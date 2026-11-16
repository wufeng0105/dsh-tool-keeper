/**
 * instructions.js 的测试 —— 说明页半边。
 *
 * 规格 0.5.0 的 B1–B6、B9 机判版。每条断言都做过变异证红。
 * 纯函数部分零宿主依赖；安装器用假 ctx（带/不带 on）验证。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSections, installInstructionsFilter } from '../instructions.js';

const LIST_HEAD = '## MCP resource servers\n\nUse list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: ';

function listText(names) {
  return LIST_HEAD + JSON.stringify(names) + '.';
}

function sectionsFixture() {
  return [
    { name: 'harness:identity', text: 'You are an AI agent.' },
    { name: 'mcp:lexiang', text: '乐享使用说明……' },
    { name: 'mcp:rea', text: 'REA 使用说明……' },
    { name: 'mcp:tinyfish', text: 'TinyFish 说明……' },
    { name: 'mcp-resource-servers', text: listText(['lexiang', 'rea', 'tinyfish']) },
    { name: 'runtime:context', text: 'cwd=…' },
  ];
}

const noopLog = { info() {}, warn() {} };

// ─────────────────────────────────────────────
// B1：移除停用服务器的说明段，其余段字节不变
// ─────────────────────────────────────────────
test('instructions: 停用服务器的说明段被移除，其余段原样', () => {
  const input = sectionsFixture();
  const { sections, removed } = filterSections(input, ['lexiang', 'rea']);
  const names = sections.map(s => s.name);
  assert.ok(!names.includes('mcp:lexiang'));
  assert.ok(!names.includes('mcp:rea'));
  assert.deepEqual(removed.sort(), ['lexiang', 'rea']);
  // 其余段必须字节不变（对象内容相等）
  const kept = sections.filter(s => s.name !== 'mcp-resource-servers');
  const expected = input.filter(s => !['mcp:lexiang', 'mcp:rea', 'mcp-resource-servers'].includes(s.name));
  assert.deepEqual(kept, expected);
});

test('instructions: 不修改传入数组（返回新数组）', () => {
  const input = sectionsFixture();
  const before = input.length;
  filterSections(input, ['lexiang']);
  assert.equal(input.length, before, '入参数组不能被就地删段');
});

// ─────────────────────────────────────────────
// B2：名单段剔除名字；剔空 → ''
// ─────────────────────────────────────────────
test('instructions: 名单段剔除停用名字，保留尾句点与其余文案', () => {
  const { sections } = filterSections(sectionsFixture(), ['lexiang', 'rea']);
  const list = sections.find(s => s.name === 'mcp-resource-servers');
  assert.equal(list.text, LIST_HEAD + JSON.stringify(['tinyfish']) + '.');
});

test('instructions: 名单剔空后整段文本置空串', () => {
  const { sections } = filterSections(sectionsFixture(), ['lexiang', 'rea', 'tinyfish']);
  const list = sections.find(s => s.name === 'mcp-resource-servers');
  assert.equal(list.text, '');
});

test('instructions: 名单里没有停用名字时原样不动', () => {
  const input = sectionsFixture();
  const { sections, diagnostics } = filterSections(input, ['ghost']);
  const list = sections.find(s => s.name === 'mcp-resource-servers');
  assert.equal(list.text, input[4].text);
  // ghost 的说明段不存在 → 如实报「未见其说明段」
  assert.ok(diagnostics.some(d => /ghost/.test(d.message)));
});

test('instructions: 名字含引号/方括号时括号配平解析仍正确', () => {
  const names = ['a"b', 'x[y]', 'plain'];
  const input = [
    { name: 'mcp:a"b', text: 'q' },
    { name: 'mcp-resource-servers', text: listText(names) },
  ];
  const { sections } = filterSections(input, ['a"b']);
  const list = sections.find(s => s.name === 'mcp-resource-servers');
  assert.equal(list.text, LIST_HEAD + JSON.stringify(['x[y]', 'plain']) + '.');
});

// ─────────────────────────────────────────────
// B3：名单段正文异常 → 原样保留 + 诊断，不抛错
// ─────────────────────────────────────────────
test('instructions: 名单段格式漂移（无锚点）原样保留并诊断', () => {
  const input = [{ name: 'mcp-resource-servers', text: '宿主改了文案，没有数组。' }];
  const { sections, diagnostics } = filterSections(input, ['rea']);
  assert.equal(sections[0].text, input[0].text);
  assert.ok(diagnostics.some(d => /格式与预期不符/.test(d.message)));
});

test('instructions: 名单段数组不闭合/解析失败/非数组 → 原样 + 诊断', () => {
  const cases = [
    LIST_HEAD + '["rea"',            // 不闭合
    LIST_HEAD + '[rea].',            // 非法 JSON
    LIST_HEAD + '{"a":1}.',          // 不是数组
    LIST_HEAD + '没有左括号.',        // 找不到 [
  ];
  for (const text of cases) {
    const input = [{ name: 'mcp-resource-servers', text }];
    const { sections, diagnostics } = filterSections(input, ['rea']);
    assert.equal(sections[0].text, text, '异常正文必须原样：' + text);
    assert.ok(diagnostics.length > 0, '异常必须报诊断：' + text);
  }
});

// ─────────────────────────────────────────────
// B4：无停用服务器 → 全原样
// ─────────────────────────────────────────────
test('instructions: 停用集合为空时所有段原样、无诊断', () => {
  const input = sectionsFixture();
  const { sections, removed, diagnostics } = filterSections(input, []);
  assert.deepEqual(sections, input);
  assert.deepEqual(removed, []);
  assert.deepEqual(diagnostics, []);
});

// ─────────────────────────────────────────────
// B9：完整提示词预设场景如实报告（不冒充过滤生效）
// ─────────────────────────────────────────────
test('instructions: 组装里没有停用服务器的说明段时如实报「未见」', () => {
  // 模拟 complete 预设恢复后的世界：只剩 persona 段，mcp 段全不在
  const input = [{ name: 'deployment:persona-prefix', text: '完整人设……' }];
  const { sections, removed, diagnostics } = filterSections(input, ['rea']);
  assert.deepEqual(sections, input, '没有可滤的段就原样');
  assert.deepEqual(removed, []);
  assert.ok(diagnostics.some(d => /完整提示词预设/.test(d.message)),
    '必须提到完整提示词预设这个可能原因');
});

// ─────────────────────────────────────────────
// B5/B6：安装器（假 ctx）
// ─────────────────────────────────────────────
function makeEventCtx() {
  const captured = { handler: undefined, disposed: 0 };
  const ctx = {
    on(event, handler) {
      assert.equal(event, 'system-prompt/assemble');
      captured.handler = handler;
      return () => { captured.disposed++; };
    },
  };
  return { ctx, captured };
}

test('instructions: 监听器先 next 再过滤，返回新对象且更新事实', async () => {
  const { ctx, captured } = makeEventCtx();
  const state = { installed: false, removed: [], diagnostics: [] };
  const rules = { disabledServers: new Set(['rea']) };
  const result = installInstructionsFilter(ctx, rules, state, noopLog);
  assert.equal(result.installed, true);
  assert.equal(state.installed, true);

  const upstream = { sections: sectionsFixture(), contexts: [], variables: {} };
  const out = await captured.handler(upstream, {}, async () => upstream);
  assert.ok(!out.sections.some(s => s.name === 'mcp:rea'));
  assert.deepEqual(state.removed, ['rea']);
  // 上游对象不被就地修改
  assert.ok(upstream.sections.some(s => s.name === 'mcp:rea'));
});

test('instructions: 过滤内部异常时原样放行并诊断（fail-open）', async () => {
  const { ctx, captured } = makeEventCtx();
  const state = { installed: false, removed: [], diagnostics: [] };
  installInstructionsFilter(ctx, { disabledServers: new Set(['rea']) }, state, noopLog);

  // sections 是数组但迭代即炸 → filterSections 抛 → 必须吞掉放行
  const evil = new Proxy([], {
    get(t, p) {
      if (p === Symbol.iterator) throw new Error('boom');
      return t[p];
    },
  });
  const upstream = { sections: evil };
  const out = await captured.handler(upstream, {}, async () => upstream);
  assert.equal(out, upstream, '出错必须返回上游原对象');
  assert.ok(state.diagnostics.some(d => /原样放行/.test(d.message)));
});

test('instructions: 宿主没有事件接口时不安装、报原因、restore 无害', () => {
  const state = { installed: false, removed: [], diagnostics: [] };
  const warnings = [];
  const result = installInstructionsFilter({}, { disabledServers: new Set() }, state, {
    info() {}, warn: m => warnings.push(m),
  });
  assert.equal(result.installed, false);
  assert.equal(state.installed, false);
  assert.match(state.reason, /事件接口/);
  assert.ok(warnings.length > 0);
  assert.doesNotThrow(() => result.restore());
});

test('instructions: ctx.on 抛错时不安装且报原因', () => {
  const state = { installed: false, removed: [], diagnostics: [] };
  const ctx = { on() { throw new Error('no events'); } };
  const result = installInstructionsFilter(ctx, { disabledServers: new Set() }, state, noopLog);
  assert.equal(result.installed, false);
  assert.match(state.reason, /安装失败/);
});

test('instructions: restore 摘除监听器', () => {
  const { ctx, captured } = makeEventCtx();
  const state = { installed: false, removed: [], diagnostics: [] };
  const result = installInstructionsFilter(ctx, { disabledServers: new Set() }, state, noopLog);
  assert.equal(captured.disposed, 0);
  result.restore();
  assert.equal(captured.disposed, 1);
});

// ─────────────────────────────────────────────
// 0.6.0：服务器说明页改写
// ─────────────────────────────────────────────
const REWRITE_FIXTURE = () => [
  { name: 'harness:identity', text: 'You are an AI agent.' },
  { name: 'mcp:context7', text: '### MCP server: context7\n\n原来的说明正文' },
  { name: 'mcp:tinyfish', text: '### MCP server: tinyfish\n\nTF 说明' },
  { name: 'mcp-resource-servers', text: listText(['context7', 'tinyfish']) },
];

test('instructions: 改写整段替换说明段，强制 interpolate:false，并记原文', () => {
  const input = REWRITE_FIXTURE();
  const { sections, rewritten, originals } = filterSections(
    input, [], new Map([['context7', '你的新说明']]),
  );
  const sec = sections.find(s => s.name === 'mcp:context7');
  assert.equal(sec.text, '你的新说明');
  assert.equal(sec.interpolate, false, '用户正文里的 {{ 不能在渲染时爆炸');
  assert.deepEqual(rewritten, ['context7']);
  assert.equal(originals.get('context7'), '### MCP server: context7\n\n原来的说明正文');
  // 未配改写的段原样
  assert.equal(sections.find(s => s.name === 'mcp:tinyfish').text, '### MCP server: tinyfish\n\nTF 说明');
});

test('instructions: 空串/纯空白改写视为没配，段原样但原文仍记', () => {
  for (const empty of ['', '   ', '\n']) {
    const input = REWRITE_FIXTURE();
    const { sections, rewritten, originals } = filterSections(
      input, [], new Map([['context7', empty]]),
    );
    assert.equal(sections.find(s => s.name === 'mcp:context7').text, '### MCP server: context7\n\n原来的说明正文');
    assert.deepEqual(rewritten, []);
    assert.equal(originals.get('context7'), '### MCP server: context7\n\n原来的说明正文');
  }
});

test('instructions: 停用优先于改写：段被移除且不替换', () => {
  const input = REWRITE_FIXTURE();
  const { sections, removed, rewritten, originals, diagnostics } = filterSections(
    input, ['context7'], new Map([['context7', '你的新说明']]),
  );
  assert.ok(!sections.some(s => s.name === 'mcp:context7'));
  assert.deepEqual(removed, ['context7']);
  assert.deepEqual(rewritten, []);
  assert.equal(originals.get('context7'), '### MCP server: context7\n\n原来的说明正文');
  // 停用+改写的配置诊断在 rules.diagnose 里，这里不重复报
  assert.equal(diagnostics.some(d => /未生效/.test(d.message)), false);
});

test('instructions: 有改写但组装里没有该段 → 不改动 + 诊断「未生效」', () => {
  const input = REWRITE_FIXTURE().filter(s => s.name !== 'mcp:context7');
  const { sections, rewritten, diagnostics } = filterSections(
    input, [], new Map([['context7', '你的新说明']]),
  );
  assert.ok(!sections.some(s => s.name === 'mcp:context7'), '不插入段');
  assert.deepEqual(rewritten, []);
  assert.ok(diagnostics.some(d => /context7/.test(d.target) && /未生效/.test(d.message)));
});

test('instructions: 不停用、无改写时原文仍被捕获（防早退回归）', () => {
  const input = REWRITE_FIXTURE();
  const { sections, originals, diagnostics } = filterSections(input, [], new Map());
  assert.deepEqual(sections, input);
  assert.equal(originals.get('tinyfish'), '### MCP server: tinyfish\n\nTF 说明');
  assert.equal(originals.size, 2);
  assert.deepEqual(diagnostics, []);
});

test('instructions: 服务器没有说明（text 为 ""）时原文记为 ""', () => {
  const input = [{ name: 'mcp:plain', text: '' }];
  const { originals, rewritten } = filterSections(input, [], new Map([['plain', '补一段说明']]));
  assert.equal(originals.get('plain'), '', '空串 = 确认没有说明');
  assert.ok(originals.has('plain'), '仍要有这个键（与「没捕获」区分）');
  assert.deepEqual(rewritten, ['plain']);
});

test('instructions: 改写正文含 {{变量}} 不抛错（interpolate:false 生效）', () => {
  const input = [{ name: 'mcp:x', text: '原说明' }];
  assert.doesNotThrow(() => filterSections(input, [], new Map([['x', '请用 {{now}} 作为时间']])));
});

test('instructions: 改写路径抛错 → fail-open 原样放行 + 诊断', async () => {
  const { ctx, captured } = makeEventCtx();
  const state = { installed: false, removed: [], originals: new Map(), diagnostics: [] };
  installInstructionsFilter(ctx, {
    disabledServers: new Set(),
    serverRewrites: new Map([['rea', '新说明']]),
  }, state, noopLog);
  const evil = new Proxy([], {
    get(t, p) {
      if (p === Symbol.iterator) throw new Error('boom');
      return t[p];
    },
  });
  const upstream = { sections: evil };
  const out = await captured.handler(upstream, {}, async () => upstream);
  assert.equal(out, upstream);
  assert.ok(state.diagnostics.some(d => /原样放行/.test(d.message)));
});

test('instructions: 原文按服务器合并、只增不删', async () => {
  const { ctx, captured } = makeEventCtx();
  const state = { installed: false, removed: [], originals: new Map(), diagnostics: [] };
  installInstructionsFilter(ctx, {
    disabledServers: new Set(),
    serverRewrites: new Map(),
  }, state, noopLog);

  const first = { sections: [{ name: 'mcp:a', text: 'A 说明' }, { name: 'mcp:b', text: 'B 说明' }] };
  await captured.handler(first, {}, async () => first);
  assert.equal(state.originals.get('a'), 'A 说明');

  // 第二次组装里只有 b（比如 a 的服务器暂时没连上）：a 的原文不能被抹掉
  const second = { sections: [{ name: 'mcp:b', text: 'B 说明' }] };
  await captured.handler(second, {}, async () => second);
  assert.equal(state.originals.get('a'), 'A 说明');
  assert.equal(state.originals.get('b'), 'B 说明');
});