/**
 * Toolwarden 设置页 —— 浏览器半。
 *
 * 装载：window.__ModuleLoader__.load({ id, factory })
 * 数据：/toolwarden/api 的 op = state / set / reset
 *
 * ## 每个元素都得挣得自己的位置
 *
 *   标题行    标题 + 一句话说明 —— 就这些。状态用提示条表达，不挂常驻标签，
 *            因为底部已有「恢复出厂」，顶部再放「出厂状态」是重复
 *   工具栏    搜索 + 全部折叠 + 刷新 —— 三个都是高频；不再放组内批量按钮
 *   摘要      一行小字，只在隐藏过时提节省
 *   分组卡片  可折叠，头部只放标题与计数
 *   行        图标 + 名称 + 副标题 + 开关
 *   展开区    左原文右改写，两框等高
 *   底部      恢复出厂 —— 危险且低频，不放主操作区
 *
 * ## 设计取向
 *
 * 这是个精密仪表，不是设置清单。层级靠字号与字重拉开，不靠到处加边框盒子；
 * 数字统一等宽对齐；分组错开浮现；动效只在状态变化处出现。
 *
 * ## 刻度
 *
 *   正文 13/20 · 副标题 11/13 · 分组标题 13 w600 · 页面标题 16/24
 *   分组卡片 border-l2 圆角 12 · 行 min-height 44 · 间距走 4 的倍数
 *
 * 零硬编码色值，全部走 --dsw-alias-*。
 */
window.__ModuleLoader__.load({
  id: 'dsh-toolwarden-ui',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var ENDPOINT = '/toolwarden/api';
    var CSS_TAG = 'dsh-toolwarden-ui/settings.css';

    var CSS = [
      '.tw{display:flex;flex-direction:column;width:100%;max-width:760px;padding:0 0 24px;box-sizing:border-box;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}',

      /* ── 标题行 ── */
      '.tw-head{margin-bottom:14px}',
      '.tw-title{margin:0;font-size:16px;line-height:24px;font-weight:500;letter-spacing:-.01em}',
      '.tw-intro{margin:3px 0 0;max-width:44em;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',

      /* ── 工具栏 ── */
      '.tw-toolbar{display:flex;align-items:center;gap:8px;width:100%;min-width:0}',
      '.tw-searchWrap{position:relative;flex:1 1 0;min-width:140px;display:flex;align-items:center}',
      '.tw-searchIcon{position:absolute;left:9px;width:14px;height:14px;stroke:var(--dsw-alias-label-tertiary);fill:none;stroke-width:1.6;stroke-linecap:round;pointer-events:none}',
      '.tw-search{box-sizing:border-box;width:100%;font:inherit;font-size:13px;line-height:20px;padding:5px 10px 5px 30px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.tw-search::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.tw-search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.tw-actions{display:flex;align-items:center;gap:6px;flex:none}',

      /* ── 摘要 ── */
      '.tw-summary{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
      '.tw-saving{color:var(--dsw-alias-state-success-primary)}',
      '.tw-divider{height:0;border-top:1px solid var(--dsw-alias-border-l2);margin:12px 0 14px}',

      /* ── 分组卡片 ── */
      '.tw-group{margin:0 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;transition:border-color 150ms ease}',
      '.tw-group:hover{border-color:var(--dsw-alias-border-l1)}',
      '.tw-groupHeading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px;padding:0 10px;margin:0;user-select:none}',
      '.tw-groupToggle{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding:4px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.tw-groupIcon{flex:none;width:16px;height:16px;stroke:var(--dsw-alias-label-secondary);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',
      '.tw-groupTitle{min-width:0;margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-groupMeta{display:flex;align-items:center;gap:8px;flex:none}',
      '.tw-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}',
      '.tw-chevron{flex:none;transition:transform 180ms cubic-bezier(.2,.7,.3,1)}',
      '.tw-chevron.is-open{transform:rotate(0deg)}',
      '.tw-chevron:not(.is-open){transform:rotate(-90deg)}',
      '.tw-groupToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',

      /* ── 列表与行 ── */
      '.tw-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.tw-itemT{display:flex;flex-direction:column}',
      '.tw-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:44px;padding:6px 10px;transition:background 150ms ease}',
      '.tw-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tw-icon{flex:none;width:34px;height:34px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;justify-content:center;position:relative}',
      '.tw-icon svg{width:16px;height:16px;stroke:var(--dsw-alias-label-secondary);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
      '.tw-dot{position:absolute;left:3px;bottom:3px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);transition:background 150ms ease}',
      '.tw-icon[data-state=off] .tw-dot{background:var(--dsw-alias-state-idle-primary)}',
      '.tw-body{min-width:0;display:flex;flex-direction:column}',
      '.tw-name{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:16px;text-align:left;padding:0;border:0;background:transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:color 150ms ease}',
      '.tw-name:hover:not(:disabled){text-decoration:underline;text-underline-offset:3px}',
      '.tw-name:disabled{cursor:default;opacity:.6}',
      '.tw-name:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.tw-name[data-hidden=true]{color:var(--dsw-alias-label-tertiary)}',
      '.tw-meta{margin-top:1px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',

      /* 开关 */
      '.tw-switch{flex:none;display:inline-flex;align-items:center;background:none;border:none;padding:0;cursor:pointer}',
      '.tw-switch:disabled{cursor:default;opacity:.5}',
      '.tw-track{width:38px;height:20px;border-radius:10px;background:var(--dsw-alias-border-l2);position:relative;transition:background 180ms cubic-bezier(.2,.7,.3,1)}',
      '.tw-switch[aria-checked=true] .tw-track{background:var(--dsw-alias-state-success-primary)}',
      '.tw-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 180ms cubic-bezier(.2,.7,.3,1)}',
      '.tw-switch[aria-checked=true] .tw-knob{transform:translateX(18px)}',
      '.tw-switch:focus-visible .tw-track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.tw-lock{flex:none;font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

      /* ── 展开：左右两栏等高 ── */
      '.tw-detail{display:flex;flex-direction:column;gap:10px;padding:2px 10px 14px 54px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);animation:tw-detail-in 180ms cubic-bezier(.2,.7,.3,1) both}',
      '.tw-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-width:0}',
      '.tw-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.tw-fieldLabel{font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary)}',
      '.tw-box{box-sizing:border-box;height:132px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}',
      '.tw-original{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.tw-editor{resize:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}',
      '.tw-editor::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.tw-editor:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.tw-detailActions{display:flex;align-items:center;gap:10px}',
      '.tw-dirty{font-size:11px;line-height:13px;color:var(--dsw-alias-state-warn-primary)}',

      /* ── 按钮 ── */
      '.tw-btn{font:inherit;font-size:13px;line-height:20px;padding:4px 12px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background 150ms ease;white-space:nowrap}',
      '.tw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.tw-btn[data-kind=danger]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',
      '.tw-btn:disabled{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:none;cursor:default}',
      '.tw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',

      /* ── 底部危险区 ── */
      '.tw-footer{display:flex;align-items:center;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.tw-footerNote{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',

      /* ── 提示 ── */
      '.tw-note{margin:0 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding:2px 0 2px 12px;overflow-wrap:anywhere}',
      '.tw-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-left-color:currentColor}',
      '.tw-note[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-left-color:currentColor}',
      '.tw-status{margin:12px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',

      /* ── 动效：分组错开浮现 ── */
      '@keyframes tw-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@keyframes tw-detail-in{from{opacity:0}to{opacity:1}}',
      '.tw-groups>.tw-group{animation:tw-rise 260ms cubic-bezier(.2,.7,.3,1) both}',
      '.tw-groups>.tw-group:nth-child(1){animation-delay:0ms}',
      '.tw-groups>.tw-group:nth-child(2){animation-delay:40ms}',
      '.tw-groups>.tw-group:nth-child(3){animation-delay:80ms}',
      '.tw-groups>.tw-group:nth-child(4){animation-delay:120ms}',
      '.tw-groups>.tw-group:nth-child(5){animation-delay:160ms}',
      '.tw-groups>.tw-group:nth-child(6){animation-delay:200ms}',
      '.tw-groups>.tw-group:nth-child(n+7){animation-delay:240ms}',

      '@media (max-width:640px){.tw-fields{grid-template-columns:1fr}}',
      '@media (prefers-reduced-motion: reduce){.tw-group,.tw-detail{animation:none}.tw-track,.tw-knob,.tw-btn,.tw-chevron,.tw-row,.tw-name,.tw-dot,.tw-group{transition:none}}',
    ].join('\n');

    function call(body) {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || (payload && typeof payload.code === 'string')) {
            var error = new Error((payload && payload.message) || 'HTTP ' + response.status);
            error.code = payload && payload.code;
            throw error;
          }
          return payload;
        });
      });
    }

    function estimateTokens(chars) { return Math.round(chars / 3.5); }
    function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

    function chevron(open) {
      return h('svg', {
        className: 'tw-chevron' + (open ? ' is-open' : ''),
        viewBox: '0 0 16 16', width: 12, height: 12,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
        'aria-hidden': true,
      }, h('path', { d: 'M4 6l4 4 4-4', strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    function SearchIcon() {
      return h('svg', { className: 'tw-searchIcon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('circle', { cx: '7', cy: '7', r: '4.5' }),
        h('path', { d: 'M10.5 10.5L14 14' }));
    }

    function ServerIcon() {
      return h('svg', { className: 'tw-groupIcon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('rect', { x: '2', y: '3', width: '12', height: '4', rx: '1' }),
        h('rect', { x: '2', y: '9', width: '12', height: '4', rx: '1' }),
        h('path', { d: 'M5 5h.01' }), h('path', { d: 'M5 11h.01' }));
    }

    function FolderIcon() {
      return h('svg', { className: 'tw-groupIcon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', { d: 'M2 4a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z' }));
    }

    function PlugIcon() {
      return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('path', { d: 'M9 2v6' }), h('path', { d: 'M15 2v6' }),
        h('path', { d: 'M6 8h12v3a6 6 0 0 1-12 0z' }), h('path', { d: 'M12 17v4' }));
    }

    function BoxIcon() {
      return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('rect', { x: '3', y: '3', width: '18', height: '18', rx: '3' }),
        h('path', { d: 'M8 9h8' }), h('path', { d: 'M8 14h5' }));
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'tw-switch',
        role: 'switch',
        'aria-checked': props.checked === true,
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: props.onClick,
      }, h('span', { className: 'tw-track' }, h('span', { className: 'tw-knob' })));
    }

    function ToolRow(props) {
      var role = props.role;
      var hidden = props.hidden === true;
      var isMcp = typeof role.server === 'string' && role.server !== '';

      return h('div', { className: 'tw-row' },
        h('span', { className: 'tw-icon', 'data-state': hidden ? 'off' : 'on' },
          isMcp ? h(PlugIcon) : h(BoxIcon),
          h('span', { className: 'tw-dot' })),
        h('span', { className: 'tw-body' },
          h('button', {
            type: 'button',
            className: 'tw-name',
            'data-hidden': hidden,
            'aria-expanded': props.expanded === true,
            onClick: props.onExpand,
          }, role.name),
          h('span', { className: 'tw-meta' },
            num(role.chars) + ' 字符 · ≈' + num(estimateTokens(role.chars)) + ' tokens' +
            (role.rewritten ? ' · 已改写' : '')),
        ),
        role.protected
          ? h('span', { className: 'tw-lock' }, '基础工具')
          : h(Switch, {
            checked: hidden !== true,
            disabled: props.busy,
            label: (hidden ? '启用 ' : '隐藏 ') + role.name,
            onClick: props.onToggle,
          }),
      );
    }

    /** 展开的编辑区：左原文右改写，两框等高同宽。 */
    function ToolDetail(props) {
      return h('div', { className: 'tw-detail' },
        h('div', { className: 'tw-fields' },
          h('div', { className: 'tw-field' },
            h('span', { className: 'tw-fieldLabel' }, '服务器原始说明'),
            h('div', { className: 'tw-box tw-original' },
              props.originalDescription || '（服务器没有提供说明）'),
          ),
          h('div', { className: 'tw-field' },
            h('span', { className: 'tw-fieldLabel' }, '改写为（留空恢复原文）'),
            h('textarea', {
              className: 'tw-box tw-editor',
              spellCheck: false,
              'aria-label': '改写 ' + props.role.name,
              value: props.draft,
              placeholder: '输入新的工具说明',
              onChange: function (e) { props.onDraft(e.target.value); },
            }),
          ),
        ),
        h('div', { className: 'tw-detailActions' },
          h('button', {
            className: 'tw-btn',
            disabled: props.busy,
            onClick: props.onSave,
          }, '保存说明'),
          props.dirty ? h('span', { className: 'tw-dirty' }, '有未保存修改') : null,
        ),
      );
    }

    /** 一个可折叠的分组卡片。头部只放标题与计数，不放批量按钮。 */
    function ToolGroup(props) {
      var section = props.section;
      var roles = section.roles;
      var open = props.open !== false;
      var hiddenCount = roles.filter(function (r) { return props.tools[r.name] === 'drop'; }).length;
      var chars = roles.reduce(function (n, r) { return n + r.chars; }, 0);
      var isMcp = section.group !== 'core';

      return h('section', { className: 'tw-group' },
        h('div', { className: 'tw-groupHeading' },
          h('button', {
            type: 'button',
            className: 'tw-groupToggle',
            'aria-expanded': open,
            onClick: props.onToggleGroup,
          },
            chevron(open),
            isMcp ? h(ServerIcon) : h(FolderIcon),
            h('span', { className: 'tw-groupTitle' },
              isMcp ? 'MCP · ' + section.group.replace(/^mcp:/, '') : '内置工具'),
          ),
          h('div', { className: 'tw-groupMeta' },
            h('span', { className: 'tw-count' },
              roles.length + ' 个 · ≈' + num(estimateTokens(chars)) + ' tokens' +
              (hiddenCount > 0 ? ' · ' + hiddenCount + ' 已隐藏' : '')),
          ),
        ),
        open
          ? h('div', { className: 'tw-list' },
            roles.map(function (role) {
              var expanded = props.expandedName === role.name;
              return h('div', { key: role.name, className: 'tw-itemT' },
                h(ToolRow, {
                  role: role,
                  hidden: props.tools[role.name] === 'drop',
                  busy: props.busy,
                  expanded: expanded,
                  onExpand: function () { props.onExpand(role.name); },
                  onToggle: function () { props.onToggle(role.name); },
                }),
                expanded
                  ? h(ToolDetail, {
                    role: role,
                    originalDescription: role.originalDescription,
                    draft: props.draft,
                    busy: props.busy,
                    dirty: props.draft !== (role.currentRewrite || ''),
                    onDraft: props.onDraft,
                    onSave: function () { props.onSaveRewrite(role.name, props.draft); },
                  })
                  : null,
              );
            }))
          : null,
      );
    }

    /** 纯展示组件：给 data 就出 HTML。 */
    function ToolwardenView(props) {
      var data = props.data;
      var tools = data.rules.tools || {};
      var rewrites = data.rules.rewrites || {};
      var query = (props.query || '').trim().toLowerCase();
      var collapsed = props.collapsed || {};

      var all = [];
      data.groups.forEach(function (g) {
        g.roles.forEach(function (r) {
          var entry = rewrites[r.name];
          r.rewritten = entry !== undefined && entry.description !== undefined;
          r.currentRewrite = entry === undefined ? '' : (entry.description || '');
          all.push(r);
        });
      });

      var chars = all.reduce(function (n, r) { return n + r.chars; }, 0);
      var hidden = all.filter(function (r) { return tools[r.name] === 'drop'; });
      var savedChars = hidden.reduce(function (n, r) { return n + r.chars; }, 0);

      var groups = data.groups.map(function (g) {
        if (query === '') return g;
        var matched = g.roles.filter(function (r) {
          return r.name.toLowerCase().indexOf(query) >= 0
            || g.group.toLowerCase().indexOf(query) >= 0;
        });
        return matched.length === 0 ? null : { group: g.group, roles: matched };
      }).filter(function (g) { return g !== null; });

      var allCollapsed = groups.length > 0 && groups.every(function (g) {
        return collapsed[g.group] === true;
      });

      return h('div', { className: 'tw' },
        /* 标题行：只有标题与说明 */
        h('div', { className: 'tw-head' },
          h('h2', { className: 'tw-title' }, '工具守卫'),
          h('p', { className: 'tw-intro' },
            '决定哪些工具进入模型的上下文。关掉当前用不到的工具，让每轮请求少带一些 schema。'),
        ),

        data.patched === false
          ? h('p', { className: 'tw-note', 'data-tone': 'bad' },
            '拦截补丁未安装：' + (data.reason || '未知原因') + '。当前配置不会生效。')
          : null,
        (data.problems && data.problems.length > 0)
          ? h('p', { className: 'tw-note', 'data-tone': 'bad' }, '配置问题：' + data.problems.join('；'))
          : null,
        (data.diagnostics && data.diagnostics.length > 0)
          ? h('p', { className: 'tw-note', 'data-tone': 'warn' },
            '诊断：' + data.diagnostics.map(function (d) { return d.target + ' ' + d.message; }).join('；'))
          : null,
        props.error !== null && props.error !== undefined
          ? h('p', { className: 'tw-note', 'data-tone': 'bad' }, props.error) : null,
        props.pending
          ? h('p', { className: 'tw-note', 'data-tone': 'warn' },
            '已保存到配置。重启 DSH 后对新注册的工具生效。') : null,

        /* 工具栏 */
        h('div', { className: 'tw-toolbar' },
          h('div', { className: 'tw-searchWrap' },
            h(SearchIcon),
            h('input', {
              className: 'tw-search',
              type: 'search',
              placeholder: '搜索工具名或服务器…',
              'aria-label': '搜索工具',
              value: props.query || '',
              onChange: function (e) { props.onQuery(e.target.value); },
            }),
          ),
          h('div', { className: 'tw-actions' },
            h('button', {
              className: 'tw-btn',
              disabled: groups.length === 0,
              onClick: function () { props.onCollapseAll(!allCollapsed); },
            }, allCollapsed ? '全部展开' : '全部折叠'),
            h('button', {
              className: 'tw-btn',
              onClick: props.onReload, disabled: props.busy,
            }, props.busy ? '处理中…' : '刷新'),
          ),
        ),

        /* 摘要：一行小字。注意 children 要分开传，字符串 + 元素会得到 [object Object] */
        h('p', { className: 'tw-summary' },
          '共 ' + all.length + ' 个工具 · ≈' + num(estimateTokens(chars)) + ' tokens',
          hidden.length > 0
            ? h('span', { className: 'tw-saving' },
              ' · 已隐藏 ' + hidden.length + ' 个，每轮省 ≈' + num(estimateTokens(savedChars)) + ' tokens')
            : null,
        ),
        h('div', { className: 'tw-divider' }),

        /* 分组卡片 */
        groups.length === 0
          ? h('p', { className: 'tw-status' },
            query !== ''
              ? '没有匹配「' + props.query + '」的工具。'
              : '还没有捕获到任何工具。重启 DSH 后这里会列出全部工具。')
          : h('div', { className: 'tw-groups' },
            groups.map(function (g) {
              return h(ToolGroup, {
                key: g.group,
                section: g,
                tools: tools,
                busy: props.busy,
                open: collapsed[g.group] !== true,
                expandedName: props.expandedName,
                draft: props.draft,
                onToggleGroup: function () { props.onToggleGroup(g.group); },
                onExpand: props.onExpand,
                onDraft: props.onDraft,
                onToggle: props.onToggle,
                onSaveRewrite: props.onSaveRewrite,
              });
            })),

        /* 底部：危险操作 */
        h('div', { className: 'tw-footer' },
          h('button', {
            className: 'tw-btn', 'data-kind': 'danger',
            onClick: props.onReset, disabled: props.busy,
          }, '恢复出厂'),
          h('p', { className: 'tw-footerNote' },
            '清空全部规则，所有工具回到默认开启。'),
        ),
      );
    }

    /** 容器：取数、管状态。 */
    function Section() {
      var s0 = React.useState(null); var data = s0[0]; var setData = s0[1];
      var s1 = React.useState(null); var error = s1[0]; var setError = s1[1];
      var s2 = React.useState(false); var busy = s2[0]; var setBusy = s2[1];
      var s3 = React.useState(false); var pending = s3[0]; var setPending = s3[1];
      var s4 = React.useState(null); var expandedName = s4[0]; var setExpandedName = s4[1];
      var s5 = React.useState(''); var draft = s5[0]; var setDraft = s5[1];
      var s6 = React.useState({}); var collapsed = s6[0]; var setCollapsed = s6[1];
      var s7 = React.useState(''); var query = s7[0]; var setQuery = s7[1];

      var load = React.useCallback(function () {
        setError(null);
        call({ op: 'state' }).then(function (payload) { setData(payload); })
          .catch(function (e) { setError(e.message); });
      }, []);

      React.useEffect(function () { load(); }, [load]);

      if (data === null) {
        return h('div', { className: 'tw' },
          h('div', { className: 'tw-head' },
            h('h2', { className: 'tw-title' }, '工具守卫'),
            h('p', { className: 'tw-intro' }, '决定哪些工具进入模型的上下文。')),
          error === null
            ? h('p', { className: 'tw-status' }, '读取中…')
            : h('div', null,
              h('p', { className: 'tw-note', 'data-tone': 'bad' }, '无法读取状态：' + error),
              h('div', null, h('button', { className: 'tw-btn', onClick: load }, '重试'))),
        );
      }

      var tools = data.rules.tools || {};
      var rewrites = data.rules.rewrites || {};

      function persist(nextTools, done) {
        setBusy(true); setError(null);
        call({ op: 'set', tools: nextTools }).then(function () {
          setPending(true);
          return call({ op: 'state' });
        }).then(function (next) { setData(next); if (done) done(); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onToggle(name) {
        var next = Object.assign({}, tools);
        if (next[name] === 'drop') delete next[name]; else next[name] = 'drop';
        persist(next);
      }

      function onCollapseAll(shouldCollapse) {
        var next = {};
        if (shouldCollapse) {
          data.groups.forEach(function (g) { next[g.group] = true; });
        }
        setCollapsed(next);
      }

      function onExpand(name) {
        if (expandedName === name) { setExpandedName(null); setDraft(''); return; }
        setExpandedName(name);
        var entry = rewrites[name];
        setDraft(entry === undefined ? '' : (entry.description || ''));
      }

      function onSaveRewrite(name, text) {
        var next = Object.assign({}, rewrites);
        var entry = Object.assign({}, next[name] || {});
        if (text === '') delete entry.description; else entry.description = text;
        if (entry.description === undefined && entry.properties === undefined) delete next[name];
        else next[name] = entry;
        setBusy(true); setError(null);
        call({ op: 'set', rewrite: next }).then(function () {
          setPending(true);
          return call({ op: 'state' });
        }).then(function (next2) {
          setData(next2); setExpandedName(null); setDraft('');
        }).catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onReset() {
        setBusy(true); setError(null);
        call({ op: 'reset' }).then(function () {
          setPending(true); return call({ op: 'state' });
        }).then(function (next) { setData(next); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onToggleGroup(group) {
        var next = Object.assign({}, collapsed);
        if (next[group] === true) delete next[group]; else next[group] = true;
        setCollapsed(next);
      }

      return h(ToolwardenView, {
        data: data,
        busy: busy,
        pending: pending,
        error: error,
        expandedName: expandedName,
        draft: draft,
        query: query,
        collapsed: collapsed,
        onQuery: setQuery,
        onToggleGroup: onToggleGroup,
        onCollapseAll: onCollapseAll,
        onExpand: onExpand,
        onDraft: setDraft,
        onToggle: onToggle,
        onSaveRewrite: onSaveRewrite,
        onReset: onReset,
        onReload: load,
      });
    }

    function apply(ctx) {
      if (typeof document !== 'undefined' && ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') !== null) {
            return function () {};
          }
          var tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-toolwarden-ui';
          tag.dataset.pluginCss = CSS_TAG;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return function () {
            if (tag.parentNode) tag.parentNode.removeChild(tag);
          };
        });
      }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'toolwarden',
          order: 60,
          label: function () { return '工具守卫'; },
          inject: function () { return {}; },
        }, Section);
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    exports.__testing = {
      estimateTokens: estimateTokens,
      num: num,
      View: ToolwardenView,
      Section: Section,
      CSS: CSS,
    };
    return module.exports;
  },
});
