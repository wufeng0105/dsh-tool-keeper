# 怎么验证它真的在工作

**测试通过不等于功能正确。** 这个项目里出现过好几次「全绿但功能是错的」（161 条的时代），
所以这份文件记的是**怎么判真假**，不是「测试有多少条」。

---

## 一、单测跑什么

```bash
npm test
```

174 条，分五组：

| 文件 | 测什么 |
|---|---|
| `tests/rules.test.js` | 纯函数核心：配置解析、判定优先级、参数改写、诊断 |
| `tests/index.test.js` | 宿主半：补丁安装与还原、总开关、失败可见、冻结服务 |
| `tests/tool.test.js` | 模型工具 `tool_keeper` 的七个 action |
| `tests/api.test.js` | HTTP 接口：同源校验、写前校验、指纹比对 |
| `tests/ui.test.js` | 设置页：用 react 离线渲染真实 HTML 并断言结构 |

`npm install` 是必需的——`ui.test.js` 要真的渲染组件，不是看源码字符串。

---

## 二、变异测试：先证明它会红

**这是本项目的硬纪律。**

写了一个断言，不等于它在检查东西。这条断言可能因为别的原因永远成立，实现改坏了它还是绿的。

做法：故意把实现改坏 → 跑测试 → **确认它变红** → 还原 → 确认恢复绿。

### 真实踩过的空转断言

有一条测试是这样写的：

```js
assert.ok(html.includes('aria-expanded="true"'));
```

意思是「展开的那一行应该有 `aria-expanded=true`」。

问题是分组标题按钮本身就带这个属性，所以不管工具行的实现对不对，这个断言**永远成立**。
把行按钮的 `aria-expanded` 硬改成 `false`，测试还是绿的。

改成按工具名单独取才对：

```js
const openBtn = html.match(/<button[^>]*aria-expanded="true"[^>]*>mcp__tinyfish__search</);
```

**教训**：断言要尽可能具体到「只有正确实现才能满足」。

### 当前变异覆盖情况

| 模块 | 变异数 | 全部被捕获 |
|---|---|---|
| `rules.js` | 6 | 是 |
| `tool.js` | 3 | 是 |
| `api.js` | 5 | 是 |
| `index.js` | 5 | 是 |
| `ui/client.js` | 7 | 是 |

早期独立审计跑过 27 个变异，其中 12 个没被捕获——那些都补了测试。

---

## 三、真机验收

单测跑在假的 ctx 上。**真机必须单独验**，两者不能互相替代。

### 前置条件

**必须等所有 MCP 连接完成。** 信号是 `Tool.listTools` 返回的名字集合达到基线
（首次记录的全量工具名），**不是等一个固定秒数**。

### 判定方式

**用名字集合断言，不用数量。**

数量会随你装了哪几个 MCP 服务器变化。写「应该是 105 个」换台机器就红；
写「应该是基线减去我关掉的」才稳定。

| # | 验什么 | 怎么判 |
|---|---|---|
| A1 | 装得上 | `install_bundle` 返回 `application: applied`。冒烟，证明力有限 |
| A2 | 隐藏生效 | 配置了隐藏集合 H → `listTools` 名字集合 == 基线 − H |
| A3 | 改写生效 | 改某工具说明 → `listTools` 里该工具的 `description` == 改写文本 |
| A4 | 工具仍可用 | 改写后真的调用成功。**只能证明没把结构改坏，不能证明改写质量** |
| A5 | 冷启动生效 | **完整重启宿主进程**（不是刷新、不是热重载）→ 集合仍 == 基线 − H 且改写文本仍在 |
| A6 | 保护生效 | ①界面尝试关 `read` → 被拒且有提示 ②手改配置加入 → 仍不被隐藏且报错 |
| A7 | 还原生效 | ①清空配置 → 集合 == 基线 ②卸载插件 → 集合 == 基线 |
| A8 | 诊断可见 | 三态分别验证（见下） |
| A9 | 配置损坏不锁死 | 写坏成半截 JSON → DSH 正常启动、集合 == 基线、界面报错 |

### 快速自查用的探测命令

```powershell
# 接口通不通、配置对不对
Invoke-WebRequest -Uri "http://127.0.0.1:<端口>/tool-keeper/api" -Method Post `
  -Headers @{Origin="http://127.0.0.1:<端口>"} `
  -ContentType 'application/json' -Body '{"op":"state"}' -UseBasicParsing
```

返回里几个关键字段：

| 字段 | 含义 |
|---|---|
| `patched` | 补丁装上了没。`false` 说明插件没在工作 |
| `stale` | `true` = 磁盘配置与内存里用的不一样，即「改了还没重启」 |
| `groups[].roles[].effective` | 引擎的实际判定（keep / drop），页面开关以此为准 |
| `groups[].roles[].source` | 判定来自哪层规则（protected / tool / server / rewrite / none） |

**注意**：探测一个不存在的路径会返回 **405 而不是 404**。
所以看到 405 不代表路由存在，要拿一个明确不存在的路径做对照。

### A8 的三态

配置里的服务器名，要对照 `cordis.patch.yml` 的 `mcp-manager.servers`：

| 情形 | 判定 | 界面 |
|---|---|---|
| server 不在 servers 里 | 硬错误 | 红色，规则标为无效 |
| server 在 servers 里，但当前没有工具 | 警告 | 黄色「暂不可用，规则保留」（服务器没连上，配置本身没错） |
| server 有工具，但规则里的工具名匹配不上 | 警告 | 黄色「工具不存在（可能改名）」 |

第三态比第一态更常见：工具改名比服务器消失常见得多。

> **注意**：这三态目前**判定不可靠**，因为读服务器名的那段代码只认一种 YAML 写法。
> 详见 [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) 第一条。
> 在它修好之前，A8 的验证结果不能全信。

---

## 四、界面怎么验

界面测试有两层，缺一不可。

### 离线渲染

`tests/ui.test.js` 用 `react-dom/server` 的 `renderToStaticMarkup` 渲染**真实的组件**，
然后断言产出的 HTML 结构。

这样改版式不用人重启就能发现问题。这条链路是被逼出来的：
早期测试只渲染出 loading 态（因为拿不到数据），版式问题必须靠人重启才知道。

为了能喂数据，组件拆成了两层：

- `ToolKeeperView` —— 纯展示，给 data 就出 HTML，不取数
- `Section` —— 容器，负责 fetch、loading、错误、展开状态

### 真机看

离线渲染证明不了「页面出现在导航里」。真机要查：

```js
// 用 cordis_inspect_query 的 Slots.listSubTree
Slots.listSubTree({ root: 'settings.section' })
// occupants 里应该有 { id: "tool-keeper", order: 50, active: true }
```

`active: true` 才算真的注册成功。

### 页面状态必须与引擎一致

这条单独列出，因为它错过一次，而且是**自己审自己没发现**的。

把开关显示改成读 `effective` 之后，**写回路径还在读配置里的条目**——
被服务器规则关掉的行在配置里没有条目，于是点开关写成 `drop`（再关一次），
从界面永远打不开那类工具。

测试全绿，因为当时的 UI 测试只覆盖纯展示组件，从没挂载过会写数据的部分。

**现在的防线**：`nextToolsAfterToggle` 抽成了纯函数，单独测；
断言里明确写「引擎判定为 drop 时，点击意图是打开，必须写 keep」。

---

## 五、preflight

```bash
node <plugin-kit>/skills/plugin-kit/scripts/preflight.mjs .
```

稳态输出 **7 PASS / 0 FAIL / 2 UNVERIFIABLE**。

那两项不是「快通了」，是只能在真机上判，且**已经判过了**：

- **slot 注册形态**：真机确认 occupants 里有 `active: true`，且同宿主已上架插件用逐字相同写法
- **完整插件集共存**：日常 profile 装上后重启正常，但一次性 profile 的完整流程没跑

细节见 [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) 第八条（preflight 两项）。
**不要把 UNVERIFIABLE 写成 PASS。**

---

## 六、几条容易违反的

| 纪律 | 为什么 |
|---|---|
| 不要把「测试全绿」当成「验收通过」 | 161 条绿过、功能错过的次数不止一次（现为 174 条，教训不变） |
| 不要把「无法判定」写成「通过」 | 判不了就说判不了，写清楚证据到哪一层 |
| 不要在没跑过的情况下把命令写进文档 | 命令会过期，写之前先跑一遍 |
| 改动读写两侧时必须都检查 | 只改一半会造出「点了没反应」的 bug |
| 不要用两字母前缀做全局替换 | `tw-` → `tk-` 时误伤了 `ToolwardenView`，63 个测试变红 |
| 测试文件里断言 CSS 字符串要谨慎 | 样式一改就红，但改坏了未必红。能用行为断言就别数样式 |
