/**
 * dsh-tool-keeper —— 说明页半边：系统提示词里的 MCP 服务器说明过滤。
 *
 * 工具半边（index.js 的注册补丁）管「工具卡片」；这里管「说明页」：
 * 每台 MCP 服务器在系统提示词里有一个段落 `mcp:<server>`（服务器下发的使用说明），
 * 另有一个名单段 `mcp-resource-servers`（列出所有服务器名字）。
 * 服务器开关关掉时，两半一起消失；开回来一起恢复。
 *
 * 接缝：宿主官方 waterfall `system-prompt/assemble`（inspect 实查）。
 * 监听器先 next() 拿上游结果，再过滤 sections，返回；返回文本权威。
 *
 * 纯函数核心零宿主依赖，可单测。fail-open：任何一步失败都原样放行并记诊断，
 * 绝不因本插件的 bug 弄坏系统提示词。
 *
 * @module dsh-tool-keeper/instructions
 */

/** 名单段里 JSON 数组的锚点前缀（宿主 dsh-mcp-resources 的正文格式）。 */
const LIST_ANCHOR = 'as the server argument: ';

/**
 * 过滤一次组装的 sections。
 *
 * - 移除名字为 `mcp:<server>`（server 在停用集合里）的段落；
 * - 名单段剔除停用名字后重写 JSON 数组；剔空 → 整段文本置 ''（宿主渲染时过滤空段）；
 * - 名单段解析失败 → 原样保留 + 诊断；
 * - 有停用服务器、但一个段落都没命中 → 诊断「本次组装未见其说明段」
 *   （可能未连接，也可能该会话用了完整提示词预设——后者宿主在 waterfall 后
 *   无条件恢复 complete 段，本插件观测不到，如实报告不冒充）。
 *
 * @param {Array<{name: string, text: string}>} sections - 组装后的段落（可变数组）
 * @param {Set<string>|string[]} disabledServers - 停用的服务器名
 * @returns {{ sections: Array, removed: string[], diagnostics: Array<{kind: string, target: string, message: string}> }}
 */
export function filterSections(sections, disabledServers) {
  const disabled = new Set(disabledServers || []);
  const diagnostics = [];
  const removed = [];
  if (!Array.isArray(sections) || disabled.size === 0) {
    return { sections: Array.isArray(sections) ? sections : [], removed, diagnostics };
  }

  const out = [];
  for (const section of sections) {
    if (section === null || typeof section !== 'object') { out.push(section); continue; }
    const name = typeof section.name === 'string' ? section.name : '';

    // 1) 服务器说明段：整段移除
    if (name.startsWith('mcp:') && disabled.has(name.slice(4))) {
      removed.push(name.slice(4));
      continue;
    }

    // 2) 名单段：剔除名字后重写
    if (name === 'mcp-resource-servers' && typeof section.text === 'string') {
      const rewritten = rewriteList(section.text, disabled, diagnostics);
      out.push(rewritten === section.text ? section : { ...section, text: rewritten });
      continue;
    }

    out.push(section);
  }

  // 3) 有停用服务器却什么都没滤到：如实报告（未连接 / 完整提示词预设）
  const untouched = [...disabled].filter(s => !removed.includes(s));
  if (untouched.length > 0) {
    diagnostics.push({
      kind: 'warning',
      target: 'instructions',
      message: `服务器 ${untouched.join('、')} 已停用，但本次组装未见其说明段（未连接，或该会话使用完整提示词预设——后者说明页过滤不生效）`,
    });
  }

  return { sections: out, removed, diagnostics };
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
 * @param state - 共享事实对象：{ removed: string[], diagnostics: [], installed: boolean, reason?: string }
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

  let restore = () => {};
  try {
    restore = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const upstream = await next();
      try {
        const result = filterSections(upstream?.sections, rules.disabledServers);
        state.removed = result.removed;
        state.diagnostics = result.diagnostics;
        return { ...upstream, sections: result.sections };
      } catch (error) {
        state.diagnostics = [{
          kind: 'warning',
          target: 'instructions',
          message: '说明页过滤出错，本次原样放行：' + String(error?.message ?? error),
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