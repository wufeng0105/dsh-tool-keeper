/**
 * dsh-tool-keeper —— 说明页半边：系统提示词里的 MCP 服务器说明处理。
 *
 * 工具半边（index.js 的注册补丁）管「工具卡片」；这里管「说明页」：
 * 每台 MCP 服务器在系统提示词里有一个段落 `mcp:<server>`（服务器下发的使用说明，
 * 正文自带 `### MCP server: <名>` 标题行，见 dsh-mcp-client/src/connection.ts:316-317），
 * 另有一个名单段 `mcp-resource-servers`（列出所有服务器名字）。
 *
 * 三件事，读同一份启动时规则：
 * - 服务器开关关掉 → 说明段与名单名字一起消失（0.5.0）；
 * - 配了 servers.<名>.rewrite → 说明段正文整段替换（0.6.0）；
 * - 顺手把见到的原始说明记下来，供设置页的编辑器显示原文。
 *
 * 接缝：宿主官方 waterfall `system-prompt/assemble`（inspect 实查）。
 * 监听器先 next() 拿上游结果，再处理 sections，返回；返回文本权威。
 *
 * 纯函数核心零宿主依赖，可单测。fail-open：任何一步失败都原样放行并记诊断，
 * 绝不因本插件的 bug 弄坏系统提示词。
 *
 * @module dsh-tool-keeper/instructions
 */

/** 名单段里 JSON 数组的锚点前缀（宿主 dsh-mcp-resources 的正文格式）。 */
const LIST_ANCHOR = 'as the server argument: ';

/**
 * 处理一次组装的 sections。
 *
 * - 停用服务器的 `mcp:<s>` 段：整段移除（移除前记原文）；
 * - 未停用且配了改写：正文字段整段替换为改写文本，强制 interpolate:false
 *   （用户正文里的 `{{` 在渲染时会抛错，见 dsh-system-prompt/src/index.ts:297-302）；
 * - 名单段：剔除停用名字后重写 JSON 数组；剔空 → 整段文本置 ''；
 * - 其他段：原样。
 *
 * 不做插入：`mcp:<server>` 段由服务器插件装配时注册（server-context.ts:33-38），
 * 连不上时正文为 ''，所以「没有说明」不等于「没有段」。改写配了但组装里没有该段
 * → 不改动，如实报「本次未生效」。
 *
 * @param {Array<{name: string, text: string}>} sections - 组装后的段落（可变数组）
 * @param {Set<string>|string[]} disabledServers - 停用的服务器名
 * @param {Map<string,string>|object} serverRewrites - 服务器名 → 说明页改写
 * @returns {{ sections: Array, removed: string[], rewritten: string[], originals: Map<string,string>, diagnostics: Array<{kind: string, target: string, message: string}> }}
 */
export function filterSections(sections, disabledServers, serverRewrites) {
  const disabled = new Set(disabledServers || []);
  const rewrites = serverRewrites instanceof Map
    ? serverRewrites
    : new Map(Object.entries(serverRewrites || {}));
  const diagnostics = [];
  const removed = [];
  const rewritten = [];
  const originals = new Map();
  if (!Array.isArray(sections)) {
    return { sections: [], removed, rewritten, originals, diagnostics };
  }

  const seenMcpServers = new Set();
  const out = [];
  for (const section of sections) {
    if (section === null || typeof section !== 'object') { out.push(section); continue; }
    const name = typeof section.name === 'string' ? section.name : '';

    // 1) 服务器说明段
    if (name.startsWith('mcp:')) {
      const server = name.slice(4);
      seenMcpServers.add(server);
      const text = typeof section.text === 'string' ? section.text : '';
      // 原文先记：停用的也要记，否则编辑器永远读不到它的原文
      originals.set(server, text);

      if (disabled.has(server)) {
        removed.push(server);
        continue;
      }
      const rewrite = rewrites.get(server);
      if (rewrite !== undefined && rewrite.trim() !== '') {
        rewritten.push(server);
        out.push({ ...section, text: rewrite, interpolate: false });
        continue;
      }
      out.push(section);
      continue;
    }

    // 2) 名单段：剔除名字后重写
    if (name === 'mcp-resource-servers' && typeof section.text === 'string') {
      const nextText = rewriteList(section.text, disabled, diagnostics);
      out.push(nextText === section.text ? section : { ...section, text: nextText });
      continue;
    }

    out.push(section);
  }

  // 3) 有改写却没有对应段：不改动，如实报告（未连接 / 完整提示词预设 / 服务器不在本会话作用域）
  for (const [server, rewrite] of rewrites) {
    if (rewrite.trim() === '' || disabled.has(server) || seenMcpServers.has(server)) continue;
    diagnostics.push({
      kind: 'warning',
      target: 'servers.' + server + '.rewrite',
      message: `服务器 ${server} 的说明页改写本次未生效：组装里没有它的说明段（未连接，或该会话使用完整提示词预设）`,
    });
  }

  // 4) 有停用服务器却什么都没滤到：如实报告（未连接 / 完整提示词预设）
  const untouched = [...disabled].filter(s => !seenMcpServers.has(s));
  if (untouched.length > 0) {
    diagnostics.push({
      kind: 'warning',
      target: 'instructions',
      message: `服务器 ${untouched.join('、')} 已停用，但本次组装未见其说明段（未连接，或该会话使用完整提示词预设——后者说明页过滤不生效）`,
    });
  }

  return { sections: out, removed, rewritten, originals, diagnostics };
}

/**
 * 重写名单段正文：锚定 `as the server argument: ` 后的 JSON 数组，容忍尾部句点。
 * 解析失败原样返回并记诊断；剔空返回 ''。
 */
function rewriteList(text, disabled, diagnostics) {
  const at = text.indexOf(LIST_ANCHOR);
  if (at < 0) {
    diagnostics.push({
      kind: 'warning',
      target: 'instructions',
      message: '名单段正文格式与预期不符，未改动（宿主文案可能已更新）',
    });
    return text;
  }
  const start = at + LIST_ANCHOR.length;
  // 从锚点后第一个 '[' 起，用括号配平找数组尾（容忍尾句点与其余文案）
  const open = text.indexOf('[', start);
  if (open < 0) {
    diagnostics.push({ kind: 'warning', target: 'instructions', message: '名单段里找不到名字数组，未改动' });
    return text;
  }
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) {
    diagnostics.push({ kind: 'warning', target: 'instructions', message: '名单段名字数组不闭合，未改动' });
    return text;
  }
  let names;
  try {
    names = JSON.parse(text.slice(open, end + 1));
  } catch {
    diagnostics.push({ kind: 'warning', target: 'instructions', message: '名单段名字数组解析失败，未改动' });
    return text;
  }
  if (!Array.isArray(names)) {
    diagnostics.push({ kind: 'warning', target: 'instructions', message: '名单段名字数组不是数组，未改动' });
    return text;
  }
  const kept = names.filter(n => !disabled.has(n));
  if (kept.length === names.length) return text; // 无停用名字在列：原样
  if (kept.length === 0) return '';
  return text.slice(0, open) + JSON.stringify(kept) + text.slice(end + 1);
}

/**
 * 安装 waterfall 监听器。与工具补丁分开安装、分开还原。
 *
 * - 宿主没有 `ctx.on`（测试桩/异常环境）→ 不安装，返回 installed:false + 原因；
 * - 监听器内部任何异常 → 吞掉、记诊断、返回上游结果（fail-open）。
 *
 * @param ctx - Cordis 上下文
 * @param rules - 启动时 normalizeConfig 的结果（与工具补丁同源，重启生效）
 * @param state - 共享事实对象：{ installed, removed, rewritten, originals: Map, diagnostics, reason? }
 * @param log - makeLogger 产物
 * @returns {{ installed: boolean, reason?: string, restore: () => void }}
 */
export function installInstructionsFilter(ctx, rules, state, log) {
  if (typeof ctx?.on !== 'function') {
    state.installed = false;
    state.reason = '宿主上下文没有事件接口，说明页过滤未安装';
    log.warn(state.reason);
    return { installed: false, reason: state.reason, restore: () => {} };
  }
  if (!(state.originals instanceof Map)) state.originals = new Map();

  let restore = () => {};
  try {
    restore = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const upstream = await next();
      try {
        const result = filterSections(upstream?.sections, rules.disabledServers, rules.serverRewrites);
        state.removed = result.removed;
        state.rewritten = result.rewritten;
        // 原文按服务器合并、只增不删：段文本是连接级常量，跨会话合并安全；
        // 服务器下线后保留最后见过的值（界面照实展示，不冒充最新）。
        for (const [server, text] of result.originals) state.originals.set(server, text);
        state.diagnostics = result.diagnostics;
        return { ...upstream, sections: result.sections };
      } catch (error) {
        state.diagnostics = [{
          kind: 'warning',
          target: 'instructions',
          message: '说明页处理出错，本次原样放行：' + String(error?.message ?? error),
        }];
        log.warn(state.diagnostics[0].message);
        return upstream;
      }
    });
    state.installed = true;
  } catch (error) {
    state.installed = false;
    state.reason = '说明页监听器安装失败：' + String(error?.message ?? error);
    log.warn(state.reason);
    return { installed: false, reason: state.reason, restore: () => {} };
  }

  return {
    installed: true,
    restore: () => { try { restore(); } catch { /* 卸载失败不阻断 */ } },
  };
}