/**
 * Toolwarden 设置页 —— 浏览器半。
 *
 * 装载协议与官方 bundle 相同：window.__ModuleLoader__.load({ id, factory })。
 * 数据只走 /toolwarden/api 的 op：state / set / reset。
 *
 * ## 排版刻度（对齐宿主设置页，参照本机 dsh-enhance 的实现）
 *
 *   标题    16/24  weight 500   label-primary
 *   行标题  14/22  weight 400   label-primary
 *   说明    12/18               label-tertiary
 *   现状    12/18  nowrap       label-secondary，按状态着色
 *   分组    .5px solid 发丝线分隔，组间 16px
 *   宽度    720px 上限
 *   控件    宿主 switch / segmented，不自己画按钮外观
 *
 * ## 页面纪律
 *
 * 1. 一个控件只说一次后果。
 * 2. 只画真实能力：要重启就说要重启。没有的按钮不画。
 * 3. 数字要可核对：字符数来自 catalog 的原始定义，token 是估算且标注。
 * 4. 保护工具不显示开关——画一个必然点不动的开关是骗人。
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

    // 刻度直接对齐宿主：字号/行高/间距/描边都走 token，不写字面色值。
    var CSS = [
      '.tw{display:flex;flex-direction:column;gap:12px;width:100%;max-width:720px;padding:4px 0 24px;box-sizing:border-box;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}',

      // ── 页头 ──
      '.tw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}',
      '.tw-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.tw-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}',
      '.tw-pill{flex:none;font-size:12px;line-height:16px;padding:2px 8px;border-radius:var(--dsw-radius-xs);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tw-pill[data-tone=ok]{color:var(--dsw-alias-state-success-primary);border-color:currentColor}',
      '.tw-pill[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}',
      '.tw-pill[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',

      // ── 概览条 ──
      '.tw-stats{display:flex;flex-wrap:wrap;gap:28px;padding:12px 0}',
      '.tw-stat{display:flex;flex-direction:column;gap:2px;min-width:88px}',
      '.tw-stat-num{font-size:20px;line-height:26px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.tw-stat-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',

      // ── 分组 ──
      '.tw-group{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.tw-group+.tw-group{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:16px}',
      '.tw-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0}',
      '.tw-h3{margin:0;font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary)}',
      '.tw-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.tw-now{flex:none;font-size:12px;line-height:18px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.tw-now[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}',
      '.tw-now[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',

      // ── 工具清单 ──
      '.tw-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
      '.tw-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px}',
      '.tw-item:first-child{border-top:0}',
      '.tw-item[data-hidden=true] .tw-name{color:var(--dsw-alias-label-tertiary)}',
      '.tw-name{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.tw-protected{font-size:11px;line-height:16px;padding:1px 6px;border-radius:var(--dsw-radius-xs);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

      // ── 开关（照宿主 switch 的形态）──
      '.tw-switch{display:inline-flex;align-items:center;gap:8px;flex:none;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:none;border:none;padding:0;cursor:pointer}',
      '.tw-switch:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.tw-track{width:30px;height:16px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-border-l2);position:relative;flex:none;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}',
      '.tw-switch[aria-checked=true] .tw-track{background:var(--dsw-alias-state-success-primary)}',
      '.tw-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}',
      '.tw-switch[aria-checked=true] .tw-knob{transform:translateX(14px)}',

      // ── 按钮 ──
      '.tw-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.tw-btn{font:inherit;font-size:13px;line-height:20px;padding:4px 12px;min-width:72px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}',
      '.tw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.tw-btn[data-kind=danger]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',
      '.tw-btn:disabled{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:none;cursor:default}',

      // ── 提示与诊断 ──
      '.tw-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding:2px 0 2px 12px;overflow-wrap:anywhere}',
      '.tw-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-left-color:currentColor}',
      '.tw-note[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-left-color:currentColor}',
      '.tw-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:8px 0}',

      // ── 焦点环：与宿主设置页同一套 token ──
      '.tw-switch:focus-visible,.tw-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
      '@media (prefers-reduced-motion: reduce){.tw-track,.tw-knob,.tw-btn{transition:none}}',
    ].join('\n');

    function call(body) {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || (payload && typeof payload.code === 'string')) {
            const error = new Error((payload && payload.message) || 'HTTP ' + response.status);
            error.code = payload && payload.code;
            throw error;
          }
          return payload;
        });
      });
    }

    /** 字符 → token 估算。口径：字符 ÷ 3.5，界面上必须标「估算」。 */
    function estimateTokens(chars) {
      return Math.round(chars / 3.5);
    }

    function num(n) {
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** 开关。状态未知不画成「关」——那是在撒谎。 */
    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'tw-switch',
        role: 'switch',
        'aria-checked': props.checked === true,
        disabled: props.disabled === true,
        title: props.title,
        onClick: props.onClick,
      },
        h('span', { className: 'tw-track' }, h('span', { className: 'tw-knob' })),
        props.label === undefined ? null : h('span', null, props.label),
      );
    }

    function ToolItem(props) {
      const { role, hidden, busy, onToggle } = props;
      return h('li', { className: 'tw-item', 'data-hidden': hidden === true },
        h('span', { className: 'tw-name', title: role.name }, role.name),
        h('span', { className: 'tw-meta' }, num(role.chars) + ' 字符'),
        role.protected
          // 受保护工具不画开关：画一个必然点不动的开关是骗人
          ? h('span', { className: 'tw-protected' }, '基础工具')
          : h(Switch, {
            checked: hidden !== true,
            disabled: busy,
            title: hidden === true ? '当前不进入上下文，点击启用' : '当前进入上下文，点击隐藏',
            onClick: function () { onToggle(role.name, hidden === true ? 'keep' : 'drop'); },
          }),
      );
    }

    function Group(props) {
      const { group, roles, tools, busy, onToggle } = props;
      const chars = roles.reduce(function (n, r) { return n + r.chars; }, 0);
      const hiddenCount = roles.filter(function (r) { return tools[r.name] === 'drop'; }).length;
      const label = group === 'core' ? '内置工具' : 'MCP · ' + group.replace(/^mcp:/, '');
      const allHidden = hiddenCount === roles.length && roles.length > 0;

      return h('section', { className: 'tw-group' },
        h('div', { className: 'tw-row-head' },
          h('div', { style: { minWidth: 0 } },
            h('h3', { className: 'tw-h3' }, label),
            h('p', { className: 'tw-sub' },
              roles.length + ' 个工具 · ' + num(chars) + ' 字符 · ≈' + num(estimateTokens(chars)) + ' tokens'),
          ),
          h('span', {
            className: 'tw-now',
            'data-tone': hiddenCount === 0 ? undefined : (allHidden ? 'warn' : undefined),
          }, hiddenCount === 0 ? '全部启用' : hiddenCount + ' 个已隐藏'),
        ),
        h('ul', { className: 'tw-list' }, roles.map(function (role) {
          return h(ToolItem, {
            key: role.name,
            role: role,
            hidden: tools[role.name] === 'drop',
            busy: busy,
            onToggle: onToggle,
          });
        })),
      );
    }

    function Section() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [pending, setPending] = React.useState(false);

      const load = React.useCallback(function () {
        setError(null);
        call({ op: 'state' }).then(function (payload) {
          setData(payload);
        }).catch(function (e) { setError(e.message); });
      }, []);

      React.useEffect(function () { load(); }, [load]);

      if (data === null) {
        return h('div', { className: 'tw' },
          h('div', { className: 'tw-head' }, h('h2', { className: 'tw-title' }, '工具守卫')),
          error === null
            ? h('p', { className: 'tw-empty' }, '读取中…')
            : h('div', null,
              h('p', { className: 'tw-note', 'data-tone': 'bad' }, '无法读取状态：' + error),
              h('div', { className: 'tw-actions' }, h('button', { className: 'tw-btn', onClick: load }, '重试')),
            ),
        );
      }

      const tools = data.rules.tools || {};
      const allRoles = data.groups.reduce(function (a, g) { return a.concat(g.roles); }, []);
      const chars = allRoles.reduce(function (n, r) { return n + r.chars; }, 0);
      const hiddenCount = allRoles.filter(function (r) { return tools[r.name] === 'drop'; }).length;
      const savedChars = allRoles.filter(function (r) { return tools[r.name] === 'drop'; })
        .reduce(function (n, r) { return n + r.chars; }, 0);

      function persist(nextTools) {
        setBusy(true);
        setError(null);
        call({ op: 'set', tools: nextTools }).then(function () {
          setPending(true);
          return call({ op: 'state' });
        }).then(function (payload) { setData(payload); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      function onToggle(name, state) {
        const next = Object.assign({}, tools);
        if (state === 'drop') next[name] = 'drop';
        else delete next[name];
        persist(next);
      }

      function onReset() {
        setBusy(true);
        setError(null);
        call({ op: 'reset' }).then(function () {
          setPending(true);
          return call({ op: 'state' });
        }).then(function (payload) { setData(payload); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      return h('div', { className: 'tw' },
        // ── 页头：标题 + 右上现状 ──
        h('div', { className: 'tw-head' },
          h('div', { style: { minWidth: 0 } },
            h('h2', { className: 'tw-title' }, '工具守卫'),
            h('p', { className: 'tw-intro' },
              '决定哪些工具进入模型的上下文。关掉当前用不到的工具，让每轮请求少带一些 schema。'),
          ),
          h('span', {
            className: 'tw-pill',
            'data-tone': data.patched === false ? 'bad' : (hiddenCount > 0 ? 'ok' : undefined),
          }, data.patched === false ? '未生效' : (hiddenCount > 0 ? '已启用' : '出厂状态')),
        ),

        // ── 概览 ──
        h('div', { className: 'tw-stats' },
          h('div', { className: 'tw-stat' },
            h('span', { className: 'tw-stat-num' }, String(allRoles.length)),
            h('span', { className: 'tw-stat-label' }, '个工具')),
          h('div', { className: 'tw-stat' },
            h('span', { className: 'tw-stat-num' }, '≈' + num(estimateTokens(chars))),
            h('span', { className: 'tw-stat-label' }, 'tokens / 轮（估算）')),
          h('div', { className: 'tw-stat' },
            h('span', { className: 'tw-stat-num' }, String(hiddenCount)),
            h('span', { className: 'tw-stat-label' }, '个已隐藏')),
          h('div', { className: 'tw-stat' },
            h('span', { className: 'tw-stat-num' }, '≈' + num(estimateTokens(savedChars))),
            h('span', { className: 'tw-stat-label' }, '节省 / 轮（估算）')),
        ),

        // ── 状态与诊断 ──
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
        error !== null ? h('p', { className: 'tw-note', 'data-tone': 'bad' }, error) : null,
        pending
          ? h('p', { className: 'tw-note', 'data-tone': 'warn' }, '已保存到配置。重启 DSH 后对新注册的工具生效。')
          : null,

        // ── 操作 ──
        h('div', { className: 'tw-actions' },
          h('button', { className: 'tw-btn', onClick: onReset, disabled: busy, 'data-kind': 'danger' },
            '恢复出厂'),
          h('button', { className: 'tw-btn', onClick: load, disabled: busy }, busy ? '处理中…' : '刷新'),
        ),

        // ── 工具分组 ──
        data.groups.length === 0
          ? h('p', { className: 'tw-empty' }, '还没有捕获到任何工具。重启 DSH 后这里会列出全部工具。')
          : data.groups.map(function (g) {
            return h(Group, {
              key: g.group,
              group: g.group,
              roles: g.roles,
              tools: tools,
              busy: busy,
              onToggle: onToggle,
            });
          }),

        h('p', { className: 'tw-note' },
          '出厂状态不隐藏任何工具。受保护的基础工具（read / write / edit / pwsh 等）任何配置都关不掉。'),
      );
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
    exports.__testing = { estimateTokens: estimateTokens, num: num };
    return module.exports;
  },
});
