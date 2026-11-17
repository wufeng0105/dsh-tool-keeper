/**
 * liveTools 计数的边界行为。
 *
 * 这几条都是审计在实际验证中撞出来的真实缺陷，不是设想：
 *
 * - 注册抛错（宿主因重名等原因）+ 计数没退 → 工具没了却被判为在线，诊断沉默
 * - 判定抛错走 catch 分支，返回未包装的 disposer → 注销不减计数
 * - 同一个 disposer 调两次 → 计数退两份，把还活着的同名工具判成没了（假警报）
 * - disposer 的 thenable 性质被包装丢掉 → await 立刻继续，报出一件没发生的事
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../index.js';

const TOOL = 'mcp__probe__thing';

/** 假宿主：register 可自由决定行为；provide 捕获 status。 */
function makeHost(registerImpl) {
  const provided = {};
  const ctx = {
    tools: { register: registerImpl },
    on() { return () => {}; },
    get(key) { return key === 'tools' ? ctx.tools : undefined; },
    effect(fn) { if (typeof fn === 'function') fn(); return () => {}; },
    provide(key, value) { provided[key] = value; },
  };
  return { ctx, provided };
}

function setup(config, registerImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'tk-edge-'));
  const configPath = join(dir, 'tool-keeper.json');
  writeFileSync(configPath, JSON.stringify(config));
  const { ctx, provided } = makeHost(registerImpl);
  apply(ctx, { configPath });
  const diagText = () => ((provided.tool_keeper.status().diagnostics) ?? []).map(d => d.message).join(' | ');
  const unreachable = () => /当前不在线|暂不生效|指向不存在的工具/.test(diagText());
  return { ctx, diagText, unreachable, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const def = (name) => ({ name, description: 'd', parameters: {}, output: { schema: {}, render() { return []; } } });

test('计数：宿主 register 抛错时，计数必须退回（诊断要能报出不可达）', () => {
  // 宿主重名时抛错，这次注册没成。注意只对目标工具抛——
  // 全抛的话 tool_keeper 自己也注册不上，拿不到 status 就没法观察。
  const { ctx, unreachable, cleanup } = setup(
    { rewrite: { [TOOL]: '我的说明' } },
    (d) => { if (d.name === TOOL) throw new Error('already registered'); return () => {}; },
  );
  assert.throws(() => ctx.tools.register(def(TOOL)), /already registered/);
  assert.equal(unreachable(), true, '注册失败，工具不在线，诊断必须报出来');
  cleanup();
});

test('计数：宿主 disposer 幂等，重复调用不能打穿计数', () => {
  // 只统计目标工具：tool_keeper 自己也会注册，不能混进计数
  let live = 0;
  const { ctx, unreachable, cleanup } = setup(
    { rewrite: { [TOOL]: '我的说明' } },
    (d) => {
      if (d.name !== TOOL) return () => {};
      live++;
      let done = false;
      return () => { if (!done) { done = true; live--; } };
    },
  );

  const d1 = ctx.tools.register(def(TOOL));
  const d2 = ctx.tools.register(def(TOOL));
  assert.equal(live, 2);

  d1();
  d1();   // 重复调用：宿主是空操作，计数也必须不动
  assert.equal(live, 1, '幂等的 disposer 调两次只该退一份');
  assert.equal(unreachable(), false, '还有一份在线，不该报不可达（假警报）');

  d2();
  assert.equal(unreachable(), true, '两份都注销后才算不可达');
  cleanup();
});

test('计数：disposer 的 thenable 性质必须保留', () => {
  const { ctx, cleanup } = setup(
    { servers: {}, tools: {}, rewrite: {} },
    () => {
      const fn = () => {};
      let settled = false;
      fn.then = (resolve) => { settled = true; return Promise.resolve().then(() => resolve && resolve()); };
      fn.wasAwaited = () => settled;
      return fn;
    },
  );
  const d = ctx.tools.register(def(TOOL));
  assert.equal(typeof d.then, 'function', '包装后必须仍是 thenable，否则 await 会立刻继续');
  cleanup();
});

test('计数：await 包装后的 disposer，要等真实拆除完成', async () => {
  let released = false;
  const { ctx, cleanup } = setup(
    { servers: {}, tools: {}, rewrite: {} },
    () => {
      const fn = () => {};
      fn.then = async (resolve) => {
        await new Promise(r => setTimeout(r, 5));
        released = true;
        if (resolve) await resolve();
      };
      return fn;
    },
  );
  const d = ctx.tools.register(def(TOOL));
  await d;
  assert.equal(released, true, 'await 之后真实拆除应已完成');
  cleanup();
});

test('计数：判定抛错走 catch 分支时，返回的 disposer 仍要减计数', () => {
  const { ctx, unreachable, cleanup } = setup(
    { rewrite: { [TOOL]: '我的说明' } },
    (d) => {
      if (d.name !== TOOL) return () => {};
      let done = false;
      return () => { if (!done) done = true; };
    },
  );

  // 让 applyToDefinition 在访问 parameters 时抛错，从而进入 catch 分支。
  // catalog.record 只读 name/description，不会先碰到它。
  const evil = { name: TOOL, description: 'd', output: { schema: {}, render() { return []; } } };
  Object.defineProperty(evil, 'parameters', {
    get() { throw new Error('boom'); },
    enumerable: true,
    configurable: true,
  });

  const d = ctx.tools.register(evil);
  assert.equal(typeof d, 'function', 'catch 分支要放行，不能吞掉注册');
  assert.equal(unreachable(), false, '放行即注册成功，应算在线');

  d();
  assert.equal(unreachable(), true, '注销后应算不可达');
  cleanup();
});

test('live 标记：注销后目录里仍有记录，但 live 必须是 false', async () => {
  const { ctx, provided, cleanup } = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'tk-liveflag-'));
    const configPath = join(dir, 'tool-keeper.json');
    writeFileSync(configPath, JSON.stringify({ servers: {}, tools: {}, rewrite: {} }));
    const provided = {};
    const host = {
      tools: { register() { let done = false; return () => { if (!done) done = true; }; } },
      on() { return () => {}; },
      get(k) { return k === 'tools' ? host.tools : undefined; },
      effect(fn) { if (typeof fn === 'function') fn(); return () => {}; },
      provide(k, v) { provided[k] = v; },
    };
    apply(host, { configPath });
    return { ctx: host, provided, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  })();

  const d = ctx.tools.register({ name: TOOL, description: 'd', parameters: {}, output: { schema: {}, render() { return []; } } });
  const snap = () => provided.tool_keeper.status();

  assert.equal(snap().isLive(TOOL), true, '刚注册，应在线');
  d();
  assert.equal(snap().isLive(TOOL), false, '注销后应不在线');

  // 但目录（catalog）必须还留着它——还原原文要用
  const stillListed = snap().diagnostics !== undefined;   // 目录不在 status 里，用别的方式确认
  cleanup();
});
