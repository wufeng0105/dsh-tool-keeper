/**
 * index.js 的测试 —— 补丁安装与总开关。
 *
 * 审计发现这个文件原来零测试覆盖，5 个针对性变异全部漏网：
 * 补丁失败不暴露 / 总开关失效 / restore 空操作 / 不检查补丁是否装上 / 统计口径错。
 *
 * 这里用一个假的 Cordis ctx 直接跑 apply()，检查真实行为。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../index.js';

/** 造一个最小的 Cordis ctx。 */
function makeCtx(overrides = {}) {
  const state = {
    registered: [],       // 通过 ctx.tools.register 注册的工具
    provided: {},         // ctx.provide 的键
    effects: [],          // ctx.effect 的回调
    warnings: [],
    infos: [],
    route: undefined,
  };

  const tools = {
    register(definition) {
      // 走 apply 装的包装会走到这里；返回一个可取消句柄
      state.registered.push(definition);
      return () => {
        const i = state.registered.indexOf(definition);
        if (i >= 0) state.registered.splice(i, 1);
      };
    },
  };

  const ctx = {
    tools,
    get(name) {
      if (name === 'tools') return tools;
      if (name === 'logger') {
        return {
          info: m => state.infos.push(m),
          warn: m => state.warnings.push(m),
        };
      }
      return undefined;
    },
    provide(key, value) { state.provided[key] = value; },
    // Cordis 语义：effect(fn) 立刻调用 fn() 取得 disposer，卸载时调 disposer。
    // 不能只存 fn——那样「卸载」永远不会执行，restore 测试就是假的。
    effect(fn, label) {
      const disposer = fn();
      const record = { disposers: [], label };
      if (typeof disposer === 'function') record.disposers.push(disposer);
      state.effects.push(record);
      return () => { for (const d of record.disposers) d(); };
    },
    inject(names, cb) {
      state.injectedWith = names;
      // 提供一个带 register 的 webServer，让 mountApi 能挂路由
      const webServer = {
        register(route) {
          state.route = route;
          return () => { state.route = undefined; };
        },
      };
      cb({ webServer });
      return () => {};
    },
    ...overrides,
  };

  return { ctx, state, tools };
}

function makeDir(config) {
  const dir = mkdtempSync(join(tmpdir(), 'toolwarden-index-'));
  const configPath = join(dir, 'toolwarden.json');
  if (config !== undefined) {
    writeFileSync(configPath, typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  }
  return { dir, configPath };
}

function readStatus(state) {
  const entry = state.provided.toolwarden;
  assert.ok(entry !== undefined, '必须 provide toolwarden 状态');
  return typeof entry.status === 'function' ? entry.status() : entry.status;
}

// ─────────────────────────────────────────────
// 基本装配
// ─────────────────────────────────────────────
test('index: apply 不抛，且 provide 出状态', () => {
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state } = makeCtx();
  assert.doesNotThrow(() => apply(ctx, { configPath }));
  assert.ok(state.provided.toolwarden !== undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('index: 配置不存在时自动写一份空基线', () => {
  const { dir, configPath } = makeDir();
  const { ctx } = makeCtx();
  apply(ctx, { configPath });
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.tools, {}, '基线不管理任何工具');
  assert.deepEqual(saved.servers, {}, '基线不预设服务器规则');
  rmSync(dir, { recursive: true, force: true });
});

test('index: 只包装一次 register，且卸载后还原', () => {
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state, tools } = makeCtx();
  const original = tools.register;
  apply(ctx, { configPath });

  assert.notEqual(tools.register, original, '必须包装 register');

  // 跑卸载 effect（Cordis 语义：apply 时已调用 fn 取得 disposer）
  for (const e of state.effects) for (const d of e.disposers) d();
  assert.equal(tools.register, original, '卸载后必须还原成原始函数');
  rmSync(dir, { recursive: true, force: true });
});

test('index: 注册的工具被判定后进入 registry 或不被注册', () => {
  const { dir, configPath } = makeDir({
    enabled: true,
    servers: {},
    tools: { 'mcp__x__y': 'drop' },
    rewrite: {},
  });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });

  const kept = { name: 'mcp__x__keep', description: 'd', parameters: {} };
  const dropped = { name: 'mcp__x__y', description: 'd', parameters: {} };
  ctx.tools.register(kept);
  ctx.tools.register(dropped);

  const names = state.registered.map(d => d.name);
  assert.ok(names.includes('mcp__x__keep'), '未命中的工具应放行');
  assert.ok(!names.includes('mcp__x__y'), '被 drop 的工具不应进入 registry');
  rmSync(dir, { recursive: true, force: true });
});

test('index: 保护工具即使配置写 drop 也放行', () => {
  const { dir, configPath } = makeDir({
    enabled: true, servers: {}, tools: { read: 'drop' }, rewrite: {},
  });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });

  ctx.tools.register({ name: 'read', description: 'd', parameters: {} });
  assert.ok(state.registered.some(d => d.name === 'read'), '保护工具必须放行');
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 总开关（审计 H5：禁用后不能连恢复入口一起消失）
// ─────────────────────────────────────────────
test('index: enabled=false 时不装补丁，但模型工具与设置页 API 仍在', () => {
  const { dir, configPath } = makeDir({
    enabled: false, servers: {}, tools: {}, rewrite: {},
  });
  const { ctx, state, tools } = makeCtx();
  const original = tools.register;
  apply(ctx, { configPath });

  // 不装补丁：register 保持原样
  assert.equal(tools.register, original, '禁用时不应包装 register');

  // 但恢复入口必须在：toolwarden 工具
  assert.ok(state.registered.some(d => d.name === 'toolwarden'),
    '禁用后仍必须注册 toolwarden 工具，否则用户没有恢复入口');

  // 设置页 API 也必须在
  assert.ok(state.route !== undefined, '禁用后仍必须挂载 /toolwarden/api');

  const status = readStatus(state);
  assert.equal(status.patched, false);
  assert.match(String(status.reason), /disabled/);
  rmSync(dir, { recursive: true, force: true });
});

test('index: enabled=false 时诊断为空（没有规则生效，报错是噪音）', () => {
  const { dir, configPath } = makeDir({
    enabled: false,
    servers: { ghost: { enabled: false } },
    tools: {}, rewrite: {},
  });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });
  const status = readStatus(state);
  assert.deepEqual(status.diagnostics, []);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 失败可见（D6）
// ─────────────────────────────────────────────
test('index: tools 服务缺失时报 patched:false 且不抛', () => {
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state } = makeCtx();
  // get('tools') 与 ctx.tools 都给不到；logger 仍要记录，否则验不了告警
  ctx.tools = undefined;
  ctx.get = name => (name === 'logger'
    ? { info: m => state.infos.push(m), warn: m => state.warnings.push(m) }
    : undefined);

  assert.doesNotThrow(() => apply(ctx, { configPath }));
  const status = readStatus(state);
  assert.equal(status.patched, false);
  assert.match(String(status.reason), /unavailable/);
  // 失败必须同时进日志：只靠状态字段，插件的日志里就看不出为什么没生效
  assert.ok(state.warnings.some(w => /could not install the registration patch/.test(w)),
    '补丁失败必须留下告警日志');
  rmSync(dir, { recursive: true, force: true });
});

test('index: 补丁装不上时设置页 API 仍然挂载', () => {
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state } = makeCtx();
  // 没有 tools 服务：补丁装不上，工具也注册不了（注册工具本身就要 tools 服务）
  ctx.tools = undefined;
  ctx.get = name => (name === 'logger' ? { info() {}, warn() {} } : undefined);

  apply(ctx, { configPath });
  // 工具注册不了是能力所限，但设置页走的是 webServer，必须还能打开来排查
  assert.ok(state.route !== undefined, '补丁失败时设置页 API 仍要挂载，作为排查入口');
  const status = readStatus(state);
  assert.equal(status.patched, false);
  assert.match(String(status.reason), /unavailable/);
  rmSync(dir, { recursive: true, force: true });
});

test('index: 服务被冻结时如实报 patched:false，不假装装上了', () => {
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state } = makeCtx();
  // 冻结的 tools：Reflect.set 会失败。必须检查「补丁是否真的生效」，
  // 否则会在没装上的情况下继续声称自己在过滤。
  Object.freeze(ctx.tools);
  ctx.get = name => (name === 'logger'
    ? { info: m => state.infos.push(m), warn: m => state.warnings.push(m) }
    : name === 'tools' ? ctx.tools : undefined);

  assert.doesNotThrow(() => apply(ctx, { configPath }));
  const status = readStatus(state);
  assert.equal(status.patched, false, '冻结服务上不可能装上补丁');
  assert.match(String(status.reason), /frozen|proxied/i);
  rmSync(dir, { recursive: true, force: true });
});

test('index: 配置损坏时按全放行跑，并报出来', () => {
  const { dir, configPath } = makeDir('{ 这不是 JSON');
  const { ctx, state } = makeCtx();
  assert.doesNotThrow(() => apply(ctx, { configPath }));

  ctx.tools.register({ name: 'anything', description: 'd', parameters: {} });
  assert.ok(state.registered.some(d => d.name === 'anything'), '坏配置时全部放行');
  assert.ok(state.warnings.some(w => /toolwarden/.test(w)), '必须告警');
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 统计口径
// ─────────────────────────────────────────────
test('index: 统计里 dropped/kept 不混', () => {
  const { dir, configPath } = makeDir({
    enabled: true, servers: {}, tools: { 'mcp__x__y': 'drop' }, rewrite: {},
  });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });

  ctx.tools.register({ name: 'mcp__x__keep', description: 'd', parameters: {} });
  ctx.tools.register({ name: 'mcp__x__y', description: 'd', parameters: {} });

  const status = readStatus(state);
  // total 里还包含插件自己的 toolwarden 工具（它也走同一个 register），所以不钉死总数
  assert.equal(status.stats.dropped, 1, '被丢的应恰好 1 个');
  assert.equal(status.stats.kept, 2, '放行的 2 个（含 toolwarden 工具）');
  assert.equal(status.stats.total, status.stats.dropped + status.stats.kept,
    'total 必须等于 dropped + kept');
  rmSync(dir, { recursive: true, force: true });
});
