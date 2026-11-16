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
import { createBaselineConfig } from '../baseline.js';
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
    patched: true, configPath,
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

test('tool: 6 个 action 全部列在 enum 里', () => {
  const { definition, dir } = setup();
  const action = definition.parameters.properties.action;
  assert.deepEqual([...action.enum].sort(), ['list', 'reset', 'rewrite', 'server', 'status', 'tool'].sort());
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
test('tool: server 缺 server 参数时抛错', async () => {
  const { definition, dir } = setup();
  await assert.rejects(() => definition.execute({ action: 'server' }), /需要 server/);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: server 开关只动上架层，往返不碰逐工具规则', async () => {
  const { definition, configPath, dir } = setup();
  writeFileSync(configPath, JSON.stringify({ servers: {}, tools: { 'mcp__rea__x': 'drop' }, rewrite: {} }));
  await definition.execute({ action: 'server', server: 'rea', enabled: false });
  let c = readConfig(configPath);
  assert.deepEqual(c.servers.rea, { enabled: false });
  assert.equal(c.tools['mcp__rea__x'], 'drop', '关整台不能碰逐工具规则');
  await definition.execute({ action: 'server', server: 'rea', enabled: true });
  c = readConfig(configPath);
  assert.equal(c.servers.rea, undefined, '开回来删掉停用标记');
  assert.equal(c.tools['mcp__rea__x'], 'drop', '逐工具规则原样保留');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: server 传 keep 被拒绝并说明已移除', async () => {
  const { definition, dir } = setup();
  await assert.rejects(
    () => definition.execute({ action: 'server', server: 'rea', keep: ['x'] }),
    (error) => error.code === 'EINVALID',
  );
  rmSync(dir, { recursive: true, force: true });
});
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
test('tool: reset 恢复出厂基线并留备份', async () => {
  const { definition, configPath, dir } = setup();
  writeFileSync(configPath, JSON.stringify({ servers: {}, tools: { x: 'drop' }, rewrite: {} }));
  const r = await definition.execute({ action: 'reset' });
  assert.equal(r.ok, true);
  const c = readConfig(configPath);
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
  await definition.execute({ action: 'server', server: 'tinyfish', enabled: false });
  await definition.execute({
    action: 'rewrite', name: 'mcp__tinyfish__fetch_content', target: 'description', text: '读正文',
  });
  const { rules, problems } = normalizeConfig(readConfig(configPath));
  assert.deepEqual(problems, []);
  assert.equal(rules.disabledServers.has('tinyfish'), true);
  assert.equal(rules.rewrites.get('mcp__tinyfish__fetch_content').description, '读正文');
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// baseline —— 出厂不做任何管理
// ─────────────────────────────────────────────
test('baseline: 出厂不关任何内置工具', () => {
  assert.deepEqual(createBaselineConfig().tools, {}, '内置工具默认全开');
  const c = createBaselineConfig();
  assert.deepEqual(Object.keys(c.tools), []);
});

test('baseline: 出厂不对任何 MCP 服务器设规则', () => {
  assert.deepEqual(createBaselineConfig().servers, {}, '出厂不预设服务器规则');
  const c = createBaselineConfig();
  assert.deepEqual(Object.keys(c.servers), []);
});

test('baseline: 出厂不预设任何改写', () => {
  const c = createBaselineConfig();
  assert.deepEqual(Object.keys(c.rewrite), []);
});

test('baseline: 不再有全局开关字段', () => {
  assert.equal('enabled' in createBaselineConfig(), false);
});

test('baseline: 空配置解析后不隐藏任何工具', () => {
  const { rules, problems } = normalizeConfig(createBaselineConfig());
  assert.deepEqual(problems, []);
  assert.equal(rules.disabledServers.size, 0);
  assert.equal(rules.toolOverrides.size, 0);
  assert.equal(rules.rewrites.size, 0);
});
// ─────────────────────────────────────────────
// 写前校验：模型工具这条路径原来完全不校验
// ─────────────────────────────────────────────
test('tool: 非法输入不会落盘', async () => {
  const { definition, configPath, dir } = setup();
  // 先做一次合法写入，让配置文件存在，后面才能比对「一个字都没变」
  await definition.execute({ action: 'tool', name: 'mcp__a__b', state: 'drop' });
  const before = readFileSync(configPath, 'utf8');

  // text 不是字符串：由参数校验直接挡住（比写前校验更早一层）
  await assert.rejects(
    () => definition.execute({ action: 'rewrite', name: 'read', target: 'description', text: 12345 }),
    '非字符串 text 必须被拒绝',
  );

  // 配置文件一个字节都不该变
  assert.equal(readFileSync(configPath, 'utf8'), before, '拒绝后配置不能变');
  rmSync(dir, { recursive: true, force: true });
});

test('tool: 危险键写入被拒绝', async () => {
  const { definition, configPath, dir } = setup();
  await definition.execute({ action: 'tool', name: 'mcp__a__b', state: 'drop' });
  const before = readFileSync(configPath, 'utf8');

  await assert.rejects(
    () => definition.execute({ action: 'server', server: '__proto__', enabled: false }),
    (error) => error.code === 'EINVALID',
    '原型链键必须被拒绝',
  );
  assert.equal(readFileSync(configPath, 'utf8'), before);
  rmSync(dir, { recursive: true, force: true });
});

test('tool: 正常写入仍然成功', async () => {
  const { definition, configPath, dir } = setup();
  const r = await definition.execute({ action: 'server', server: 'tinyfish', enabled: false });
  assert.equal(r.ok, true);
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(saved.servers.tinyfish.enabled, false);
  rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────
// 说明页事实透传（0.5.0）
// ─────────────────────────────────────────────
test('tool: status 快照缺 instructions 时容缺省', async () => {
  const { definition, dir } = setup();
  const r = await definition.execute({ action: 'status' });
  assert.deepEqual(r.instructions, { installed: false, removed: [] });
  rmSync(dir, { recursive: true, force: true });
});

test('tool: status 透传 instructions 事实', async () => {
  const dir = makeTmp();
  const configPath = join(dir, 'tool-keeper.json');
  const { ctx, captured } = makeCtx();
  const deps = makeDeps(configPath);
  deps.snapshot = () => ({
    patched: true, configPath, diagnostics: [], problems: [],
    instructions: { installed: true, removed: ['rea'] },
  });
  registerTool(ctx, { configPath, ...deps });
  const r = await captured.definition.execute({ action: 'status' });
  assert.deepEqual(r.instructions, { installed: true, removed: ['rea'] });
  rmSync(dir, { recursive: true, force: true });
});
