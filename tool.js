/**
 * dsh-toolwarden —— 模型可调用的管理工具。
 *
 * ## 为什么需要它（审计结论）
 *
 * 用户要的是「非 JSON 的入口」。设置页是终态，但它的数据层就是这组动作。
 * 先做工具，用户立刻能用自然语言管理；后面做界面时，界面读写的是同一份
 * `toolwarden.json`、复用同一个 `rules.js`，工具就是界面的后端。
 *
 * `PROTECTED_TOOLS` 里早已预留 `'toolwarden'` 这个名字。
 *
 * ## 它的定位
 *
 * 不是给用户手敲 command，而是让模型在对话里替用户改配置：
 *   用户：「把 exa 也关掉，只留网页搜索」
 *   模型：调 toolwarden { action: "server", server: "exa", keep: ["web_search_exa"] }
 *
 * @module dsh-toolwarden/tool
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeConfig, diagnose, splitMcpName, PROTECTED_TOOLS } from './rules.js';
import { createBaselineConfig } from './baseline.js';

const TOOL_NAME = 'toolwarden';

/**
 * 读配置；文件不存在时返回 baseline。
 * @param {string} path
 * @returns {{ data: object, created: boolean }}
 */
function loadOrBaseline(path) {
  try {
    return { data: JSON.parse(readFileSync(path, 'utf8')), created: false };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { data: createBaselineConfig(), created: true };
    }
    throw error;
  }
}

/**
 * 原子写回。审计指出原实现里 writeConfigFile 是死代码且 Windows 回退不原子，
 * 这里改成：先写临时文件并 fsync 语义下的 rename，失败才退化。
 * @param {string} path
 * @param {object} data
 */
function saveConfig(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(data, null, 2) + '\n';
  const tmp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  writeFileSync(tmp, text, 'utf8');
  try {
    renameSync(tmp, path);
    return;
  } catch (error) {
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(error?.code ?? '')) throw error;
  }
  // Windows 目标被占用：直接覆盖（非原子，但比丢失配置好），并保留临时文件供人工比对
  writeFileSync(path, text, 'utf8');
}

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
      'action=server 设置某 MCP 服务器保留哪些工具（keep 为空数组=全关，省略 keep=全开）；',
      'action=tool 开关单个工具（state=drop/keep）；',
      'action=rewrite 改写工具或参数说明（省略 text=清除该工具的改写）；',
      'action=enable 总开关（value=true/false）；',
      'action=reset 恢复出厂基线。',
      '改动写入 toolwarden.json，需重启 DSH 才对已注册的工具生效。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'list', 'server', 'tool', 'rewrite', 'enable', 'reset'],
          description: '要执行的动作。',
        },
        server: { type: 'string', description: 'MCP 服务器名（action=server 时必填）。' },
        keep: {
          type: 'array',
          items: { type: 'string' },
          description: 'action=server：保留的工具短名列表。空数组表示关闭该服务器全部工具；省略该参数表示全部保留。',
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
        text: { type: 'string', description: 'action=rewrite：新的说明文本。省略则清除该改写。' },
        value: { type: 'boolean', description: 'action=enable：true 启用，false 全部放行。' },
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
          enabled: s.enabled,
          configPath: s.configPath,
          stats: s.stats,
          toolCount: catalog.size(),
          diagnostics: s.diagnostics,
          problems: s.problems,
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
      const { data, created } = loadOrBaseline(configPath);
      const base = { ...data };
      if (base.servers === undefined) base.servers = {};
      if (base.tools === undefined) base.tools = {};
      if (base.rewrite === undefined) base.rewrite = {};

      // ---- enable ----
      if (action === 'enable') {
        if (typeof args.value !== 'boolean') throw new Error('action=enable 需要 value: true/false');
        base.enabled = args.value;
        saveConfig(configPath, base);
        return { ok: true, enabled: args.value, note: '重启 DSH 后生效' };
      }

      // ---- reset ----
      if (action === 'reset') {
        if (existsSync(configPath)) {
          const bak = configPath + '.bak-' + Date.now();
          writeFileSync(bak, readFileSync(configPath), 'utf8');
          saveConfig(configPath, createBaselineConfig());
          return { ok: true, note: '已恢复出厂基线，旧配置备份在 ' + bak + '；重启后生效' };
        }
        saveConfig(configPath, createBaselineConfig());
        return { ok: true, note: '已写入出厂基线；重启后生效' };
      }

      // ---- server ----
      if (action === 'server') {
        const server = typeof args.server === 'string' ? args.server.trim() : '';
        if (server === '') throw new Error('action=server 需要 server');
        if (!Array.isArray(args.keep)) {
          // 省略 keep = 该服务器全部保留（删掉规则）
          delete base.servers[server];
          saveConfig(configPath, base);
          return { ok: true, server, mode: 'all', note: '已移除该服务器规则，全部工具保留；重启后生效' };
        }
        const keep = args.keep.filter(n => typeof n === 'string' && n !== '');
        if (keep.length === 0) {
          base.servers[server] = { enabled: false };
          saveConfig(configPath, base);
          return { ok: true, server, mode: 'off', note: '已关闭该服务器全部工具；重启后生效' };
        }
        base.servers[server] = { keep };
        saveConfig(configPath, base);
        return { ok: true, server, keep, note: '重启后生效' };
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
        saveConfig(configPath, base);
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
          saveConfig(configPath, base);
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
        saveConfig(configPath, base);
        return { ok: true, name, target, note: '重启后生效' };
      }

      throw new Error(`未知 action: ${String(action)}`);
    },
  };

  try {
    return ctx.tools.register(definition);
  } catch (error) {
    log.warn('could not register the toolwarden tool: ' + String(error?.message ?? error));
    return () => {};
  }
}
