# 怎么验证它真的在工作

**测试通过不等于功能正确。** 这份文件记的是怎么判真假。

---

## 一、单测跑什么

```bash
npm install    # ui.test.js 要真的渲染组件，不是看源码字符串
npm test
```

236 条，分六组：

| 文件 | 测什么 |
|---|---|
| `tests/rules.test.js` | 纯函数核心：配置解析（含 servers.<名>.rewrite）、判定优先级、参数改写、诊断 |
| `tests/index.test.js` | 宿主半：补丁安装与还原、失败可见、冻结服务 |
| `tests/instructions.test.js` | 说明页半边：段落移除/改写/原文捕获、名单重写、格式漂移 fail-open、监听器安装/摘除 |
| `tests/tool.test.js` | 模型工具 `tool_keeper` 的六个 action（含 `server` 的开关与说明页改写） |
| `tests/api.test.js` | HTTP 接口：同源校验、写前校验、指纹比对 |
| `tests/ui.test.js` | 设置页：用 react 离线渲染真实 HTML 并断言结构 |

---

## 二、变异测试：先证明它会红

**这是本项目的硬纪律。**

写了一个断言，不等于它在检查东西。断言可能因为别的原因永远成立，实现改坏了它还是绿的。

做法：故意把实现改坏 → 跑测试 → **确认变红** → 还原 → 确认恢复绿。

### 断言要具体到「只有正确实现才能满足」

一条空转断言的样子：

```js
assert.ok(html.includes('aria-expanded="true"'));
```

意图是「展开的那一行应该有 `aria-expanded=true`」，但分组标题按钮本身就带这个属性，所以不管工具行实现对不对它都成立。按工具名单独取才对：

```js
const openBtn = html.match(/<button[^>]*aria-expanded="true"[^>]*>mcp__tinyfish__search</);
```

同类陷阱：断言「页面含『已停用』」时，行级副标题「服务器已停用」也含这三个字。要锚定专属结构（如 `.tw-count`）。

### 怎么做

每改一条断言，就故意改坏它守护的实现，确认变红后还原。
交付说明里列出本轮的变异组；不写「N 个变异全捕获」这类无法当场复核的数字。

**变异必须真的改变行为。** 往代码里加一句注释、改个无关的常量，测试当然还是绿的——那不是断言无效，是变异无效。判断方法：变异后先想「这条断言该红吗」，该红却没红才是问题。

---

## 三、真机验收

单测跑在假的 ctx 上，**真机必须单独验**。

### 前置条件

**必须等所有 MCP 连接完成。** 信号是 `Tool.listTools` 返回的名字集合达到基线，不是等固定秒数。

**核对「模型可见哪些工具」必须开新会话**：旧会话的工具清单是它创建时的快照，重启后旧会话仍显示旧清单，会把正常过滤误判成漏网。

### 判定方式

**用名字集合断言，不用数量。** 数量随装了哪些 MCP 服务器变化；写「应该是 105 个」换台机器就红。

| # | 验什么 | 怎么判 |
|---|---|---|
| A1 | 装得上 | `install_bundle` 返回 `application: applied`。冒烟，证明力有限 |
| A2 | 隐藏生效 | 配置了隐藏集合 H → `listTools` 名字集合 == 基线 − H |
| A3 | 改写生效 | 改某工具说明 → `listTools` 里该工具的 `description` == 改写文本 |
| A4 | 工具仍可用 | 改写后真的调用成功。**只证明没把结构改坏，不能证明改写质量** |
| A5 | 冷启动生效 | **完整重启宿主进程**（不是刷新、不是热重载）→ 集合仍 == 基线 − H 且改写文本仍在 |
| A6 | 保护生效 | ①界面尝试关 `read` → 被拒且有提示 ②手改配置加入 → 仍不被隐藏且报错 |
| A7 | 还原生效 | ①清空配置 → 集合 == 基线 ②卸载插件 → 集合 == 基线 |
| A8 | 诊断可见 | 两种态分别验证（见下） |
| A9 | 配置损坏不锁死 | 写坏成半截 JSON → DSH 正常启动、集合 == 基线、界面报错 |
| A10 | 服务器开关 | 关某台 → 该台工具全部消失；开回来 → 单工具规则原样生效（可见集合与关闭前一致） |
| A11 | 插件级停用 | 在 DSH 插件页停用 → 不装补丁、全部工具放行 |
| B1 | 说明页过滤（工具侧对照） | 关某台 MCP → 新会话的 `system/message` 里既没有它的说明段，名单数组里也没有它的名字；同一会话 `listTools` 该台工具全消失 |
| B2 | 两半一起恢复 | 重新启用 → 新会话里名单恢复含该名字、说明段回来，工具集合与关闭前一致 |
| B3 | 服务器说明页改写 | 写 `servers.<名>.rewrite` → 重启 → **新会话** `system/message` 里：含改写文本、不含 `### MCP server: <名>`（整段替换的直接后果）；清空后重启 → 标题与原文回来 |

B1–B3 的取数位置都是新会话 JSONL 的 `system/message` 事件（`data.message.content` 里的 text 块），不是 LLM 请求体里的 tools。**必须新会话**：宿主恢复旧会话时会重放旧内容，旧日志的时间戳会被刷新，拿它判会误报。

### 快速自查用的探测命令

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:<端口>/tool-keeper/api" -Method Post `
  -Headers @{Origin="http://127.0.0.1:<端口>"} `
  -ContentType 'application/json' -Body '{"op":"state"}' -UseBasicParsing
```

返回里的关键字段：

| 字段 | 含义 |
|---|---|
| `patched` | 补丁装上了没。`false` 说明插件没在工作 |
| `stale` | `true` = 磁盘配置与内存里用的不一样，即「改了还没重启」 |
| `groups[].roles[].effective` | 引擎的实际判定（keep / drop），页面开关以此为准 |
| `groups[].roles[].source` | 判定来自哪层规则：`protected` / `tool` / `server-disabled` / `rewrite` / `none` |
| `rules.disabledServers` | 停用的服务器集合，页面服务器开关以此为准 |
| `instructions` | 说明页半边的运行时事实：`installed`（监听器装上没）、`removed`（**最近一次组装**里真的被移除的服务器名）、`rewritten`（真的被替换过的）、`texts`（各服务器原始说明；**只给设置页**，`tool_keeper` 的 status 不含它） |

**注意**：探测不存在的路径返回 **405 而不是 404**（见 [HOST-CONTRACT](./HOST-CONTRACT.md)）。看到 405 不代表路由存在，要拿明确不存在的路径做对照。

### A8 的两种态

诊断只依赖「配置事实 + 本次实际见到的工具名」，不猜宿主有哪些服务器：

| 情形 | 判定 | 界面 |
|---|---|---|
| 配置了某服务器，但当前没有它的工具出现 | 警告 | 黄色「规则暂不生效（未连接或已移除，规则会保留）」 |
| 规则里的条目匹配不到工具 | 警告 | 黄色「工具不存在（可能改名）」 |

改写落在被隐藏或受保护的工具上时，另有明确提示「不会生效」。

---

## 四、界面怎么验

界面测试有两层，缺一不可。

### 离线渲染

`tests/ui.test.js` 用 `react-dom/server` 的 `renderToStaticMarkup` 渲染**真实组件**，断言产出的 HTML 结构，改版式不用人重启就能发现问题。

为了能喂数据，组件拆成两层：

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

把开关显示改成读 `effective` 之后，写回路径若还读配置里的条目，被服务器规则关掉的行在配置里没有条目，点开关会写成 `drop`（再关一次），从界面永远打不开那类工具。

**防线**：写配置的两个交互都抽成纯函数单独测——`nextToolsAfterToggle`（工具开关）与 `nextServersAfterRewrite`（服务器说明页改写，含「条目全空才删整条」）。断言里明确写「引擎判定为 drop 时，点击意图是打开，必须写 keep」。读写两侧必须一起检查。

---

## 五、preflight

```bash
node <plugin-kit>/skills/plugin-kit/scripts/preflight.mjs .
```

稳态输出 **7 PASS / 0 FAIL / 2 UNVERIFIABLE**，两项的原因与结论见 [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) 第十四节。**不要把 UNVERIFIABLE 写成 PASS。**

另外三项体检（升级 DSH 后必跑）：

```bash
node <plugin-kit>/scripts/recheck.mjs --self-test   # 先证明它会红
node <plugin-kit>/scripts/recheck.mjs --touchpoints touchpoints.json --snapshot host-snapshot.json
node <plugin-kit>源码仓/scripts/reextract.mjs --check   # dsh-doc 副本是否过期
```

---

## 六、改写内容的写作质量

`npm test` 管不了这一层：它测代码行为，而「工具说明该写成什么样」是文字内容。改错了不会报错，只会让模型悄悄少看到一个工具，或者按一段错话去用它。

`scripts/check-rewrites.mjs` 把「合格的说明」写成 7 条可机判的判据：

| | 判据 | 拦的是什么 |
|---|---|---|
| C1 | 描述与参数均已中文化 | 整段英文没翻译（按标点切段判，专有名词和枚举值不算） |
| C2 | 工具说明不点名别家工具 | 单个工具的说明里写「改用 X 工具」——路由该在服务器说明页 |
| C3 | 说明页不依赖外部文件 | 写「见 AGENTS.md」这类指针，模型读到的就是一句断掉的线索 |
| C4 | 同类工具的切换条件到位 | 三个搜索/抓取工具之间没有可判定的选择条件 |
| C5 | schema 假必填已点明 | 带默认值的参数被列进 `required`，模型会逐个去填 |
| C6 | 改写参数名全部存在 | 写了 schema 里没有的参数名，那条改写永远不生效也不报错 |
| C7 | 说明页写现象不写站点 | 把站名写死；站点风控是波动的，换站名会把人引向不稳定的路 |

**跑法**：需要两个真机输入，脚本自身不连宿主。

```bash
# 1. 取宿主实际注册的工具快照
#    cordis_inspect_query(platform=host, provider=Tool, method=listTools)，把返回 JSON 落盘
# 2. 拿快照和配置一起跑
npm run check-rewrites -- <listTools快照.json> ~/.dsh/tool-keeper.json
```

**C7 的局限**：站名清单是手写枚举，只拦已知站名，新站漏得掉。它证明的是「没有出现这些站名」，不是「没有任何站名」。这条属于部分 `UNVERIFIABLE`，不冒充全覆盖。

---

## 七、几条容易违反的

| 纪律 | 为什么 |
|---|---|
| 不要把「测试全绿」当成「验收通过」 | 功能错误的版本也全绿过，教训不变 |
| 不要把「无法判定」写成「通过」 | 判不了就说判不了，写清证据到哪一层 |
| **判不了的时候，先怀疑自己的查法** | 把「精确查询失败」记成「宿主不支持 input 传参」过，实际是用法写错了。见 HOST-CONTRACT「怎么查」 |
| **文档里的行号引用会被代码改动冲掉** | 引用代码位置用函数名而非行号，或每轮改动后复查 |
| 不要在没跑过的情况下把命令写进文档 | 命令会过期，写之前先跑一遍 |
| 改动读写两侧时必须都检查 | 只改一半会造出「点了没反应」的 bug |
| 不要用两字母前缀做全局替换 | `tw-` → `tk-` 时误伤了 `ToolwardenView`，63 个测试变红 |
| 测试里断言 CSS 字符串要谨慎 | 样式一改就红，但改坏了未必红。能用行为断言就别数样式 |
| **核对模型可见工具必须开新会话** | 旧会话清单是创建时的快照，会误导判断 |