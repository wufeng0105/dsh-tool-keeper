/**
 * dsh-tool-keeper —— 模型可调用的管理工具。
 *
 * ## 为什么需要它
 *
 * 用户要的是「非 JSON 的入口」：不用手动改文件，说一句话就能管理。
 * 这个工具与设置页读写同一份 `tool-keeper.json`、复用同一个 `rules.js`，
 * 是界面之外的另一条入口。
 *
 * `PROTECTED_TOOLS` 里早已预留 `'tool_keeper'` 这个名字。
 *
 * ## 它的定位
 *
 * 不是给用户手敲 command，而是让模型在对话里替用户改配置：
 *   用户：「把 exa 也关掉，只留网页搜索」
 *   模型：调 tool_keeper { action: "server", server: "exa", enabled: false }
 *
 * @module dsh-tool-keeper/tool
 */

import { PROTECTED_TOOLS, DANGEROUS_KEYS } from './rules.js';
import { readConfigOrBaseline, writeConfig, backupConfig } from './config.js';
import { createBaselineConfig } from './baseline.js';

const TOOL_NAME = 'tool_keeper';

/** 计算一个工具当前占多少字符（用于回答「能省多少」）。 */
function weightOf(definition) {
  const d = typeof definition?.description === 'string' ? definition.description.length : 0;
  let p = 0;
  try {
    p = JSON.stringify(definition?.parameters ?? {}).length;
  } catch {
    p = 0;
  }
  return d + p;
}

/**
 * 构造并注册工具。
 *
 * @param ctx - Cordis 上下文（需有 ctx.tools）
 * @param options - { configPath, catalog, snapshot, rules, log }
 * @returns disposer
 */
export function registerTool(ctx, options) {
  const { configPath, catalog, snapshot, log } = options;

  const definition = {
    name: TOOL_NAME,
    description: [
      '管理「哪些工具进入模型上下文」。可查看全部工具及占用、按服务器/单个工具开关、改写工具说明。',
      'action=status 看概况与诊断；action=list 列全部工具（按来源分组，含字符数）；',
      'action=server 打开/关闭整台 MCP 服务器（enabled=true/false），或改写它的说明页（text，空串=恢复原样）；关闭时工具与说明页一并隐藏；',
      'action=tool 开关单个工具（state=drop/keep）；',
      'action=rewrite 改写工具或参数说明（省略 text=清除该工具的改写）；',
      'action=reset 恢复出厂基线。',
      '改动写入 tool-keeper.json，需重启 DSH 才对已注册的工具与说明页生效。',
      '插件级启停由 DSH 插件页负责，本工具不再提供全局开关。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'list', 'server', 'tool', 'rewrite', 'reset'],
          description: '要执行的动作。',
        },
        server: { type: 'string', description: 'MCP 服务器名（action=server 时必填）。' },
        enabled: {
          type: 'boolean',
          description: 'action=server：true 打开整台、false 关闭整台（说明页随开关一并隐藏/恢复）。只动"上不上架"这一层，不碰单个工具开关。',
        },
        name: { type: 'string', description: '完整工具名，如 mcp__tinyfish__search 或 read（action=tool/rewrite 时必填）。' },
        state: {
          type: 'string',
          enum: ['drop', 'keep'],
          description: 'action=tool：drop 隐藏，keep 放行。',
        },
        target: {
          type: 'string',
          enum: ['description', 'param'],
          description: 'action=rewrite：改写工具说明还是某个参数的说明。',
        },
        param: { type: 'string', description: 'action=rewrite 且 target=param 时的参数名。' },
        text: { type: 'string', description: 'action=rewrite：该工具的新说明；action=server：该服务器说明页的整段改写（会替换掉「### MCP server: 名字」那行标题，空串=恢复原样）。省略则清除。' },

      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
      },
    },
    async execute(rawArgs) {
      const args = rawArgs !== null && typeof rawArgs === 'object' ? rawArgs : {};
      const action = args.action;

      // ---- status ----
      if (action === 'status') {
        const s = snapshot();
        return {
          patched: s.patched,
          configPath: s.configPath,
          toolCount: catalog.size(),
          diagnostics: s.diagnostics,
          problems: s.problems,
          // 只带事实摘要：原文（texts）只给设置页。单台上限 32KB，
          // 一句 status 就把 N×32KB 灌进上下文，与插件目的相反。
          instructions: {
            installed: s.instructions?.installed === true,
            removed: s.instructions?.removed ?? [],
            rewritten: s.instructions?.rewritten ?? [],
          },
        };
      }

      // ---- list ----
      if (action === 'list') {
        const groups = [...catalog.groups()].map(([group, entries]) => ({
          group,
          count: entries.length,
          totalChars: entries.reduce((n, e) => n + e.originalChars, 0),
          tools: entries.map(e => ({
            name: e.name,
            chars: e.originalChars,
            protected: e.protected,
          })),
        }));
        return { groups, total: catalog.size() };
      }

      // 写操作：先读盘上现状（不是内存里的 rules，避免覆盖别的改动）
      const data = readConfigOrBaseline(configPath);
      const base = { ...data };
      if (base.servers === undefined) base.servers = {};
      if (base.tools === undefined) base.tools = {};
      if (base.rewrite === undefined) base.rewrite = {};


      // ---- reset ----
      if (action === 'reset') {
        const backup = backupConfig(configPath);
        writeConfig(configPath, createBaselineConfig());
        return {
          ok: true,
          note: backup
            ? '已恢复出厂基线，旧配置备份在 ' + backup + '；重启后生效'
            : '已写入出厂基线；重启后生效',
        };
      }

      // ---- server ----
      if (action === 'server') {
        const server = typeof args.server === 'string' ? args.server.trim() : '';
        if (server === '') throw new Error('action=server 需要 server');
        // 危险键必须在这里挡住：`servers['__proto__'] = {...}` 走的是原型 setter，
        // 赋值静默失败，JSON 序列化出来是空的 —— 会变成「返回 ok: true 但什么都没写」。
        // 写前校验查不到它，因为字面量对象的 __proto__ 不是自有属性。
        if (DANGEROUS_KEYS.has(server)) {
          const error = new Error(`${server} 不能作为服务器名`);
          error.code = 'EINVALID';
          throw error;
        }
        const hasEnabled = typeof args.enabled === 'boolean';
        const hasText = typeof args.text === 'string';
        if (!hasEnabled && !hasText) {
          const error = new Error(
            'action=server 需要 enabled（开关整台）或 text（改写该服务器的说明页）之一；只关某个工具请用 action=tool',
          );
          error.code = 'EINVALID';
          throw error;
        }
        // 一次可写两个字段，互不覆盖：条目从磁盘现状起步
        const entry = { ...(base.servers[server] || {}) };
        if (hasEnabled) {
          if (args.enabled) delete entry.enabled; else entry.enabled = false;
        }
        if (hasText) {
          // 纯空白等同「没写」：normalizeConfig 也这么看，两边必须一致，
          // 否则会落一条永远不生效的死键。
          if (args.text.trim() === '') delete entry.rewrite; else entry.rewrite = args.text;
        }
        // 只有三个字段都空才删整条——否则「打开服务器」会顺手把改写删掉
        if (entry.enabled === undefined && entry.rewrite === undefined) delete base.servers[server];
        else base.servers[server] = entry;
        writeConfig(configPath, base);
        const done = [];
        if (hasEnabled) done.push(args.enabled ? '已打开整台服务器' : '已关闭整台服务器');
        if (hasText) done.push(args.text.trim() === '' ? '已清除说明页改写' : '已改写说明页');
        return {
          ok: true,
          server,
          ...(hasEnabled ? { enabled: args.enabled } : {}),
          ...(hasText ? { rewrite: args.text } : {}),
          note: done.join('，') + '；重启后生效',
        };
      }

      // ---- tool ----
      if (action === 'tool') {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (name === '') throw new Error('action=tool 需要 name');
        if (PROTECTED_TOOLS.includes(name)) {
          throw new Error(`"${name}" 是受保护的基础工具，任何配置都关不掉`);
        }
        if (args.state !== 'drop' && args.state !== 'keep') {
          throw new Error('action=tool 需要 state: drop/keep');
        }
        base.tools[name] = args.state;
        writeConfig(configPath, base);
        return { ok: true, name, state: args.state, note: '重启后生效' };
      }

      // ---- rewrite ----
      if (action === 'rewrite') {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (name === '') throw new Error('action=rewrite 需要 name');
        const target = args.target === 'param' ? 'param' : 'description';

        if (args.text === undefined || args.text === null) {
          // 清除
          delete base.rewrite[name];
          writeConfig(configPath, base);
          if (catalog.has(name)) {
            const original = catalog.get(name).description;
            return { ok: true, name, cleared: true, originalDescription: original, note: '已清除改写，恢复为服务器原文；重启后生效' };
          }
          return { ok: true, name, cleared: true, note: '已清除改写；重启后生效' };
        }
        if (typeof args.text !== 'string') throw new Error('text 必须是字符串');

        if (target === 'param') {
          const param = typeof args.param === 'string' ? args.param.trim() : '';
          if (param === '') throw new Error('target=param 需要 param');
          const current = base.rewrite[name];
          const entry = current !== null && typeof current === 'object' && !Array.isArray(current)
            ? { ...current }
            : typeof current === 'string' ? { description: current } : {};
          const properties = entry.properties !== null && typeof entry.properties === 'object' ? { ...entry.properties } : {};
          properties[param] = args.text;
          entry.properties = properties;
          base.rewrite[name] = entry;
        } else {
          const current = base.rewrite[name];
          const entry = current !== null && typeof current === 'object' && !Array.isArray(current)
            ? { ...current }
            : {};
          entry.description = args.text;
          base.rewrite[name] = entry;
        }
        writeConfig(configPath, base);
        return { ok: true, name, target, note: '重启后生效' };
      }

      throw new Error(`未知 action: ${String(action)}`);
    },
  };

  try {
    return ctx.tools.register(definition);
  } catch (error) {
    log.warn('could not register the tool-keeper tool: ' + String(error?.message ?? error));
    return () => {};
  }
}
