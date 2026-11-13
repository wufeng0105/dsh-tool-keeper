# 设计决策与宿主契约

这个文件回答「**要做什么**」与「**为什么这么做**」。改机制之前先读它，否则很容易退回到已经被推翻的做法。

---

## 范围

### R1 准入：决定哪些工具进入上下文

- 按服务器整体开关（例：tinyfish 43 个工具全隐藏）
- 按服务器保留白名单（例：只留 `search`、`fetch_content`）
- 按单个工具开关（精确到 `mcp__tinyfish__create_dataset`）
- 原生工具与 MCP 工具一视同仁，同一套规则

> **机制副产品**：被隐藏的工具不进入注册表。这不是需求，是 D1 的后果。
> 它买到的是：被隐藏的工具**不可能**被其他插件或 Inspect 重新看见。
> 代价是**没有「解除遮罩」的备用出口**——因此总开关（R4.4）是必需的补偿。

### R2 改写：重写说明文字

- 改工具的 `description`
- 改单个参数的 `description`（例：`include_selectors` 那 1,080 字符的教程）
- 改写后工具**照常可调用**，只是模型看到的文本变了
- 一键还原成原始文本

**判据**：改写后 `Tool.listTools` 返回的 `description` 是改写后的文本，且调用仍成功。

### R3 界面

- 设置页里有一页（`settings.section`），不是侧边栏面板
- 按来源分组，每个工具一个开关（**不做勾选框**：没有批量操作，勾选框是摆设）
- 每个工具能展开看到并编辑说明
- 显示每个工具估算的 token 占用
- 配置写错的条目在界面上明确报出来，不静默失效
- **页面显示的状态必须与引擎判定一致**：开关状态取自 `decide()` 的 `effective`，
  不由页面从配置自行推断——否则服务器白名单 / 总开关造成的隐藏会在页面上显示成「开」，
  等于让人照着假状态做决定
- **改完未重启时必须持续提示**：该状态由服务端比对配置指纹得出，不依赖页面内存，
  刷新后不能消失

### R4 可靠性

- **冷启动即生效**（完整宿主进程重启，这是 `tool-mask` 栽的地方）
- 保护名单硬编码：`read` / `write` / `edit` / `pwsh` 等任何配置都关不掉，避免把会话锁死
- 卸载或清空配置后，一切恢复服务器原样
- **总开关**：一键禁用全部干预。注意它只关过滤、不关管理入口（见 D1 末段）
- **配置损坏不锁死**：解析失败按全放行运行，绝不中断注册链

### 明确不做

- 不碰 MCP 服务器连接（那是 `mcp-manager` 的事）
- 不做 `parameters` 结构裁剪（风险 > 收益，见 D2）
- 不做按会话 / 按预设的临时开关
- 不做分发守卫（`guard()`）——工具不进注册表，模型点名也调不到，不需要第二道

---

## D1 机制：拦截 `tools.register`，不用 `restrict()`

DSH 官方推荐用 `ctx.tools.restrict({deny})` 隐藏工具（`practices.md:17`），但那个能力**只能移除，不能改写**。本项目同时要做改写，所以必须走注册期拦截。

### 论证链：模型看到的文本从哪里来

**证据 A（L3，源码）** MCP 工具与内置工具走**同一个注册入口**：
`dsh-mcp-client/src/tools.ts:176-178`

```ts
for (const [publicName, definition] of definitions) {
  disposers.set(publicName, ctx.tools.register(definition))
}
```

**证据 B（L3，源码）** `description` 在**构造 definition 时**就被写入：
`dsh-mcp-client/src/tools.ts:145-149` → `createMcpToolDefinition` → `tools.ts:257-260`

```ts
return { name, description, parameters: inputSchema, output: ... }
```

**证据 C（L3，源码）** 模型侧看到的 schema 从注册的 definition 投影而来：
`dsh-tools/src/schema.ts:641-646` `projectToolSchema()` 取 `{ name, description, parameters }`。

**由此得出**：模型可见文本 = 注册时存入 definition 的字段。
`restrict()` 只影响「哪些 definition 可见」，**不影响 definition 内的字段内容**。
**所以改写必须发生在注册期。** 论证闭合。

这同时解释了验收时为何可用 `Tool.listTools` 判真假：它返回的 `description` 就是模型看到的那份。

### 为什么不选另两条路线

- **`restrict()` 管准入 + 另一机制管改写**：另一机制仍需在注册期动 definition，
  等于同一件事做两遍，且两套机制的状态要同步。无收益。
- **只在读取路径改写**：读取路径是 `projectToolSchema`，在 `dsh-tools` 包内、非本插件所有；
  要拦截它需改宿主代码或再打一次补丁，且每个请求都要改写，成本高于注册期一次。

### 已知风险与退路

| 风险 | 症状 | 检测 | 退路 |
|---|---|---|---|
| 宿主改了 `register` 签名 | 加载即抛或静默不生效 | 断言 `typeof register === 'function'`；装后查工具数 | 退回 `restrict()` 只隐藏、不改写 |
| 服务被冻结 / sealed | `Reflect.set` 抛错 | 捕获后置 `patched: false` 并在界面告警 | 同上 |
| 内部调用绕过替换（`this.register`） | 改写不生效但无报错 | 装后查 `Tool.listTools` 的 description | 同上 |
| Cordis 代理让覆写失效 | 同上 | 同上 | 同上 |

**共同兜底**：总开关 `enabled: false` 即全放行。
注意它只关「过滤」，不关管理入口——模型工具与设置页 API 仍然注册，否则用户失去恢复路径。

---

## D2 只改文本，不改结构

改 `description` 与 `properties.<name>.description`，**不碰** `type` / `required` / `enum` / 参数集合 / 默认值。

理由：结构改错会让工具直接报错（模型按错误 schema 调用），文本改错只是说明不准。
风险不对等，所以只做前者。

---

## D3 配置存独立文件

`~/.dsh/tool-keeper.json`，不写 profile 的 `cordis.patch.yml`。

理由：界面要频繁写，而 profile 的 patch 是用户主配置、混着别人的行和注释，程序化改写有覆盖风险。

---

## D4 界面形态：`settings.section` 一页

一个 slot（`settings.section`，kind: list，注册 `{id, order?, label?}`），不碰 `sidebar.panellist` + `main` 的联动与 dispatch 协调。

`ctx.inject(['webServer'], cb)` 运行期注入挂载 `/tool-keeper/api`，**不能写进 `inject`**：
headless 下没有这个服务，写进去插件会永远 pending，宿主把它当 web boot 失败。

---

## D5 加一个模型可调用的管理工具

`tool_keeper`。设置页给人用，这个工具给模型用。两者写同一份配置、走同一套 `rules.js`。

理由：用户不必为了关一个工具去点界面。

---

## 宿主契约备忘（L3，查证于 0.2.2-rc.2）

| 事项 | 结论 | 出处 |
|---|---|---|
| MCP 与内置工具同一注册入口 | 是 | `dsh-mcp-client/src/tools.ts:176-178` |
| description 构造时固定 | 是 | `dsh-mcp-client/src/tools.ts:257-260` |
| 模型看到的 schema 来源 | `projectToolSchema()` 从 definition 投影 | `dsh-tools/src/schema.ts:641-646` |
| `restrict()` 可否改写内容 | 不能，只能移除 | `practices.md:10,17` |
| `restrict()` 的作用域要求 | 读 `scopeOf(this.ctx)`，须挂成 agent 作用域的子插件 | `dsh-tools/src/index.ts:163-166` |
| `restrict()` 未知名字 | 抛错 | `dsh-tools/src/index.ts:179-183` |
| 浏览器半的发现方式 | 只认「包的精确包名」或「路径里最近的 package.json」 | 本机 `dsh-enhance` 实现 |
| 浏览器半的模块形态 | `window.__ModuleLoader__.load({id, factory})`，**不能有 ESM export/import** | 同上 |
| 客户端 RPC | `fetch('/<plugin>/api', {method:'POST', body: JSON.stringify(...)})` | 同上 |

### 为什么不用 `restrict()`

除了不能改写，它还有一个结构性问题：**冷启动会失效**。
`tool-mask`（同类实现）踩过这个坑——它在加载时算一次 deny 集合，而 MCP 是异步注册的；
插件先于 MCP 连接加载时，`resolveNames()` 返回空集，之后没有重试，**冷启动必然不生效**。

注册期拦截从结构上避开了这个问题：每注册一个工具就判一次，不存在「算早了」的窗口。

---

## preflight 的 9 项里有两项是 UNVERIFIABLE，不是失败

`preflight.mjs` 稳态输出为 **7 PASS / 0 FAIL / 2 UNVERIFIABLE**。

### ① slot 注册形态（已人工核实为合法）

preflight 会标记 `slots.inject` 回调里出现 `slots.register` 的写法，理由是
2026-11-10 有过「设置页看不到」的事故是同类形态。

**本项目的结论：合法形态。** 依据有两条：

1. 真机验证：重启后 `Slots.listSubTree('settings.section')` 的 occupants 里
   有 `{ id: "tool-keeper", order: 50, active: true }`，设置页可见。
2. 同宿主已上架的 `dsh-enhance` 用的是**逐字相同**的写法
   （`ui/client.js:926-927`），它工作正常。

preflight 那条检查给出的补法就是「人工打开设置页确认是否可见」，已照做。

### ② 完整插件集共存

只能在设备齐全的真机环境上验证：把插件装进复刻目标 bundle 组合的一次性 profile，
启动看是否出现 `1 entry did not activate`。

**当前状态：本机日常 profile 装了这个插件，重启后正常加载、无 entry 失败。**
但这不等于「复刻环境验证过」——一次性 profile 的完整流程尚未跑。不冒充通过。

---

## 已知缺陷

| 缺陷 | 说明 |
|---|---|
| `readKnownServers` 只认一种 YAML 写法 | 见上文 A8 三态下方的说明。五种合法写法全部读不出 |
| 三类静默失效无诊断 | 对保护工具配改写、对被丢弃工具配改写、`tool.js` 写配置不校验（导入了 `normalizeConfig` / `diagnose` 却没用） |
| 双重 apply 的 restore 无栈语义 | 只还原一层，且会覆盖后装插件的补丁。触发条件是同一插件被两条 patch 行加载或热重载，概率低 |
| 页面未使用一半的 state 字段 | `enabled` / `rules.servers` / `disabledServers` / `descChars` 零引用。死字段无害但会误导后来者 |
| 参数改写无独立开关 | 设计上曾写「默认关闭、需显式开启」，实际配了就生效 |
| 恢复出厂无二次确认 | 一次点击清空全部规则；API 留 `.bak-<时间戳>` 备份，但页面不提示位置 |

---

## 优先级与归一化

三条规则冲突时：**最具体者胜**

```
受保护  >  单工具规则  >  服务器白名单  >  服务器总开关
```

`rules.js` 的 `decide()` 是这条链的唯一实现，切页显示的开关状态也取它的结果
（`effective`），不由页面另行推断。

保存时**归一化成单一结果**再落盘，不保存多层原始意图。因此界面开关是二态（开/关），不是三态。

---

## 验收怎么判

**通用前置**：测前须等所有 MCP 连接完成，信号是 `Tool.listTools` 的名字集合达到基线
（首次记录的全量工具名，**不是固定数量**）。

**通用判定方式**：用**名字集合断言**，不用数量。数量会随挂载的服务器变化，集合不会。

| # | 标准 | 怎么判 |
|---|---|---|
| A1 | 装得上 | `install_bundle` 返回 `application: applied`（冒烟，证明力有限） |
| A2 | 隐藏生效 | 配置隐藏集合 H → `listTools` 名字集合 == 基线 − H |
| A3 | 改写生效 | 改某工具说明 → `listTools` 中该工具的 `description` == 改写文本 |
| A4 | 工具仍可用 | 改写后实调成功。**只能证明没把结构改坏，不能证明改写质量** |
| A5 | 冷启动生效 | **完整重启宿主进程**（非刷新、非热重载）→ 名字集合仍 == 基线 − H 且改写文本仍在 |
| A6 | 保护生效 | ①界面尝试关 `read` → 被拒且有可见提示 ②手改配置加入 → 仍不被隐藏且报错 |
| A7 | 还原生效 | ①清空配置 → 集合 == 基线 ②卸载插件 → 集合 == 基线 |
| A8 | 诊断可见 | 三态分别验证（见下） |
| A9 | 配置损坏不锁死 | 写坏配置成半截 JSON → DSH 正常启动、集合 == 基线、界面报错 |

### A8 的三态

配置里的服务器名，对照 `cordis.patch.yml` 的 `mcp-manager.servers`：

| 情形 | 判定 | 界面 |
|---|---|---|
| server 不在 `servers` 里 | **硬错误** | 红色，规则标为无效 |
| server 在 `servers` 里，但当前无工具 | **警告** | 黄色「暂不可用，规则保留」（服务器未连接，配置本身没错） |
| server 有工具，但规则里的工具名匹配不上 | **警告** | 黄色「工具不存在（可能改名）」 |

第三态比「服务器名不存在」更常发生：工具改名比服务器消失常见得多。

> **已知缺陷**：`readKnownServers()` 目前用手写正则扫 `cordis.patch.yml`，
> 只认一种 YAML 写法。引号包裹的服务器名、名字带点、4 空格缩进、行尾注释、
> 流式对象——五种合法写法全部读不出来。读不出时该服务器的规则静默失效，
> 且诊断会误报「server not found」。
> 修法：改用真 YAML 解析，或把数据源换成 mcp-manager 的 Config（`cordis_inspect` 的 Config provider 是权威源）。

---

## 配置格式

```jsonc
{
  "enabled": true,                          // 总开关，false = 全部放行
  "servers": {
    "tinyfish": { "keep": ["search", "fetch_content"] },  // 只保留列出的
    "lexiang": { "enabled": false }                        // 整个服务器关闭
  },
  "tools": {
    "mcp__exa__agent_run": "drop"           // 单工具；受保护工具写了会被拒绝
  },
  "rewrite": {
    "mcp__tinyfish__search": "搜索网页与外部知识。",          // 简单形态：只改工具说明
    "mcp__tinyfish__fetch_content": {                        // 完整形态：含参数说明
      "description": "读取网页正文。",
      "properties": { "include_selectors": "只提取匹配的元素。" }
    }
  }
}
```

`__proto__` / `constructor` / `prototype` 不能作键：它们会走到原型 setter，
表现为「报成功但什么也没写」。解析阶段直接拒绝并记 `problems`。

