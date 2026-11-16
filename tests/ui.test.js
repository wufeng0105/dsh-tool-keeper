/**
 * UI 渲染测试。
 *
 * 直接渲染 __testing.View（纯展示组件），带真实数据检查 HTML 结构。
 * 版式问题离线就能发现，不用靠人重启。
 *
 * 版式参照 MichengAI/dsh-archive-manager 的设置页：
 * 分组卡片（边框圆角）+ 可折叠头部（chevron）+ 内部行列表。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const CLIENT = new URL('../ui/client.js', import.meta.url);

function loadUi() {
  const code = readFileSync(CLIENT, 'utf8');
  let loaded = null;
  vm.runInNewContext(code, {
    window: { __ModuleLoader__: { load(o) { loaded = o; } } },
    console,
  }, { filename: 'ui/client.js' });
  assert.ok(loaded !== null, 'client.js 必须调用 __ModuleLoader__.load');
  const mod = loaded.factory((name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  });
  return { mod, id: loaded.id };
}

function makeData(overrides = {}) {
  return Object.assign({
    ok: true,
    patched: true,
    problems: [],
    diagnostics: [],
    groups: [
      {
        group: 'core',
        roles: [
          { name: 'read', protected: true, effective: 'keep', source: 'protected', chars: 5986, originalDescription: '读取文件内容。' },
          { name: 'pwsh', protected: true, effective: 'keep', source: 'protected', chars: 5700, originalDescription: '执行 PowerShell。' },
          { name: 'create_goal', protected: false, effective: 'keep', source: 'none', chars: 320, originalDescription: '创建一个目标。' },
        ],
      },
      {
        group: 'mcp:tinyfish',
        roles: [
          { name: 'mcp__tinyfish__search', server: 'tinyfish', protected: false, effective: 'keep', source: 'none', chars: 2080, originalDescription: '搜索网页。' },
          { name: 'mcp__tinyfish__fetch_content', server: 'tinyfish', protected: false, effective: 'keep', source: 'none', chars: 1020, originalDescription: '抓取网页正文。' },
        ],
      },
    ],
    rules: { tools: {}, servers: {}, disabledServers: [], rewrites: {} },
  }, overrides);
}

const noop = () => {};

/** 数 HTML 里的 aria-expanded="true" 次数。 */
function htmlHasAriaExpanded(html, expected) {
  const count = (html.match(/aria-expanded="true"/g) || []).length;
  return count === expected;
}

function renderView(data, extra = {}) {
  const { mod } = loadUi();
  return renderToStaticMarkup(React.createElement(mod.__testing.View, Object.assign({
    data,
    busy: false,
    pending: false,
    error: null,
    expandedName: null,
    draft: '',
    query: '',
    expanded: {},
    onQuery: noop,
    onToggleGroup: noop,
    onToggleAll: noop,
    onExpand: noop,
    onDraft: noop,
    onToggle: noop,
    onSaveRewrite: noop,
    onReset: noop,
    onReload: noop,
  }, extra)));
}

// ─────────────────────────────────────────────
// 模块形态
// ─────────────────────────────────────────────
test('ui: 装载 id 正确，导出 apply/inject', () => {
  const { mod, id } = loadUi();
  assert.equal(id, 'dsh-tool-keeper-ui');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(mod.inject.length, 1);
  assert.equal(mod.inject[0], 'slots');
});

test('ui: apply 注册到 settings.section，id=tool-keeper', () => {
  const { mod } = loadUi();
  let registered = null;
  mod.apply({
    effect(fn) { fn(); },
    slots: {
      inject(name, cb) { assert.equal(name, 'settings.section'); cb(); },
      register(opts, comp) { registered = { opts, comp }; },
    },
  });
  assert.ok(registered !== null);
  assert.equal(registered.opts.name, 'settings.section');
  assert.equal(registered.opts.id, 'tool-keeper');
  assert.equal(registered.opts.label(), '工具管理');
  assert.equal(typeof registered.comp, 'function');
});

test('ui: 导航排序用 50，不与已知插件撞号', () => {
  const { mod } = loadUi();
  let order = null;
  mod.apply({
    effect(fn) { fn(); },
    slots: {
      inject(_n, cb) { cb(); },
      register(opts) { order = opts.order; },
    },
  });
  assert.equal(order, 50);
  // 宿主现有条目的 order：general 0 / models 10 / plugins 15 / agent-presets 20
  // enhance 30 / market 40 / archive-manager 45 / draft-studio 60 / xdpool 440
  // 50 落在 archive-manager 与 draft-studio 之间，且不与任何一次撞号
  const taken = [0, 10, 15, 20, 30, 40, 45, 60, 440];
  assert.ok(!taken.includes(order), '不能与任何现有条目同号，否则导航相对顺序不稳定');
});

// ─────────────────────────────────────────────
// 分组卡片：一张卡包住标题与整组工具，卡与卡贴合无缝
// ─────────────────────────────────────────────
test('ui: 分组 = 卡片包住标题与工具（标题行在卡内，卡间无缝）', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  // 卡片本体：.tw-group 自己带边框与底色，标题收进卡内
  const groupRule = css.match(/(?:^|\n)\.tw-group\{([^}]*)\}/);
  assert.ok(groupRule !== null, '要有 .tw-group 卡片规则');
  assert.ok(/border:1px solid/.test(groupRule[1]), '卡片要有边框包住整组');
  assert.ok(/background/.test(groupRule[1]), '卡片要有底色');
  assert.ok(/overflow:hidden/.test(groupRule[1]), '卡片要裁切内部');
  // 卡与卡贴合：相邻卡 margin-top:-1px 让边框重合成一条线
  assert.ok(/\.tw-group\+\.tw-group\{margin-top:-1px\}/.test(css), '相邻卡片要无缝贴合');
  // 组间不再有旧的大间距
  assert.ok(!/\.tw-group\{[^}]*margin:0 0 20px/.test(css), '组间不应有 20px 缝');
  // 列表降级为卡内分隔，不再是独立盒子
  const listRule = css.match(/\.tw-list\{([^}]*)\}/);
  assert.ok(listRule !== null);
  assert.ok(!/border:1px solid/.test(listRule[1]), '列表不再自带边框（那是卡片的事）');
  assert.ok(/border-top:1px solid/.test(listRule[1]), '列表与标题之间要发丝线分隔');

  // 行级仍然没有盒子（那是上一轮被否的方案，盒与盒之间的缝很丑）
  const itemRule = css.match(/\.tw-item\{([^}]*)\}/);
  assert.ok(itemRule !== null);
  assert.ok(!/border:/.test(itemRule[1]), '单个工具行不能自己带边框');

  // 行与行之间用发丝线
  assert.ok(/\.tw-item\+\.tw-item\{border-top:\.5px solid/.test(css), '行间要发丝线');
});

test('ui: 分组标题行是整卡可点的按钮（计数也在点击区内）', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  // 头部容器 + 折叠按钮 + 独立总开关 + 独立编辑按钮：右侧两个格子固定宽度，
  // 标题占剩余宽度。用网格而不是 flex：flex 下第三个控件会撑出卡片右缘。
  const headerRule = css.match(/\.tw-groupHeader\{([^}]*)\}/);
  assert.ok(headerRule !== null, '要有头部容器（放折叠按钮、总开关与编辑）');
  assert.ok(/display:grid/.test(headerRule[1]), '头部容器用网格横排');
  assert.ok(/grid-template-columns:minmax\(0,1fr\) auto auto/.test(headerRule[1]),
    '三列：标题占剩余宽度，开关与编辑各占一列');
  // 旧的 heading 容器不再存在
  assert.ok(!css.includes('.tw-groupHeading'), '不应再有独立的 heading 容器');
  const toggleRule = css.match(/\.tw-groupToggle\{([^}]*)\}/);
  assert.ok(toggleRule !== null, '要有标题按钮规则');
  assert.ok(/min-width:0/.test(toggleRule[1]), '标题区必须可收缩，否则会溢出卡片');
  assert.ok(/justify-content:space-between/.test(toggleRule[1]), '标题与计数两端分布');
  assert.ok(/cursor:pointer/.test(toggleRule[1]), '标题按钮要可点');
  // 总开关与编辑只出现在 MCP 组：内置工具组（core）不渲染它们
  const html = renderView(makeData());
  const headerChunks = html.split('tw-groupHeader').slice(1);
  assert.equal(headerChunks.length, 2, '两个分组各有一个头部容器');
  assert.equal(headerChunks.filter(c => c.includes('role="switch"')).length, 1, '恰好 MCP 组的头部有总开关');
  assert.equal(headerChunks.filter(c => c.includes('tw-editServer')).length, 1, '恰好 MCP 组的头部有编辑按钮');
  // 两个控件都独立于折叠按钮：不在 tw-groupToggle 内部
  for (const chunk of headerChunks) {
    const toggleEnd = chunk.indexOf('</button>');
    const switchPos = chunk.indexOf('role="switch"');
    if (switchPos >= 0) {
      assert.ok(switchPos > toggleEnd, '总开关必须在折叠按钮之外，不嵌在其内部');
    }
    const editPos = chunk.indexOf('tw-editServer');
    if (editPos >= 0) {
      assert.ok(editPos > toggleEnd, '编辑按钮必须在折叠按钮之外，不嵌在其内部');
    }
  }

  // 标题行高必须等于工具行实际高度：图标块(34px) + 行上下内边距(6px*2) = 46px。
  // 推导式断言——改任一因子时这条会重新算，而不是跟着写死的数字漂移。
  const iconRule = css.match(/\.tw-icon\{([^}]*)\}/);
  assert.ok(iconRule !== null, '要有图标块规则');
  const iconHeight = iconRule[1].match(/height:(\d+)px/);
  assert.ok(iconHeight !== null, '图标块要定高');
  const rowRule = css.match(/\.tw-row\{([^}]*)\}/);
  assert.ok(rowRule !== null, '要有工具行规则');
  const rowPadding = rowRule[1].match(/padding:(\d+)px (\d+)px/);
  assert.ok(rowPadding !== null, '工具行要有上下内边距');
  const expected = Number(iconHeight[1]) + Number(rowPadding[1]) * 2;
  const declared = toggleRule[1].match(/min-height:(\d+)px/);
  assert.ok(declared !== null, '标题按钮要定高');
  assert.equal(Number(declared[1]), expected,
    `标题行高(${declared[1]})必须等于工具行实际高度(${expected})——折叠卡与展开行堆叠在一起，一高一矮节奏就断了`);
});

test('ui: 渲染出两个分组卡片', () => {
  const html = renderView(makeData());
  const groups = html.match(/class="tw-group"/g) || [];
  assert.equal(groups.length, 2);
});

test('ui: 分组头部有标题与计数', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('内置工具'));
  assert.ok(html.includes('MCP · tinyfish'));
  assert.ok(/3 个/.test(html), '内置工具组应显示工具数量');
  assert.ok(!/tokens/.test(html), '不显示 token');
});

// ─────────────────────────────────────────────
// 折叠：语义反转——expanded 记录谁被手动展开，空表 = 默认全折叠
// ─────────────────────────────────────────────
test('ui: 分组头部是整卡可点按钮，带 chevron', () => {
  const html = renderView(makeData());
  const toggles = html.match(/class="tw-groupToggle"/g) || [];
  assert.equal(toggles.length, 2, '每个分组一个折叠按钮');
  const chevrons = html.match(/class="tw-chevron/g) || [];
  assert.equal(chevrons.length, 2, '每个分组一个箭头');
});

test('ui: 默认全折叠，aria-expanded=false', () => {
  const html = renderView(makeData());
  // 只数分组折叠按钮：0.6.0 起 MCP 组头还有一个「编辑」按钮也带 aria-expanded
  const expanded = html.match(/class="tw-groupToggle"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*class="tw-groupToggle"/g) || [];
  assert.equal(expanded.length, 2, '默认全部折叠');
  assert.ok(!html.includes('>read<'), '折叠组内的工具不应出现');
  assert.ok(!html.includes('mcp__tinyfish__search'), '折叠组内的工具不应出现');
});

test('ui: 手动展开某组后该组内容渲染', () => {
  const html = renderView(makeData(), { expanded: { core: true } });
  const expanded = html.match(/aria-expanded="true"/g) || [];
  assert.equal(expanded.length, 1, '只展开一组');
  assert.ok(html.includes('>read<'), '展开组内的工具应出现');
  assert.ok(!html.includes('mcp__tinyfish__search'), '未展开组仍折叠');
});

test('ui: 搜索时强制展开有匹配的组，清空后回默认折叠', () => {
  const filtered = renderView(makeData(), { query: 'tinyfish' });
  assert.ok(htmlHasAriaExpanded(filtered, 1), '搜索态匹配组应强制展开');
  assert.ok(filtered.includes('mcp__tinyfish__search'), '搜索结果应可见');

  const cleared = renderView(makeData(), { expanded: {} });
  assert.ok(!cleared.includes('mcp__tinyfish__search'), '清空搜索回到默认折叠');
});

test('ui: 折叠箭头方向随状态变化', () => {
  const open = renderView(makeData(), { expanded: { core: true } });
  const closed = renderView(makeData());
  assert.ok(open.includes('tw-chevron is-open'), '展开态箭头朝下');
  assert.ok(closed.includes('class="tw-chevron"'), '折叠态箭头旋转');
});

// ─────────────────────────────────────────────
// 行（默认全折叠，这些测试显式展开全部组来测行级行为）
// ─────────────────────────────────────────────
const ALL_OPEN = { core: true, 'mcp:tinyfish': true };

test('ui: 服务器总开关关闭时该组显示「已停用」', () => {
  const data = makeData();
  // disabledServers 是引擎判定源（api state 的 rules.disabledServers）
  data.rules.disabledServers = ['tinyfish'];
  const html = renderView(data, { expanded: ALL_OPEN });
  // 锚定计数区专属结构，避免被行级副标题「服务器已停用」的子串遮蔽：
  // tw-count 里只有「已停用」，不再有「N 个 · N 已隐藏」
  const counts = html.match(/class="tw-count"[^>]*>([^<]*)</g) || [];
  assert.ok(counts.some(c => c.includes('已停用')), '停用组的计数区应显示「已停用」: ' + counts.join(' | '));
  assert.ok(counts.every(c => !c.includes('已隐藏')), '停用态计数区不再显示「已隐藏」数字');
});

test('ui: 停用服务器的行级开关全部禁用，副标题说明原因', () => {
  const data = makeData();
  data.rules.disabledServers = ['tinyfish'];
  const html = renderView(data, { expanded: ALL_OPEN });
  // React 19 静态渲染把 disabled 输出为 disabled=""；行级开关 2 个 + 头部 busy 总开关 1 个
  const disabledSwitches = (html.match(/disabled=""/g) || []).length;
  assert.ok(disabledSwitches >= 2, '停用组的行级开关应为 disabled，实际 ' + disabledSwitches);
  assert.ok(html.includes('服务器已停用'), '行副标题必须说明「服务器已停用」');
});

test('ui: 每行有图标块 + 名称 + 副标题', () => {
  const html = renderView(makeData(), { expanded: ALL_OPEN });
  assert.ok(html.includes('tw-icon'));
  assert.ok(html.includes('tw-name'));
  assert.ok(html.includes('tw-meta'));
  assert.ok(html.includes('<svg'));
});

test('ui: 每行有状态点', () => {
  const html = renderView(makeData(), { expanded: ALL_OPEN });
  const dots = html.match(/class="tw-dot"/g) || [];
  assert.equal(dots.length, 5);
});

test('ui: 行用 grid 三列（图标/内容/开关）且 border-box 46px，与分组标题同高', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  const rowRule = css.match(/\.tw-row\{([^}]*)\}/);
  assert.ok(rowRule !== null);
  assert.ok(/grid-template-columns:34px minmax\(0,1fr\) auto/.test(rowRule[1]));
  // 必须 border-box：否则 min-height 不含内边距，行实际 56px，与 46px 标题错位
  assert.ok(/box-sizing:border-box/.test(rowRule[1]), '工具行必须 border-box，否则与标题行错位 12px');
  assert.ok(/min-height:46px/.test(rowRule[1]), '行高 46（34 图标块 + 6×2 内边距），与分组标题一致');
});

// ─────────────────────────────────────────────
// 开关
// ─────────────────────────────────────────────
test('ui: 非保护工具显示开关（含 MCP 头部总开关）', () => {
  const html = renderView(makeData(), { expanded: ALL_OPEN });
  const switches = html.match(/role="switch"/g) || [];
  // 3 个行级开关 + tinyfish 组头部 1 个服务器总开关
  assert.equal(switches.length, 4, '三个行开关 + 一个服务器总开关');
});

test('ui: 保护工具不显示开关，标「受保护」', () => {
  const html = renderView(makeData(), { expanded: ALL_OPEN });
  const locks = html.match(/class="tw-lock"/g) || [];
  assert.equal(locks.length, 2);
  assert.ok(html.includes('受保护'));
});

test('ui: 出厂状态全部开关为开', () => {
  const html = renderView(makeData(), { expanded: ALL_OPEN });
  const checked = html.match(/aria-checked="true"/g) || [];
  // 3 个行级 + 1 个服务器总开关（tinyfish 未停用）
  assert.equal(checked.length, 4);
});

// ─────────────────────────────────────────────
// 搜索
// ─────────────────────────────────────────────
test('ui: 工具栏有搜索框', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-search'));
  assert.ok(html.includes('搜索工具名或服务器'));
});

test('ui: 搜索按工具名过滤', () => {
  const html = renderView(makeData(), { query: 'tinyfish' });
  assert.ok(html.includes('mcp__tinyfish__search'));
  assert.ok(!html.includes('>read<'), '不匹配的内置工具应被过滤');
});

test('ui: 搜索无结果时给提示', () => {
  const html = renderView(makeData(), { query: 'zzz-nothing' });
  assert.ok(html.includes('没有匹配'));
});

// ─────────────────────────────────────────────
// 展开编辑
// ─────────────────────────────────────────────
test('ui: 未展开时不出现编辑区', () => {
  const html = renderView(makeData());
  assert.ok(!html.includes('tw-editor'));
});

test('ui: 展开后出现原文 + 改写框 + 保存按钮', () => {
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search', expanded: ALL_OPEN });
  assert.ok(html.includes('tw-editor'));
  assert.ok(html.includes('tw-original'));
  assert.ok(html.includes('搜索网页。'), '应显示服务器原文');
  assert.ok(html.includes('服务器原始说明'));
  assert.ok(html.includes('保存说明'));
});

test('ui: 展开的工具行 aria-expanded=true，未展开的为 false', () => {
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search', expanded: ALL_OPEN });
  // 不能只断言 includes('aria-expanded="true"')：
  // 分组头按钮本身就带 aria-expanded="true"，那样断言永远能过（空转）。
  // 必须按工具名的按钮单独取。
  const openBtn = html.match(/<button[^>]*aria-expanded="true"[^>]*>mcp__tinyfish__search</);
  assert.ok(openBtn !== null, '展开的那一行必须 aria-expanded=true');

  const closedBtn = html.match(/<button[^>]*aria-expanded="false"[^>]*>mcp__tinyfish__fetch_content</);
  assert.ok(closedBtn !== null, '未展开的行必须 aria-expanded=false');
});

test('ui: 有未保存修改时提示', () => {
  const html = renderView(makeData(), {
    expandedName: 'mcp__tinyfish__search',
    draft: '改过的说明',
    expanded: ALL_OPEN,
  });
  assert.ok(html.includes('有未保存修改'));
});

test('ui: 没有修改时不该显示「有未保存修改」', () => {
  // 未配置任何改写、草稿为空 → 不该报脏
  const clean = renderView(makeData(), { expandedName: 'mcp__tinyfish__search', draft: '', expanded: ALL_OPEN });
  assert.ok(!clean.includes('有未保存修改'), '空草稿且无改写时不该报脏');

  // 已有改写且草稿与之一致 → 也不该报脏
  const data = makeData();
  data.rules.rewrites['mcp__tinyfish__search'] = { description: '已保存的说明' };
  const same = renderView(data, {
    expandedName: 'mcp__tinyfish__search',
    draft: '已保存的说明',
    expanded: ALL_OPEN,
  });
  assert.ok(!same.includes('有未保存修改'), '草稿与已保存值相同不该报脏');
});

test('ui: 只配了参数改写（没有 description）时也不该一展开就报脏', () => {
  const data = makeData();
  // properties-only 形态：没有 description 字段
  data.rules.rewrites['mcp__tinyfish__search'] = {
    properties: { include_selectors: '只提取匹配元素' },
  };
  const html = renderView(data, { expandedName: 'mcp__tinyfish__search', draft: '', expanded: ALL_OPEN });
  assert.ok(!html.includes('有未保存修改'),
    '没有 description 时当前值应视为空字符串，不能与 undefined 比较');
});

// ─────────────────────────────────────────────
// 头部与状态
// ─────────────────────────────────────────────
test('ui: 页面内不再重复标题与说明（导航里已经叫「工具管理」）', () => {
  const html = renderView(makeData());

  // 导航行已经有「工具管理」，页面里再写一遍是重复
  assert.ok(!html.includes('tw-title'), '不应有页内标题');
  assert.ok(!html.includes('tw-intro'), '不应有页内说明');
  assert.ok(!html.includes('tw-head'), '不应有标题行容器');
  assert.ok(!html.includes('Tool Keeper'), '旧英文名不应出现');
  assert.ok(!html.includes('工具管理'), '页面内不重复导航名');

  // 之前几轮删掉的东西也不能回来
  assert.ok(!html.includes('tw-pill'), '不应有状态胶囊');
  assert.ok(!html.includes('出厂状态'), '不应重复显示出厂状态');
  assert.ok(!html.includes('tw-headerCard'), '不应有头部卡片');
  assert.ok(!html.includes('tw-stat'), '不应有统计块');
});

test('ui: 未重启时提示必须说清「模型仍然能看见并使用」', () => {
  const data = makeData();
  data.stale = true;
  const html = renderView(data);

  // 关键：只写「重启后生效」会让人以为已经生效了。
  // 必须明说重启之前模型仍然能看见并使用这些工具。
  assert.ok(html.includes('重启 DSH 后才生效'));
  assert.ok(/仍然能看见并使用/.test(html), '必须说明重启前仍然生效');

  // 旧文案「下面显示的是重启后才会成立的状态」在去掉字符/token 显示后已经不准确
  assert.ok(!/重启后才会成立的状态/.test(html), '旧文案应已删除');

  // 没有 stale 时不该出现这条提示
  const clean = renderView(makeData());
  assert.ok(!clean.includes('重启 DSH 后才生效'), '未改动时不该提示重启');
});

test('ui: 摘要只报工具数量，不报字符和 token', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-summary'));
  assert.ok(/共 5 个工具/.test(html));
  assert.ok(!/tokens/.test(html), '不显示 token');
  assert.ok(!/字符/.test(html), '不显示字符数');
});

// ─────────────────────────────────────────────
// 开关决策：必须按引擎判定决定写什么，不能按配置里的条目
// ─────────────────────────────────────────────
test('ui: 被服务器规则关掉时，点开关写的是 keep（打开）', () => {
  const { mod } = loadUi();
  const next = mod.__testing.nextToolsAfterToggle({}, 'mcp__tinyfish__fetch_content', 'drop');
  assert.equal(next['mcp__tinyfish__fetch_content'], 'keep',
    '引擎判定为 drop 时，点击意图是「打开」，必须写 keep 覆盖服务器规则');
});

test('ui: 正在生效时，点开关写的是 drop（关闭）', () => {
  const { mod } = loadUi();
  const next = mod.__testing.nextToolsAfterToggle({}, 'mcp__tinyfish__search', 'keep');
  assert.equal(next['mcp__tinyfish__search'], 'drop');
});

test('ui: 开关决策不看配置里已有的条目', () => {
  const { mod } = loadUi();
  // 配置里有 drop 条目，但引擎判定 keep（例如被别的规则救回来）→ 点击应关闭
  const next = mod.__testing.nextToolsAfterToggle(
    { 'mcp__x__y': 'drop' }, 'mcp__x__y', 'keep');
  assert.equal(next['mcp__x__y'], 'drop', '以引擎判定为准，不以条目为准');
});

test('ui: 开关决策不改原对象', () => {
  const { mod } = loadUi();
  const before = { a: 'drop' };
  mod.__testing.nextToolsAfterToggle(before, 'b', 'keep');
  assert.deepEqual(before, { a: 'drop' }, '不能改传入的 tools');
});
test('ui: 有隐藏时才在摘要里提已隐藏数', () => {
  const none = renderView(makeData());
  assert.ok(!none.includes('已隐藏'), '没有隐藏时不该提已隐藏');

  const data = makeData();
  // 状态读的是 effective（引擎判定），不是 rules.tools
  data.groups[1].roles[1].effective = 'drop';
  data.groups[1].roles[1].source = 'tool';
  const some = renderView(data);
  assert.ok(/已隐藏 1 个/.test(some), '有隐藏时应报已隐藏数');
  assert.ok(!/每轮省/.test(some), '不再算节省，因为字符和 token 都不显示了');
});

// ─────────────────────────────────────────────
// 开关状态必须来自引擎判定，不能自己从 rules.tools 推
// ─────────────────────────────────────────────
test('ui: rules.tools 里的 drop 不直接决定开关（以 effective 为准）', () => {
  const data = makeData();
  // tools 说 drop，但引擎判定 keep（例如单工具 keep 覆盖了一切）
  data.rules.tools['create_goal'] = 'drop';
  data.groups[0].roles[2].effective = 'keep';
  data.groups[0].roles[2].source = 'tool';

  const html = renderView(data, { expanded: ALL_OPEN });
  const checked = html.match(/aria-checked="true"/g) || [];
  // 3 个行级开 + 1 个服务器总开
  assert.equal(checked.length, 4, '开关只认 effective，不认 rules.tools');
});

test('ui: 内置工具的说明标签不写「服务器」', () => {
  const html = renderView(makeData(), { expandedName: 'create_goal', expanded: ALL_OPEN });
  assert.ok(html.includes('原始说明'), '内置工具应有「原始说明」标签');
  assert.ok(!html.includes('服务器原始说明'), '内置工具没有服务器，不能这么写');
});

test('ui: MCP 工具仍写「服务器原始说明」', () => {
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search', expanded: ALL_OPEN });
  assert.ok(html.includes('服务器原始说明'));
});

test('ui: 摘要跟着搜索变，不与列表矛盾', () => {
  const all = renderView(makeData());
  assert.ok(/共 5 个工具/.test(all), '未搜索时显示全量');

  const filtered = renderView(makeData(), { query: 'tinyfish' });
  assert.ok(/筛选出 2 个工具/.test(filtered), '搜索后显示筛选结果数');
  assert.ok(/全部 5 个/.test(filtered), '同时给出全量，便于知道筛掉了多少');
  assert.ok(!/共 5 个工具/.test(filtered), '不能再说「共 5 个」而屏幕上只有 2 行');
});

test('ui: 受保护工具标记为「受保护」且有解释', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('受保护'));
  assert.ok(!html.includes('基础工具'), '统一叫「受保护」');
  // 页面上必须有解释，否则用户不知道为什么这些行没有开关
  assert.ok(/任何配置都关不掉/.test(html));
});

test('ui: 分组头部不放批量开关按钮', () => {
  const html = renderView(makeData());
  assert.ok(!html.includes('全部隐藏'), '组内不该有「全部隐藏」');
  assert.ok(!html.includes('全部显示'), '组内不该有「全部显示」');
});

test('ui: 恢复出厂只在底部出现一次', () => {
  const html = renderView(makeData());
  const count = (html.match(/恢复出厂/g) || []).length;
  assert.equal(count, 1, '「恢复出厂」不应重复出现');
  assert.ok(html.includes('tw-footer'), '应位于底部区域');
});

test('ui: 工具栏有搜索、展开/折叠、刷新', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-search'));
  // 默认全折叠 → 按钮文案是「展开」；全展开时才是「折叠」
  assert.ok(html.includes('>展开<'), '默认折叠态按钮文案为「展开」');
  assert.ok(!html.includes('全部展开'), '用短文案，不占宽度');
  assert.ok(!html.includes('全部折叠'), '用短文案，不占宽度');
  assert.ok(html.includes('刷新'));
});

test('ui: 全部展开后按钮文案变「折叠」', () => {
  const html = renderView(makeData(), { expanded: { core: true, 'mcp:tinyfish': true } });
  assert.ok(html.includes('>折叠<'), '全开态按钮文案为「折叠」');
});

test('ui: 搜索框与按钮同高，且垂直居中', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;

  // 三者必须定同一个高度，否则一高一矮看着就是歪的
  const search = css.match(/(?:^|\n)\.tw-search\{([^}]*)\}/)[1];
  const btn = css.match(/(?:^|\n)\.tw-btn\{([^}]*)\}/)[1];
  const hSearch = search.match(/height:(\d+)px/);
  const hBtn = btn.match(/height:(\d+)px/);
  assert.ok(hSearch !== null, '搜索框要定高');
  assert.ok(hBtn !== null, '按钮要定高');
  assert.equal(hSearch[1], hBtn[1], '搜索框与按钮必须等高');

  // 按钮内部要垂直居中
  assert.ok(/display:inline-flex/.test(btn), '按钮用 inline-flex');
  assert.ok(/align-items:center/.test(btn), '按钮内容垂直居中');
  assert.ok(/justify-content:center/.test(btn), '按钮内容水平居中');

  // 工具栏容器也居中对齐
  assert.ok(/\.tw-toolbar\{[^}]*align-items:center/.test(css));

  // 搜索图标用 top:50% + translateY 垂直居中，不用写死像素
  assert.ok(/\.tw-searchIcon\{[^}]*top:50%/.test(css), '图标应垂直居中');
  assert.ok(/\.tw-searchIcon\{[^}]*translateY\(-50%\)/.test(css));
});

test('ui: 工具栏两个按钮同宽，文字居中', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;

  // 宽度必须写死，不能由文字长度撑出来，否则四个按钮宽窄不一
  const rule = css.match(/\.tw-actions \.tw-btn\{([^}]*)\}/);
  assert.ok(rule !== null, '必须有 .tw-actions .tw-btn 规则');
  const w = rule[1].match(/width:(\d+)px/);
  assert.ok(w !== null, '工具栏按钮要定宽');
  assert.equal(w[1], '72');

  // 定宽后 padding 必须严格为 0，否则文字会被挤偏
  // 注意：捕获组不含结尾的 }，所以用行尾锚定；不能只写 /padding:0/——
  // 那也会匹配到 "padding:0 14px"
  assert.ok(/padding:0$/.test(rule[1].trim()),
    '定宽后 padding 必须恰好为 0，不能带左右内边距；实际: ' + rule[1]);

  // 基础按钮规则里已有 inline-flex + 居中，这里确认仍然成立
  const base = css.match(/(?:^|\n)\.tw-btn\{([^}]*)\}/)[1];
  assert.ok(/justify-content:center/.test(base), '按钮文字水平居中');
  assert.ok(/align-items:center/.test(base), '按钮文字垂直居中');
});

test('ui: 工具栏四个按钮渲染出来结构一致', () => {
  const html = renderView(makeData());
  const actions = html.match(/<div class="tw-actions">[\s\S]*?<\/div>/);
  assert.ok(actions !== null);
  const btns = actions[0].match(/<button[^>]*class="tw-btn"[^>]*>/g) || [];
  assert.equal(btns.length, 4, '工具栏应恰好四个按钮（折叠/刷新/导出/导入）');
  // 四个按钮的 class 属性必须完全一致（宽度由 CSS 统一，不靠字面）
  const classes = btns.map(b => (b.match(/class="([^"]*)"/) || [])[1]);
  for (const cls of classes) assert.equal(cls, classes[0], '四个按钮的 class 必须一致');
});

test('ui: 工具栏有导出和导入按钮，导入带隐藏的文件选择器', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('>导出<'), '应有导出按钮');
  assert.ok(html.includes('>导入<'), '应有导入按钮');
  // 导入需要文件选择器，但它在界面上不可见
  const flat = html.replace(/\s+/g, ' ');
  assert.ok(/type="file"[^>]*style="[^"]*display:none/.test(flat) ||
            /style="[^"]*display:none[^"]*"[^>]*type="file"/.test(flat),
    '应有隐藏的 file input');
  assert.ok(flat.includes('accept=".json') || flat.includes('accept="application/json"'),
    '文件选择器应只接受 json');
});

test('ui: 补丁未装时显示提示且胶囊变红', () => {
  const data = makeData({ patched: false, reason: 'tools service unavailable' });
  const html = renderView(data);
  assert.ok(html.includes('拦截补丁未安装'));
  assert.ok(html.includes('data-tone="bad"'));
});

test('ui: 配置问题与诊断都显示', () => {
  const data = makeData({
    problems: ['servers.ghost must be an object'],
    diagnostics: [{ target: 'servers.ghost', message: 'not found' }],
  });
  const html = renderView(data);
  assert.ok(html.includes('配置问题'));
  assert.ok(html.includes('诊断'));
  assert.ok(html.includes('servers.ghost'));
});

// ─────────────────────────────────────────────
// 样式纪律
// ─────────────────────────────────────────────
test('ui: CSS 零硬编码色值', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  const hard = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
  assert.deepEqual(hard, [], '不允许写死颜色：' + hard.join(','));
  assert.ok((css.match(/--dsw-alias-/g) || []).length > 20);
});

test('ui: CSS 采用宿主的排版刻度', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  assert.ok(css.includes('max-width:760px'));
  assert.ok(!css.includes('tw-title'), '页内标题的样式已随标题一起删除');
  assert.ok(!css.includes('tw-intro'), '页内说明的样式已随说明一起删除');
  assert.ok(!css.includes('tw-saving'), '节省量的样式已随 token 显示一起删除');
  assert.ok(css.includes('font-size:13px;font-weight:600'), '行名 13 w600');
  assert.ok(css.includes('font-size:11px;line-height:13px'), '副标题 11/13');
  assert.ok(css.includes('border-radius:var(--dsw-radius-sm,8px)'), '工具盒圆角走宿主 token');
  assert.ok(css.includes('min-height:46px'), '行高 46，与分组标题一致');
});

test('ui: 有错开浮现动效与 reduced-motion 降级', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  assert.ok(css.includes('@keyframes tw-rise'), '分组应有浮现动效');
  assert.ok(/nth-child\(2\)\{animation-delay/.test(css), '分组应错开延迟');
  assert.ok(css.includes('prefers-reduced-motion'), '必须尊重减弱动效偏好');
});

// ─────────────────────────────────────────────
// 编辑区：两框等高同宽（用户明确要求）
// ─────────────────────────────────────────────
test('ui: 编辑区是左右两栏等高布局', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  // 两栏是 grid 1fr 1fr
  assert.ok(/\.tw-fields\{[^}]*grid-template-columns:1fr 1fr/.test(css),
    '原文与改写应左右两栏等宽');
});

test('ui: 原文框与编辑框共用同一套盒子样式（等高同边框）', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  // .tw-box 定义了固定高度 + 边框 + 内边距，两个框都套用
  const boxRule = css.match(/\.tw-box\{([^}]*)\}/);
  assert.ok(boxRule !== null, '必须存在 .tw-box 公共盒子');
  assert.ok(/height:132px/.test(boxRule[1]), '盒子要固定高度');
  assert.ok(/border:1px solid/.test(boxRule[1]), '盒子要有边框');
  assert.ok(/padding:8px 10px/.test(boxRule[1]), '盒子内边距一致');
});

test('ui: 原文包在框里且只读，改写是可编辑的 textarea', () => {
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search', expanded: ALL_OPEN });
  // 原文是 div 且同时有 tw-box 与 tw-original 两个类
  assert.ok(/class="tw-box tw-original"/.test(html), '原文应同时套用 tw-box 与 tw-original');
  // 改写是 textarea 且同时有 tw-box 与 tw-editor
  assert.ok(/<textarea[^>]*class="tw-box tw-editor"/.test(html), '改写应是 textarea 且套用 tw-box');
});

test('ui: 窄屏下两栏改为一栏', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  assert.ok(/@media \(max-width:640px\)\{\.tw-fields\{grid-template-columns:1fr\}\}/.test(css));
});

test('ui: 有焦点环与动效降级', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  assert.ok(css.includes('focus-visible'));
  assert.ok(css.includes('prefers-reduced-motion'));
});

// ─────────────────────────────────────────────
// 数值口径
// ─────────────────────────────────────────────
test('ui: 千分位格式化', () => {
  const { mod } = loadUi();
  assert.equal(mod.__testing.num(79505), '79,505');
  assert.equal(mod.__testing.num(60), '60');
});

// ─────────────────────────────────────────────
// 说明页半边的界面事实（0.5.0）
// ─────────────────────────────────────────────
test('ui: 停用且说明页确实被滤时组头说「说明页已一并隐藏」', () => {
  const data = makeData();
  data.rules.disabledServers = ['tinyfish'];
  data.instructions = { installed: true, removed: ['tinyfish'] };
  const html = renderView(data);
  assert.ok(html.includes('说明页已一并隐藏'));
});

test('ui: 停用但最近组装没滤到时不冒充「已隐藏」', () => {
  const data = makeData();
  data.rules.disabledServers = ['tinyfish'];
  data.instructions = { installed: true, removed: [] };
  const html = renderView(data);
  assert.ok(html.includes('已停用'));
  assert.ok(!html.includes('说明页已一并隐藏'), '没有运行时事实就不能这么说');
});

test('ui: 快照没有 instructions 字段时页面不炸', () => {
  const data = makeData();
  data.rules.disabledServers = ['tinyfish'];
  const html = renderView(data);
  assert.ok(html.includes('已停用'));
});

test('ui: 未重启提示同时覆盖工具与说明页', () => {
  const data = makeData();
  data.stale = true;
  const html = renderView(data);
  assert.ok(html.includes('说明页'), 'stale 提示必须提到说明页');
});

// ─────────────────────────────────────────────
// 0.6.0：服务器说明页编辑（行尾按钮 + 面板 + 纯函数）
// ─────────────────────────────────────────────
const ONLY_MCP = () => makeData({
  groups: [{
    group: 'mcp:tinyfish',
    roles: [
      { name: 'mcp__tinyfish__search', server: 'tinyfish', protected: false, effective: 'keep', source: 'none', chars: 2080, originalDescription: '搜索网页。' },
    ],
  }],
});

test('ui: MCP 组头有「编辑」，在内置工具组没有', () => {
  const both = renderView(makeData());
  const mcpGroups = makeData().groups.filter(g => g.group !== 'core').length;
  const buttons = (both.match(/class="tw-editServer"/g) || []).length;
  assert.equal(buttons, mcpGroups, '每台 MCP 一个编辑按钮，内置工具组没有');
  assert.ok(both.includes('aria-label="编辑服务器说明"'));

  const coreOnly = renderView(makeData({ groups: [makeData().groups[0]] }));
  assert.ok(!coreOnly.includes('tw-editServer'), '内置工具组不得出现');
});

test('ui: 编辑按钮在开关之后、且在折叠按钮之外', () => {
  const html = renderView(ONLY_MCP());
  const toggle = html.indexOf('tw-groupToggle');
  const toggleEnd = html.indexOf('</button>', toggle);
  const toggleBlock = html.slice(toggle, toggleEnd);
  assert.ok(toggleBlock.includes('aria-expanded="false"'), '折叠按钮仍在');
  assert.ok(!toggleBlock.includes('tw-editServer'), '编辑按钮不能嵌在折叠按钮里（非法嵌套）');
  const sw = html.indexOf('tw-switch');
  const edit = html.indexOf('tw-editServer');
  assert.ok(sw >= 0 && edit > sw, '编辑按钮必须在开关之后（手往右偏落在无害处）');
});

test('ui: 点编辑出现面板，左原文右编辑框（没有取消按钮）', () => {
  const data = ONLY_MCP();
  data.instructions = { installed: true, removed: [], rewritten: [], texts: { tinyfish: '### MCP server: tinyfish\n\n原文' } };
  const html = renderView(data, { editingServer: 'tinyfish', serverDraft: '' });
  assert.ok(html.includes('服务器原始说明'));
  assert.ok(html.includes('### MCP server: tinyfish'), '左边要能看到原文（含标题行）');
  assert.ok(/<textarea[^>]*tw-editor/.test(html), '右边是编辑框');
  assert.ok(html.includes('保存说明'));
  assert.ok(!html.includes('>取消<'), '取消按钮已去掉：再点「编辑」或用 Esc 收起');
  assert.ok(!html.includes('上次组装已生效'), '没配改写时不给「已生效」的假话');
});

test('ui: 原文缺失与空串的提示必须不同（不冒充）', () => {
  const missing = ONLY_MCP();
  missing.instructions = { installed: true, removed: [], rewritten: [], texts: {} };
  const htmlMissing = renderView(missing, { editingServer: 'tinyfish', serverDraft: '' });
  assert.ok(htmlMissing.includes('还没读到原始说明'));

  const empty = ONLY_MCP();
  empty.instructions = { installed: true, removed: [], rewritten: [], texts: { tinyfish: '' } };
  const htmlEmpty = renderView(empty, { editingServer: 'tinyfish', serverDraft: '' });
  assert.ok(htmlEmpty.includes('该服务器没有提供说明'));
  assert.ok(!htmlEmpty.includes('还没读到原始说明'), '空串不是「读不到」');
});

test('ui: 停用时面板提示「启用后生效」，改写生效时提示「上次组装已生效」', () => {
  const disabled = ONLY_MCP();
  disabled.rules.disabledServers = ['tinyfish'];
  disabled.instructions = { installed: true, removed: ['tinyfish'], rewritten: [], texts: { tinyfish: '原文' } };
  const htmlDisabled = renderView(disabled, { editingServer: 'tinyfish', serverDraft: '我的改写' });
  assert.ok(htmlDisabled.includes('该服务器已停用，改写会在启用后生效'));

  const applied = ONLY_MCP();
  applied.rules.disabledServers = [];
  applied.rules.servers = { tinyfish: { rewrite: '我的改写' } };
  applied.instructions = { installed: true, removed: [], rewritten: ['tinyfish'], texts: { tinyfish: '原文' } };
  const htmlApplied = renderView(applied, { editingServer: 'tinyfish', serverDraft: '我的改写' });
  assert.ok(htmlApplied.includes('上次组装已生效'));
});

test('ui: nextServersAfterRewrite 四种情形', () => {
  const { mod } = loadUi();
  const f = mod.__testing.nextServersAfterRewrite;
  const J = v => JSON.parse(JSON.stringify(v));
  // 跨 realm 对象要 JSON 归一化后比较（vm 里建的对象原型不同）
  // 1) 设值：新增条目
  assert.deepEqual(J(f({}, 'x', '新说明')), { x: { rewrite: '新说明' } });
  // 2) 改值：保留 enabled
  assert.deepEqual(J(f({ x: { enabled: false } }, 'x', '新说明')), { x: { enabled: false, rewrite: '新说明' } });
  // 3) 清空：删 rewrite，保留 enabled
  assert.deepEqual(J(f({ x: { enabled: false, rewrite: '旧' } }, 'x', '')), { x: { enabled: false } });
  // 4) 清空后条目全空 → 删整条
  assert.deepEqual(J(f({ x: { rewrite: '旧' } }, 'x', '')), {});
  // 不改入参
  const src = { x: { rewrite: '旧' } };
  f(src, 'x', '新');
  assert.deepEqual(src, { x: { rewrite: '旧' } });
});

test('ui: nextServersAfterRewrite 把纯空白当清除', () => {
  const { mod } = loadUi();
  const J = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(J(mod.__testing.nextServersAfterRewrite({ x: { rewrite: '旧' } }, 'x', '   ')), {});
});
