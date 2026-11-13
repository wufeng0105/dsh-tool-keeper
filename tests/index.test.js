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
  const dir = mkdtempSync(join(tmpdir(), 'tool-keeper-index-'));
  const configPath = join(dir, 'tool-keeper.json');
  if (config !== undefined) {
    writeFileSync(configPath, typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  }
  return { dir, configPath };
}

function readStatus(state) {
  const entry = state.provided.tool_keeper;
  assert.ok(entry !== undefined, '必须 provide tool-keeper 状态');
  return typeof entry.status === 'function' ? entry.status() : entry.status;
}

// ─────────────────────────────────────────────
// 基本装配
// ─────────────────────────────────────────────
test('index: apply 不抛，且 provide 出状态', () => {
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state } = makeCtx();
  assert.doesNotThrow(() => apply(ctx, { configPath }));
  assert.ok(state.provided.tool_keeper !== undefined);
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

  // 但恢复入口必须在：tool-keeper 工具
  assert.ok(state.registered.some(d => d.name === 'tool_keeper'),
    '禁用后仍必须注册 tool-keeper 工具，否则用户没有恢复入口');

  // 设置页 API 也必须在
  assert.ok(state.route !== undefined, '禁用后仍必须挂载 /tool-keeper/api');

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

// ─────────────────────────────────────────────
// 参数名没命中时的诊断（审计发现：全未命中会被静默吞掉）
//
// 注意：这些用例必须用**内置工具名**（不带 mcp__ 前缀），
// 因为 MCP 工具会先过「未知服务器一律放行」那一关，
// 测试环境里 readKnownServers 读不到假的服务器名，规则根本不会走到 rewrite 分支。
// ─────────────────────────────────────────────
test('index: rewrite 只配参数且参数名全部不存在时，诊断必须报出来', () => {
  const { dir, configPath } = makeDir({
    enabled: true,
    servers: {},
    tools: {},
    rewrite: {
      // 只配 properties，且两个参数名都不存在 → definition 原样返回
      'create_goal': { properties: { nope1: 'A', nope2: 'B' } },
    },
  });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });

  ctx.tools.register({
    name: 'create_goal',
    description: '原说明',
    parameters: { type: 'object', properties: { real: { type: 'string' } } },
  });

  const status = readStatus(state);
  const diags = status.diagnostics.map(d => d.target + ' ' + d.message).join(' | ');

  // 关键断言：即使 definition 一个字都没改，也必须报「参数不存在」
  assert.ok(/nope1/.test(diags), '未命中的参数名必须出现在诊断里，实际：' + (diags || '(空)'));
  assert.ok(/nope2/.test(diags), 'nope2 也要报');
});

test('index: 参数部分命中时，命中的不算错、未命中的报错', () => {
  const { dir, configPath } = makeDir({
    enabled: true,
    servers: {},
    tools: {},
    rewrite: {
      'create_goal': { properties: { real: '新说明', nope: 'A' } },
    },
  });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });

  ctx.tools.register({
    name: 'create_goal',
    description: '原说明',
    parameters: { type: 'object', properties: { real: { type: 'string' } } },
  });

  const diags = readStatus(state).diagnostics.map(d => d.target).join(' | ');
  assert.ok(/nope/.test(diags), '未命中的要报，实际：' + (diags || '(空)'));
  assert.ok(!/\.real\b/.test(diags), '命中的不该报错');
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
  assert.ok(state.warnings.some(w => /tool-keeper/.test(w)), '必须告警');
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 统计口径
// ─────────────────────────────────────────────
test('index: 状态里不再有统计计数', () => {
  // 这些计数原本数的是 register() 调用次数，与实际工具数不一致
  // （实测 stats.total=172 而真实工具 105 个），没有消费者，还自相矛盾，已删除。
  const { dir, configPath } = makeDir({ enabled: true, servers: {}, tools: {}, rewrite: {} });
  const { ctx, state } = makeCtx();
  apply(ctx, { configPath });
  const status = readStatus(state);
  assert.equal(status.stats, undefined, '不要维护没人读、又不准的计数');
  // 真实的工具清单由目录提供，不靠计数
  assert.ok(Array.isArray(status.groups), '工具清单从目录来');
  rmSync(dir, { recursive: true, force: true });
});
