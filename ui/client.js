/**
 * Toolwarden 设置页 —— 浏览器半。
 *
 * 装载：window.__ModuleLoader__.load({ id, factory })
 * 数据：/toolwarden/api 的 op = state / set / reset
 *
 * ## 版式来源
 *
 * 结构照 MichengAI/dsh-archive-manager 的设置页（`src/plugin-ui.ts` 的 Disclosure
 * 与 `src/client.ts` 的 dsham_settings* 规则），它是同宿主里被认可的布局：
 *
 *   头部卡片    padding 18/20、bg-layer-2、border-l1、圆角 16
 *   分组卡片    border-l2、圆角 12、overflow hidden —— 这是「外面一个整体」
 *   分组头部    min-height 38、flex space-between
 *   折叠按钮    chevron(12×12) + 标题 13px w600
 *   行          grid minmax(0,1fr) auto、min-height 40、底边 1px
 *   分隔线      border-top 1px
 *
 * 刻度照宿主：标题 16/24 w500、正文 13/20、副标题 11/13、720 宽上限。
 * 颜色全走 --dsw-alias-*，零字面色值。
 *
 * ## 两层结构
 *
 * `ToolwardenView` 纯展示（给 data 出 HTML），`Section` 管取数与交互状态。
 * 这样版式可以离线渲染验证，不用靠人重启才能发现问题。
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
      '.tw{display:flex;flex-direction:column;width:100%;max-width:720px;padding:0 0 24px;box-sizing:border-box;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}',

      /* ── 头部卡片 ── */
      '.tw-headerCard{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:18px 20px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,16px);margin-bottom:16px}',
      '.tw-titleRow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0}',
      '.tw-title{margin:0;font-size:16px;line-height:24px;font-weight:500}',
      '.tw-intro{margin:0;max-width:42em;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
      '.tw-pill{flex:none;font-size:12px;line-height:16px;padding:2px 8px;border-radius:var(--dsw-radius-xs);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tw-pill[data-tone=ok]{color:var(--dsw-alias-state-success-primary);border-color:currentColor}',
      '.tw-pill[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}',
      '.tw-pill[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',

      /* ── 概览 ── */
      '.tw-stats{display:flex;flex-wrap:wrap;gap:28px}',
      '.tw-stat{display:flex;flex-direction:column;gap:1px}',
      '.tw-stat-num{font-size:18px;line-height:24px;font-weight:500}',
      '.tw-stat-label{font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary)}',

      /* ── 工具栏 ── */
      '.tw-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:16px;width:100%;min-width:0}',
      '.tw-search{flex:1 1 0;min-width:120px;box-sizing:border-box;font:inherit;font-size:13px;line-height:20px;padding:5px 10px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.tw-search::placeholder{color:var(--dsw-alias-label-tertiary)}',

      /* ── 分组卡片：外面一个整体 ── */
      '.tw-group{margin:0 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;transition:border-color 150ms ease}',
      '.tw-groupHeading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px;padding:0 10px;margin:0;user-select:none}',
      '.tw-groupToggle{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding:4px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.tw-groupTitle{display:flex;align-items:center;gap:8px;min-width:0;margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-groupMeta{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap}',
      '.tw-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.tw-chevron{flex:none;transition:transform 150ms ease}',
      '.tw-chevron.is-open{transform:rotate(0deg)}',
      '.tw-chevron:not(.is-open){transform:rotate(-90deg)}',
      '.tw-groupToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',

      /* ── 分组内的列表 ── */
      '.tw-list{display:grid;overflow:hidden;border-top:1px solid var(--dsw-alias-border-l2)}',

      /* ── 一行 ── */
      '.tw-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:40px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.tw-row:last-child{border-bottom:0}',
      '.tw-rowHead{display:contents;cursor:pointer}',
      '.tw-rowHead:hover .tw-name{text-decoration:underline;text-underline-offset:3px}',

      /* 图标块 */
      '.tw-icon{flex:none;width:34px;height:34px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;justify-content:center;position:relative}',
      '.tw-icon svg{width:16px;height:16px;stroke:var(--dsw-alias-label-secondary);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
      '.tw-dot{position:absolute;left:3px;bottom:3px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}',
      '.tw-icon[data-state=off] .tw-dot{background:var(--dsw-alias-state-idle-primary)}',

      /* 文字 */
      '.tw-body{min-width:0;display:flex;flex-direction:column;gap:0}',
      '.tw-name{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:16px;text-align:left;padding:0;border:0;background:transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
      '.tw-name:disabled{cursor:default;opacity:.6}',
      '.tw-name:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.tw-name[data-hidden=true]{color:var(--dsw-alias-label-tertiary)}',
      '.tw-meta{margin-top:1px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-tag{color:var(--dsw-alias-label-tertiary)}',

      /* ── 开关 ── */
      '.tw-switch{flex:none;display:inline-flex;align-items:center;background:none;border:none;padding:0;cursor:pointer}',
      '.tw-switch:disabled{cursor:default;opacity:.5}',
      '.tw-track{width:40px;height:22px;border-radius:11px;background:var(--dsw-alias-border-l2);position:relative;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}',
      '.tw-switch[aria-checked=true] .tw-track{background:var(--dsw-alias-state-success-primary)}',
      '.tw-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}',
      '.tw-switch[aria-checked=true] .tw-knob{transform:translateX(18px)}',
      '.tw-lock{flex:none;font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

      /* ── 展开的编辑区 ── */
      '.tw-detail{display:flex;flex-direction:column;gap:8px;padding:8px 10px 12px 52px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
      '.tw-detail-label{font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary)}',
      '.tw-original{font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-sm);padding:8px 10px;max-height:120px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.tw-textarea{width:100%;min-height:64px;box-sizing:border-box;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:8px;resize:vertical}',
      '.tw-detailActions{display:flex;gap:8px;align-items:center}',
      '.tw-dirty{font-size:11px;line-height:13px;color:var(--dsw-alias-state-warn-primary)}',

      /* ── 按钮 ── */
      '.tw-actions{display:flex;align-items:center;gap:6px;flex:none}',
      '.tw-btn{font:inherit;font-size:13px;line-height:20px;padding:4px 12px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}',
      '.tw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.tw-btn[data-kind=danger]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',
      '.tw-btn:disabled{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:none;cursor:default}',

      /* ── 提示 ── */
      '.tw-note{margin:0 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding:2px 0 2px 12px;overflow-wrap:anywhere}',
      '.tw-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-left-color:currentColor}',
      '.tw-note[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-left-color:currentColor}',
      '.tw-status{margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:12px}',

      '@media (prefers-reduced-motion: reduce){.tw-track,.tw-knob,.tw-btn,.tw-chevron,.tw-group{transition:none}}',
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

    /** 折叠箭头。方向由 open 决定。 */
    function chevron(open) {
      return h('svg', {
        className: 'tw-chevron' + (open ? ' is-open' : ''),
        viewBox: '0 0 16 16', width: 12, height: 12,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
        'aria-hidden': true,
      }, h('path', { d: 'M4 6l4 4 4-4', strokeLinecap: 'round', strokeLinejoin: 'round' }));
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
        title: props.title,
        onClick: props.onClick,
      }, h('span', { className: 'tw-track' }, h('span', { className: 'tw-knob' })));
    }

    /** 一行工具。展开时下面追加编辑区。 */
    function ToolRow(props) {
      var role = props.role;
      var hidden = props.hidden === true;
      var expanded = props.expanded === true;
      var isMcp = typeof role.server === 'string' && role.server !== '';

      return h('div', { className: 'tw-row', style: expanded ? { borderBottom: '0', paddingBottom: '2px' } : null },
        h('span', { className: 'tw-icon', 'data-state': hidden ? 'off' : 'on' },
          isMcp ? h(PlugIcon) : h(BoxIcon),
          h('span', { className: 'tw-dot' })),
        h('span', { className: 'tw-body' },
          h('button', {
            type: 'button',
            className: 'tw-name',
            'data-hidden': hidden,
            'aria-expanded': expanded,
            title: '点击展开改写说明',
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
            title: hidden ? '当前不进入上下文，点击启用' : '当前进入上下文，点击隐藏',
            onClick: props.onToggle,
          }),
      );
    }

    function ToolDetail(props) {
      return h('div', { className: 'tw-detail' },
        h('span', { className: 'tw-detail-label' }, '服务器原始说明'),
        h('div', { className: 'tw-original' }, props.originalDescription || '（无说明）'),
        h('span', { className: 'tw-detail-label' }, '改写为（留空则恢复原文）'),
        h('textarea', {
          className: 'tw-textarea',
          spellCheck: false,
          'aria-label': '改写 ' + props.role.name,
          value: props.draft,
          placeholder: '输入新的工具说明',
          onChange: function (e) { props.onDraft(e.target.value); },
        }),
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

    /** 一个可折叠的分组卡片。 */
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
              return h(React.Fragment, { key: role.name },
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
      var hiddenCount = all.filter(function (r) { return tools[r.name] === 'drop'; }).length;
      var savedChars = all.filter(function (r) { return tools[r.name] === 'drop'; })
        .reduce(function (n, r) { return n + r.chars; }, 0);

      // 搜索过滤；分组内无匹配时整组不显示
      var groups = data.groups.map(function (g) {
        if (query === '') return g;
        var matched = g.roles.filter(function (r) {
          return r.name.toLowerCase().indexOf(query) >= 0
            || g.group.toLowerCase().indexOf(query) >= 0;
        });
        return matched.length === 0 ? null : { group: g.group, roles: matched };
      }).filter(function (g) { return g !== null; });

      return h('div', { className: 'tw' },
        /* ── 头部卡片 ── */
        h('div', { className: 'tw-headerCard' },
          h('div', { className: 'tw-titleRow' },
            h('div', { style: { minWidth: 0 } },
              h('h2', { className: 'tw-title' }, '工具守卫'),
              h('p', { className: 'tw-intro' },
                '决定哪些工具进入模型的上下文。关掉当前用不到的工具，让每轮请求少带一些 schema。')),
            h('span', {
              className: 'tw-pill',
              'data-tone': data.patched === false ? 'bad' : (hiddenCount > 0 ? 'ok' : undefined),
            }, data.patched === false ? '未生效' : (hiddenCount > 0 ? '已启用' : '出厂状态')),
          ),
          h('div', { className: 'tw-stats' },
            h('div', { className: 'tw-stat' },
              h('span', { className: 'tw-stat-num' }, String(all.length)),
              h('span', { className: 'tw-stat-label' }, '个工具')),
            h('div', { className: 'tw-stat' },
              h('span', { className: 'tw-stat-num' }, '≈' + num(estimateTokens(chars))),
              h('span', { className: 'tw-stat-label' }, 'tokens / 轮')),
            h('div', { className: 'tw-stat' },
              h('span', { className: 'tw-stat-num' }, String(hiddenCount)),
              h('span', { className: 'tw-stat-label' }, '个已隐藏')),
            h('div', { className: 'tw-stat' },
              h('span', { className: 'tw-stat-num' }, '≈' + num(estimateTokens(savedChars))),
              h('span', { className: 'tw-stat-label' }, '节省 / 轮')),
          ),
        ),

        /* ── 提示 ── */
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

        /* ── 工具栏：搜索 + 操作 ── */
        h('div', { className: 'tw-toolbar' },
          h('input', {
            className: 'tw-search',
            type: 'search',
            placeholder: '搜索工具名或服务器…',
            'aria-label': '搜索工具',
            value: props.query || '',
            onChange: function (e) { props.onQuery(e.target.value); },
          }),
          h('div', { className: 'tw-actions' },
            h('button', {
              className: 'tw-btn', 'data-kind': 'danger',
              onClick: props.onReset, disabled: props.busy,
            }, '恢复出厂'),
            h('button', {
              className: 'tw-btn',
              onClick: props.onReload, disabled: props.busy,
            }, props.busy ? '处理中…' : '刷新'),
          ),
        ),

        /* ── 分组卡片 ── */
        groups.length === 0
          ? h('p', { className: 'tw-status' },
            query !== ''
              ? '没有匹配「' + props.query + '」的工具。'
              : '还没有捕获到任何工具。重启 DSH 后这里会列出全部工具。')
          : groups.map(function (g) {
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
          }),

        h('p', { className: 'tw-status' },
          '出厂状态不隐藏任何工具。点工具名展开可以改写说明。受保护的基础工具（read / write / edit / pwsh 等）任何配置都关不掉。'),
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
          h('div', { className: 'tw-headerCard' },
            h('h2', { className: 'tw-title' }, '工具守卫'),
            h('p', { className: 'tw-intro' }, '决定哪些工具进入模型的上下文。')),
          error === null
            ? h('p', { className: 'tw-status' }, '读取中…')
            : h('div', null,
              h('p', { className: 'tw-note', 'data-tone': 'bad' }, '无法读取状态：' + error),
              h('div', { className: 'tw-actions' },
                h('button', { className: 'tw-btn', onClick: load }, '重试'))),
        );
      }

      var tools = data.rules.tools || {};
      var rewrites = data.rules.rewrites || {};

      function persist(payload, done) {
        setBusy(true); setError(null);
        call(payload).then(function () {
          setPending(true);
          return call({ op: 'state' });
        }).then(function (next) { setData(next); if (done) done(); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onToggle(name) {
        var next = Object.assign({}, tools);
        if (next[name] === 'drop') delete next[name]; else next[name] = 'drop';
        persist({ op: 'set', tools: next });
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
        persist({ op: 'set', rewrite: next }, function () { setExpandedName(null); setDraft(''); });
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
