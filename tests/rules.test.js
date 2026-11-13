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
  rewriteParameterDescriptions, ToolCatalog,
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

test('decide: rewrite 命中时返回改写条目', () => {
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': '读网页正文。' } });
  const v = decide('mcp__tinyfish__fetch_content', rules, new Set(['tinyfish']));
  assert.equal(v.action, 'rewrite');
  assert.equal(v.rewrite.description, '读网页正文。');
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

// ─────────────────────────────────────────────
// R2.2 参数说明改写
// ─────────────────────────────────────────────
const paramFixture = () => ({
  type: 'object',
  properties: {
    urls: { type: 'array', description: 'Array of URLs to fetch' },
    ttl: { type: 'integer', description: 'Caller freshness tolerance in seconds' },
  },
  required: ['urls'],
});

test('rewriteParameterDescriptions: 替换指定参数的说明', () => {
  const params = paramFixture();
  const { parameters, applied, missing } = rewriteParameterDescriptions(params, new Map([['ttl', '缓存秒数']]));
  assert.deepEqual(applied, ['ttl']);
  assert.deepEqual(missing, []);
  assert.equal(parameters.properties.ttl.description, '缓存秒数');
  assert.equal(parameters.properties.urls.description, 'Array of URLs to fetch', '未指定的参数不得改动');
  assert.equal(params.properties.ttl.description, 'Caller freshness tolerance in seconds', '原对象不得被修改');
});

test('rewriteParameterDescriptions: 结构字段一个不动（D2）', () => {
  const params = paramFixture();
  const { parameters } = rewriteParameterDescriptions(params, new Map([['urls', 'URL 列表']]));
  assert.equal(parameters.properties.urls.type, 'array');
  assert.deepEqual(parameters.required, ['urls'], 'required 必须原样保留');
  assert.equal(parameters.type, 'object');
});

test('rewriteParameterDescriptions: 不存在的参数记入 missing，不抛', () => {
  const params = paramFixture();
  const { parameters, applied, missing } = rewriteParameterDescriptions(params, new Map([['nope', 'x']]));
  assert.deepEqual(applied, []);
  assert.deepEqual(missing, ['nope']);
  assert.equal(parameters, params, '全未命中时应返回原对象');
});

test('rewriteParameterDescriptions: 空 overrides 时原样返回', () => {
  const params = paramFixture();
  const r = rewriteParameterDescriptions(params, new Map());
  assert.equal(r.parameters, params);
});

test('applyToDefinition: 对象形态的 rewrite 同时改工具说明与参数说明', () => {
  const params = paramFixture();
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: params };
  const rules = rulesOf({
    rewrite: {
      'mcp__tinyfish__fetch_content': {
        description: '读网页正文。',
        properties: { ttl: '缓存秒数' },
      },
    },
  });
  const r = applyToDefinition(def, rules, new Set(['tinyfish']));
  assert.equal(r.definition.description, '读网页正文。');
  assert.equal(r.definition.parameters.properties.ttl.description, '缓存秒数');
  assert.equal(r.definition.parameters.properties.urls.description, 'Array of URLs to fetch');
  assert.equal(r.definition.parameters.required[0], 'urls');
});

test('applyToDefinition: 对象形态只给 properties 时不改工具说明', () => {
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: paramFixture() };
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': { properties: { ttl: '缓存秒数' } } } });
  const r = applyToDefinition(def, rules, new Set(['tinyfish']));
  assert.equal(r.definition.description, 'orig', '未指定 description 时不得改动');
});

test('applyToDefinition: 参数不存在时进入 missingParams', () => {
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: paramFixture() };
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': { properties: { ghost: 'x' } } } });
  const r = applyToDefinition(def, rules, new Set(['tinyfish']));
  assert.deepEqual(r.missingParams, ['ghost']);
});

test('normalizeConfig: 字符串与对象两种 rewrite 形态共存', () => {
  const { rules, problems } = normalizeConfig({
    rewrite: {
      'mcp__a__b': '简单说明',
      'mcp__a__c': { description: '复杂说明', properties: { p: '参数说明' } },
    },
  });
  assert.equal(problems.length, 0);
  // 两种形态统一归一化为对象，调用方不需分支
  assert.equal(rules.rewrites.get('mcp__a__b').description, '简单说明');
  assert.equal(rules.rewrites.get('mcp__a__b').properties.size, 0);
  assert.equal(rules.rewrites.get('mcp__a__c').description, '复杂说明');
  assert.equal(rules.rewrites.get('mcp__a__c').properties.get('p'), '参数说明');
});

test('normalizeConfig: 空的 rewrite 对象被拒绝并记问题', () => {
  const { rules, problems } = normalizeConfig({ rewrite: { 'mcp__a__b': {} } });
  assert.equal(rules.rewrites.has('mcp__a__b'), false);
  assert.ok(problems.some(p => /neither description nor properties/.test(p)));
});

// ─────────────────────────────────────────────
// ToolCatalog（原始文本留存）
// ─────────────────────────────────────────────
test('ToolCatalog: 记录原始 description 与体积，供还原与界面使用', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'mcp__tinyfish__fetch_content', description: '很长的说明', parameters: { a: 1 } });
  const e = cat.get('mcp__tinyfish__fetch_content');
  assert.equal(e.description, '很长的说明');
  assert.equal(e.server, 'tinyfish');
  assert.equal(e.leaf, 'fetch_content');
  assert.equal(e.group, 'mcp:tinyfish');
  assert.ok(e.originalChars > 0);
});

test('ToolCatalog: 已记录的条目不被后来者覆盖（保证原文）', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'x', description: '原始' });
  cat.record({ name: 'x', description: '改写后' });
  assert.equal(cat.get('x').description, '原始');
});

test('ToolCatalog: 按来源分组', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'read', description: 'r' });
  cat.record({ name: 'mcp__tinyfish__search', description: 's' });
  cat.record({ name: 'mcp__tinyfish__fetch_content', description: 'f' });
  const groups = cat.groups();
  assert.equal(groups.get('core').length, 1);
  assert.equal(groups.get('mcp:tinyfish').length, 2);
});

test('ToolCatalog: 标记保护工具', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'read', description: 'r' });
  cat.record({ name: 'other', description: 'o' });
  assert.equal(cat.get('read').protected, true);
  assert.equal(cat.get('other').protected, false);
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
