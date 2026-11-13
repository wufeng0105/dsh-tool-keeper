/**
 * dsh-toolwarden — 规则引擎（纯函数，无宿主依赖）。
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
 * @module dsh-toolwarden/rules
 */

/** MCP 工具名的固定前缀。 */
export const MCP_PREFIX = 'mcp__';

/** 任何配置都关不掉的基础工具。关掉它们等于把会话锁死。 */
export const PROTECTED_TOOLS = Object.freeze([
  'read', 'write', 'edit', 'glob', 'grep', 'pwsh',
  'present', 'todo_write', 'ask_user_question',
  'toolwarden', 'skill',
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
 * @param raw - 来自 toolwarden.json 的原始对象
 * @returns {{ rules: object, problems: string[] }} 归一化后的规则与问题清单
 */
export function normalizeConfig(raw) {
  const problems = [];
  const empty = {
    disabledServers: new Set(),
    serverKeep: new Map(),   // server -> Set<leaf>
    toolOverrides: new Map(), // full name -> 'drop' | 'keep'
    rewrites: new Map(),     // full name -> string
  };

  if (raw === null || raw === undefined) return { rules: empty, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('config root must be an object, got ' + describe(raw));
    return { rules: empty, problems };
  }

  // ---- servers: { name: { enabled?: bool, keep?: string[] } } ----
  if (raw.servers !== undefined) {
    if (raw.servers === null || typeof raw.servers !== 'object' || Array.isArray(raw.servers)) {
      problems.push('servers must be an object, got ' + describe(raw.servers));
    } else {
      for (const [server, value] of Object.entries(raw.servers)) {
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
  if (raw.rewrite !== undefined) {
    if (raw.rewrite === null || typeof raw.rewrite !== 'object' || Array.isArray(raw.rewrite)) {
      problems.push('rewrite must be an object, got ' + describe(raw.rewrite));
    } else {
      for (const [name, text] of Object.entries(raw.rewrite)) {
        if (typeof text !== 'string') {
          problems.push(`rewrite.${name} must be a string, got ` + describe(text));
          continue;
        }
        empty.rewrites.set(name, text);
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
  const text = rules.rewrites.get(name);
  if (typeof text === 'string') {
    return { action: 'rewrite', description: text, reason: 'rewrite configured' };
  }
  return { action: 'keep', reason: 'no rule' };
}

/**
 * 对一次注册做最终裁决，包含改写。
 * 这是宿主侧实际调用的入口。
 *
 * @param definition - 原始工具定义（有 name / description）
 * @param rules - 归一化后的规则
 * @param knownServers - 当前已知的 MCP 服务器名集合
 * @returns {{ drop: boolean, definition: object, reason: string }}
 */
export function applyToDefinition(definition, rules, knownServers) {
  const name = definition === null || definition === undefined ? undefined : definition.name;
  const verdict = decide(name, rules, knownServers);
  if (verdict.action === 'drop') {
    return { drop: true, definition, reason: verdict.reason };
  }
  if (verdict.action === 'rewrite') {
    // 浅拷贝，只换 description；结构（parameters/output/execute）原样保留（D2）
    return {
      drop: false,
      definition: { ...definition, description: verdict.description },
      reason: verdict.reason,
    };
  }
  return { drop: false, definition, reason: verdict.reason };
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
