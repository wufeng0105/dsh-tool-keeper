/**
 * liveTools：注册/注销计数的正确性。
 *
 * 观测手段用 `snapshot().isLive(name)`——直接问「这个工具现在算不算在线」。
 * 早期版本绕道 diagnose 的输出间接观察，那既脆弱又把两件事绑在一起：
 * 诊断一旦不再关心在线状态（它现在确实不关心了），这些测试就失去意义。
 * 计数的正确性应该由计数自己证明。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../index.js';

const TOOL = 'mcp__probe__thing';

/** 假宿主：register 由调用方决定行为；provide 捕获 status。 */
function setup(registerImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'tk-live-'));
  const configPath = join(dir, 'tool-keeper.json');
  writeFileSync(configPath, JSON.stringify({ servers: {}, tools: {}, rewrite: {} }));
  const provided = {};
  const ctx = {
    tools: { register: registerImpl },
    on() { return () => {}; },
    get(k) { return k === 'tools' ? ctx.tools : undefined; },
    effect(fn) { if (typeof fn === 'function') fn(); return () => {}; },
    provide(k, v) { provided[k] = v; },
  };
  apply(ctx, { configPath });
  const snap = () => provided.tool_keeper.status();
  const isLive = (name) => snap().isLive(name);
  return { ctx, isLive, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const def = { name: TOOL, description: 'd', parameters: {}, output: { schema: {}, render() { return []; } } };

/** 宿主的 disposer 是幂等的：重复调用只有第一次有效。 */
const idempotentHost = () => () => { let done = false; return () => { if (!done) done = true; }; };

test('liveTools: 注册后在线，注销后不在线', () => {
  const { ctx, isLive, cleanup } = setup(idempotentHost());
  assert.equal(isLive(TOOL), false, '还没注册，不该在线');
  const d = ctx.tools.register(def);
  assert.equal(isLive(TOOL), true);
  d();
  assert.equal(isLive(TOOL), false);
  cleanup();
});

test('liveTools: 同名注册两次，注销一次仍在线', () => {
  const { ctx, isLive, cleanup } = setup(idempotentHost());
  const d1 = ctx.tools.register(def);
  const d2 = ctx.tools.register(def);
  d1();
  assert.equal(isLive(TOOL), true, '还有一份注册在');
  d2();
  assert.equal(isLive(TOOL), false, '两份都注销了才不在');
  cleanup();
});

test('liveTools: 重复调用同一个 disposer 不会多减', () => {
  const { ctx, isLive, cleanup } = setup(idempotentHost());
  const d1 = ctx.tools.register(def);
  const d2 = ctx.tools.register(def);
  d1();
  d1();   // 宿主幂等：第二次是空操作
  d1();
  assert.equal(isLive(TOOL), true, '重复调用不该把第二份也减掉');
  d2();
  assert.equal(isLive(TOOL), false);
  cleanup();
});

test('liveTools: 宿主 register 抛错时不算在线', () => {
  const { ctx, isLive, cleanup } = setup(() => { throw new Error('already registered'); });
  assert.throws(() => ctx.tools.register(def), /already registered/);
  assert.equal(isLive(TOOL), false, '注册没成，不能算在线');
  cleanup();
});

test('liveTools: 判定抛错但宿主注册成功时，仍算在线', () => {
  const { ctx, isLive, cleanup } = setup(idempotentHost());
  // parameters 的 getter 抛错，让 applyToDefinition 走进 catch 分支
  const evil = { name: TOOL, description: 'd', output: { schema: {}, render() { return []; } } };
  Object.defineProperty(evil, 'parameters', { get() { throw new Error('boom'); }, enumerable: true });
  const d = ctx.tools.register(evil);
  assert.equal(isLive(TOOL), true, '放行即注册成功，应算在线');
  d();
  assert.equal(isLive(TOOL), false);
  cleanup();
});

test('liveTools: disposer 的 thenable 性质必须保住', async () => {
  let tore = false;
  const { ctx, isLive, cleanup } = setup(() => {
    const fn = () => {};
    fn.then = async (resolve) => {
      await new Promise(r => setTimeout(r, 5));
      tore = true;
      if (resolve) await resolve();
    };
    return fn;
  });
  const d = ctx.tools.register(def);
  assert.equal(typeof d.then, 'function', '丢了 then，await 会立刻继续');
  await d;
  assert.equal(tore, true, 'await 之后真实拆除应已完成');
  assert.equal(isLive(TOOL), false, 'await 之后计数也该退');
  cleanup();
});

test('liveTools: 被 drop 的工具不算在线', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-drop-'));
  const configPath = join(dir, 'tool-keeper.json');
  writeFileSync(configPath, JSON.stringify({ tools: { [TOOL]: 'drop' } }));
  const provided = {};
  const ctx = {
    tools: { register: idempotentHost() },
    on() { return () => {}; },
    get(k) { return k === 'tools' ? ctx.tools : undefined; },
    effect(fn) { if (typeof fn === 'function') fn(); return () => {}; },
    provide(k, v) { provided[k] = v; },
  };
  apply(ctx, { configPath });
  ctx.tools.register(def);
  assert.equal(provided.tool_keeper.status().isLive(TOOL), false, 'drop 了就不该在线');
  rmSync(dir, { recursive: true, force: true });
});
