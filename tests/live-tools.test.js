/**
 * liveTools：工具注销后，诊断必须重新知道「它已经不在了」。
 *
 * 为什么测这个：修复前 `seen` 是只增不减的 Set，工具注销后名字永远留着，
 * 于是「配置里的规则/改写已失效」这类诊断再也不会出现——正是本插件要消灭的
 * 那种静默。修复后改成「当前注册份数」，注销即递减。
 *
 * 观测手段：配一条指向某工具的改写。
 *   - 工具在线   → 不该报「指向不存在的工具」
 *   - 工具不在线 → 该报
 * 所以「注册 → 诊断消失 → 注销 → 诊断重现」这一串就能证明计数是对的。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../index.js';

/** 假宿主：register 记录调用并返回可控 disposer；provide 捕获 status。 */
function makeHost() {
  const provided = {};
  const ctx = {
    tools: {
      register(definition) {
        return () => { /* 宿主侧注销 */ };
      },
    },
    on() { return () => {}; },
    get(key) { return key === 'tools' ? ctx.tools : undefined; },
    effect(fn) { if (typeof fn === 'function') fn(); return () => {}; },
    provide(key, value) { provided[key] = value; },
  };
  return { ctx, provided };
}

function setup(config) {
  const dir = mkdtempSync(join(tmpdir(), 'tk-live-'));
  const configPath = join(dir, 'tool-keeper.json');
  writeFileSync(configPath, JSON.stringify(config));
  const { ctx, provided } = makeHost();
  apply(ctx, { configPath });
  const status = () => provided.tool_keeper.status();
  const diagText = () => (status().diagnostics ?? []).map(d => d.message).join(' | ');
  return { ctx, dir, status, diagText, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const TOOL = 'mcp__probe__thing';

test('liveTools: 未注册时报「改写指向不存在的工具」', () => {
  const { diagText, cleanup } = setup({ rewrite: { [TOOL]: '我的说明' } });
  assert.match(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '工具从没注册过，应报这条');
  cleanup();
});

test('liveTools: 注册后该诊断消失', () => {
  const { ctx, diagText, cleanup } = setup({ rewrite: { [TOOL]: '我的说明' } });
  ctx.tools.register({ name: TOOL, description: 'x', parameters: {}, output: { schema: {}, render() { return []; } } });
  assert.doesNotMatch(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '工具已在线，不该再报');
  cleanup();
});

test('liveTools: 注销后该诊断必须重现（修复前永不重现）', () => {
  const { ctx, diagText, cleanup } = setup({ rewrite: { [TOOL]: '我的说明' } });
  const dispose = ctx.tools.register({ name: TOOL, description: 'x', parameters: {}, output: { schema: {}, render() { return []; } } });
  assert.doesNotMatch(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '前置：注册后不报');

  dispose();

  assert.match(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '注销后必须重新报出来');
  cleanup();
});

test('liveTools: 同名注册两次，注销一次仍算在线', () => {
  const { ctx, diagText, cleanup } = setup({ rewrite: { [TOOL]: '我的说明' } });
  const d1 = ctx.tools.register({ name: TOOL, description: 'a', parameters: {}, output: { schema: {}, render() { return []; } } });
  const d2 = ctx.tools.register({ name: TOOL, description: 'b', parameters: {}, output: { schema: {}, render() { return []; } } });

  d1();
  assert.doesNotMatch(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '还有一份注册在，应算在线');

  d2();
  assert.match(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '两份都注销后才算不在');
  cleanup();
});

test('liveTools: 重复调用同一个 disposer 不会把计数退成负数', () => {
  const { ctx, diagText, cleanup } = setup({ rewrite: { [TOOL]: '我的说明' } });
  const disposer = ctx.tools.register({ name: TOOL, description: 'x', parameters: {}, output: { schema: {}, render() { return []; } } });
  disposer();
  disposer();
  disposer();
  assert.match(diagText(), /当前不在线|暂不生效|指向不存在的工具/, '退多了也只是不在线，不该抛错或复活');
  cleanup();
});
