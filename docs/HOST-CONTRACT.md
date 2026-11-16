# DSH 接口事实

这个文件记录「DSH 到底长什么样」，每条带出处。改代码前核对这里，不要凭印象，也不只信上游文档——文档可能落后于实际运行版本。

查证版本：`0.2.2-rc.3`。授权的查询方式是 `cordis_inspect_query`（权威源），文档副本在 plugin-kit 包的 `host-skills/dsh-doc/`。逐条触点与复检方法见 `touchpoints.json`，签名快照见 `host-snapshot.json`。

### 怎么查

`cordis_inspect_query` 的 `input` 传参**是有效的**，两种查法都能用：

```js
// 精确 Service 契约（含方法签名、参数、返回类型）
{ platform: 'host', provider: 'Service', method: 'listService', input: { service: 'webServer' } }

// 精确 Slot 树（含 occupants，即谁挂了这个 slot）
{ platform: 'client', provider: 'Slots', method: 'listSubTree', input: { root: 'settings.section' } }
```

判不了的时候先怀疑自己的查法，不要急着写「宿主不支持」；一句错误的「宿主限制」会污染整条证据链。

事件目录用**无 input** 形态查（rc.3 实测 `input={event:<name>}` 被拒，报 `"input" must be an object`；目录里每条带完整签名，够用）：

```js
{ platform: 'host', provider: 'Event', method: 'listEvents' }
```

---

## 系统提示词组装（说明页半边）

| 事实 | 结论 | 出处 |
|---|---|---|
| 接缝事件 | `'system-prompt/assemble'`，mode=waterfall；签名 `(this: Scoped<SystemPrompt>, assembly: PromptPresentation, context: AssembleContext, next: () => Promise<PromptPresentation>) => Promise<PromptPresentation>` | L1：2026-11-17 `cordis_inspect_query` host `Event.listEvents` 目录 |
| 返回文本权威 | 监听器返回的 presentation 就是最终组装结果；先 `next()` 拿上游再改 | `dsh-system-prompt/src/index.ts:688`（assemble 用 waterfall 返回值） |
| 上游基线返回同一对象 | 宿主自己的基线监听器原样返回 assembly，所以「返回新对象 + 新 sections」不会丢上游字段 | `dsh-system-prompt/src/index.ts:684-686` |
| 监听器顺序与卸载 | waterfall 外层先跑；`ctx.on` 返回 disposer，作用域销毁自动摘除 | `cordis/src/events.ts:246-261,263-269` |
| 不需要 inject | `ctx.on` 不声明服务依赖；根作用域监听器收到**所有**会话（含子代理）的组装 | `dsh-scope/src/index.ts:175-176` |
| 空段不渲染 | 渲染时过滤 `text === ''` 的段 → 名单段剔空置 '' 即整段消失 | `dsh-system-prompt/src/index.ts:297-302` |
| complete 段不可观测 | waterfall 里的 `AssembledSection` 只有 name/text/interpolate（complete 标志被剥掉）；complete 段在 waterfall **之后**无条件恢复 → 完整提示词预设场景本插件滤不动，也检测不到 | `dsh-system-prompt/src/index.ts:667-672,693` |
| persona-prefix 恒存在 | 构造器总是注册 `deployment:persona-prefix`（text 可为 ''）；dsh-persona 仅在 `config.complete` 时另注册 scoped 同名 complete 段 → 「只有一个 persona-prefix 段」之类的启发式检测是错的 | `dsh-system-prompt/src/index.ts:463-468`；`dsh-persona/src/index.ts:62-68` |
| 服务器说明段 | 名字 `mcp:<server>`，order 3100，interpolate:false，text 取 `connection.instructions()` | `dsh-mcp-client/src/server-context.ts` registerServerContext |
| 服务器名单段 | 名字 `mcp-resource-servers`；正文 = `'## MCP resource servers\n\nUse … as the server argument: ' + JSON.stringify(排序后的名字数组) + '.'`（**数组后有尾句点**） | `dsh-mcp-resources/src/index.ts:61-73` |

**推论**：说明页过滤只能做「移除段 / 重写名单」，做不到「检测完整预设」；后者如实报告边界（见 KNOWN-ISSUES），不冒充。

---

## 工具注册

| 事实 | 结论 | 出处 |
|---|---|---|
| MCP 工具和内置工具是否同一个入口 | 是，都走 `ctx.tools.register(definition)` | `dsh-mcp-client/src/tools.ts:176-178` |
| `description` 什么时候固定 | 构造 definition 时，不是每次读取时 | `dsh-mcp-client/src/tools.ts:257-260` |
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

**为什么不用它**：见 [DESIGN.md](./DESIGN.md)。

---

## 浏览器半（设置页）

| 事实 | 结论 |
|---|---|
| 模块形态 | `window.__ModuleLoader__.load({ id, factory })`，**不能有 ESM 的 export / import** |
| 为什么不能有 | 宿主把所有插件的 client.js 拼成一个大脚本加载，一个坏插件会让整个 web 起不来 |
| 包怎么被发现 | 只认「包的精确包名」或「路径里最近的 package.json」 |
| 所以要怎么做 | `ui/` 目录下必须有独立的 `package.json`，声明 `dsh.client.platform: "web"` 和 `exports["./client"]` |
| CSS 怎么挂 | 自己创建 `<style>` 标签塞进 `document.head`，并在 effect 的清理函数里移除 |
| 客户端取数 | `fetch('/tool-keeper/api', { method:'POST', body: JSON.stringify(...) })` |

出处：本机 `dsh-enhance` 与 `dsh-archive-manager` 的实现，两者都是已上架插件。

### 主题 token

颜色、圆角、字体必须用宿主的 CSS 变量，不写死色值。可用变量用 `cordis_inspect_query` 的 `Theme.listTokens` 查。

两个容易搞错的：

- 字体族是 `--dsw-font-family`（界面）和 `--ds-font-family-code`（等宽）。后者是 `--ds-` 开头不是 `--dsw-`。
- 行间分隔用 `.5px solid` 而不是 `1px`，这是宿主的视觉刻度。

---

## `settings.section`

```js
ctx.slots.inject('settings.section', function () {
  return ctx.slots.register({ id: 'tool-keeper', order: 50, label: () => '工具管理' }, Component);
});
```

| 事实 | 结论 |
|---|---|
| `id` | 自己的键。用已存在的 id 会**替换**那个条目，不是并列 |
| `order` | 导航里的位置，升序 |
| `label` | 可以是函数，每次投影都重新读，能跟随语言切换 |
| 收到什么 props | `{ close }`，只能关掉设置面板 |

### 当前位置占用情况

改 `order` 之前先看这张表，撞号会让导航顺序不稳定（相同 order 谁先谁后未定义）。

```
0    general          10   models         15   plugins
20   agent-presets    30   enhance        40   market
45   archive-manager  50   tool-keeper    60   dsh-draft-studio
440  xdpool
```

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
| 未知路径返回什么 | **405**（不是 404）。所以「405」不代表路由存在，验证时拿一个明确不存在的路径做对照 |

---

## 插件形态

| 事实 | 结论 |
|---|---|
| `package.json` 里怎么声明 | `dsh.bundle.patch` 指向 patch 文件 |
| `index.js` 要导出什么 | `name`、`inject`、`apply` |
| `Config` 能导出普通对象吗 | **不能**。会报 `Cannot read properties of undefined (reading 'validate')` |
| 想用配置怎么办 | 用 schemastery 的 `Schema.object(...)`，或干脆不导出 Config，自己读独立配置文件（本项目选后者） |
| 两个插件间的关系 | 所有插件共享同一个 Cordis 容器与作用域树 |

### patch 里 `name` 有两种写法

| 用途 | patch 里的 `name` | 解析规则 |
|---|---|---|
| 宿主半（`index.js`） | 包名 `dsh-tool-keeper` | **必须与 `package.json` 的 `name` 逐字一致** |
| 浏览器半（`ui/`） | 相对路径 `./ui/index.js` | 相对**本包目录**解析，指向一个**自己的 `package.json`** |

浏览器半要独立成包（声明 `dsh.client.platform: "web"` + `exports["./client"]`），因为宿主只认「包的精确包名」或「路径里最近的 `package.json`」，裸子路径会被当成非包跳过。

---

## 宿主的失败模式

| 操作 | 结果 |
|---|---|
| `ctx.get('tools')` 服务不存在 | 返回 `undefined` |
| 服务被 `Object.freeze` | `Reflect.set` 静默失败，赋值后比较能发现 |
| 属性是只读 getter | `Reflect.set` 抛错 |
| 不带 `Origin` 头访问本地接口 | 正常收到（非浏览器调用） |
| 跨源访问 | 由插件自己拒绝（`api.js` 的 `sameOrigin()`） |