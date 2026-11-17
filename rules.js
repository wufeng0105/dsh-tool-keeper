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
 * ## 优先级（DESIGN「规则冲突时听谁的」）
 *
 *   保护名单  >  服务器总开关  >  单工具规则
 *
 * 两条边界：
 * - 服务器总开关是「整台取消注册」的物理闸，压过一切逐条规则（关 = 一个不剩）。
 * - 单工具规则是唯一的选择层：没明确 drop 的默认 keep；keep 与 rewrite 正交
 *   （工具没被隐藏时，改写仍然生效）。
 *
 * 本模块不提供「白名单」或插件级全局开关：前者只是「只留这些」的压缩写法，
 * 与逐条 drop 重复；后者归 DSH 插件页。
 *
 * 判定不依赖「宿主当前有哪些服务器」：归属只从工具名 `mcp__<server>__<leaf>` 解析，
 * 用户显式写下的规则就是意图；服务器没连上时没有工具出现，规则自然惰性。
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
 * 因为一个坏配置绝不能中断工具注册链（DESIGN「七、可靠性与已知风险」第 4 条）。
 *
 * @param raw - 来自 tool-keeper.json 的原始对象
 * @returns {{ rules: object, problems: string[] }} 归一化后的规则与问题清单
 */
export function normalizeConfig(raw) {
  const problems = [];
  const empty = {
    disabledServers: new Set(),
    serverRewrites: new Map(), // server -> 说明页改写文本（空 = 原样）
    toolOverrides: new Map(), // full name -> 'drop' | 'keep'
    rewrites: new Map(),     // full name -> { description?, properties: Map }
  };

  if (raw === null || raw === undefined) return { rules: empty, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('配置根必须是一个对象，实际是 ' + describe(raw));
    return { rules: empty, problems };
  }

  // ---- enabled: 已移除。插件级启停归 DSH 插件页，本插件不再维护全局开关 ----
  if (raw.enabled !== undefined) {
    problems.push('enabled 已移除：插件级启停请用 DSH 插件页；请删掉这个字段');
  }

  // ---- servers: { name: { enabled?: bool } } ----
  if (raw.servers !== undefined) {
    if (raw.servers === null || typeof raw.servers !== 'object' || Array.isArray(raw.servers)) {
      problems.push('servers 必须是对象，实际是 ' + describe(raw.servers));
    } else {
      for (const [server, value] of Object.entries(raw.servers)) {
        if (isDangerousKey(server)) {
          problems.push(`servers.${server} 不是合法的服务器名，已忽略`);
          continue;
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          problems.push(`servers.${server} 必须是对象，实际是 ` + describe(value));
          continue;
        }
        if (value.enabled === false) empty.disabledServers.add(server);
        if (value.rewrite !== undefined) {
          if (typeof value.rewrite !== 'string') {
            problems.push(`servers.${server}.rewrite 必须是字符串，实际是 ` + describe(value.rewrite));
          } else if (value.rewrite.trim() !== '') {
            // 原样保存（不 trim）：正文里的换行是用户意图，渲染按 '\n\n' 拼接
            empty.serverRewrites.set(server, value.rewrite);
          }
          // 空串/纯空白 = 未配置：静默忽略（调用方负责不把它落盘）
        }
        if (value.keep !== undefined) {
          // 白名单已移除：必须报出来，不能静默忽略——静默忽略等于把工具全放出来
          problems.push(
            `servers.${server}.keep 已移除：请改写成 tools.<完整名> = "drop"`,
          );
        }
      }
    }
  }

  // ---- tools: { fullName: 'drop' | 'keep' } ----
  if (raw.tools !== undefined) {
    if (raw.tools === null || typeof raw.tools !== 'object' || Array.isArray(raw.tools)) {
      problems.push('tools 必须是对象，实际是 ' + describe(raw.tools));
    } else {
      for (const [name, action] of Object.entries(raw.tools)) {
        if (isDangerousKey(name)) {
          problems.push(`tools.${name} 不是合法的工具名，已忽略`);
          continue;
        }
        if (action !== 'drop' && action !== 'keep') {
          problems.push(`tools.${name} 只能是 'drop' 或 'keep'，实际是 ` + describe(action));
          continue;
        }
        if (isProtected(name)) {
          problems.push(`tools.${name} 是受保护工具，不能覆盖，已忽略`);
          continue;
        }
        empty.toolOverrides.set(name, action);
      }
    }
  }

  // ---- rewrite: { fullName: 'new description' } ----
  // 值可以是字符串（改工具说明），也可以是对象（改参数说明）
  if (raw.rewrite !== undefined) {
    if (raw.rewrite === null || typeof raw.rewrite !== 'object' || Array.isArray(raw.rewrite)) {
      problems.push('rewrite 必须是对象，实际是 ' + describe(raw.rewrite));
    } else {
      for (const [name, value] of Object.entries(raw.rewrite)) {
        if (isDangerousKey(name)) {
          problems.push(`rewrite.${name} 不是合法的工具名，已忽略`);
          continue;
        }
        if (typeof value === 'string') {
          // 字符串是对象形态的简写：只改工具说明。
          // 空串/纯空白 = 未配置，与 servers.<名>.rewrite 同一口径：
          // 用户写 "" 是想「别改了」，不是想把工具说明抹成空白；
          // 后者会让模型拿到一个没有说明的工具，且不会留下任何痕迹。
          if (value.trim() === '') {
            problems.push(`rewrite.${name} 是空字符串，已忽略（要撤销改写请删掉这个键）`);
            continue;
          }
          empty.rewrites.set(name, { description: value, properties: new Map() });
          continue;
        }
        // 对象形态 { description?: string, properties?: { 参数名: string } }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          problems.push(`rewrite.${name} 必须是字符串或对象，实际是 ` + describe(value));
          continue;
        }
        const entry = { properties: new Map() };
        if (value.description !== undefined) {
          if (typeof value.description !== 'string') {
            problems.push(`rewrite.${name}.description 必须是字符串`);
          } else if (value.description.trim() === '') {
            // 同字符串形态：空 description 是想「别改说明」，不是想抹成空白
            problems.push(`rewrite.${name}.description 是空字符串，已忽略（要撤销请删掉这个字段）`);
          } else {
            entry.description = value.description;
          }
        }
        if (value.properties !== undefined) {
          if (value.properties === null || typeof value.properties !== 'object' || Array.isArray(value.properties)) {
            problems.push(`rewrite.${name}.properties 必须是对象`);
          } else {
            for (const [param, text] of Object.entries(value.properties)) {
              // 危险键必须挡住：写 properties.__proto__ 命中的是原型对象而不是参数，
              // 赋值不生效、又不落入 missing，等于静默谎报。
              if (isDangerousKey(param)) {
                problems.push(`rewrite.${name}.properties.${param} 不是合法的参数名，已忽略`);
                continue;
              }
              if (typeof text !== 'string') {
                problems.push(`rewrite.${name}.properties.${param} 必须是字符串`);
                continue;
              }
              if (text.trim() === '') {
                problems.push(`rewrite.${name}.properties.${param} 是空字符串，已忽略（要撤销请删掉这个字段）`);
                continue;
              }
              entry.properties.set(param, text);
            }
          }
        }
        if (entry.description === undefined && entry.properties.size === 0) {
          problems.push(`rewrite.${name} 既没有 description 也没有 properties，已忽略`);
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
 *
 * 导出是为了让 tool.js 在入口处也能挡住 —— 它构造配置时用的是普通对象赋值，
 * 字面量里的 `__proto__` 不是自有属性，normalizeConfig 看不到。
 */
export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isDangerousKey(key) {
  return DANGEROUS_KEYS.has(key);
}

/**
 * 判定一个工具该怎么处理。
 *
 * 优先级：保护名单 > 服务器总开关 > 单工具规则。
 * 判定只看配置与工具名，不依赖宿主当前有哪些服务器（见文件头）。
 *
 * @param name - 工具的注册名
 * @param rules - normalizeConfig 返回的 rules
 * @returns {{ action: 'keep'|'drop'|'rewrite', rewrite?: object, reason: string }}
 */
export function decide(name, rules) {
  if (typeof name !== 'string' || name === '') {
    return { action: 'keep', reason: 'unnamed' };
  }

  // 保护名单优先于一切
  if (isProtected(name)) {
    return { action: 'keep', reason: 'protected' };
  }

  const parts = splitMcpName(name);
  const override = rules.toolOverrides.get(name);

  if (parts !== undefined) {
    // 1. 服务器总开关：物理闸，关 = 整台一个不剩
    if (rules.disabledServers.has(parts.server)) {
      return { action: 'drop', reason: `server ${parts.server} disabled` };
    }
    // 2. 单工具规则（唯一的选择层；没明确关的默认 keep）
    if (override === 'drop') {
      return { action: 'drop', reason: 'tool override: drop' };
    }
  } else if (override === 'drop') {
    return { action: 'drop', reason: 'tool override: drop' };
  }

  // 3. 保留（单工具 keep / 无规则）—— 改写与保留正交，照套
  const entry = rules.rewrites.get(name);
  if (entry !== undefined) {
    return { action: 'rewrite', rewrite: entry, reason: 'rewrite configured' };
  }
  return { action: 'keep', reason: override === 'keep' ? 'tool override: keep' : 'no rule' };
}

/**
 * 在 parameters 的深拷贝上替换指定参数的 description。
 *
 * 只改 `properties.<param>.description`，不碰 type / required / enum / 默认值（DESIGN「只改文字，不碰结构」）。
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
    // 只能命中真正的自有参数。不能只判 `properties[param]` 是不是对象——
    // `__proto__` 会取到 Object.prototype（一个对象），于是被当成命中，
    // 而随后的赋值改的是原型链，不落任何自有属性：静默无效且不报缺失。
    if (!Object.hasOwn(properties, param)) {
      missing.push(param);
      continue;
    }
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
 * @returns {{ drop: boolean, definition: object, reason: string, missingParams?: string[] }}
 */
export function applyToDefinition(definition, rules) {
  const name = definition === null || definition === undefined ? undefined : definition.name;
  const verdict = decide(name, rules);
  if (verdict.action === 'drop') {
    return { drop: true, definition, reason: verdict.reason };
  }
  if (verdict.action === 'rewrite') {
    const entry = verdict.rewrite;
    let next = definition;
    const missingParams = [];

    // 工具说明
    if (typeof entry.description === 'string') {
      next = { ...next, description: entry.description };
    }
    // 参数说明
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
 * 工具目录：注册时留存每个工具的原始定义。
 * 没有它就做不到两件事：
 * - 「一键还原」—— 没有原文，只能删配置 + 重启
 * - 界面展开编辑—— 要显示「现在是什么」和「原来是怎样」
 *
 * 只留存文本与归属，不留存体量：本插件管的是模型读到什么，不是占多少字。
 *
 * @module dsh-tool-keeper/catalog
 */
export class ToolCatalog {
  constructor() {
    /** name → { group, server, leaf, description, protected } */
    this.entries = new Map();
  }

  /** 注册时记录原始定义。只记不存在的，避免改写后的值覆盖原文。 */
  record(definition) {
    const name = definition === null || definition === undefined ? undefined : definition.name;
    if (typeof name !== 'string' || name === '' || this.entries.has(name)) return;
    const description = typeof definition.description === 'string' ? definition.description : '';
    const parts = splitMcpName(name);
    this.entries.set(name, {
      name,
      group: groupOf(name),
      server: parts === undefined ? undefined : parts.server,
      leaf: parts === undefined ? undefined : parts.leaf,
      description,
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
    for (const list of out.values()) list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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

/**
 * 诊断：找出配置里那些「写了但不可能生效」的条目。
 * 静默失效的过滤器比没有过滤器更坏（见 docs/KNOWN-ISSUES.md 前几条）。
 *
 * ## 两个名字集合，语义不同，不能混用
 *
 * - `seenNames`：**见过**的工具名。判断「这个名字是否存在过」。
 *   被 drop 的工具按设计不会注册，但它们确实存在——所以这个集合必须包含它们，
 *   否则那些有意关掉的工具会被误报成「名字对不上（可能改名了）」。
 * - `liveNames`：**此刻在线**的工具名。判断「这台服务器连上了没有」。
 *   服务器断开后它的工具全部注销，但名字仍然「见过」。
 *
 * 早期版本只有一个集合，两种语义挤在一起：只传在线名会把被 drop 的规则全报成
 * 失效；只传见过的名则永远发现不了服务器已断开。所以拆成两个。
 *
 * @param rules - 归一化后的规则
 * @param seenNames - 曾经注册过的工具名（含被 drop 的）
 * @param liveNames - 此刻真正注册着的工具名；省略时按 seenNames 处理
 * @returns {{ kind: string, target: string, message: string }[]}
 */
export function diagnose(rules, seenNames, liveNames) {
  const out = [];
  const seen = new Set(seenNames || []);
  // 不传就退回 seen：老调用方（只关心「见过什么」的测试）仍然照旧工作。
  const live = new Set(liveNames === undefined ? (seenNames || []) : liveNames);

  const seenServers = new Set();
  for (const n of seen) {
    const p = splitMcpName(n);
    if (p !== undefined) seenServers.add(p.server);
  }
  const liveServers = new Set();
  for (const n of live) {
    const p = splitMcpName(n);
    if (p !== undefined) liveServers.add(p.server);
  }
  const serverOf = name => {
    const p = splitMcpName(name);
    return p === undefined ? 'core' : p.server;
  };

  // 1) 停用的服务器：当前有没有它的工具出现
  for (const server of rules.disabledServers) {
    if (!seenServers.has(server)) {
      out.push({
        kind: 'warning',
        target: 'servers.' + server,
        message: `服务器 ${server} 暂时没有工具出现，停用规则暂不生效（未连接或已移除，规则会保留）`,
      });
    }
  }

  // 2) 停用 + 说明页改写：两者同条目，停用优先，改写不会生效。
  //    这是纯配置事实，不必等运行时组装就能说清。
  for (const server of (rules.serverRewrites ?? new Map()).keys()) {
    if (rules.disabledServers.has(server)) {
      out.push({
        kind: 'warning',
        target: 'servers.' + server + '.rewrite',
        message: `服务器 ${server} 已停用，说明页改写不会生效（启用后生效）`,
      });
    }
  }

  // 3) 单工具规则：按服务器聚合。一台可能有几百条 drop，
  //    逐个报会刷屏；同名服务器下匹配不到的统一报一条。
  const overridesByServer = new Map();
  for (const name of rules.toolOverrides.keys()) {
    const s = serverOf(name);
    if (!overridesByServer.has(s)) overridesByServer.set(s, []);
    overridesByServer.get(s).push(name);
  }
  for (const [server, names] of overridesByServer) {
    const missing = names.filter(n => !seen.has(n));
    if (missing.length === 0) continue;
    // 「这台服务器连上了没有」要看在线名，不是见过的名：停用服务器的工具
    // 本来就全部不注册，用见过的名永远判不出它已断开。
    if (server !== 'core' && !liveServers.has(server)) {
      out.push({
        kind: 'warning',
        target: `servers.${server}`,
        message: `服务器 ${server} 的 ${names.length} 条工具规则暂不生效（服务器未连接或已移除），规则会保留`,
      });
    } else {
      const shown = missing.slice(0, 8).join('、') + (missing.length > 8 ? ` 等 ${missing.length} 个` : '');
      out.push({
        kind: 'warning',
        target: 'tools',
        message: `有 ${missing.length} 个工具名对不上（可能改名了）：${shown}`,
      });
    }
  }

  // 4) 改写：同样按服务器聚合"不存在"的情况；存在的工具再查两件会静默失效的事
  const rewritesByServer = new Map();
  for (const name of rules.rewrites.keys()) {
    const s = serverOf(name);
    if (!rewritesByServer.has(s)) rewritesByServer.set(s, []);
    rewritesByServer.get(s).push(name);
  }
  for (const [server, names] of rewritesByServer) {
    const missing = names.filter(n => !seen.has(n));
    if (missing.length > 0) {
      if (server !== 'core' && !liveServers.has(server)) {
        out.push({
          kind: 'warning',
          target: `servers.${server}`,
          message: `服务器 ${server} 的 ${names.length} 条改写暂不生效（服务器未连接或已移除），规则会保留`,
        });
      } else {
        out.push({
          kind: 'warning',
          target: 'rewrite',
          message: `有 ${missing.length} 条改写指向不存在的工具（可能改名了）：${missing.slice(0, 8).join('、')}`,
        });
      }
    }
    // 工具存在但永远不会执行到改写：说出来，别让它静默失效
    for (const name of names) {
      if (!seen.has(name)) continue;
      // 见过、但此刻不在线：改写同样用不上。
      // 不报的话就是静默——用户以为改写在生效，实际那个工具根本没注册。
      if (!live.has(name)) {
        out.push({
          kind: 'warning',
          target: 'rewrite.' + name,
          message: `工具 ${name} 当前不在线，这条改写暂时用不上（它重新注册后会自动生效）`,
        });
        continue;
      }
      const verdict = decide(name, rules);
      if (verdict.action === 'drop') {
        out.push({
          kind: 'warning',
          target: 'rewrite.' + name,
          message: `工具 ${name} 已被规则隐藏，这条改写不会生效（要它生效先把工具放出来）`,
        });
      } else if (verdict.reason === 'protected') {
        out.push({
          kind: 'warning',
          target: 'rewrite.' + name,
          message: `${name} 是受保护的基础工具，改写不会生效`,
        });
      }
    }
  }

  return out;
}
