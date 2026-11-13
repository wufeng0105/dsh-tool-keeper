/**
 * tool.js 与 baseline.js 的测试。
 *
 * tool.js 的 execute 需要 ctx.tools.register，这里用一个最小的假 ctx 承接，
 * 拿到 definition 后直接调用 execute —— 这样能测到真实的读写逻辑。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerTool } from '../tool.js';
import { createBaselineConfig, BASELINE_DROP, BASELINE_SERVERS } from '../baseline.js';
import { normalizeConfig, ToolCatalog } from '../rules.js';

/** 建一个临时目录当 DSH_HOME。 */
function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'tool-keeper-test-'));
}

/** 造一个假 ctx：捕获 register 进来的定义。 */
function makeCtx() {
  const captured = { definition: undefined, disposed: 0 };
  return {
    captured,
    ctx: {
      tools: {
        register(definition) {
          captured.definition = definition;
          return () => { captured.disposed += 1; };
        },
      },
    },
  };
}

/** 造一份可用的 snapshot/catalog 桩。 */
function makeDeps(configPath) {
  const catalog = new ToolCatalog();
  catalog.record({ name: 'mcp__tinyfish__search', description: 'search desc', parameters: { a: 1 } });
  catalog.record({ name: 'read', description: 'read desc', parameters: {} });
  const snapshot = () => ({
    patched: true, enabled: true, configPath,
    diagnostics: [], problems: [],
  });
  const log = { info() {}, warn() {} };
  return { catalog, snapshot, log };
}

function setup() {
  const dir = makeTmp();
  const configPath = join(dir, 'tool-keeper.json');
  const { ctx, captured } = makeCtx();
  const deps = makeDeps(configPath);
  const dispose = registerTool(ctx, { configPath, ...deps });
  return { dir, configPath, definition: captured.definition, dispose, deps };
}

function readConfig(configPath) {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

// ─────────────────────────────────────────────
// 工具定义形状
// ─────────────────────────────────────────────
test('tool: 注册名是 tool-keeper（保护名单已预留）', () => {
  const { definition, dir } = setup();
  assert.equal(definition.name, 'tool_keeper');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: 7 个 action 全部列在 enum 里', () => {
  const { definition, dir } = setup();
  const action = definition.parameters.properties.action;
  assert.deepEqual([...action.enum].sort(), ['enable', 'list', 'reset', 'rewrite', 'server', 'status', 'tool'].sort());
  assert.deepEqual(definition.parameters.required, ['action']);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// status / list（只读，不写盘）
// ─────────────────────────────────────────────
test('tool: status 返回 snapshot 的字段', async () => {
  const { definition, configPath, dir } = setup();
  const r = await definition.execute({ action: 'status' });
  assert.equal(r.patched, true);
  assert.equal(r.configPath, configPath);
  assert.equal(r.toolCount, 2);
  assert.equal(existsSync(configPath), false, 'status 不应写盘');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: list 按来源分组并给出字符数', async () => {
  const { definition, dir } = setup();
  const r = await definition.execute({ action: 'list' });
  assert.equal(r.total, 2);
  const groups = r.groups.map(g => g.group).sort();
  assert.deepEqual(groups, ['core', 'mcp:tinyfish']);
  const tf = r.groups.find(g => g.group === 'mcp:tinyfish');
  assert.equal(tf.tools[0].name, 'mcp__tinyfish__search');
  assert.ok(tf.tools[0].chars > 0);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// server
// ─────────────────────────────────────────────
test('tool: server + keep 写入白名单', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({ action: 'server', server: 'exa', keep: ['web_search_exa'] });
  const c = readConfig(configPath);
  assert.deepEqual(c.servers.exa.keep, ['web_search_exa']);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: server + 空 keep = 关闭该服务器全部工具', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({ action: 'server', server: 'context7', keep: [] });
  const c = readConfig(configPath);
  assert.equal(c.servers.context7.enabled, false);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: server 省略 keep = 移除规则（全部保留）', async () => {
  const { definition, configPath, dir } = setup();
  writeFileSync(configPath, JSON.stringify({ servers: { exa: { keep: ['a'] } }, tools: {}, rewrite: {} }));
  await definition.execute({ action: 'server', server: 'exa' });
  const c = readConfig(configPath);
  assert.equal(c.servers.exa, undefined, 'exa 规则应被移除');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: server 缺 server 参数时抛错', async () => {
  const { definition, dir } = setup();
  await assert.rejects(() => definition.execute({ action: 'server' }), /需要 server/);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// tool
// ─────────────────────────────────────────────
test('tool: drop 单个工具', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({ action: 'tool', name: 'mcp__tinyfish__search', state: 'drop' });
  const c = readConfig(configPath);
  assert.equal(c.tools['mcp__tinyfish__search'], 'drop');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: 拒绝关闭受保护工具', async () => {
  const { definition, dir } = setup();
  await assert.rejects(
    () => definition.execute({ action: 'tool', name: 'read', state: 'drop' }),
    /受保护/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('tool: 非法 state 被拒绝', async () => {
  const { definition, dir } = setup();
  await assert.rejects(
    () => definition.execute({ action: 'tool', name: 'foo', state: 'nuke' }),
    /state/,
  );
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// rewrite
// ─────────────────────────────────────────────
test('tool: rewrite description 写入字符串形态', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({
    action: 'rewrite', name: 'mcp__tinyfish__search', target: 'description', text: '新说明',
  });
  const c = readConfig(configPath);
  assert.equal(c.rewrite['mcp__tinyfish__search'].description, '新说明');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: rewrite param 写入 properties，且不丢已有 description', async () => {
  const { definition, configPath, dir } = setup();
  writeFileSync(configPath, JSON.stringify({
    servers: {}, tools: {},
    rewrite: { 'mcp__tinyfish__search': { description: '已有说明' } },
  }));
  await definition.execute({
    action: 'rewrite', name: 'mcp__tinyfish__search', target: 'param', param: 'ttl', text: '缓存秒数',
  });
  const c = readConfig(configPath);
  const e = c.rewrite['mcp__tinyfish__search'];
  assert.equal(e.description, '已有说明', '不能丢掉已有 description');
  assert.equal(e.properties.ttl, '缓存秒数');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: rewrite 省略 text = 清除，并返回服务器原文', async () => {
  const { definition, configPath, dir } = setup();
  writeFileSync(configPath, JSON.stringify({
    servers: {}, tools: {},
    rewrite: { 'mcp__tinyfish__search': { description: '改过的' } },
  }));
  const r = await definition.execute({ action: 'rewrite', name: 'mcp__tinyfish__search' });
  assert.equal(r.cleared, true);
  assert.equal(r.originalDescription, 'search desc', '应返回 catalog 里的原文');
  const c = readConfig(configPath);
  assert.equal(c.rewrite['mcp__tinyfish__search'], undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: rewrite 缺 name 时抛错', async () => {
  const { definition, dir } = setup();
  await assert.rejects(() => definition.execute({ action: 'rewrite', text: 'x' }), /需要 name/);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// enable / reset
// ─────────────────────────────────────────────
test('tool: enable false 写入总开关', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({ action: 'enable', value: false });
  const c = readConfig(configPath);
  assert.equal(c.enabled, false);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: enable 需要布尔值', async () => {
  const { definition, dir } = setup();
  await assert.rejects(() => definition.execute({ action: 'enable' }), /value/);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: reset 恢复出厂基线并留备份', async () => {
  const { definition, configPath, dir } = setup();
  writeFileSync(configPath, JSON.stringify({ enabled: false, servers: {}, tools: { x: 'drop' }, rewrite: {} }));
  const r = await definition.execute({ action: 'reset' });
  assert.equal(r.ok, true);
  const c = readConfig(configPath);
  assert.equal(c.enabled, true);
  assert.deepEqual(Object.keys(c.tools), [], '基线不关内置工具');
  assert.ok(r.note.includes('备份'));
  rmSync(dir, { recursive: true, force: true });
});

test('tool: 未知 action 抛错', async () => {
  const { definition, dir } = setup();
  await assert.rejects(() => definition.execute({ action: 'nope' }), /未知 action/);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 写回后仍能被 rules.js 正确解析（端到端）
// ─────────────────────────────────────────────
test('端到端: tool 写出的配置能被 normalizeConfig 解析', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({ action: 'server', server: 'tinyfish', keep: ['search', 'fetch_content'] });
  await definition.execute({
    action: 'rewrite', name: 'mcp__tinyfish__fetch_content', target: 'description', text: '读正文',
  });
  const { rules, problems } = normalizeConfig(readConfig(configPath));
  assert.deepEqual(problems, []);
  assert.deepEqual([...rules.serverKeep.get('tinyfish')], ['search', 'fetch_content']);
  assert.equal(rules.rewrites.get('mcp__tinyfish__fetch_content').description, '读正文');
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// baseline —— 出厂不做任何管理
// ─────────────────────────────────────────────
test('baseline: 出厂不关任何内置工具', () => {
  assert.deepEqual([...BASELINE_DROP], [], '内置工具默认全开');
  const c = createBaselineConfig();
  assert.deepEqual(Object.keys(c.tools), []);
});

test('baseline: 出厂不对任何 MCP 服务器设规则', () => {
  assert.deepEqual(Object.keys(BASELINE_SERVERS), [], '出厂不预设服务器规则');
  const c = createBaselineConfig();
  assert.deepEqual(Object.keys(c.servers), []);
});

test('baseline: 出厂不预设任何改写', () => {
  const c = createBaselineConfig();
  assert.deepEqual(Object.keys(c.rewrite), []);
});

test('baseline: 默认启用，可显式关闭', () => {
  assert.equal(createBaselineConfig().enabled, true);
  assert.equal(createBaselineConfig({ enabled: false }).enabled, false);
});

test('baseline: 空配置解析后不隐藏任何工具', () => {
  const { rules, problems } = normalizeConfig(createBaselineConfig());
  assert.deepEqual(problems, []);
  assert.equal(rules.enabled, true);
  assert.equal(rules.disabledServers.size, 0);
  assert.equal(rules.serverKeep.size, 0);
  assert.equal(rules.toolOverrides.size, 0);
  assert.equal(rules.rewrites.size, 0);
});
