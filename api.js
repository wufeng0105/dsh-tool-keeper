/**
 * dsh-tool-keeper —— 设置页 API 路由（宿主半）。
 *
 * ## 为什么单独一个文件
 *
 * `webServer` **不能写进 inject**：headless 环境下没有这个服务，写进去插件会
 * 永远 pending，宿主把它当 web boot 失败——整个页面加载不出来。
 * 必须用 `ctx.inject(['webServer'], cb)` 运行期可选注入。
 * 这个坑记在 dsh-enhance/enhance-scope/index.js 的文件头注释里。
 *
 * ## 契约来源（L3，本机 dsh-enhance 实现）
 *
 * 宿主侧：
 *   ctx.inject(['webServer'], (inner) => {
 *     ctx.effect(() => inner.webServer.register({
 *       kind: 'exact', path: ROUTE_PATH,
 *       handler: async (req, res) => { ... },
 *     }));
 *   });
 *
 * 客户端侧：
 *   fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ op, ... }) })
 *
 * @module dsh-tool-keeper/api
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeConfig, diagnose, decide } from './rules.js';
import { createBaselineConfig } from './baseline.js';
import { hashText } from './hash.js';

export const ROUTE_PATH = '/tool-keeper/api';

/** 只接受同源请求，防止别的页面通过浏览器改配置。 */
function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (origin === undefined || origin === null || origin === '') return true; // 非浏览器调用
  try {
    const host = req.headers?.host;
    const url = new URL(origin);
    return url.host === host;
  } catch {
    return false;
  }
}

/** 读 JSON body，限制大小。 */
async function readJson(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  return JSON.parse(text);
}

function fail(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ code, message }));
}

function ok(res, body) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** 原子写：临时文件 + rename，Windows 上目标被占用时退化。 */
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
  writeFileSync(path, text, 'utf8');
}

/**
 * 挂载路由。返回 disposer；宿主没有 webServer 时返回空函数（不算失败）。
 *
 * @param ctx - Cordis 上下文
 * @param deps - { configPath, catalog, snapshot, log }
 * @returns {() => void} 拆除函数
 */
export function mountApi(ctx, deps) {
  const { configPath, catalog, snapshot, log } = deps;

  if (typeof ctx.inject !== 'function') {
    log.warn('ctx.inject unavailable; settings page API not mounted');
    return () => {};
  }

  let disposer;

  // 运行期可选注入：服务出现时挂，消失时自动卸载
  ctx.inject(['webServer'], inner => {
    const web = inner.webServer;
    if (web === undefined || web === null || typeof web.register !== 'function') {
      log.warn('webServer has no register(); settings page API not mounted');
      return;
    }

    const handle = async (req, res) => {
      try {
        if (req.method !== 'POST') return fail(res, 405, 'EMETHOD', 'POST only');
        if (!sameOrigin(req)) return fail(res, 403, 'EORIGIN', 'cross-origin request rejected');

        const body = await readJson(req);
        const op = body.op;

        // ---- state：页面首屏 ----
        if (op === 'state') {
          const s = snapshot();
          // 读盘上的配置原文，让页面能显示「当前值」而不是只有 catalog
          let config = {};
          try {
            config = JSON.parse(readFileSync(configPath, 'utf8'));
          } catch {
            config = {};
          }
          const { rules, problems } = normalizeConfig(config);

          // 磁盘上的配置 != 启动时加载的那份 → 改了但还没重启。
          // 页面必须能一直说出这件事：否则保存完立刻按新配置算「省了多少」，
          // 而此刻一个字节都还没生效；刷新一次连提示都会消失。
          const diskText = (() => {
            try {
              return readFileSync(configPath, 'utf8');
            } catch {
              return undefined;
            }
          })();
          const stale = typeof s.loadedHash === 'string' && s.loadedHash !== ''
            && hashText(diskText) !== s.loadedHash;

          // 目录里出现过的服务器就是「已知服务器」。用它跑 decide()，
          // 让页面拿到的开关状态与引擎在注册期的判定完全一致。
          // 不这么做的话，配置里的服务器白名单 / 总开关在页面上完全不可见：
          // 页面只会去读 tools，于是把引擎已经丢掉的工具显示成「开」——那是在说谎。
          const knownServers = new Set();
          const groups = [...catalog.groups()];
          for (const [, entries] of groups) {
            for (const e of entries) {
              if (typeof e.server === 'string' && e.server !== '') knownServers.add(e.server);
            }
          }

          /** 把 decide() 的 reason 归成页面要显示的来源分类。 */
          const sourceOf = reason => {
            if (reason === 'protected') return 'protected';
            if (reason.startsWith('tool override')) return 'tool';
            if (reason.startsWith('not in ') || reason.startsWith('server ')) return 'server';
            if (reason.startsWith('unknown server')) return 'unknown';
            if (reason === 'rewrite configured') return 'rewrite';
            return 'none';
          };

          return ok(res, {
            ok: true,
            patched: s.patched,
            enabled: rules.enabled,
            configPath,
            // true = 磁盘上的配置与启动时加载的不同，即「改了还没重启」。
            // 此时页面上的隐藏数/节省量都是「重启后才会成立」的数字。
            stale,
            problems: [...problems, ...s.problems],
            diagnostics: s.diagnostics,
            groups: groups.map(([group, entries]) => ({
              group,
              roles: entries.map(e => {
                const verdict = decide(e.name, rules, knownServers);
                return {
                  name: e.name,
                  server: e.server,
                  leaf: e.leaf,
                  protected: e.protected,
                  chars: e.originalChars,
                  descChars: e.originalDescChars,
                  originalDescription: e.description,
                  // 引擎的实际判定，页面开关以此为准
                  effective: verdict.action === 'drop' ? 'drop' : 'keep',
                  source: sourceOf(verdict.reason),
                };
              }),
            })),
            rules: {
              servers: Object.fromEntries(
                [...rules.serverKeep].map(([srv, keep]) => [srv, { keep: [...keep] }]),
              ),
              disabledServers: [...rules.disabledServers],
              tools: Object.fromEntries(rules.toolOverrides),
              rewrites: Object.fromEntries(
                [...rules.rewrites].map(([name, e]) => [
                  name,
                  {
                    ...(e.description === undefined ? {} : { description: e.description }),
                    ...(e.properties.size === 0 ? {} : { properties: Object.fromEntries(e.properties) }),
                  },
                ]),
              ),
            },
          });
        }

        // ---- set：写入变更（整块替换某类规则） ----
        if (op === 'set') {
          let data;
          try {
            data = JSON.parse(readFileSync(configPath, 'utf8'));
          } catch {
            data = createBaselineConfig();
          }
          if (data === null || typeof data !== 'object') data = createBaselineConfig();
          if (data.servers === undefined) data.servers = {};
          if (data.tools === undefined) data.tools = {};
          if (data.rewrite === undefined) data.rewrite = {};

          if (body.enabled !== undefined) {
            if (typeof body.enabled !== 'boolean') return fail(res, 400, 'EBADARG', 'enabled must be boolean');
            data.enabled = body.enabled;
          }
          if (body.servers !== undefined) {
            if (body.servers === null || typeof body.servers !== 'object' || Array.isArray(body.servers)) {
              return fail(res, 400, 'EBADARG', 'servers must be an object');
            }
            data.servers = body.servers;
          }
          if (body.tools !== undefined) {
            if (body.tools === null || typeof body.tools !== 'object' || Array.isArray(body.tools)) {
              return fail(res, 400, 'EBADARG', 'tools must be an object');
            }
            data.tools = body.tools;
          }
          if (body.rewrite !== undefined) {
            if (body.rewrite === null || typeof body.rewrite !== 'object' || Array.isArray(body.rewrite)) {
              return fail(res, 400, 'EBADARG', 'rewrite must be an object');
            }
            data.rewrite = body.rewrite;
          }

          // 写前校验：坏配置不许落盘（保护用户不被自己写坏）
          const { problems } = normalizeConfig(data);
          if (problems.length > 0) {
            return fail(res, 400, 'EINVALID', '配置有问题，未保存：' + problems.join('; '));
          }

          saveConfig(configPath, data);
          return ok(res, { ok: true, needRestart: true });
        }

        // ---- reset ----
        if (op === 'reset') {
          if (existsSync(configPath)) {
            const bak = configPath + '.bak-' + Date.now();
            writeFileSync(bak, readFileSync(configPath), 'utf8');
            saveConfig(configPath, createBaselineConfig());
            return ok(res, { ok: true, backup: bak, needRestart: true });
          }
          saveConfig(configPath, createBaselineConfig());
          return ok(res, { ok: true, needRestart: true });
        }

        // ---- export：导出当前配置 ----
        if (op === 'export') {
          // 导出的是**磁盘上的**配置 —— 与页面显示、与「改了没重启」提示共用同一个事实源。
          // 从内存读会绕过 stale 提示，导出「看起来已生效、其实还没」的内容。
          let data;
          try {
            data = JSON.parse(readFileSync(configPath, 'utf8'));
          } catch {
            // 没有配置文件或读坏了：导出全空基线。导出不该失败，坏配置也要能带出去修。
            data = createBaselineConfig();
          }
          return ok(res, {
            ok: true,
            exportedAt: new Date().toISOString(),
            config: data,
          });
        }

        // ---- import：整份替换配置 ----
        if (op === 'import') {
          const incoming = body.config;
          if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return fail(res, 400, 'EBADARG', 'import 需要 config 对象');
          }
          // 先备份当前磁盘内容 —— 导入是整份替换，回退只能靠这份备份
          if (existsSync(configPath)) {
            const bak = configPath + '.bak-' + Date.now();
            writeFileSync(bak, readFileSync(configPath), 'utf8');
          }
          // 导入的内容与手改文件走同一条校验路径：normalizeConfig 拒收坏配置
          const { problems } = normalizeConfig(incoming);
          if (problems.length > 0) {
            return fail(res, 400, 'EINVALID', '导入的配置有问题，未保存：' + problems.join('; '));
          }
          // 只落 normalizeConfig 认可的五个字段，不照抄导入文件的任意键
          const data = createBaselineConfig();
          if (typeof incoming.enabled === 'boolean') data.enabled = incoming.enabled;
          data.servers = incoming.servers ?? {};
          data.tools = incoming.tools ?? {};
          data.rewrite = incoming.rewrite ?? {};

          const again = normalizeConfig(data);
          if (again.problems.length > 0) {
            return fail(res, 400, 'EINVALID', '导入的配置有问题，未保存：' + again.problems.join('; '));
          }
          saveConfig(configPath, data);
          return ok(res, { ok: true, needRestart: true });
        }

        return fail(res, 400, 'EUNKNOWN', 'unknown op: ' + String(op));
      } catch (error) {
        log.warn('api error: ' + String(error?.message ?? error));
        return fail(res, 500, 'EINTERNAL', String(error?.message ?? error));
      }
    };

    try {
      disposer = web.register({ kind: 'exact', path: ROUTE_PATH, handler: handle });
      log.info('settings page API mounted at ' + ROUTE_PATH);
    } catch (error) {
      log.warn('could not register the settings page route: ' + String(error?.message ?? error));
    }
  });

  return () => {
    try {
      if (typeof disposer === 'function') disposer();
    } catch {
      // 路由可能随作用域一并销毁
    }
  };
}
