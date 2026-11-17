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
  assert.match(problems[0], /配置根必须是一个对象/);
});

test('normalizeConfig: servers 形态错误被记录', () => {
  const { problems } = normalizeConfig({ servers: [] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /servers 必须是对象/);
});

test('normalizeConfig: servers.*.keep 已移除会被记录（不静默忽略）', () => {
  const { problems } = normalizeConfig({ servers: { tinyfish: { keep: ['search'] } } });
  assert.ok(problems.some(p => p.includes('已移除')), '必须报出来，不能静默忽略');
});

test('normalizeConfig: enabled 已移除会被记录', () => {
  const { problems } = normalizeConfig({ enabled: true });
  assert.ok(problems.some(p => p.includes('enabled 已移除')), '必须提示改用 DSH 插件页');
});

test('迁移等价：旧 keep 名单与等价的 drop 集合判定一致', () => {
  // 旧语义：keep 名单外的都 drop；迁移成「名单外写成 drop」后必须完全等价
  const keep = ['a', 'b'];
  const names = ['mcp__s__a', 'mcp__s__b', 'mcp__s__c', 'read'];
  const rules = rulesOf({ tools: { 'mcp__s__c': 'drop' } });
  for (const n of names) {
    const leaf = n.startsWith('mcp__s__') ? n.split('__')[2] : undefined;
    const oldVisible = leaf === undefined || keep.includes(leaf);
    const newVisible = decide(n, rules).action !== 'drop';
    assert.equal(newVisible, oldVisible, n);
  }
});

test('normalizeConfig: tools 值非法被记录', () => {
  const { problems } = normalizeConfig({ tools: { foo: 'nuke' } });
  assert.ok(problems.some(p => /只能是/.test(p)));
});

test('normalizeConfig: 试图覆盖保护工具被拒绝', () => {
  const { rules, problems } = normalizeConfig({ tools: { read: 'drop' } });
  assert.equal(rules.toolOverrides.has('read'), false, '保护工具不得进入覆盖表');
  assert.ok(problems.some(p => /受保护工具/.test(p)));
});

test('normalizeConfig: rewrite 非字符串被记录', () => {
  const { problems } = normalizeConfig({ rewrite: { 'mcp__a__b': 42 } });
  assert.ok(problems.some(p => /必须是字符串/.test(p)));
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
  assert.equal(decide('mcp__tinyfish__search', rules).action, 'drop');
});

test('decide: 服务器总开关压过单工具 keep（关 = 一个不剩）', () => {
  const rules = rulesOf({
    servers: { tinyfish: { enabled: false } },
    tools: { 'mcp__tinyfish__search': 'keep' },
  });
  const v = decide('mcp__tinyfish__search', rules);
  assert.equal(v.action, 'drop', '总开关关闭时 keep 条目不得漏网（0.3.20 语义）');
});

test('decide: 未在配置里声明的服务器，无规则照常放行', () => {
  // 判定不再依赖宿主声明：没写规则就是没规则，与服务器是否存在无关
  const rules = rulesOf({});
  const v = decide('mcp__ghost__whatever', rules);
  assert.equal(v.action, 'keep', '没配规则的服务器，工具照常放行');
  assert.equal(v.reason, 'no rule');
});

test('decide: 配置了规则的服务器一律执行，不依赖宿主是否声明它', () => {
  // 服务器没连上时没有工具出现，规则自然惰性；一旦出现就按配置执行
  const rules = rulesOf({
    servers: { s2: { enabled: false } },
    tools: { 'mcp__s2__t': 'keep' },
  });
  assert.equal(decide('mcp__s2__t', rules).action, 'drop',
    '总开关是物理闸，压过单工具 keep');
});

test('decide: 单工具 keep 不丢改写（keep 与 rewrite 正交）', () => {
  const rules = rulesOf({
    tools: { 'mcp__tinyfish__fetch_content': 'keep' },
    rewrite: { 'mcp__tinyfish__fetch_content': '读网页正文。' },
  });
  const v = decide('mcp__tinyfish__fetch_content', rules);
  assert.equal(v.action, 'rewrite', '打开开关不应让说明改写失效');
  assert.equal(v.rewrite.description, '读网页正文。');
});

test('decide: 原生工具不受服务器规则影响', () => {
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  assert.equal(decide('schedule_list', rules).action, 'keep');
});

// 非 MCP 名字也可能有自己的 drop 规则，且不受服务器闸影响。
// 这条守住 decide() 里那个「单工具规则」判断不能被写成只对 MCP 名字生效——
// 曾有一版把它嵌进 parts !== undefined 分支内，MCP 工具照常、原生工具全部漏网。
// web_fetch / schedule_list / create_goal 都不在保护名单里，漏网就会真的多出来。
test('decide: 非 MCP 名字的 drop 规则同样生效', () => {
  const rules = rulesOf({ tools: { web_fetch: 'drop', schedule_list: 'drop' } });
  assert.equal(decide('web_fetch', rules).action, 'drop');
  assert.equal(decide('schedule_list', rules).action, 'drop');
  assert.equal(decide('web_fetch', rules).reason, 'tool override: drop');
});

test('decide: 非 MCP 名字的 drop 规则与 MCP 规则互不干扰', () => {
  const rules = rulesOf({
    servers: { tinyfish: { enabled: false } },
    tools: { web_fetch: 'drop' },
  });
  assert.equal(decide('web_fetch', rules).action, 'drop', '原生工具按自己的规则丢');
  assert.equal(decide('mcp__tinyfish__search', rules).action, 'drop', 'MCP 工具按服务器闸丢');
  assert.equal(decide('mcp__other__x', rules).action, 'keep', '不相干的仍然放行');
});

test('decide: rewrite 命中时返回改写条目', () => {
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': '读网页正文。' } });
  const v = decide('mcp__tinyfish__fetch_content', rules);
  assert.equal(v.action, 'rewrite');
  assert.equal(v.rewrite.description, '读网页正文。');
});

test('decide: 被 drop 的工具不产生 rewrite', () => {
  const rules = rulesOf({
    servers: { tinyfish: { enabled: false } },
    rewrite: { 'mcp__tinyfish__search': '不该出现' },
  });
  const v = decide('mcp__tinyfish__search', rules);
  assert.equal(v.action, 'drop', 'drop 优先于 rewrite');
});

// ─────────────────────────────────────────────
// applyToDefinition
// ─────────────────────────────────────────────
test('applyToDefinition: drop 时原样返回 definition 并标记', () => {
  const def = { name: 'mcp__tinyfish__search', description: 'orig', parameters: { a: 1 } };
  const rules = rulesOf({ servers: { tinyfish: { enabled: false } } });
  const r = applyToDefinition(def, rules);
  assert.equal(r.drop, true);
  assert.equal(r.definition, def, 'drop 时不应构造新对象');
});

test('applyToDefinition: rewrite 只换 description，其余字段保持引用', () => {
  const params = { type: 'object', properties: {} };
  const output = { schema: {}, render: () => [] };
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: params, output };
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': '新说明' } });
  const r = applyToDefinition(def, rules);
  assert.equal(r.drop, false);
  assert.equal(r.definition.description, '新说明');
  assert.equal(r.definition.parameters, params, 'parameters 必须是同一引用');
  assert.equal(r.definition.output, output, 'output 必须是同一引用');
  assert.equal(def.description, 'orig', '原对象不得被修改');
});

// ─────────────────────────────────────────────
// 参数说明改写
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
  const { parameters, missing } = rewriteParameterDescriptions(params, new Map([['ttl', '缓存秒数']]));
  assert.deepEqual(missing, []);
  assert.equal(parameters.properties.ttl.description, '缓存秒数');
  assert.equal(parameters.properties.urls.description, 'Array of URLs to fetch', '未指定的参数不得改动');
  assert.equal(params.properties.ttl.description, 'Caller freshness tolerance in seconds', '原对象不得被修改');
});

test('rewriteParameterDescriptions: 结构字段一个不动（DESIGN「只改文字，不碰结构」）', () => {
  const params = paramFixture();
  const { parameters } = rewriteParameterDescriptions(params, new Map([['urls', 'URL 列表']]));
  assert.equal(parameters.properties.urls.type, 'array');
  assert.deepEqual(parameters.required, ['urls'], 'required 必须原样保留');
  assert.equal(parameters.type, 'object');
});

test('rewriteParameterDescriptions: 不存在的参数记入 missing，不抛', () => {
  const params = paramFixture();
  const { parameters, missing } = rewriteParameterDescriptions(params, new Map([['nope', 'x']]));
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
  const r = applyToDefinition(def, rules);
  assert.equal(r.definition.description, '读网页正文。');
  assert.equal(r.definition.parameters.properties.ttl.description, '缓存秒数');
  assert.equal(r.definition.parameters.properties.urls.description, 'Array of URLs to fetch');
  assert.equal(r.definition.parameters.required[0], 'urls');
});

test('applyToDefinition: 对象形态只给 properties 时不改工具说明', () => {
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: paramFixture() };
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': { properties: { ttl: '缓存秒数' } } } });
  const r = applyToDefinition(def, rules);
  assert.equal(r.definition.description, 'orig', '未指定 description 时不得改动');
});

test('applyToDefinition: 参数不存在时进入 missingParams', () => {
  const def = { name: 'mcp__tinyfish__fetch_content', description: 'orig', parameters: paramFixture() };
  const rules = rulesOf({ rewrite: { 'mcp__tinyfish__fetch_content': { properties: { ghost: 'x' } } } });
  const r = applyToDefinition(def, rules);
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
  assert.ok(problems.some(p => /既没有 description 也没有 properties/.test(p)));
});

// ─────────────────────────────────────────────
// ToolCatalog（原始文本留存）
// ─────────────────────────────────────────────
test('ToolCatalog: 记录原始 description 供还原与界面使用', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'mcp__tinyfish__fetch_content', description: '很长的说明', parameters: { a: 1 } });
  const e = cat.get('mcp__tinyfish__fetch_content');
  assert.equal(e.description, '很长的说明');
  assert.equal(e.server, 'tinyfish');
  assert.equal(e.leaf, 'fetch_content');
  assert.equal(e.group, 'mcp:tinyfish');
});

test('ToolCatalog: 不留存体量字段（本插件管注意力，不管占多少字）', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'x', description: '说明', parameters: { a: 1 } });
  const e = cat.get('x');
  assert.equal('originalChars' in e, false, '不应记录字符数');
  assert.equal('originalDescChars' in e, false, '不应记录描述字符数');
});

test('ToolCatalog: 同组内按名字排序，结果与注册顺序无关', () => {
  const cat = new ToolCatalog();
  cat.record({ name: 'mcp__s__zebra', description: 'z' });
  cat.record({ name: 'mcp__s__alpha', description: 'a' });
  cat.record({ name: 'mcp__s__middle', description: 'm' });
  const names = cat.groups().get('mcp:s').map(e => e.name);
  assert.deepEqual(names, ['mcp__s__alpha', 'mcp__s__middle', 'mcp__s__zebra']);
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
  const r = applyToDefinition(def, rules);
  assert.equal(r.drop, false);
  assert.equal(r.definition, def);
});

// ─────────────────────────────────────────────
// diagnose —— 只看「配置事实 + 实际见到的工具」
// ─────────────────────────────────────────────
test('diagnose: 停用的服务器连不上 → 不报（那是正常状态）', () => {
  // 停用一台服务器，它本来就不该有工具出现。把它报成「暂不生效」
  // 会让人以为出了问题，却没有任何可做的动作。
  const rules = rulesOf({ servers: { ghost: { enabled: false } } });
  const out = diagnose(rules, []);
  assert.equal(out.length, 0, '停用是正常状态，不该报');
});

test('diagnose: 工具被 drop 后不在线 → 不报（正是配置生效的样子）', () => {
  const rules = rulesOf({ tools: { 'mcp__tinyfish__search': 'drop' } });
  // 工具注册过（见过的名里有它），现在不在线——这就是 drop 想要的结果
  const out = diagnose(rules, ['mcp__tinyfish__search']);
  assert.equal(out.length, 0, '规则生效中，不该报');
});

test('diagnose: 完全正常的配置不产生任何诊断', () => {
  const rules = rulesOf({ servers: { tinyfish: { keep: ['search'] } } });
  const out = diagnose(rules, ['mcp__tinyfish__search']);
  assert.deepEqual(out, []);
});

test('diagnose: 改写指向不存在的工具 → 报一条', () => {
  const rules = rulesOf({ rewrite: { 'mcp__gone__tool': 'x' } });
  const out = diagnose(rules, ['mcp__tinyfish__search']);
  const hit = out.find(d => d.target === 'rewrite');
  assert.ok(hit, '改名/typo 是废配置，必须报出来');
  assert.ok(hit.message.includes('mcp__gone__tool'));
});

test('diagnose: rewrite 落在被隐藏的工具上 → warning（不静默失效）', () => {
  const rules = rulesOf({
    servers: { tinyfish: { enabled: false } },
    rewrite: { 'mcp__tinyfish__search': 'x' },
  });
  const out = diagnose(rules, ['mcp__tinyfish__search']);
  const hit = out.find(d => d.target === 'rewrite.mcp__tinyfish__search');
  assert.ok(hit, '必须报出这条改写不会生效');
  assert.ok(hit.message.includes('隐藏'), '要说清原因');
});

test('diagnose: rewrite 落在受保护工具上 → warning', () => {
  const rules = rulesOf({ rewrite: { read: 'x' } });
  const out = diagnose(rules, ['read']);
  const hit = out.find(d => d.target === 'rewrite.read');
  assert.ok(hit, '必须报出受保护工具的改写不会生效');
  assert.ok(hit.message.includes('受保护'));
});
// ─────────────────────────────────────────────
// 原型链危险键：必须拒绝，不能「报成功但什么也没写」
// ─────────────────────────────────────────────
test('normalizeConfig: 拒绝 __proto__ / constructor / prototype 当配置键', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    // 必须走 JSON.parse —— 对象字面量里的 __proto__ 不走 own property，测不到真实路径
    const fromTools = normalizeConfig(JSON.parse(`{"tools":{"${key}":"drop"}}`));
    assert.equal(fromTools.rules.toolOverrides.size, 0, `tools.${key} 不该进规则`);
    assert.ok(fromTools.problems.some(p => p.includes(key)), `tools.${key} 必须报错`);

    const fromServers = normalizeConfig(JSON.parse(`{"servers":{"${key}":{"enabled":false}}}`));
    assert.equal(fromServers.rules.disabledServers.size, 0);
    assert.ok(fromServers.problems.some(p => p.includes(key)), `servers.${key} 必须报错`);

    const fromRewrite = normalizeConfig(JSON.parse(`{"rewrite":{"${key}":"x"}}`));
    assert.equal(fromRewrite.rules.rewrites.size, 0);
    assert.ok(fromRewrite.problems.some(p => p.includes(key)), `rewrite.${key} 必须报错`);
  }
});

test('normalizeConfig: 正常键不受影响', () => {
  const { rules, problems } = normalizeConfig({
    tools: { 'mcp__x__y': 'drop' },
    servers: { context7: { enabled: false } },
    rewrite: { 'mcp__x__z': '说明' },
  });
  assert.deepEqual(problems, []);
  assert.equal(rules.toolOverrides.size, 1);
  assert.equal(rules.disabledServers.size, 1);
  assert.equal(rules.rewrites.size, 1);
});

// ─────────────────────────────────────────────
// 0.6.0：servers.<名>.rewrite（说明页改写）
// ─────────────────────────────────────────────
test('rules: servers.<名>.rewrite 正常入库', () => {
  const rules = rulesOf({ servers: { context7: { rewrite: '新的说明' } } });
  assert.equal(rules.serverRewrites.get('context7'), '新的说明');
  assert.equal(rules.disabledServers.has('context7'), false);
});

test('rules: rewrite 非字符串 → problem + 忽略该字段', () => {
  const { rules, problems } = normalizeConfig({ servers: { x: { rewrite: 42 } } });
  assert.equal(rules.serverRewrites.has('x'), false);
  assert.ok(problems.some(p => /servers\.x\.rewrite/.test(p)));
});

test('rules: rewrite 空串/纯空白不报 problem 也不入库', () => {
  for (const v of ['', '   ', '\n']) {
    const { rules, problems } = normalizeConfig({ servers: { x: { rewrite: v } } });
    assert.equal(rules.serverRewrites.has('x'), false);
    assert.deepEqual(problems, []);
  }
});

test('rules: 停用与改写互不干扰，decide 不受 rewrite 影响', () => {
  const { rules } = normalizeConfig({
    servers: { a: { enabled: false }, b: { rewrite: '说明改写' } },
    tools: { 'mcp__b__t': 'drop' },
  });
  assert.ok(rules.disabledServers.has('a'));
  assert.equal(rules.serverRewrites.get('b'), '说明改写');
  // rewrite 只管说明页，不改变任何工具的可见性
  assert.equal(decide('mcp__b__t', rules).action, 'drop');
  assert.equal(decide('mcp__b__other', rules).action, 'keep');
  assert.equal(decide('mcp__a__t', rules).action, 'drop');
});

test('rules: 停用 + 改写 → 诊断说清改写不会生效', () => {
  const { rules } = normalizeConfig({ servers: { a: { enabled: false, rewrite: '写点什么' } } });
  const out = diagnose(rules, ['mcp__a__t']);
  assert.ok(out.some(d => d.target === 'servers.a.rewrite' && /已停用/.test(d.message)));
});
