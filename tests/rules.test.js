/**
 * rules.js 的单元测试。
 *
 * 纪律：先证明它会红，再用它判通过。
 * 本文件里每个 describe 至少有一条「反向断言」——即如果实现被改坏，测试必须失败。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitMcpName, groupOf, isProtected, normalizeConfig, decide, applyToDefinition, diagnose,
  PROTECTED_TOOLS, MCP_PREFIX,
} from '../rules.js';

const NO_SERVERS = new Set();

function rulesOf(raw) {
  return normalizeConfig(raw).rules;
}

// ─────────────────────────────────────────────
// splitMcpName
// ─────────────────────────────────────────────
test('splitMcpName: 正常拆分', () => {
  assert.deepEqual(splitMcpName('mcp__tinyfish__fetch_content'), {
    server: 'tinyfish', leaf: 'fetch_content',
  });
});

test('splitMcpName: 非 MCP 名字返回 undefined', () => {
  assert.equal(splitMcpName('read'), undefined);
  assert.equal(splitMcpName('mcp__bogus'), undefined);   // 没有第二段
  assert.equal(splitMcpName('mcp____x'), undefined);      // 空 server
  assert.equal(splitMcpName(123), undefined);
  assert.equal(splitMcpName(undefined), undefined);
});

test('splitMcpName: leaf 里再含 __ 时只按第一个切', () => {
  assert.deepEqual(splitMcpName('mcp__srv__a__b'), { server: 'srv', leaf: 'a__b' });
});

// ─────────────────────────────────────────────
// 保护名单
// ─────────────────────────────────────────────
test('isProtected: 覆盖关键基础工具', () => {
  for (const name of ['read', 'write', 'edit', 'pwsh', 'grep', 'glob']) {
    assert.equal(isProtected(name), true, name + ' 必须在保护名单里');
  }
});

test('isProtected: 非名单工具不受保护', () => {
  assert.equal(isProtected('mcp__tinyfish__search'), false);
  assert.equal(isProtected('some_random_tool'), false);
});

// ─────────────────────────────────────────────
// normalizeConfig —— 坏配置不能抛
// ─────────────────────────────────────────────
test('normalizeConfig: 空/undefined/null 都返回空规则且不抛', () => {
  for (const v of [undefined, null, {}]) {
    const { rules, problems } = normalizeConfig(v);
    assert.equal(problems.length, 0);
    assert.equal(rules.disabledServers.size, 0);
  }
});

test('normalizeConfig: 根不是对象时记问题而不抛', () => {
  const { problems } = normalizeConfig('not an object');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /config root must be an object/);
});

test('normalizeConfig: servers 形态错误被记录', () => {
  const { problems } = normalizeConfig({ servers: [] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /servers must be an object/);
});

test('normalizeConfig: keep 不是数组被记录', () => {
  const { problems } = normalizeConfig({ servers: { tinyfish: { keep: 'search' } } });
  assert.ok(problems.some(p => /keep must be an array/.test(p)));
});

test('normalizeConfig: tools 值非法被记录', () => {
  const { problems } = normalizeConfig({ tools: { foo: 'nuke' } });
  assert.ok(problems.some(p => /must be "drop" or "keep"/.test(p)));
});

test('normalizeConfig: 试图覆盖保护工具被拒绝', () => {
  const { rules, problems } = normalizeConfig({ tools: { read: 'drop' } });
  assert.equal(rules.toolOverrides.has('read'), false, '保护工具不得进入覆盖表');
  assert.ok(problems.some(p => /protected/.test(p)));
});

test('normalizeConfig: rewrite 非字符串被记录', () => {
  const { problems } = normalizeConfig({ rewrite: { 'mcp__a__b': 42 } });
  assert.ok(problems.some(p => /must be a string/.test(p)));
});

// ─────────────────────────────────────────────
// decide —— 优先级
// ─────────────────────────────────────────────
test('decide: 保护工具即便配了 drop 也放行', () => {
  const rules = rulesOf({});
  rules.toolOverrides.set('read', 'drop');   // 绕过 normalizeConfig 直接塞
  const v = decide('read', rules);
  assert.equal(v.action, 'keep');
  assert.equal(v.reason, 'protected');
});

test('decide: 服务器总开关生效', () => {
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  assert.equal(decide('mcp__tinyfish__search', rules, new Set(['tinyfish'])).action, 'drop');
});

test('decide: 服务器白名单生效', () => {
  const rules = rulesOf({ servers: { tinyfish: { keep: ['search'] } } });
  assert.equal(decide('mcp__tinyfish__search', rules, new Set(['tinyfish'])).action, 'keep');
  assert.equal(decide('mcp__tinyfish__create_dataset', rules, new Set(['tinyfish'])).action, 'drop');
});

test('decide: 单工具规则胜过服务器总开关（最具体者胜）', () => {
  const rules = rulesOf({
    servers: { tinyfish: { enabled: false } },
    tools: { 'mcp__tinyfish__search': 'keep' },
  });
  const v = decide('mcp__tinyfish__search', rules, new Set(['tinyfish']));
  assert.equal(v.action, 'keep', '单工具 keep 必须压过服务器关闭');
});

test('decide: 单工具 drop 胜过白名单', () => {
  const rules = rulesOf({
    servers: { tinyfish: { keep: ['search', 'fetch_content'] } },
    tools: { 'mcp__tinyfish__search': 'drop' },
  });
  assert.equal(decide('mcp__tinyfish__search', rules, new Set(['tinyfish'])).action, 'drop');
  assert.equal(decide('mcp__tinyfish__fetch_content', rules, new Set(['tinyfish'])).action, 'keep');
});

test('decide: 未知服务器一律不隐藏', () => {
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  // tinyfish 不在 knownServers 里
  const v = decide('mcp__tinyfish__search', rules, new Set(['other']));
  assert.equal(v.action, 'keep', '未知服务器不该被隐藏');
});

test('decide: 原生工具不受服务器规则影响', () => {
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  assert.equal(decide('schedule_list', rules, new Set(['tinyfish'])).action, 'keep');
});

test('decide: rewrite 命中时返回改写文本', () => {
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': '读网页正文。' } });
  const v = decide('mcp__tinyfish__fetch_content', rules, new Set(['tinyfish']));
  assert.equal(v.action, 'rewrite');
  assert.equal(v.description, '读网页正文。');
});

test('decide: 被 drop 的工具不产生 rewrite', () => {
  const rules = rulesOf({
    servers: { tinyfish: { enabled: false } },
    rewrite: { 'mcp__tinyfish__search': '不该出现' },
  });
  const v = decide('mcp__tinyfish__search', rules, new Set(['tinyfish']));
  assert.equal(v.action, 'drop', 'drop 优先于 rewrite');
});

// ─────────────────────────────────────────────
// applyToDefinition
// ─────────────────────────────────────────────
test('applyToDefinition: drop 时原样返回 definition 并标记', () => {
  const def = { name: 'mcp__tinyfish__search', description: 'orig', parameters: { a: 1 } };
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  const r = applyToDefinition(def, rules, new Set(['tinyfish']));
  assert.equal(r.drop, true);
  assert.equal(r.definition, def, 'drop 时不应构造新对象');
});

test('applyToDefinition: rewrite 只换 description，其余字段保持引用', () => {
  const params = { type: 'object', properties: {} };
  const output = { schema: {}, render: () => [] };
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: params, output };
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': '新说明' } });
  const r = applyToDefinition(def, rules, new Set(['tinyfish']));
  assert.equal(r.drop, false);
  assert.equal(r.definition.description, '新说明');
  assert.equal(r.definition.parameters, params, 'parameters 必须是同一引用');
  assert.equal(r.definition.output, output, 'output 必须是同一引用');
  assert.equal(def.description, 'orig', '原对象不得被修改');
});

test('applyToDefinition: 无规则时返回原对象', () => {
  const def = { name: 'mcp__tinyfish__search', description: 'orig' };
  const rules = rulesOf({});
  const r = applyToDefinition(def, rules, new Set(['tinyfish']));
  assert.equal(r.drop, false);
  assert.equal(r.definition, def);
});

// ─────────────────────────────────────────────
// diagnose —— 三态
// ─────────────────────────────────────────────
test('diagnose: 服务器不在 mcp-manager.servers 里 → error', () => {
  const rules = rulesOf({ servers: { ghost: { enabled: false } } });
  const out = diagnose(rules, [], new Set(['tinyfish']));
  const hit = out.find(d => d.target === 'servers.ghost');
  assert.ok(hit, '必须报出 ghost');
  assert.equal(hit.kind, 'error');
});

test('diagnose: 服务器存在但无工具 → warning', () => {
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  const out = diagnose(rules, [], new Set(['tinyfish']));
  const hit = out.find(d => d.target === 'servers.tinyfish');
  assert.ok(hit);
  assert.equal(hit.kind, 'warning');
});

test('diagnose: keep 里的工具名匹配不上 → warning', () => {
  const rules = rulesOf({ servers: { tinyfish: { keep: ['nosuchtool'] } } });
  const out = diagnose(rules, ['mcp__tinyfish__search'], new Set(['tinyfish']));
  const hit = out.find(d => d.target === 'servers.tinyfish.keep.nosuchtool');
  assert.ok(hit);
  assert.equal(hit.kind, 'warning');
});

test('diagnose: 完全正常的配置不产生任何诊断', () => {
  const rules = rulesOf({ servers: { tinyfish: { keep: ['search'] } } });
  const out = diagnose(rules, ['mcp__tinyfish__search'], new Set(['tinyfish']));
  assert.deepEqual(out, []);
});

test('diagnose: rewrite 指向不存在的工具 → warning', () => {
  const rules = rulesOf({ rewrite: { 'mcp__gone__tool': 'x' } });
  const out = diagnose(rules, ['mcp__tinyfish__search'], new Set(['tinyfish']));
  assert.ok(out.some(d => d.target === 'rewrite.mcp__gone__tool'));
});
