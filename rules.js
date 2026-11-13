/**
 * dsh-tool-keeper — 规则引擎（纯函数，无宿主依赖）。
 *
 * 这一层的职责：给定「当前注册表里的工具」和「用户配置」，算出每一个工具应当
 * 被如何处理。它不碰 ctx、不碰文件、不碰网络，所以可以用 node --test 直接验证。
 *
 * ## 为什么单独抽出这一层
 *
 * 宿主侧（index.js）要做的是打补丁、读配置、接事件；这些都无法单元测试。
 * 但「哪个工具该隐藏、哪个该改写」是纯计算，可以完全测透。把判定式和接线分开，
 * 是让「检查先证明会红」这件事真的可做的前提。
 *
 * ## 三种裁决
 *
 * - `drop`   —— 不注册。工具不进注册表，模型完全看不见。
 * - `rewrite`—— 注册，但 description 换成用户写的文本。
 * - `keep`   —— 原样放行。
 *
 * ## 优先级（REQUIREMENTS.md M5）
 *
 *   单工具规则  >  服务器白名单  >  服务器总开关
 *
 * 归一化时取最具体者，不保存三层原始意图。
 *
 * @module dsh-tool-keeper/rules
 */

/** MCP 工具名的固定前缀。 */
export const MCP_PREFIX = 'mcp__';

/** 任何配置都关不掉的基础工具。关掉它们等于把会话锁死。 */
export const PROTECTED_TOOLS = Object.freeze([
  'read', 'write', 'edit', 'glob', 'grep', 'pwsh',
  'present', 'todo_write', 'ask_user_question',
  'tool_keeper', 'skill',
]);

/**
 * 从公开工具名拆出 (server, leaf)。
 * `mcp__tinyfish__fetch_content` → `{ server: 'tinyfish', leaf: 'fetch_content' }`
 * 非 MCP 名字返回 undefined。
 * @param name - 注册名
 * @returns 拆分结果，或 undefined
 */
export function splitMcpName(name) {
  if (typeof name !== 'string' || !name.startsWith(MCP_PREFIX)) return undefined;
  const rest = name.slice(MCP_PREFIX.length);
  const cut = rest.indexOf('__');
  if (cut <= 0 || cut + 2 >= rest.length) return undefined;
  return { server: rest.slice(0, cut), leaf: rest.slice(cut + 2) };
}

/** 一个工具被归到哪一组：`mcp:tinyfish` 或 `core`。 */
export function groupOf(name) {
  const parts = splitMcpName(name);
  return parts === undefined ? 'core' : 'mcp:' + parts.server;
}

/** 是否受保护（永不被隐藏）。只按完整名字精确匹配。 */
export function isProtected(name) {
  return PROTECTED_TOOLS.includes(name);
}

/**
 * 归一化配置。非法输入不抛异常 —— 按最宽松解释处理并记入 problems，
 * 因为一个坏配置绝不能中断工具注册链（REQUIREMENTS R4.5）。
 *
 * @param raw - 来自 tool-keeper.json 的原始对象
 * @returns {{ rules: object, problems: string[] }} 归一化后的规则与问题清单
 */
export function normalizeConfig(raw) {
  const problems = [];
  const empty = {
    enabled: true,
    disabledServers: new Set(),
    serverKeep: new Map(),   // server -> Set<leaf>
    toolOverrides: new Map(), // full name -> 'drop' | 'keep'
    rewrites: new Map(),     // full name -> { description?, properties: Map }
  };

  if (raw === null || raw === undefined) return { rules: empty, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('config root must be an object, got ' + describe(raw));
    return { rules: empty, problems };
  }

  // ---- enabled: 总开关（R4.4）。放这里而不是插件 Config：
  //      插件 Config 要改 cordis.patch.yml + 重启，不算「一键」。
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') {
      problems.push('enabled must be a boolean, got ' + describe(raw.enabled));
    } else {
      empty.enabled = raw.enabled;
    }
  }

  // ---- servers: { name: { enabled?: bool, keep?: string[] } } ----
  if (raw.servers !== undefined) {
    if (raw.servers === null || typeof raw.servers !== 'object' || Array.isArray(raw.servers)) {
      problems.push('servers must be an object, got ' + describe(raw.servers));
    } else {
      for (const [server, value] of Object.entries(raw.servers)) {
        if (isDangerousKey(server)) {
          problems.push(`servers.${server} is not a valid server name; ignored`);
          continue;
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          problems.push(`servers.${server} must be an object, got ` + describe(value));
          continue;
        }
        if (value.enabled === false) empty.disabledServers.add(server);
        if (value.keep !== undefined) {
          if (!Array.isArray(value.keep)) {
            problems.push(`servers.${server}.keep must be an array, got ` + describe(value.keep));
          } else {
            const keep = new Set();
            for (const leaf of value.keep) {
              if (typeof leaf !== 'string' || leaf === '') {
                problems.push(`servers.${server}.keep contains a non-string entry`);
                continue;
              }
              keep.add(leaf);
            }
            empty.serverKeep.set(server, keep);
          }
        }
      }
    }
  }

  // ---- tools: { fullName: 'drop' | 'keep' } ----
  if (raw.tools !== undefined) {
    if (raw.tools === null || typeof raw.tools !== 'object' || Array.isArray(raw.tools)) {
      problems.push('tools must be an object, got ' + describe(raw.tools));
    } else {
      for (const [name, action] of Object.entries(raw.tools)) {
        if (isDangerousKey(name)) {
          problems.push(`tools.${name} is not a valid tool name; ignored`);
          continue;
        }
        if (action !== 'drop' && action !== 'keep') {
          problems.push(`tools.${name} must be "drop" or "keep", got ` + describe(action));
          continue;
        }
        if (isProtected(name)) {
          problems.push(`tools.${name} is protected and cannot be overridden; ignored`);
          continue;
        }
        empty.toolOverrides.set(name, action);
      }
    }
  }

  // ---- rewrite: { fullName: 'new description' } ----
  // 值可以是字符串（改工具说明），也可以是对象（改参数说明，R2.2）
  if (raw.rewrite !== undefined) {
    if (raw.rewrite === null || typeof raw.rewrite !== 'object' || Array.isArray(raw.rewrite)) {
      problems.push('rewrite must be an object, got ' + describe(raw.rewrite));
    } else {
      for (const [name, value] of Object.entries(raw.rewrite)) {
        if (isDangerousKey(name)) {
          problems.push(`rewrite.${name} is not a valid tool name; ignored`);
          continue;
        }
        if (typeof value === 'string') {
          // 字符串是对象形态的简写：只改工具说明
          empty.rewrites.set(name, { description: value, properties: new Map() });
          continue;
        }
        // R2.2：对象形态 { description?: string, properties?: { 参数名: string } }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          problems.push(`rewrite.${name} must be a string or an object, got ` + describe(value));
          continue;
        }
        const entry = { properties: new Map() };
        if (value.description !== undefined) {
          if (typeof value.description !== 'string') {
            problems.push(`rewrite.${name}.description must be a string`);
          } else {
            entry.description = value.description;
          }
        }
        if (value.properties !== undefined) {
          if (value.properties === null || typeof value.properties !== 'object' || Array.isArray(value.properties)) {
            problems.push(`rewrite.${name}.properties must be an object`);
          } else {
            for (const [param, text] of Object.entries(value.properties)) {
              if (typeof text !== 'string') {
                problems.push(`rewrite.${name}.properties.${param} must be a string`);
                continue;
              }
              entry.properties.set(param, text);
            }
          }
        }
        if (entry.description === undefined && entry.properties.size === 0) {
          problems.push(`rewrite.${name} has neither description nor properties; ignored`);
          continue;
        }
        empty.rewrites.set(name, entry);
      }
    }
  }

  return { rules: empty, problems };
}

/** 一行错误描述，避免把巨大对象打进日志。 */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value.slice(0, 40));
  if (t === 'object') return 'object';
  return String(value);
}

/**
 * 原型链上的危险键。
 *
 * 允许它们当配置键有两个后果：`servers.__proto__ = {...}` 会走到原型 setter，
 * 结果「报成功但什么也没写」；`tools.__proto__ = 'drop'` 会落盘成一个看着正常
 * 却永远不生效的条目。两种都是谎报，所以在解析阶段直接拒绝。
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isDangerousKey(key) {
  return DANGEROUS_KEYS.has(key);
}

/**
 * 判定一个工具该怎么处理。
 *
 * 优先级：单工具规则 > 服务器白名单 > 服务器总开关。
 *
 * @param name - 工具的注册名
 * @param rules - normalizeConfig 返回的 rules
 * @param knownServers - 当前确认存在的 MCP 服务器名集合（用于诊断，可省略）
 * @returns {{ action: 'keep'|'drop'|'rewrite', description?: string, reason: string }}
 */
export function decide(name, rules, knownServers) {
  if (typeof name !== 'string' || name === '') {
    return { action: 'keep', reason: 'unnamed' };
  }

  // 保护名单优先于一切
  if (isProtected(name)) {
    return { action: 'keep', reason: 'protected' };
  }

  // 1. 单工具规则（最具体）
  const override = rules.toolOverrides.get(name);
  if (override === 'keep') {
    return { action: 'keep', reason: 'tool override: keep' };
  }
  if (override === 'drop') {
    return { action: 'drop', reason: 'tool override: drop' };
  }

  // 2. 服务器白名单 / 3. 服务器总开关（仅对 MCP 工具）
  const parts = splitMcpName(name);
  if (parts !== undefined) {
    if (knownServers !== undefined && !knownServers.has(parts.server)) {
      // 未知服务器：不隐藏（配置可能来自另一台机器/另一环境）
      return { action: 'keep', reason: `unknown server "${parts.server}"` };
    }
    const keep = rules.serverKeep.get(parts.server);
    if (keep !== undefined) {
      if (!keep.has(parts.leaf)) {
        return { action: 'drop', reason: `not in ${parts.server} keep list` };
      }
    } else if (rules.disabledServers.has(parts.server)) {
      return { action: 'drop', reason: `server ${parts.server} disabled` };
    }
  }

  // 到这里仍是 keep —— 但可能有改写
  const entry = rules.rewrites.get(name);
  if (entry !== undefined) {
    return { action: 'rewrite', rewrite: entry, reason: 'rewrite configured' };
  }
  return { action: 'keep', reason: 'no rule' };
}

/**
 * 在 parameters 的深拷贝上替换指定参数的 description（R2.2）。
 *
 * 只改 `properties.<param>.description`，不碰 type / required / enum / 默认值（D2）。
 * 不存在该参数时跳过并返回未命中的参数名，供诊断使用。
 *
 * @param parameters - 原始 parameters 对象
 * @param overrides - Map<参数名, 新说明>
 * @returns {{ parameters: object, applied: string[], missing: string[] }}
 */
export function rewriteParameterDescriptions(parameters, overrides) {
  const applied = [];
  const missing = [];
  if (parameters === null || typeof parameters !== 'object' || overrides.size === 0) {
    return { parameters, applied, missing: [...overrides.keys()] };
  }
  const properties = parameters.properties;
  if (properties === null || typeof properties !== 'object') {
    return { parameters, applied, missing: [...overrides.keys()] };
  }

  let next;
  for (const [param, text] of overrides) {
    const node = properties[param];
    if (node === null || typeof node !== 'object') {
      missing.push(param);
      continue;
    }
    // 首次命中时才拷贝，避免无谓的深拷贝
    if (next === undefined) {
      next = { ...parameters, properties: { ...properties } };
    }
    next.properties[param] = { ...node, description: text };
    applied.push(param);
  }
  return { parameters: next === undefined ? parameters : next, applied, missing };
}

/**
 * 对一次注册做最终裁决，包含改写。
 * 这是宿主侧实际调用的入口。
 *
 * @param definition - 原始工具定义（有 name / description / parameters）
 * @param rules - 归一化后的规则
 * @param knownServers - 当前已知的 MCP 服务器名集合
 * @returns {{ drop: boolean, definition: object, reason: string, missingParams?: string[] }}
 */
export function applyToDefinition(definition, rules, knownServers) {
  const name = definition === null || definition === undefined ? undefined : definition.name;
  const verdict = decide(name, rules, knownServers);
  if (verdict.action === 'drop') {
    return { drop: true, definition, reason: verdict.reason };
  }
  if (verdict.action === 'rewrite') {
    const entry = verdict.rewrite;
    let next = definition;
    const missingParams = [];

    // R2.1 工具说明
    if (typeof entry.description === 'string') {
      next = { ...next, description: entry.description };
    }
    // R2.2 参数说明
    if (entry.properties !== undefined && entry.properties.size > 0) {
      const result = rewriteParameterDescriptions(next.parameters, entry.properties);
      if (result.parameters !== next.parameters) {
        next = { ...next, parameters: result.parameters };
      }
      missingParams.push(...result.missing);
    }
    return {
      drop: false,
      definition: next,
      reason: verdict.reason,
      ...missingParams.length > 0 ? { missingParams } : {},
    };
  }
  return { drop: false, definition, reason: verdict.reason };
}

/**
 * 工具目录：注册时留存每个工具的原始文本与体量。
 *
 * 没有它就做不到三件事（审计指出）：
 * - R2.4「一键还原」—— 没有原文，只能删配置 + 重启
 * - R3.3「展开看到并编辑」—— 界面要显示「现在是什么」和「原来是怎样」
 * - R3.4「token 占用」—— 没有原文算不出省了多少
 *
 * @module dsh-tool-keeper/catalog
 */
export class ToolCatalog {
  constructor() {
    /** name → { description, parameters, group, server, leaf, originalChars, originalDescChars } */
    this.entries = new Map();
  }

  /** 注册时记录原始定义。只记不存在的，避免改写后的值覆盖原文。 */
  record(definition) {
    const name = definition === null || definition === undefined ? undefined : definition.name;
    if (typeof name !== 'string' || name === '' || this.entries.has(name)) return;
    const description = typeof definition.description === 'string' ? definition.description : '';
    const parameters = definition.parameters;
    const parts = splitMcpName(name);
    this.entries.set(name, {
      name,
      group: groupOf(name),
      server: parts === undefined ? undefined : parts.server,
      leaf: parts === undefined ? undefined : parts.leaf,
      description,
      parameters,
      originalDescChars: description.length,
      originalChars: description.length + safeLength(parameters),
      protected: isProtected(name),
    });
  }

  has(name) {
    return this.entries.has(name);
  }

  get(name) {
    return this.entries.get(name);
  }

  /** 按来源分组，供界面渲染。 */
  groups() {
    const out = new Map();
    for (const entry of this.entries.values()) {
      let list = out.get(entry.group);
      if (list === undefined) {
        list = [];
        out.set(entry.group, list);
      }
      list.push(entry);
    }
    for (const list of out.values()) list.sort((a, b) => b.originalChars - a.originalChars);
    return out;
  }

  /** 全部原始工具名。 */
  names() {
    return [...this.entries.keys()];
  }

  size() {
    return this.entries.size;
  }
}

/** 计算 JSON 长度，失败返回 0。 */
function safeLength(value) {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * 诊断：找出配置里那些「写了但从没匹配到任何工具」的条目。
 * 静默失效的过滤器比没有过滤器更坏（REQUIREMENTS R3.5/A8）。
 *
 * @param rules - 归一化后的规则
 * @param seenNames - 本次运行中实际见过的工具名
 * @param knownServers - 从 profiles 配置读到的 MCP 服务器名
 * @returns {{ kind: string, target: string, message: string }[]}
 */
export function diagnose(rules, seenNames, knownServers) {
  const out = [];
  const seen = new Set(seenNames || []);
  const servers = new Set(knownServers || []);

  // 三态判定（REQUIREMENTS A8）
  const configuredServers = new Set([
    ...rules.disabledServers,
    ...rules.serverKeep.keys(),
  ]);
  for (const server of configuredServers) {
    if (!servers.has(server)) {
      out.push({ kind: 'error', target: 'servers.' + server, message: 'server not found in mcp-manager.servers' });
      continue;
    }
    const anySeen = [...seen].some(n => {
      const p = splitMcpName(n);
      return p !== undefined && p.server === server;
    });
    if (!anySeen) {
      out.push({ kind: 'warning', target: 'servers.' + server, message: 'server configured but currently has no tools (not connected?)' });
      continue;
    }
    const keep = rules.serverKeep.get(server);
    if (keep !== undefined) {
      for (const leaf of keep) {
        if (!seen.has(MCP_PREFIX + server + '__' + leaf)) {
          out.push({ kind: 'warning', target: `servers.${server}.keep.${leaf}`, message: 'tool not found (renamed?)' });
        }
      }
    }
  }

  for (const name of rules.toolOverrides.keys()) {
    if (!seen.has(name)) {
      out.push({ kind: 'warning', target: 'tools.' + name, message: 'tool not found (renamed or server offline?)' });
    }
  }
  for (const name of rules.rewrites.keys()) {
    if (!seen.has(name)) {
      out.push({ kind: 'warning', target: 'rewrite.' + name, message: 'tool not found (renamed or server offline?)' });
    }
  }

  return out;
}
