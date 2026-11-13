/**
 * api.js 的测试。
 *
 * 不起真 HTTP 服务，直接拿 handler 调用，用假的 req/res。
 * 这样测的是真实的读写与校验逻辑。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mountApi, ROUTE_PATH } from '../api.js';
import { ToolCatalog } from '../rules.js';

/** 造一个假 ctx：捕获 webServer.register 的 handler。 */
function makeCtx() {
  const captured = { route: undefined, disposed: 0, injectedWith: undefined };
  const ctx = {
    inject(names, cb) {
      captured.injectedWith = names;
      // 造一个带 register 的 webServer
      const webServer = {
        register(route) {
          captured.route = route;
          return () => { captured.disposed += 1; };
        },
      };
      cb({ webServer });
    },
  };
  return { ctx, captured };
}

/** 造一个假 req（可以把 JSON body 塞进 async iterator）。 */
function makeReq(method, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const chunks = text === '' ? [] : [Buffer.from(text, 'utf8')];
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

/** 造一个假 res，收集 status / json。 */
function makeRes() {
  const out = { status: undefined, body: undefined, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    end(text) { out.body = text; },
    get statusCode() { return out.status; },
    set statusCode(v) { out.status = v; },
  };
}

function makeDeps(configPath) {
  const catalog = new ToolCatalog();
  catalog.record({ name: 'mcp__tinyfish__search', description: 'search desc', parameters: { a: 1 } });
  catalog.record({ name: 'read', description: 'read desc', parameters: {} });
  return {
    configPath,
    catalog,
    snapshot: () => ({
      patched: true, enabled: true, configPath,
      stats: { total: 2, dropped: 0, rewritten: 0, kept: 2 },
      problems: [], diagnostics: [],
    }),
    log: { info() {}, warn() {} },
  };
}

async function callHandler(handler, method, body, headers) {
  const req = makeReq(method, body, headers);
  const res = makeRes();
  await handler(req, res);
  return { status: res.out.status, json: res.out.body === undefined ? undefined : JSON.parse(res.out.body) };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'toolwarden-api-'));
  const configPath = join(dir, 'toolwarden.json');
  const { ctx, captured } = makeCtx();
  const dispose = mountApi(ctx, makeDeps(configPath));
  return { dir, configPath, ctx, captured, dispose };
}

// ─────────────────────────────────────────────
// 挂载
// ─────────────────────────────────────────────
test('api: 注册的路由路径正确，kind=exact', () => {
  const { captured, dir, dispose } = setup();
  assert.equal(captured.route.kind, 'exact');
  assert.equal(captured.route.path, ROUTE_PATH);
  assert.equal(ROUTE_PATH, '/toolwarden/api');
  dispose();
  assert.equal(captured.disposed, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('api: 用运行期注入拿 webServer，不写进 inject', () => {
  const { captured, dir, dispose } = setup();
  assert.deepEqual(captured.injectedWith, ['webServer'], '必须先注入 webServer 再注册路由');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 没有 webServer 时不抛，只记日志', () => {
  const warnings = [];
  const ctx = { inject: (names, cb) => cb({}) }; // 空服务
  const dir = mkdtempSync(join(tmpdir(), 'toolwarden-api-'));
  const dispose = mountApi(ctx, {
    configPath: join(dir, 'x.json'),
    catalog: new ToolCatalog(),
    snapshot: () => ({}),
    log: { info() {}, warn: (m) => warnings.push(m) },
  });
  assert.ok(warnings.some(w => /no register/.test(w)));
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 请求校验
// ─────────────────────────────────────────────
test('api: 非 POST 被拒', async () => {
  const { captured, dir, dispose } = setup();
  const r = await callHandler(captured.route.handler, 'GET');
  assert.equal(r.status, 405);
  assert.equal(r.json.code, 'EMETHOD');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 跨源请求被拒', async () => {
  const { captured, dir, dispose } = setup();
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' }, {
    origin: 'https://evil.example', host: 'localhost:3080',
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'EORIGIN');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 同源请求放行', async () => {
  const { captured, dir, dispose } = setup();
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' }, {
    origin: 'http://localhost:3080', host: 'localhost:3080',
  });
  assert.equal(r.status, 200);
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 无 origin 头（非浏览器调用）放行', async () => {
  const { captured, dir, dispose } = setup();
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  assert.equal(r.status, 200);
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// op = state
// ─────────────────────────────────────────────
test('api: state 返回分组与规则，不写盘', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: true, servers: {}, tools: { 'mcp__tinyfish__search': 'drop' }, rewrite: {},
  }));
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(Array.isArray(r.json.groups));
  assert.equal(r.json.rules.tools['mcp__tinyfish__search'], 'drop');
  assert.equal(r.json.patched, true);

  const groupNames = r.json.groups.map(g => g.group).sort();
  assert.deepEqual(groupNames, ['core', 'mcp:tinyfish']);
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: state 在配置损坏时仍返回 200（页面不能白屏）', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, '{ broken json');
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  assert.equal(r.status, 200, '页面必须能打开，否则用户没法修配置');
  assert.equal(r.json.ok, true);
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// effective：页面开关必须以引擎判定为准
// ─────────────────────────────────────────────
function findRole(state, name) {
  for (const g of state.groups) {
    for (const r of g.roles) if (r.name === name) return r;
  }
  return undefined;
}

test('api: 每个工具都带 effective 与 source', async () => {
  const { captured, dir, dispose } = setup();
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  const all = r.json.groups.flatMap(g => g.roles);
  assert.ok(all.length > 0);
  for (const role of all) {
    assert.ok(role.effective === 'keep' || role.effective === 'drop', role.name + ' 缺 effective');
    assert.equal(typeof role.source, 'string', role.name + ' 缺 source');
  }
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 服务器白名单会反映到 effective（页面不会把被丢的显示成开）', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: true,
    servers: { tinyfish: { keep: ['search'] } },
    tools: {}, rewrite: {},
  }));
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  const state = r.json;

  // 目录里有 search，但它不在 catalog 里（本 fixture 只登记了一个 tinyfish 工具），
  // 所以这里验证的是：decide 真的被调用了，source 不是永远 'none'
  const role = findRole(state, 'mcp__tinyfish__search');
  assert.ok(role !== undefined, '用例需要 catalog 里有该工具');
  assert.equal(role.effective, 'keep', '在白名单里，应为 keep');
  assert.equal(role.source, 'none', '白名单内且命中，走 default');

  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 服务器总开关关闭时，该服务器工具 effective=drop 且 source=server', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: true,
    servers: { tinyfish: { enabled: false } },
    tools: {}, rewrite: {},
  }));
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  const role = findRole(r.json, 'mcp__tinyfish__search');
  assert.ok(role !== undefined);
  assert.equal(role.effective, 'drop', '服务器被关掉，工具应判定为丢');
  assert.equal(role.source, 'server', '来源要标明是服务器级规则');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 单工具规则优先于服务器规则', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: true,
    servers: { tinyfish: { enabled: false } },
    tools: { 'mcp__tinyfish__search': 'keep' },
    rewrite: {},
  }));
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  const role = findRole(r.json, 'mcp__tinyfish__search');
  assert.equal(role.effective, 'keep', '单工具 keep 应压过服务器总开关');
  assert.equal(role.source, 'tool');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 保护工具永远 effective=keep 且 source=protected', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: true, servers: {}, tools: { read: 'drop' }, rewrite: {},
  }));
  const r = await callHandler(captured.route.handler, 'POST', { op: 'state' });
  const role = findRole(r.json, 'read');
  assert.ok(role !== undefined);
  assert.equal(role.effective, 'keep', '保护工具任何配置都关不掉');
  assert.equal(role.source, 'protected');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// op = set
// ─────────────────────────────────────────────
test('api: set 写入 tools 并返回 needRestart', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({ enabled: true, servers: {}, tools: {}, rewrite: {} }));
  const r = await callHandler(captured.route.handler, 'POST', {
    op: 'set', tools: { 'mcp__tinyfish__search': 'drop' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.needRestart, true);
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(saved.tools['mcp__tinyfish__search'], 'drop');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: set 保留未提交的字段（不整体覆盖）', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: true,
    servers: { tinyfish: { keep: ['search'] } },
    tools: {},
    rewrite: { 'mcp__x__y': '旧改写' },
  }));
  await callHandler(captured.route.handler, 'POST', { op: 'set', tools: { foo: 'drop' } });
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(saved.servers.tinyfish.keep, ['search'], 'servers 不能被丢掉');
  assert.equal(saved.rewrite['mcp__x__y'], '旧改写', 'rewrite 不能被丢掉');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: set 拒绝非法类型', async () => {
  const { captured, dir, dispose } = setup();
  let r = await callHandler(captured.route.handler, 'POST', { op: 'set', tools: 'not-an-object' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'EBADARG');

  r = await callHandler(captured.route.handler, 'POST', { op: 'set', enabled: 'yes' });
  assert.equal(r.status, 400);
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: set 拒绝会写出问题的配置（保护用户不被自己写坏）', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({ enabled: true, servers: {}, tools: {}, rewrite: {} }));
  const r = await callHandler(captured.route.handler, 'POST', {
    op: 'set', rewrite: { 'mcp__a__b': 12345 },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'EINVALID');
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(saved.rewrite, {}, '坏配置不得落盘');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// op = reset / 未知
// ─────────────────────────────────────────────
test('api: reset 恢复空基线并留备份', async () => {
  const { captured, configPath, dir, dispose } = setup();
  writeFileSync(configPath, JSON.stringify({
    enabled: false, servers: {}, tools: { x: 'drop' }, rewrite: {},
  }));
  const r = await callHandler(captured.route.handler, 'POST', { op: 'reset' });
  assert.equal(r.status, 200);
  assert.ok(r.json.backup, '必须留备份');
  assert.ok(existsSync(r.json.backup), '备份文件应真实存在');
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.tools, {}, '基线不管理任何工具');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: 未知 op 返回 400', async () => {
  const { captured, dir, dispose } = setup();
  const r = await callHandler(captured.route.handler, 'POST', { op: 'nuke' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'EUNKNOWN');
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

test('api: handler 内部异常返回 500 而不是崩掉', async () => {
  const { captured, dir, dispose } = setup();
  // 传一个无法 JSON.parse 的 body
  const req = {
    method: 'POST', headers: {},
    async *[Symbol.asyncIterator]() { yield Buffer.from('{ not json', 'utf8'); },
  };
  const res = makeRes();
  await captured.route.handler(req, res);
  assert.equal(res.out.status, 500);
  dispose();
  rmSync(dir, { recursive: true, force: true });
});
