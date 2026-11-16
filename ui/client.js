/**
 * 工具管理设置页 —— 浏览器半。
 *
 * 装载：window.__ModuleLoader__.load({ id, factory })
 * 数据：/tool-keeper/api 的 op = state / set / reset
 *
 * ## 每个元素都得挣得自己的位置
 *
 *   标题行    标题 + 一句话说明 —— 就这些。状态用提示条表达，不挂常驻标签，
 *            因为底部已有「恢复出厂」，顶部再放「出厂状态」是重复
 *   工具栏    搜索 + 展开/折叠 + 刷新 + 导出 + 导入
 *   摘要      一行小字，报「屏幕上有多少个工具」
 *   分组卡片  默认折叠；卡片包住标题与工具，卡与卡贴合无缝
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
  id: 'dsh-tool-keeper-ui',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var ENDPOINT = '/tool-keeper/api';
    var CSS_TAG = 'dsh-tool-keeper-ui/settings.css';

    var CSS = [
      '.tw{display:flex;flex-direction:column;width:100%;max-width:760px;padding:0 0 24px;box-sizing:border-box;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}',

      /* ── 工具栏：三者同高、垂直居中 ── */
      '.tw-toolbar{display:flex;align-items:center;gap:8px;width:100%;min-width:0}',

      '.tw-searchWrap{position:relative;flex:1 1 0;min-width:140px;display:flex;align-items:center}',
      '.tw-searchIcon{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;stroke:var(--dsw-alias-label-tertiary);fill:none;stroke-width:1.6;stroke-linecap:round;pointer-events:none}',
      '.tw-search{box-sizing:border-box;width:100%;height:34px;font:inherit;font-size:13px;line-height:20px;padding:0 10px 0 30px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.tw-search::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.tw-search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.tw-actions{display:flex;align-items:center;gap:8px;flex:none}',
      /* 工具栏四个按钮定死同宽：宽度不能由文字长度撑出来，否则宽窄不一 */
      '.tw-actions .tw-btn{width:72px;padding:0}',
      '.tw-actions .tw-btn[data-kind=danger]{width:auto;padding:0 14px}',

      /* ── 摘要 ── */
      '.tw-summary{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
      '.tw-divider{height:0;border-top:1px solid var(--dsw-alias-border-l2);margin:12px 0 14px}',
      /* ── 分组：一张卡片包住标题与整组工具，卡与卡贴合无缝 ──
         标题行收进卡片（折叠态也是完整的卡）；组间不留缝，相邻卡边框重合成一条线；
         组内行间用发丝线，行级没有独立盒子；首尾卡保留圆角。 */
      '.tw-group{margin:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);overflow:hidden}',
      '.tw-group+.tw-group{margin-top:-1px}',
      '.tw-groups>.tw-group:first-child{border-radius:var(--dsw-radius-sm,8px) var(--dsw-radius-sm,8px) 0 0}',
      '.tw-groups>.tw-group:last-child{border-radius:0 0 var(--dsw-radius-sm,8px) var(--dsw-radius-sm,8px)}',
      '.tw-groups>.tw-group:first-child:last-child{border-radius:var(--dsw-radius-sm,8px)}',
      /* 标题行高必须等于工具行实际高度（34px 图标块 + 12px 行内边距 = 46px）：
         折叠卡与展开行在同一竖列里堆叠，一高一矮节奏就断了。 */
      /* 头部容器：三列网格（标题 | 开关 | 编辑）。行高仍与工具行一致（46px）。
         不要退回 flex：第三个控件在 flex 下不参与宽度分配，会撑出卡片右缘。 */
      /* 头部用网格而不是 flex：右侧永远只有「开关 + 编辑」两个固定宽度的格子，
         标题与状态占剩余宽度并自行省略。flex 下第三个控件会撑出卡片右缘（历史 bug）。 */
      '.tw-groupHeader{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:0;padding:0 10px 0 0}',
      '.tw-groupToggle{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;min-height:46px;padding:0 0 0 10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;user-select:none;transition:background 150ms ease}',
      '.tw-groupToggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.tw-groupToggle:disabled{cursor:default}',
      '.tw-groupLead{display:flex;align-items:center;gap:8px;min-width:0}',
      '.tw-groupIcon{flex:none;width:16px;height:16px;stroke:var(--dsw-alias-label-secondary);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',
      '.tw-groupTitle{min-width:0;margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-groupMeta{display:flex;align-items:center;gap:8px;min-width:0;flex:none}',
      '.tw-count{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}',
      '.tw-chevron{flex:none;transition:transform 180ms cubic-bezier(.2,.7,.3,1)}',
      '.tw-chevron.is-open{transform:rotate(0deg)}',
      '.tw-chevron:not(.is-open){transform:rotate(-90deg)}',
      '.tw-groupToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',

      /* ── 列表：卡内的工具列表，顶部发丝线与标题分隔，行间发丝线 ── */
      '.tw-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.tw-item{display:flex;flex-direction:column}',
      '.tw-item+.tw-item{border-top:.5px solid var(--dsw-alias-border-l2)}',
      /* 行必须 border-box：content-box 下 min-height 不含内边距，行会多出 12px，
         与分组标题（46px）错位。46 = 34px 图标块 + 6px×2 内边距。 */
      /* 行必须 border-box：content-box 下 min-height 不含内边距，行会多出 12px，
         与分组标题（46px）错位。46 = 34px 图标块 + 6px×2 内边距。 */
      '.tw-row{box-sizing:border-box;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:46px;padding:6px 10px;transition:background 150ms ease}',
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
      '.tw-switch{flex:none;display:inline-flex;align-items:center;background:none;border:none;padding:0;margin-left:10px;cursor:pointer;justify-self:end}',
      '.tw-switch:disabled{cursor:default;opacity:.5}',
      '.tw-track{width:38px;height:20px;border-radius:10px;background:var(--dsw-alias-border-l2);position:relative;transition:background 180ms cubic-bezier(.2,.7,.3,1)}',
      '.tw-switch[aria-checked=true] .tw-track{background:var(--dsw-alias-state-success-primary)}',
      '.tw-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 180ms cubic-bezier(.2,.7,.3,1)}',
      '.tw-switch[aria-checked=true] .tw-knob{transform:translateX(18px)}',
      '.tw-switch:focus-visible .tw-track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.tw-lock{flex:none;font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

      /* ── 展开：左右两栏等高，画在同一个盒子里 ── */
      '.tw-detail{display:flex;flex-direction:column;gap:10px;padding:2px 10px 12px 54px;border-top:.5px solid var(--dsw-alias-border-l2);animation:tw-detail-in 180ms cubic-bezier(.2,.7,.3,1) both}',
      '.tw-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-width:0}',
      '.tw-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.tw-fieldLabel{font-size:11px;line-height:13px;color:var(--dsw-alias-label-tertiary)}',
      '.tw-box{box-sizing:border-box;height:132px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}',
      '.tw-original{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.tw-editor{resize:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}',
      '.tw-editor::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.tw-editor:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.tw-detailActions{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.tw-dirty{font-size:11px;line-height:13px;color:var(--dsw-alias-state-warn-primary)}',
      '.tw-detailHint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
      /* 编辑按钮：网格里的固定格，自身右对齐；outline 用内偏移，贴在卡片边缘也不会被裁 */
      '.tw-editServer{justify-self:end;height:26px;margin:0 0 0 10px;padding:0 10px;font:inherit;font-size:12px;line-height:24px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.tw-editServer:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.tw-editServer:disabled{cursor:default;opacity:.5}',
      '.tw-editServer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.tw-editServer[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',

      /* ── 按钮：与搜索框同高 34px，内容垂直居中 ── */
      '.tw-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:34px;font:inherit;font-size:13px;line-height:20px;padding:0 14px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background 150ms ease;white-space:nowrap}',
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
      '@media (prefers-reduced-motion: reduce){.tw-group,.tw-detail{animation:none}.tw-track,.tw-knob,.tw-btn,.tw-chevron,.tw-row,.tw-name,.tw-dot,.tw-groupToggle{transition:none}}',
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

    /**
     * 点击开关后应该写入的 `tools` 映射。
     *
     * `effective` 是点击那一刻引擎的判定，**不是**配置里的条目：
     * 被服务器总开关关掉的行，`tools` 里根本没有条目，
     * 若按 `tools[name]` 判断就会写成 drop（再关一次），从界面永远打不开。
     *
     * 打开 = 写 keep 覆盖（单工具优先级高于服务器规则）；关闭 = 写 drop。
     *
     * 抽成纯函数，因为这是唯一会写配置的交互，必须能单独测。
     */
    function nextToolsAfterToggle(tools, name, effective) {
      var next = Object.assign({}, tools);
      if (effective === 'drop') next[name] = 'keep';
      else next[name] = 'drop';
      return next;
    }

    /**
     * 改写某台服务器的说明页后应写入的 `servers` 映射。
     *
     * 只动一个字段：`rewrite`。空串/纯空白 = 恢复原样（删字段，与 normalizeConfig 同口径）；
     * 条目里三个字段都空才删整条（否则「打开服务器」会顺手把改写删掉，这是 0.5.0 的既有缺陷）。
     * 抽成纯函数：这是唯一写服务器说明的交互，必须能单独测。
     */
    function nextServersAfterRewrite(servers, server, text) {
      var next = Object.assign({}, servers || {});
      var entry = Object.assign({}, next[server] || {});
      if (text.trim() === '') delete entry.rewrite; else entry.rewrite = text;
      if (entry.enabled === undefined && entry.rewrite === undefined) delete next[server];
      else next[server] = entry;
      return next;
    }

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
      var hidden = role.effective === 'drop';
      var isMcp = typeof role.server === 'string' && role.server !== '';

      // 整台服务器停用时，行级开关是无效操作 —— 禁用比「点了没反应」诚实
      var serverDisabled = props.serverDisabled === true;

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
            serverDisabled ? '服务器已停用' : null,
            props.rewritten ? '已改写' : null,
          ),
        ),
        role.protected
          ? h('span', { className: 'tw-lock' }, '受保护')
          : h(Switch, {
            checked: hidden !== true,
            disabled: props.busy || serverDisabled,
            label: (hidden ? '启用 ' : '隐藏 ') + role.name,
            // 必须把「当前引擎判定」一起传出去。只看 rules.tools 是错的：
            // 被服务器规则关掉的行，tools 里没有条目，点开关会再写一条 drop，
            // 于是从界面永远打不开它（再点一次只是删掉 drop，服务器规则还在）。
            onClick: function () { props.onToggle(role.effective); },
          }),
      );
    }

    /** 展开的编辑区：左原文右改写，两框等高同宽。 */
    function ToolDetail(props) {
      var isMcp = typeof props.role.server === 'string' && props.role.server !== '';
      return h('div', { className: 'tw-detail' },
        h('div', { className: 'tw-fields' },
          h('div', { className: 'tw-field' },
            // 内置工具没有服务器，不能一律写「服务器原始说明」
            h('span', { className: 'tw-fieldLabel' }, isMcp ? '服务器原始说明' : '原始说明'),
            h('div', { className: 'tw-box tw-original' },
              props.originalDescription || '（没有提供说明）'),
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

    /**
     * 服务器说明页的编辑面板：左原文、右改写。
     * 三种原文状态必须可区分：有文本 / 空串（服务器没提供说明）/ 键缺失（还没组装过）。
     * 没有「取消」：再点一次「编辑」就收起，Esc 也可以——少一个按钮少一处要对齐的东西。
     */
    function ServerDetail(props) {
      var original = props.originalText;
      var originalText;
      if (original === undefined) originalText = '还没读到原始说明（发一次消息后点刷新）';
      else if (original === '') originalText = '该服务器没有提供说明（你写的内容会作为它的说明出现）';
      else originalText = original;
      // 运行时事实：改写配了，上次组装到底替没替换
      var effectHint = props.configured === true
        ? (props.applied === true ? '上次组装已生效' : '尚未生效（重启后生效）')
        : null;
      return h('div', {
        className: 'tw-detail',
        onKeyDown: function (e) { if (e.key === 'Escape') props.onCancel(); },
      },
        props.disabled === true
          ? h('p', { className: 'tw-detailHint' }, '该服务器已停用，改写会在启用后生效')
          : null,
        h('div', { className: 'tw-fields' },
          h('div', { className: 'tw-field' },
            h('span', { className: 'tw-fieldLabel' }, '服务器原始说明'),
            h('div', { className: 'tw-box tw-original' }, originalText),
          ),
          h('div', { className: 'tw-field' },
            h('span', { className: 'tw-fieldLabel' }, '改写为（留空恢复原文）'),
            h('textarea', {
              className: 'tw-box tw-editor',
              spellCheck: false,
              'aria-label': '改写服务器说明 ' + props.server,
              placeholder: '整段替换。标题行 `### MCP server: 名字` 也在正文里，想保留就自己写回去。',
              value: props.draft,
              onChange: function (e) { props.onDraft(e.target.value); },
            }),
          ),
        ),
        h('div', { className: 'tw-detailActions' },
          h('div', { className: 'tw-detailHint' },
            props.dirty === true ? h('span', { className: 'tw-dirty' }, '有未保存修改') : null,
            props.dirty === true && effectHint ? ' · ' : null,
            effectHint,
          ),
          h('button', {
            className: 'tw-btn',
            disabled: props.busy || props.dirty !== true,
            onClick: props.onSave,
          }, '保存说明'),
        ),
      );
    }

    /**
     * 一个可折叠的分组卡片。整张卡包住标题与工具，标题行就是卡片头：
     * 左区（chevron+图标+标题+计数）整体是折叠按钮；MCP 组在最右另有一个
     * 服务器总开关，独立于折叠按钮 —— 两个热区互不误触。
     * 总开关写 servers.<名>.enabled，是「整台取消注册」的一层覆盖：
     * 关 = 该组一个不剩（引擎优先级最高）；开 = 底下逐条规则原样生效。
     */
    function ToolGroup(props) {
      var section = props.section;
      var roles = section.roles;
      var open = props.open === true;
      var hiddenCount = roles.filter(function (r) { return r.effective === 'drop'; }).length;
      var isMcp = section.group !== 'core';
      var serverName = isMcp ? section.group.replace(/^mcp:/, '') : undefined;
      // 总开关状态读 rules.disabledServers（引擎判定源），不是页面自己的推导
      var serverDisabled = isMcp && props.disabledServers.indexOf(serverName) >= 0;
      // 说明页半边的事实：最近一次组装里真的移除了该服务器的说明段才这么说，
      // 不拿配置推导冒充运行时事实（未连接/完整预设场景 removed 里没有它）。
      var instructions = props.instructions || { installed: false, removed: [] };
      var instructionsHidden = serverDisabled
        && (instructions.removed || []).indexOf(serverName) >= 0;
      // 说明页改写（0.6.0）：当前配置值、上次组装是否真的替换过
      var serverRewrites = props.serverRewrites || {};
      var currentRewrite = serverRewrites[serverName];
      var editing = isMcp && props.editingServer === serverName;

      return h('section', { className: 'tw-group' },
        h('div', { className: 'tw-groupHeader' },
          h('button', {
            type: 'button',
            className: 'tw-groupToggle',
            'aria-expanded': open,
            onClick: props.onToggleGroup,
          },
            h('span', { className: 'tw-groupLead' },
              chevron(open),
              isMcp ? h(ServerIcon) : h(FolderIcon),
              h('span', { className: 'tw-groupTitle' },
                isMcp ? 'MCP · ' + serverName : '内置工具'),
            ),
            h('span', { className: 'tw-groupMeta' },
              h('span', { className: 'tw-count' },
                serverDisabled
                  ? '已停用' + (instructionsHidden ? ' · 说明页已一并隐藏' : '')
                  : roles.length + ' 个' + (hiddenCount > 0 ? ' · ' + hiddenCount + ' 已隐藏' : '')),
            ),
          ),
          // 服务器总开关只出现在 MCP 组。全局停用时也禁用（写了也不生效）。
          isMcp
            ? h(Switch, {
              checked: !serverDisabled,
              disabled: props.busy,
              label: (serverDisabled ? '启用服务器 ' : '停用服务器 ') + serverName,
              onClick: function () { props.onToggleServer(serverName, serverDisabled); },
            })
            : null,
          // 「编辑」在最右、开关之后、仍在本行内：危险控件是开关，
          // 手往右偏落在无害的编辑上。必须是 header 最后一个子节点，且不在折叠按钮里。
          isMcp
            ? h('button', {
              type: 'button',
              className: 'tw-editServer',
              'aria-expanded': editing,
              'aria-label': '编辑服务器说明',
              title: '编辑服务器说明',
              disabled: props.busy,
              onClick: function () { props.onEditServer(serverName); },
            }, '编辑')
            : null,
        ),
        editing
          ? h(ServerDetail, {
            server: serverName,
            originalText: (props.serverTexts || {})[serverName],
            draft: props.serverDraft === undefined ? '' : props.serverDraft,
            dirty: (props.serverDraft === undefined ? '' : props.serverDraft) !== (currentRewrite === undefined ? '' : currentRewrite),
            busy: props.busy,
            disabled: serverDisabled,
            configured: currentRewrite !== undefined,
            applied: (props.rewrittenServers || []).indexOf(serverName) >= 0,
            onDraft: props.onServerDraft,
            onSave: props.onSaveServer,
            onCancel: props.onCancelServer,
          })
          : null,
        open
          ? h('div', { className: 'tw-list' },
            roles.map(function (role) {
              var expanded = props.expandedName === role.name;
              // 只配了参数改写（没有 description 字段）的条目，当前值是空字符串，
              // 不能直接 != undefined，否则一展开就报「有未保存修改」
              var entry = props.rewrites[role.name] || {};
              var currentDescription = entry.description === undefined ? '' : entry.description;
              return h('div', { key: role.name, className: 'tw-item' },
                h(ToolRow, {
                  role: role,
                  rewritten: props.rewrittenNames[role.name] === true,
                  busy: props.busy || serverDisabled,
                  serverDisabled: serverDisabled,
                  expanded: expanded,
                  onExpand: function () { props.onExpand(role.name); },
                  onToggle: function (effective) { props.onToggle(role.name, effective); },
                }),
                expanded
                  ? h(ToolDetail, {
                    role: role,
                    originalDescription: role.originalDescription,
                    draft: props.draft,
                    busy: props.busy,
                    dirty: props.draft !== currentDescription,
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
    function ToolKeeperView(props) {
      var data = props.data;
      var rewrites = data.rules.rewrites || {};
      var query = (props.query || '').trim().toLowerCase();
      // expanded 语义：「记录谁被手动展开了」。空 map = 全部折叠（默认态）。
      // 搜索时强制展开有匹配的组——否则结果全藏在折叠卡里，搜了等于白搜。
      var expanded = props.expanded || {};

      // 改写状态做成查表，不改入参对象
      var rewrittenNames = {};
      Object.keys(rewrites).forEach(function (name) {
        var entry = rewrites[name];
        if (entry !== undefined && entry.description !== undefined) rewrittenNames[name] = true;
      });

      var all = [];
      data.groups.forEach(function (g) { all = all.concat(g.roles); });

      // 开关状态一律读引擎判定（effective），不自己从 tools 推。
      // 从 tools 推会漏掉被服务器总开关丢掉的工具，把它们显示成「开」。
      var isHidden = function (role) { return role.effective === 'drop'; };

      var groups = data.groups.map(function (g) {
        if (query === '') return g;
        var matched = g.roles.filter(function (r) {
          return r.name.toLowerCase().indexOf(query) >= 0
            || g.group.toLowerCase().indexOf(query) >= 0;
        });
        return matched.length === 0 ? null : { group: g.group, roles: matched };
      }).filter(function (g) { return g !== null; });

      // 摘要必须描述「屏幕上的这些工具」，不是全量。
      // 搜索时还说「共 105 个」而屏幕上只有 2 行，就是自相矛盾。
      var visible = [];
      groups.forEach(function (g) { visible = visible.concat(g.roles); });
      var visibleHidden = visible.filter(isHidden);

      // 工具栏按钮按「当前是否全开」换文案：默认折叠 → 显示「展开」；
      // 全部展开 → 显示「折叠」。搜索态强制展开，按钮此时不参与判断。
      var searchOpen = query !== '';
      var allOpen = groups.length > 0 && groups.every(function (g) {
        return searchOpen || expanded[g.group] === true;
      });
      // 引擎判定的停用服务器集合（rules.disabledServers），头部总开关读它
      var disabledServers = data.rules.disabledServers || [];
      // 说明页改写三件套：配置值、原始文本、上次组装是否真的替换过。
      // 全部容缺省（旧快照 / 测试桩可能没有）。
      var serverEntries = data.rules.servers || {};
      var serverRewrites = {};
      Object.keys(serverEntries).forEach(function (n) {
        var e = serverEntries[n];
        // 纯空白不算改写（与 normalizeConfig 同口径），否则界面会把死键当配置显示
        if (e && typeof e.rewrite === 'string' && e.rewrite.trim() !== '') serverRewrites[n] = e.rewrite;
      });
      var serverTexts = (data.instructions && data.instructions.texts) || {};
      var rewrittenServers = (data.instructions && data.instructions.rewritten) || [];

      return h('div', { className: 'tw' },
        /* 插件级启停归 DSH 插件页；这里只显示拦截补丁是否装上 */
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
        props.notice !== null && props.notice !== undefined
          ? h('p', { className: 'tw-note' }, props.notice) : null,
        // stale 三态：true 磁盘内容与启动时不同 / false 一致 / null 无法判定。
        // 注意 stale===true 只说明「磁盘变了」，不说明「是你保存的」——文件被外部
        // 改坏也会走到这里。所以文案只说事实，不替用户编造「已保存」这个因果。
        data.stale === null || data.stale === undefined
          ? h('p', { className: 'tw-note', 'data-tone': 'warn' },
            '无法判断配置是否已生效：读不到磁盘上的配置。下面的内容取自内存里的启动状态。')
          : data.stale
            ? h('p', { className: 'tw-note', 'data-tone': 'warn' },
              '磁盘上的配置与当前生效的不同，重启 DSH 后才生效——在此之前，模型仍然能看见并使用这些工具与它们的说明页。')
            : null,

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
              onClick: function () { props.onToggleAll(!allOpen); },
            }, allOpen ? '折叠' : '展开'),
            h('button', {
              className: 'tw-btn',
              onClick: props.onReload, disabled: props.busy,
            }, '刷新'),
            h('button', {
              className: 'tw-btn',
              onClick: props.onExport, disabled: props.busy,
            }, '导出'),
            h('button', {
              className: 'tw-btn',
              onClick: props.onImport, disabled: props.busy,
            }, '导入'),
            // 隐藏的 file input：导入要走文件选择器，按钮只是它的代理
            h('input', {
              ref: props.importInputRef,
              type: 'file',
              accept: '.json,application/json',
              style: { display: 'none' },
              onChange: function (e) {
                var file = e.target.files && e.target.files[0];
                props.onImportFile(file);
                e.target.value = ''; // 允许连续导入同一个文件
              },
            }),
          ),
        ),

        /* 摘要：只报工具数量。搜索时跟着变，否则会和列表自相矛盾。 */
        h('p', { className: 'tw-summary' },
          (query === '' ? '共 ' : '筛选出 ') + visible.length + ' 个工具' +
          (query !== '' ? '（全部 ' + all.length + ' 个）' : ''),
          visibleHidden.length > 0
            ? ' · 已隐藏 ' + visibleHidden.length + ' 个'
            : null,
        ),
        h('div', { className: 'tw-divider' }),

        /* 分组卡片 */
        groups.length === 0
          ? h('p', { className: 'tw-status' },
            query !== ''
              ? '没有匹配「' + props.query + '」的工具。'
              // 空列表有两种完全不同的成因，说成一句话就是在骗人：
              // 补丁没装上是「重启多少次都不会有」，不是「重启后就有了」。
              : data.patched === false
                ? '拦截补丁没有装上，所以捕获不到任何工具。重启不会解决——请先看上面的原因。'
                : '还没有捕获到任何工具。如果刚启动，重启 DSH 后这里会列出全部工具。')
          : h('div', { className: 'tw-groups' },
            groups.map(function (g) {
              return h(ToolGroup, {
                key: g.group,
                section: g,
                rewrites: rewrites,
                rewrittenNames: rewrittenNames,
                busy: props.busy,
                disabledServers: disabledServers,
                instructions: data.instructions || { installed: false, removed: [] },
                open: searchOpen || expanded[g.group] === true,
                expandedName: props.expandedName,
                draft: props.draft,
                onToggleGroup: function () { props.onToggleGroup(g.group); },
                onToggleServer: props.onToggleServer,
                onExpand: props.onExpand,
                onDraft: props.onDraft,
                onToggle: props.onToggle,
                onSaveRewrite: props.onSaveRewrite,
                serverRewrites: serverRewrites,
                serverTexts: serverTexts,
                rewrittenServers: rewrittenServers,
                editingServer: props.editingServer,
                serverDraft: props.serverDraft,
                onEditServer: props.onEditServer,
                onServerDraft: props.onServerDraft,
                onSaveServer: props.onSaveServer,
                onCancelServer: props.onCancelServer,
              });
            })),

        /* 底部：危险操作 + 本页唯一的规则说明 */
        h('div', { className: 'tw-footer' },
          h('button', {
            className: 'tw-btn', 'data-kind': 'danger',
            onClick: props.onReset, disabled: props.busy,
          }, '恢复出厂'),
          h('p', { className: 'tw-footerNote' },
            '清空全部规则，所有工具回到默认开启。标「受保护」的工具任何配置都关不掉。'),
        ),
      );
    }

    /** 容器：取数、管状态。 */
    function Section() {
      var s0 = React.useState(null); var data = s0[0]; var setData = s0[1];
      var s1 = React.useState(null); var error = s1[0]; var setError = s1[1];
      var s2 = React.useState(false); var busy = s2[0]; var setBusy = s2[1];
      var s4 = React.useState(null); var expandedName = s4[0]; var setExpandedName = s4[1];
      var s5 = React.useState(''); var draft = s5[0]; var setDraft = s5[1];
      var s6 = React.useState({}); var expandedGroups = s6[0]; var setExpandedGroups = s6[1];
      var s7 = React.useState(''); var query = s7[0]; var setQuery = s7[1];
      var s8 = React.useState(null); var notice = s8[0]; var setNotice = s8[1];
      var s9 = React.useState(null); var editingServer = s9[0]; var setEditingServer = s9[1];
      var s10 = React.useState(''); var serverDraft = s10[0]; var setServerDraft = s10[1];
      var importInputRef = React.useRef(null);

      var load = React.useCallback(function () {
        setError(null);
        call({ op: 'state' }).then(function (payload) { setData(payload); })
          .catch(function (e) { setError(e.message); });
      }, []);

      React.useEffect(function () { load(); }, [load]);

      if (data === null) {
        return h('div', { className: 'tw' },
          error === null
            ? h('p', { className: 'tw-status' }, '读取中…')
            : h('div', null,
              h('p', { className: 'tw-note', 'data-tone': 'bad' }, '无法读取状态：' + error),
              h('div', null, h('button', { className: 'tw-btn', onClick: load }, '重试'))),
        );
      }

      var tools = data.rules.tools || {};
      var rewrites = data.rules.rewrites || {};
      var servers = data.rules.servers || {};

      /** 打开/收起某台服务器的说明页编辑面板。打开时草稿 = 当前改写值。 */
      function onEditServer(server) {
        if (editingServer === server) { setEditingServer(null); setServerDraft(''); return; }
        setEditingServer(server);
        var entry = servers[server] || {};
        setServerDraft(typeof entry.rewrite === 'string' ? entry.rewrite : '');
      }

      /** 保存服务器说明页改写：只动 servers 条目的 rewrite 字段。 */
      function onSaveServer() {
        if (editingServer === null) return;
        var next = nextServersAfterRewrite(servers, editingServer, serverDraft);
        setBusy(true); setError(null);
        call({ op: 'set', servers: next }).then(function () {
          return call({ op: 'state' });
        }).then(function (next2) {
          setData(next2); setEditingServer(null); setServerDraft('');
        }).catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onCancelServer() { setEditingServer(null); setServerDraft(''); }

      function persist(nextTools, done) {
        setBusy(true); setError(null);
        call({ op: 'set', tools: nextTools }).then(function () {
          return call({ op: 'state' });
        }).then(function (next) { setData(next); if (done) done(); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      /**
       * 切换一个工具。`effective` 是点击时引擎的判定，不是配置里的条目。
       * 决策本身在 nextToolsAfterToggle 里，那部分是纯函数、可单测。
       */
      function onToggle(name, effective) {
        persist(nextToolsAfterToggle(tools, name, effective));
      }

      /** 全开/全折叠：全开 = 表里记满所有组；全折叠 = 清空表回默认态。 */
      function onToggleAll(shouldOpen) {
        var next = {};
        if (shouldOpen) {
          data.groups.forEach(function (g) { next[g.group] = true; });
        }
        setExpandedGroups(next);
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
          return call({ op: 'state' });
        }).then(function (next2) {
          setData(next2); setExpandedName(null); setDraft('');
        }).catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      /** 导出：取磁盘上的配置，落成一个带时间戳的本地文件。 */
      function onExport() {
        setBusy(true); setError(null);
        call({ op: 'export' }).then(function (payload) {
          var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          var blob = new Blob([JSON.stringify(payload.config, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'tool-keeper-config-' + stamp + '.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }).catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      /** 导入按钮只是打开文件选择器；真正的导入在 onImportFile 里。 */
      function onImport() {
        if (importInputRef.current) importInputRef.current.click();
      }

      /**
       * 导入是整份替换。先本地解析 JSON（fail fast，省一次往返），
       * 再交给服务端校验落盘 —— 服务端会先备份再校验，坏配置不会进来。
       * 成功后显示备份文件名：用户要回退时知道去哪找。
       */
      function onImportFile(file) {
        if (!file) return;
        setBusy(true); setError(null); setNotice(null);
        file.text().then(function (text) {
          var parsed = JSON.parse(text); // 解析失败直接进 catch，报给用户
          return call({ op: 'import', config: parsed });
        }).then(function (result) {
          setNotice('导入成功' + (result && result.backup
            ? '，旧配置已备份为 ' + String(result.backup).split(/[\\/]/).pop()
            : '') + '。重启 DSH 后生效。');
          return call({ op: 'state' });
        }).then(function (next) { setData(next); })
          .catch(function (e) { setError('导入失败：' + e.message); })
          .then(function () { setBusy(false); });
      }


      function onReset() {
        setBusy(true); setError(null);
        call({ op: 'reset' }).then(function () {
          return call({ op: 'state' });
        }).then(function (next) { setData(next); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onToggleGroup(group) {
        var next = Object.assign({}, expandedGroups);
        if (next[group] === true) delete next[group]; else next[group] = true;
        setExpandedGroups(next);
      }

      /**
       * 服务器总开关：写 servers.<名>.enabled 的整块替换。
       * 关 = enabled:false（整台取消注册，逐条规则不动）；
       * 开 = 删掉 enabled 字段，条目里其它字段（rewrite）原样保留。
       */
      function onToggleServer(server, currentlyDisabled) {
        var next = Object.assign({}, data.rules.servers || {});
        var entry = Object.assign({}, next[server] || {});
        if (currentlyDisabled) delete entry.enabled;
        else entry.enabled = false;
        // 空条目不落盘（baseline 是全空，别替用户留空壳）。
        // 两个字段都要看：只看 enabled 会把带 rewrite 的条目一起删掉，
        // 等于开一次服务器就丢掉它的说明页改写。
        if (entry.enabled === undefined && entry.rewrite === undefined) delete next[server];
        else next[server] = entry;
        setBusy(true); setError(null);
        call({ op: 'set', servers: next }).then(function () {
          return call({ op: 'state' });
        }).then(function (next2) { setData(next2); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      return h(ToolKeeperView, {
        data: data,
        busy: busy,
        error: error,
        expandedName: expandedName,
        draft: draft,
        query: query,
        expanded: expandedGroups,
        onQuery: setQuery,
        onToggleGroup: onToggleGroup,
        onToggleServer: onToggleServer,
        editingServer: editingServer,
        serverDraft: serverDraft,
        onEditServer: onEditServer,
        onServerDraft: setServerDraft,
        onSaveServer: onSaveServer,
        onCancelServer: onCancelServer,
        onToggleAll: onToggleAll,
        onExpand: onExpand,
        onDraft: setDraft,
        onToggle: onToggle,
        onSaveRewrite: onSaveRewrite,
        onReset: onReset,
        onReload: load,
        onExport: onExport,
        onImport: onImport,
        onImportFile: onImportFile,
        notice: notice,
        importInputRef: importInputRef,
      });
    }

    function apply(ctx) {
      if (typeof document !== 'undefined' && ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') !== null) {
            return function () {};
          }
          var tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-tool-keeper-ui';
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
          id: 'tool-keeper',
          // 50：排在「归档会话」(45) 之后、草稿工作室(60) 之前。
          // 不能用 60——那和 dsh-draft-studio 撞号，导航里的相对顺序会不稳定。
          order: 50,
          label: function () { return '工具管理'; },
          inject: function () { return {}; },
        }, Section);
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    exports.__testing = {
      nextToolsAfterToggle: nextToolsAfterToggle,
      nextServersAfterRewrite: nextServersAfterRewrite,
      View: ToolKeeperView,
      Section: Section,
      CSS: CSS,
    };
    return module.exports;
  },
});
