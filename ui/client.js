/**
 * Toolwarden 设置页 —— 浏览器半。
 *
 * 装载协议与官方 bundle 相同：window.__ModuleLoader__.load({ id, factory })。
 * 数据只走 /toolwarden/api 的 op：state / set / reset。
 *
 * ## 页面纪律（抄 dsh-enhance 的成文规矩）
 *
 * 1. 一屏只说明一件事：工具占了多少上下文，关掉哪些。
 * 2. 每个控件只说一次后果，不重复。
 * 3. 纯宿主样式：颜色/圆角/字号走 --dsw-alias-* token，不画页面底色、不换字体族。
 * 4. 只画真实能力：改完需要重启就明说，不做假按钮。
 * 5. 出厂不做任何管理——所以首屏的常态是「全部工具都开着」，这是对的，不是坏了。
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
      '.tw{max-width:720px;font-size:14px;line-height:22px;}',
      '.tw h2{font-size:16px;line-height:24px;margin:0 0 4px;font-weight:600;}',
      '.tw .tw-sub{color:var(--dsw-alias-text-secondary);margin:0 0 16px;}',
      '.tw .tw-sec{border-top:0.5px solid var(--dsw-alias-border);padding:12px 0;}',
      '.tw .tw-sec:first-of-type{border-top:0;}',
      '.tw .tw-row{display:flex;align-items:center;gap:8px;min-height:28px;}',
      '.tw .tw-name{flex:1;font-family:ui-monospace,monospace;font-size:13px;}',
      '.tw .tw-chars{color:var(--dsw-alias-text-secondary);font-size:12px;min-width:88px;text-align:right;}',
      '.tw .tw-tag{font-size:11px;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-bg-tint);color:var(--dsw-alias-text-secondary);}',
      '.tw .tw-grouphead{display:flex;align-items:center;gap:8px;margin:8px 0 4px;font-weight:600;}',
      '.tw .tw-grouphead .tw-count{color:var(--dsw-alias-text-secondary);font-weight:400;font-size:12px;}',
      '.tw button{font:inherit;padding:3px 10px;border-radius:6px;border:0.5px solid var(--dsw-alias-border);background:var(--dsw-alias-bg);color:inherit;cursor:pointer;}',
      '.tw button:hover{background:var(--dsw-alias-bg-tint);}',
      '.tw button:disabled{opacity:.5;cursor:not-allowed;}',
      '.tw .tw-note{margin-top:8px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-tint);font-size:12px;}',
      '.tw .tw-warn{background:var(--dsw-alias-bg-warning-tint,rgba(255,180,0,.12));}',
      '.tw .tw-err{background:var(--dsw-alias-bg-danger-tint,rgba(255,80,80,.12));}',
      '.tw .tw-empty{color:var(--dsw-alias-text-secondary);padding:12px 0;}',
      '.tw .tw-stat{display:flex;gap:24px;margin:8px 0 12px;}',
      '.tw .tw-stat div{display:flex;flex-direction:column;}',
      '.tw .tw-stat b{font-size:20px;line-height:26px;font-weight:600;}',
      '.tw .tw-stat span{font-size:12px;color:var(--dsw-alias-text-secondary);}',
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

    /** 字节 → 人读的 token 估算（口径：字符 ÷ 3.5，与文档一致） */
    function estimateTokens(chars) {
      return Math.round(chars / 3.5);
    }

    function formatNumber(n) {
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ---------------------------------------------------------------- 组件

    function ToolRow(props) {
      const { role, state, onToggle, busy } = props;
      // state: 'keep' | 'drop'
      const dropped = state === 'drop';
      return h('div', { className: 'tw-row' },
        h('span', { className: 'tw-name' }, role.name),
        role.protected ? h('span', { className: 'tw-tag' }, '受保护') : null,
        h('span', { className: 'tw-chars' }, formatNumber(role.chars) + ' 字符'),
        h('button', {
          disabled: role.protected || busy,
          title: role.protected ? '基础工具，任何配置都关不掉' : (dropped ? '点击恢复' : '点击隐藏'),
          onClick: function () { onToggle(role.name, dropped ? 'keep' : 'drop'); },
        }, role.protected ? '不可关' : (dropped ? '已隐藏' : '隐藏')),
      );
    }

    function GroupBlock(props) {
      const { group, roles, tools, onToggle, busy } = props;
      const totalChars = roles.reduce(function (n, r) { return n + r.chars; }, 0);
      const hiddenCount = roles.filter(function (r) { return tools[r.name] === 'drop' || (r.server && group === 'mcp:' + r.server && false); }).length;

      return h('div', { className: 'tw-sec' },
        h('div', { className: 'tw-grouphead' },
          h('span', null, group === 'core' ? '内置工具' : 'MCP · ' + group.replace(/^mcp:/, '')),
          h('span', { className: 'tw-count' },
            roles.length + ' 个 · ' + formatNumber(totalChars) + ' 字符 · ≈' +
            formatNumber(estimateTokens(totalChars)) + ' tokens'),
        ),
        roles.map(function (role) {
          return h(ToolRow, {
            key: role.name,
            role: role,
            state: tools[role.name] === 'drop' ? 'drop' : 'keep',
            onToggle: onToggle,
            busy: busy,
          });
        }),
      );
    }

    function Section() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [dirty, setDirty] = React.useState(false);

      const load = React.useCallback(function () {
        setError(null);
        call({ op: 'state' }).then(function (payload) {
          setData(payload);
          setDirty(false);
        }).catch(function (e) { setError(e.message); });
      }, []);

      React.useEffect(function () { load(); }, [load]);

      if (error !== null) {
        return h('div', { className: 'tw' },
          h('h2', null, '工具守卫'),
          h('div', { className: 'tw-note tw-err' }, '无法读取状态：' + error),
          h('div', { className: 'tw-row' }, h('button', { onClick: load }, '重试')),
        );
      }
      if (data === null) {
        return h('div', { className: 'tw' }, h('h2', null, '工具守卫'), h('div', { className: 'tw-empty' }, '读取中…'));
      }

      const tools = data.rules.tools || {};
      const totalChars = data.groups.reduce(function (n, g) {
        return n + g.roles.reduce(function (m, r) { return m + r.chars; }, 0);
      }, 0);
      const hiddenCount = Object.keys(tools).filter(function (k) { return tools[k] === 'drop'; }).length;

      function persist(nextTools) {
        setBusy(true);
        setError(null);
        call({ op: 'set', tools: nextTools }).then(function () {
          setDirty(true);
          return call({ op: 'state' });
        }).then(function (payload) {
          setData(payload);
        }).catch(function (e) { setError(e.message); })
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
        call({ op: 'reset' }).then(function () { setDirty(true); return call({ op: 'state' }); })
          .then(function (payload) { setData(payload); })
          .catch(function (e) { setError(e.message); })
          .then(function () { setBusy(false); });
      }

      return h('div', { className: 'tw' },
        h('h2', null, '工具守卫'),
        h('p', { className: 'tw-sub' },
          '决定哪些工具进入模型的上下文。出厂状态不管理任何工具——全部原样。'),

        h('div', { className: 'tw-stat' },
          h('div', null, h('b', null, String(data.groups.reduce(function (n, g) { return n + g.roles.length; }, 0))), h('span', null, '个工具')),
          h('div', null, h('b', null, '≈' + formatNumber(estimateTokens(totalChars))), h('span', null, 'tokens/轮（估算）')),
          h('div', null, h('b', null, String(hiddenCount)), h('span', null, '个已隐藏')),
        ),

        data.patched === false
          ? h('div', { className: 'tw-note tw-err' },
            '拦截补丁未安装：' + (data.reason || '未知原因') + '。当前配置不会生效。')
          : null,

        (data.problems && data.problems.length > 0)
          ? h('div', { className: 'tw-note tw-err' }, '配置问题：' + data.problems.join('；'))
          : null,

        (data.diagnostics && data.diagnostics.length > 0)
          ? h('div', { className: 'tw-note tw-warn' },
            '诊断：' + data.diagnostics.map(function (d) { return d.target + ' ' + d.message; }).join('；'))
          : null,

        error !== null ? h('div', { className: 'tw-note tw-err' }, error) : null,

        busy ? h('div', { className: 'tw-note' }, '保存中…') : null,
        dirty ? h('div', { className: 'tw-note tw-warn' }, '已保存。重启 DSH 后生效。') : null,

        h('div', { style: { marginTop: '12px' } },
          h('button', { onClick: onReset, disabled: busy }, '恢复出厂（全部放行）'),
          h('button', {
            onClick: load, disabled: busy, style: { marginLeft: '8px' },
          }, '刷新'),
        ),

        data.groups.map(function (g) {
          return h(GroupBlock, {
            key: g.group,
            group: g.group,
            roles: g.roles,
            tools: tools,
            onToggle: onToggle,
            busy: busy,
          });
        }),
      );
    }

    function apply(ctx) {
      // CSS 挂载：Node 测试里没有 document，守卫必要
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
    exports.__testing = { estimateTokens: estimateTokens, formatNumber: formatNumber };
    return module.exports;
  },
});
