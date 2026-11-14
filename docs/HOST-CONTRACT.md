# DSH 接口事实

这个文件记录**「DSH 到底长什么样」**，每一条都带出处。
改代码之前核对这里，不要凭印象，也不要凭上游文档——文档可能落后于实际运行版本。

查证版本：`0.2.2-rc.2`。
授权的查询方式是 `cordis_inspect_query`（权威源），文档副本在 plugin-kit 包的 `host-skills/dsh-doc/`。

---

## 工具注册

| 事实 | 结论 | 出处 |
|---|---|---|
| MCP 工具和内置工具是不是同一个入口 | 是，都走 `ctx.tools.register(definition)` | `dsh-mcp-client/src/tools.ts:176-178` |
| `description` 什么时候固定下来 | 构造 definition 时，不是每次读取时 | `dsh-mcp-client/src/tools.ts:257-260` |
| 模型看到的 schema 从哪来 | `projectToolSchema()` 从 definition 投影 | `dsh-tools/src/schema.ts:641-646` |

**推论**：想在模型看到的文字上做手脚，只有注册期这一次机会。

---

## `restrict()`

| 事实 | 结论 | 出处 |
|---|---|---|
| 能改工具说明吗 | 不能，只能移除 | `practices.md:10,17` |
| 作用域要求 | 读 `scopeOf(this.ctx)`，必须挂成 agent 作用域的子插件 | `dsh-tools/src/index.ts:163-166` |
| 传入不认识的名字 | 抛错 | `dsh-tools/src/index.ts:179-183` |
| 变更通知时机 | 同步发出 `tools/change` | `dsh-scope/src/store.ts:257-262` |

**为什么本项目不用它**：见 [DESIGN.md](./DESIGN.md) 第一、六节。

---

## 浏览器半（设置页）

| 事实 | 结论 |
|---|---|
| 模块形态 | `window.__ModuleLoader__.load({ id, factory })`，**不能有 ESM 的 export / import** |
| 为什么不能有 | 宿主把所有插件的 client.js 拼成一个大脚本加载，一个坏插件会让整个 web 起不来 |
| 包怎么被发现 | 只认「包的精确包名」或「路径里最近的 package.json」 |
| 所以要怎么做 | `ui/` 目录下必须有独立的 `package.json`，声明 `dsh.client.platform: "web"` 和 `exports["./client"]` |
| CSS 怎么挂 | 自己创建 `<style>` 标签塞进 `document.head`，并在 effect 的清理函数里移除 |
| 客户端取数 | `fetch('/<插件>/api', { method:'POST', body: JSON.stringify(...) })` |

出处：本机 `dsh-enhance` 与 `dsh-archive-manager` 的实现，两者都是已上架插件。

### 主题 token

所有颜色、圆角、字体必须用宿主的 CSS 变量，不能写死色值。可用的变量用
`cordis_inspect_query` 的 `Theme.listTokens` 查。

有两个容易搞错的：

- 字体族是 `--dsw-font-family`（界面）和 `--ds-font-family-code`（等宽）。
  后者是 `--ds-` 开头不是 `--dsw-`，**看着像笔误但是真的**。
- 行间分隔用 `.5px solid` 而不是 `1px`，这是宿主的视觉刻度。

---

## `settings.section`

注册方式：

```js
ctx.slots.inject('settings.section', function () {
  return ctx.slots.register({ id: 'tool-keeper', order: 50, label: () => 'Tool Keeper' }, Component);
});
```

| 事实 | 结论 |
|---|---|
| `id` | 自己的键。用已存在的 id 会**替换**那个条目，不是并列 |
| `order` | 导航里的位置，升序 |
| `label` | 可以是函数，每次投影都会重新读，所以能跟随语言切换 |
| 收到什么 props | `{ close }`，只能关掉设置面板 |

### 当前位置占用情况

改 `order` 之前先看这张表，撞号会让导航顺序不稳定（相同 order 谁先谁后是未定义的）。

```
0    general          10   models         15   plugins
20   agent-presets    30   enhance        40   market
45   archive-manager  50   tool-keeper    60   dsh-draft-studio
440  xdpool
```

本插件取 `50`。原先是 `60`，跟 `dsh-draft-studio` 撞了，改掉的。

---

## HTTP 路由

```js
ctx.inject(['webServer'], (inner) => {
  ctx.effect(() => inner.webServer.register({
    kind: 'exact',
    path: '/tool-keeper/api',
    handler: async (req, res) => { /* ... */ },
  }));
});
```

| 事实 | 结论 |
|---|---|
| 为什么用 `ctx.inject` 而不是写进 `inject` 数组 | headless 下没有 `webServer`，写进 `inject` 会让插件永远 pending，宿主判定 web 启动失败 |
| 没有 `webServer` 时怎么办 | 检查 `typeof web.register === 'function'`，没有就只记日志，不影响插件其余功能 |
| 未知路径返回什么 | **405**（不是 404）。所以「405」不代表路由存在 |

最后一条踩过坑：验证改名时探测旧路由得到 405，一度以为是残留。
拿一个明确不存在的路径对照，同样返回 405，才确认是宿主的默认响应。

---

## 插件形态

| 事实 | 结论 |
|---|---|
| `package.json` 里怎么声明 | `dsh.bundle.patch` 指向 patch 文件 |
| `index.js` 要导出什么 | `name`、`inject`、`apply` |
| `Config` 能导出普通对象吗 | **不能**。会报 `Cannot read properties of undefined (reading 'validate')` |
| 想用配置怎么办 | 用 schemastery 的 `Schema.object(...)`，或者干脆不导出 Config，自己读独立配置文件（本项目选了后者） |
| 两个插件间的关系 | 所有插件共享同一个 Cordis 容器与作用域树 |

### patch 里 `name` 有两种写法，规则不同

这一点容易搞错，本项目两行都用到了：

| 用途 | patch 里的 `name` | 解析规则 |
|---|---|---|
| 宿主半（`index.js`） | 包名 `dsh-tool-keeper` | **必须与 `package.json` 的 `name` 逐字一致** |
| 浏览器半（`ui/`） | 相对路径 `./ui/index.js` | 相对**本包目录**解析，指向一个**自己的 `package.json`** |

浏览器半之所以要独立成一个包（`ui/package.json` 声明 `dsh.client.platform: "web"` + `exports["./client"]`），
是因为宿主的浏览器半发现机制只认「包的精确包名」或「路径里最近的 `package.json`」——
裸子路径会被当成非包直接跳过。

所以「entry name 必须等于包名」只对宿主半那一行成立，**浏览器半那行写的是路径**。

---

## 宿主的失败模式

这些是查证过的，不是猜的：

| 操作 | 结果 |
|---|---|
| `ctx.get('tools')` 服务不存在 | 返回 `undefined` |
| 服务被 `Object.freeze` | `Reflect.set` 静默失败，赋值后比较能发现 |
| 属性是只读 getter | `Reflect.set` 抛错 |
| 不带 `Origin` 头访问本地接口 | 正常收到（非浏览器调用） |
| 跨源访问 | 应由插件自己拒绝 |

最后一条是本插件自己实现的行为，不是宿主的。见 `api.js` 的 `sameOrigin()`。
