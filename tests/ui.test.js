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
    enabled: true,
    problems: [],
    diagnostics: [],
    groups: [
      {
        group: 'core',
        roles: [
          { name: 'read', protected: true, chars: 5986, originalDescription: '读取文件内容。' },
          { name: 'pwsh', protected: true, chars: 5700, originalDescription: '执行 PowerShell。' },
          { name: 'create_goal', protected: false, chars: 320, originalDescription: '创建一个目标。' },
        ],
      },
      {
        group: 'mcp:tinyfish',
        roles: [
          { name: 'mcp__tinyfish__search', server: 'tinyfish', protected: false, chars: 2080, originalDescription: '搜索网页。' },
          { name: 'mcp__tinyfish__fetch_content', server: 'tinyfish', protected: false, chars: 1020, originalDescription: '抓取网页正文。' },
        ],
      },
    ],
    rules: { tools: {}, servers: {}, disabledServers: [], rewrites: {} },
  }, overrides);
}

const noop = () => {};

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
    collapsed: {},
    onQuery: noop,
    onToggleGroup: noop,
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
  assert.equal(id, 'dsh-toolwarden-ui');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(mod.inject.length, 1);
  assert.equal(mod.inject[0], 'slots');
});

test('ui: apply 注册到 settings.section，id=toolwarden', () => {
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
  assert.equal(registered.opts.id, 'toolwarden');
  assert.equal(registered.opts.label(), '工具守卫');
});

// ─────────────────────────────────────────────
// 分组卡片：外面一个整体
// ─────────────────────────────────────────────
test('ui: 每个分组是一个独立卡片（边框+圆角+背景）', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  assert.ok(/\.tw-group\{[^}]*border:1px solid var\(--dsw-alias-border-l2\)/.test(css), '分组卡片要有边框');
  assert.ok(/\.tw-group\{[^}]*border-radius:12px/.test(css), '分组卡片要圆角 12');
  assert.ok(/\.tw-group\{[^}]*background:var\(--dsw-alias-bg-layer-2\)/.test(css), '分组卡片要有底色');
  assert.ok(/\.tw-group\{[^}]*overflow:hidden/.test(css), '卡片要裁切内部圆角');
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
  assert.ok(/3 个 · ≈[\d,]+ tokens/.test(html), '内置工具组应显示计数');
});

// ─────────────────────────────────────────────
// 折叠
// ─────────────────────────────────────────────
test('ui: 分组头部是可折叠按钮，带 chevron', () => {
  const html = renderView(makeData());
  const toggles = html.match(/class="tw-groupToggle"/g) || [];
  assert.equal(toggles.length, 2, '每个分组一个折叠按钮');
  const chevrons = html.match(/class="tw-chevron/g) || [];
  assert.equal(chevrons.length, 2, '每个分组一个箭头');
});

test('ui: 默认展开，aria-expanded=true', () => {
  const html = renderView(makeData());
  const expanded = html.match(/class="tw-groupToggle" aria-expanded="true"/g) || [];
  assert.equal(expanded.length, 2, '默认全部展开');
});

test('ui: 折叠某组后该组内容不渲染', () => {
  const html = renderView(makeData(), { collapsed: { core: true } });
  const expanded = html.match(/aria-expanded="true"/g) || [];
  assert.equal(expanded.length, 1, '折叠一组后只剩一组展开');
  assert.ok(!html.includes('>read<'), '折叠组内的工具不应出现');
  assert.ok(html.includes('mcp__tinyfish__search'), '未折叠组应正常显示');
});

test('ui: 折叠箭头方向随状态变化', () => {
  const open = renderView(makeData());
  const closed = renderView(makeData(), { collapsed: { core: true } });
  assert.ok(open.includes('tw-chevron is-open'), '展开态箭头朝下');
  assert.ok(closed.includes('class="tw-chevron"'), '折叠态箭头旋转');
});

// ─────────────────────────────────────────────
// 行
// ─────────────────────────────────────────────
test('ui: 每行有图标块 + 名称 + 副标题', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-icon'));
  assert.ok(html.includes('tw-name'));
  assert.ok(html.includes('tw-meta'));
  assert.ok(html.includes('<svg'));
});

test('ui: 每行有状态点', () => {
  const html = renderView(makeData());
  const dots = html.match(/class="tw-dot"/g) || [];
  assert.equal(dots.length, 5);
});

test('ui: 行用 grid 三列（图标/内容/开关）', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;
  assert.ok(/\.tw-row\{[^}]*grid-template-columns:34px minmax\(0,1fr\) auto/.test(css));
  assert.ok(/\.tw-row\{[^}]*min-height:44px/.test(css));
});

// ─────────────────────────────────────────────
// 开关
// ─────────────────────────────────────────────
test('ui: 非保护工具显示开关', () => {
  const html = renderView(makeData());
  const switches = html.match(/role="switch"/g) || [];
  assert.equal(switches.length, 3, '三个非保护工具三个开关');
});

test('ui: 保护工具不显示开关，标「基础工具」', () => {
  const html = renderView(makeData());
  const locks = html.match(/class="tw-lock"/g) || [];
  assert.equal(locks.length, 2);
  assert.ok(html.includes('基础工具'));
});

test('ui: 出厂状态全部开关为开', () => {
  const html = renderView(makeData());
  const checked = html.match(/aria-checked="true"/g) || [];
  assert.equal(checked.length, 3);
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
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search' });
  assert.ok(html.includes('tw-editor'));
  assert.ok(html.includes('tw-original'));
  assert.ok(html.includes('搜索网页。'), '应显示服务器原文');
  assert.ok(html.includes('服务器原始说明'));
  assert.ok(html.includes('保存说明'));
});

test('ui: 展开行 aria-expanded=true', () => {
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search' });
  assert.ok(html.includes('aria-expanded="true"'));
});

test('ui: 有未保存修改时提示', () => {
  const html = renderView(makeData(), {
    expandedName: 'mcp__tinyfish__search',
    draft: '改过的说明',
  });
  assert.ok(html.includes('有未保存修改'));
});

// ─────────────────────────────────────────────
// 头部与状态
// ─────────────────────────────────────────────
test('ui: 标题行只有标题与说明，不挂状态标签和统计块', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-head'));
  assert.ok(html.includes('工具守卫'));
  assert.ok(html.includes('tw-intro'));

  // 这些是用户明确要求删掉的：顶部标签与底部按钮重复，统计块是无效数字
  assert.ok(!html.includes('tw-pill'), '不应有状态胶囊');
  assert.ok(!html.includes('出厂状态'), '不应重复显示出厂状态');
  assert.ok(!html.includes('tw-headerCard'), '不应有头部卡片');
  assert.ok(!html.includes('tw-stat'), '不应有统计块');
});

test('ui: 摘要是一行小字，含总数与 token', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-summary'));
  assert.ok(/共 5 个工具 · ≈[\d,]+ tokens/.test(html));
});

test('ui: 有隐藏时才在摘要里提节省', () => {
  const none = renderView(makeData());
  assert.ok(!none.includes('每轮省'), '没有隐藏时不该提节省');

  const data = makeData();
  data.rules.tools['mcp__tinyfish__fetch_content'] = 'drop';
  const some = renderView(data);
  assert.ok(some.includes('每轮省'), '有隐藏时应提节省');
  assert.ok(/已隐藏 1 个/.test(some));
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

test('ui: 工具栏有搜索、全部折叠、刷新', () => {
  const html = renderView(makeData());
  assert.ok(html.includes('tw-search'));
  assert.ok(html.includes('全部折叠'));
  assert.ok(html.includes('刷新'));
});

test('ui: 搜索框与按钮同高，且垂直居中', () => {
  const { mod } = loadUi();
  const css = mod.__testing.CSS;

  // 三者必须定同一个高度，否则一高一矮看着就是歪的
  const search = css.match(/\.tw-search\{([^}]*)\}/)[1];
  const btn = css.match(/\.tw-btn\{([^}]*)\}/)[1];
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
  assert.ok(css.includes('font-size:16px;line-height:24px'), '页面标题 16/24');
  assert.ok(css.includes('font-size:13px;font-weight:600'), '行名 13 w600');
  assert.ok(css.includes('font-size:11px;line-height:13px'), '副标题 11/13');
  assert.ok(css.includes('border-radius:12px'), '分组卡片圆角 12');
  assert.ok(css.includes('min-height:44px'), '行高 44');
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
  const html = renderView(makeData(), { expandedName: 'mcp__tinyfish__search' });
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
test('ui: token 估算口径为字符 ÷ 3.5', () => {
  const { mod } = loadUi();
  assert.equal(mod.__testing.estimateTokens(3500), 1000);
  assert.equal(mod.__testing.estimateTokens(10609), 3031);
});

test('ui: 千分位格式化', () => {
  const { mod } = loadUi();
  assert.equal(mod.__testing.num(79505), '79,505');
  assert.equal(mod.__testing.num(60), '60');
});
