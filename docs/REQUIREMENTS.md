# Tool Keeper 需求与决策

> 本文是需求基线。功能点必须先在这里写清楚，再动代码。
> 证据分级：L1 运行时实测 / L3 源码核对 / UNVERIFIABLE 未验证。

---

## 一、这个项目是什么

**Tool Keeper（工具守卫）决定模型能看见哪些工具，以及看见什么样的工具说明。**

一句话区别于已有的三个实现：

| 实现 | 能力 | 局限 |
|---|---|---|
| `tool-mask`（本机在用） | 按前缀隐藏 | 冷启动失效；单条硬编码；无界面 |
| `dsh-toolgate`（未安装） | 分组隐藏 + 分发守卫 | 只能"有/无"，不能改内容 |
| `dsh-mcp-tool-filter`（未安装） | 注册入口拦截 | 只管 MCP；不能改内容 |

**三者都只能隐藏，不能改写。** Tool Keeper 的第一个差异化能力是：**工具说明的文字由你重写。**

---

## 二、需求（每条可判真假）

### R1 — 准入：决定哪些工具进入上下文

- R1.1 能按服务器整体开关（例：tinyfish 43 个工具全隐藏）
- R1.2 能按服务器保留白名单（例：tinyfish 只留 `search`、`fetch_content`）
- R1.3 能按单个工具开关（精确到 `mcp__tinyfish__create_dataset`）
- R1.4 原生工具与 MCP 工具一视同仁，同一套规则
- ~~R1.5 被隐藏的工具不进入注册表~~ → **降级为实现后果**（审计 S3）：这不是用户要的东西，是 D1 的机制副产品，且原文又拿它当 D1 的理由，构成循环论证。
  D1 采用后确实有这个后果。它买到的是：被隐藏的工具**不可能**被其他插件或 Inspect 重新看见。
  代价：**没有"解除遮罩"的备用出口**——插件出 bug 时恢复手段只剩改配置或禁用插件。
  因此 R4 增加一条：**插件总开关（一键回到全放行）**，作为备用出口。

### R2 — 改写：重写工具说明文字

- R2.1 能改写工具的 `description`（例：删掉"默认、免费、最省 token"这句）
- R2.2 能改写单个参数的 `description`（例：`include_selectors` 那 1,080 字符的教程）
- R2.3 改写后工具**照常可调用**，只是模型看到的说明变了
- R2.4 能一键还原成服务器原始文本

**判据**：改写后 `Tool.listTools` 返回的 `description` 是改写后的文本；调用该工具仍然成功。

**当前实测体量**（L1，本机）：`mcp__tinyfish__fetch_content` 共 10,609 字符 ≈ 3,031 tokens/轮，其中工具说明 2,166、参数说明 4,682，合计 **6,848 字符是可安全改写的纯文本**。

### R3 — 界面

> 0.3.0 已实现（`ui/client.js` + `api.js`）。实现期有一处偏离，记在 R3.2 下。

- R3.1 设置页里有一页（`settings.section`），不是侧边栏面板
- R3.2 工具按来源分组列出，每个工具一个开关。
  **偏离**：初稿写的是「带勾选框和开关」。实现时删掉了组内批量按钮
  （把整组 49 个内置工具一起关掉会让 agent 无法工作，而单服务器的整组开关
  配置里本来就有），没有批量操作，勾选框就成了摆设，因此只保留开关。
- R3.3 每个工具能展开看到并编辑说明文字
- R3.4 显示每个工具估算的 token 占用，让人知道改动值多少
- R3.5 配置写错的条目（服务器名不存在等）在界面上明确报出来，不静默失效
- R3.6 **页面显示的状态必须与引擎判定一致**。开关状态取自 `decide()` 的结果
  （`effective`），不由页面从 `tools` 自行推断——否则服务器白名单/总开关造成的
  隐藏会在页面上显示成「开」，等于让人照着假状态做决定。（0.3.1 审计补）

### R4 — 可靠性

- R4.1 **冷启动即生效**（完整宿主进程重启，这是 `tool-mask` 栽的地方）
- R4.2 保护名单硬编码：`read`/`write`/`edit`/`pwsh` 等基础工具任何配置都关不掉，避免把会话锁死
- R4.3 插件卸载/配置清空后，一切恢复服务器原样
- R4.4 **插件总开关**：一键禁用本插件的全部干预（审计 S3 要求，作为 D1 无备用出口的补偿）
- R4.5 **配置损坏不锁死**：解析失败按全放行运行，绝不中断注册链（审计 M7 要求）

---

## 三、技术决策（我定，不再征求选择）

### D1 机制：拦截 `tools.register`，不用 `restrict()`

#### D1.0 论证链（补齐审计 M1 指出的断点）

审计指出：原文只写了"`restrict()` 不能改写"就直接跳到"必须拦截 register"，跳过了决定性的一问——**模型看到的工具文本从哪里读出来**。现补全：

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
`restrict()` 只影响「哪些 definition 可见」，**不影响 definition 内的字段内容**（`practices.md:10`："restrict can only remove tools"）。
**所以改写必须发生在注册期。** 论证闭合。

**这同时解释了 A3 的判据为何有效**：`Tool.listTools` 返回的 `description` 就是模型看到的那份。

#### D1.1 为什么不选另两条路线

- **`restrict()` 管准入 + 另一机制管改写**：另一机制仍需在注册期动 definition，等于同一件事做两遍，且两套机制的状态要同步。无收益。
- **只在读取路径改写**：读取路径是 `projectToolSchema`，在 `dsh-tools` 包内，非本插件所有；要拦截它需改宿主代码或再打一次补丁。且每个请求都要改写，成本高于注册期一次。

#### D1.2 已知风险与回滚（审计 M1 要求）

| 风险 | 症状 | 检测 | 退回方案 |
|---|---|---|---|
| 宿主改了 `register` 签名 | 插件加载即抛或静默不生效 | 启动自检断言 `typeof register === 'function'`；装后立即查工具数 | 退回 `restrict()` 只隐藏、不改写 |
| 服务被冻结/sealed | `Reflect.set` 抛错 | 捕获后置 `patched: false` 并**界面告警** | 同上 |
| 内部调用绕过替换（`this.register`） | 改写不生效但无报错 | 装后查 `Tool.listTools` 的 description 是否为改后文本 | 同上 |
| Cordis 代理让覆写失效 | 同上传 | 同上传 | 同上 |

**共同兜底**：插件自身有一个总开关，关掉即回到全放行（审计 S3 要求）。

### D2 只改文本，不改结构

可改：`description`（工具级）、`properties.*.description`（参数级——**审计 M6 后改为默认关闭**）
**不改**：`type` / `required` / `enum` / 参数集合 / 默认值

**风险定价修正（审计 M6）**：原文写"文本改错最坏是模型不选这个工具，可逆"，**这是错的**。

真实取舍是：
- **结构改动** → 工具在所有情况下不可用，症状明显
- **文本改动** → 工具**仍然可用但可能被用错**，症状隐蔽

参数说明承载的是**用法约束**而非描述。删掉 `include_selectors` 的说明，模型不会不选这个工具，它会照选、传错选择器、拿到"成功但内容不对"的结果——**A4 测不出来**。

**因此追加约束**：
- 参数级 `description` 改写**默认关闭**，需显式开启
- 对有副作用/写入类工具（`pwsh`/`write`/`edit`/MCP 写类），参数说明改写时界面给显著警告
- R2.4 支持字段级回滚，不只是整体还原
- R3.4 的 token 占用必须标注"估算"，口径统一为 `字符数 ÷ 3.5`（未用 tokenizer 实测）

### D3 配置存独立文件

`~/.dsh/tool-keeper.json`，不写进 `cordis.patch.yml`。

**理由**：界面要频繁写，而 profile 的 patch 是用户主配置、混着别人的行和注释；UI 程序化改写它有覆盖风险。这是 `dsh-skill-mcp-panel` 的 ADR-0003 踩过的坑。

### D4 界面形态：`settings.section` 一页

**理由**：它本质是配置，属于设置页；只需要一个 slot（`settings.section`，kind: list，注册 `{id, order?, label?}`），不需要 `sidebar.panellist` + `main` 的联动和 dispatch 协调。`dsh-enhance` 已证明这条路可行。

### D5 本次范围：只做工具页

MCP 服务器**写**配置（增删改启停）留到第二阶段。
**读**服务器清单（`cordis.patch.yml` 的 `mcp-manager.servers`）属本阶段——它是 R3.5 判定"服务器名是否存在"的唯一信息源。

（审计 M4 修正：原文写"与工具可见性无关"是错的。服务器标识贯穿 R1.1/R1.2/R3.5/A8，是分组主键。）

### D6 补丁的安装时机与失败可见性（审计 M3 要求）

R4.1「冷启动即生效」必须由决策承接，不能只是愿望。

- 插件在 `apply` 期间同步安装补丁，早于任何 MCP 连接
- **若安装失败**（服务缺失/冻结/签名不符）：绝不静默，必须
  1. 写日志
  2. 在界面顶部显示"本次启动未生效：<原因>"
  3. 工具维持原样（fail-open，不 fail-closed）
- **配置解析失败**（审计 M7）：按空配置运行（全放行）+ 界面与日志报错，**绝不因配置中断注册链**
- 写配置用临时文件 + 原子替换

**tool-mask 的死因（L3，源码 `local/tool-mask.scope.mjs`）**，这是本项目的唯一负面先例，必须记录：

第 104-107 行，配置为空时直接 `return`，不注册任何东西。第 124-131 行 `applyTo()` 只在 `agent/created` 和加载时调用一次。
MCP 工具是**异步注册**的（`mcp-client` 连上服务器后才 `register`）。
插件加载时若 MCP 尚未连上，`resolveNames()` 扫到空集，`denyOn([])` 直接返回 `undefined`，**之后再无重试**。
→ **死因：一次性计算 + MCP 异步注册，二者错配。**

D1 天然规避此问题：补丁装在注册入口，MCP 何时连上都会经过它。

---

## 四、明确不做

- 不碰 MCP 服务器连接（那是 `mcp-manager` 的事）
- 不做 `parameters` 结构裁剪（风险 > 收益，见 D2）
- 不做按会话/按预设的临时开关（未来再说）
- 不做分发守卫（`guard()`）——工具不进注册表，模型点名也调不到，不需要第二道

---

## 五、验收标准

审计指出原始八条里只有 A1 干净达标，其余存在绝对数依赖、只数个数不校验集合、时序竞态等问题。已按建议重写。

**通用前置条件**（每条都适用）：测前须等所有 MCP 连接完成，信号是 `Tool.listTools` 返回的工具名集合达到「基线集合」（首次记录的全量工具名，非固定数量）。

**通用判定方式**：用**名字集合断言**，不用数量。

| # | 标准 | 怎么判 | 可判性 |
|---|---|---|---|
| A1 | 装得上 | `install_bundle` 返回 `application: applied` | ✅（冒烟，证明力有限） |
| A2 | 隐藏生效 | 配置隐藏集合 H → `listTools` 名字集合 == 基线 − H | ✅ 集合断言 |
| A3 | 改写生效 | 改 `fetch_content` 说明 → `listTools` 中该工具的 `description` == 改写文本 | ✅（已证 listTools 含 description） |
| A4 | 工具仍可用 | 改写后实调成功 —— **注意：此条只能证明"没把结构改坏"，不能证明"改写质量"** | ⚠️ 弱 |
| A5 | 冷启动生效 | **完整重启宿主进程**（非页面刷新、非热重载）→ ①名字集合仍 == 基线 − H ②某条改写文本仍存在 | ✅ 双断言 |
| A6 | 保护生效 | ①界面尝试关 `read` → 被拒绝且有可见提示 ②手改配置把 `read` 加入隐藏 → 仍不被隐藏，且报错 | ✅ 双路径 |
| A7 | 还原生效 | ①清空配置 → 名字集合 == 基线 ②卸载插件 → 名字集合 == 基线 | ✅ 双路径 |
| A8 | 诊断可见 | 三态分别验证（见下） | ✅ |
| **A9** | **配置损坏不锁死** | 故意写坏 `tool-keeper.json`（半截 JSON）→ DSH 正常启动、工具集合 == 基线、界面报错 | ✅（审计 M7 新增） |

### A8 的三态定义（审计 M4 要求）

配置里的服务器名，对照 `cordis.patch.yml` 的 `mcp-manager.servers`：

| 情形 | 判定 | 界面 |
|---|---|---|
| server 不在 `servers` 里 | **硬错误** | 红色，规则标为无效 |
| server 在 `servers` 里，但当前无工具 | **警告** | 黄色"暂不可用，规则保留"（服务器未连接/连接失败，配置本身没错） |
| server 有工具，但规则里的工具名匹配不上 | **警告** | 黄色"工具不存在（可能改名）" |

第三态是审计指出的常见错误类型，比"服务器名不存在"更常发生。

### R1 优先级（审计 M5 要求，原文档没定义）

三条规则冲突时的判据：**最具体者胜**

```
单工具规则  >  服务器白名单  >  服务器总开关
```

保存时**归一化成单一结果**再落盘，不保存三层原始意图。界面勾选框据此设计为二态（开/关），不是三态。

---

## 六、已查清的契约（L3，来自 plugin-kit 的 dsh-doc 副本）

来源：`dsh-plugin-kit/skills/plugin-kit/host-skills/dsh-doc/references/practices.md` 与 `ui-plugin.md`。
这是可 grep 的文档副本，不必读 app.asar。

### 6.1 官方对"隐藏工具"的推荐（与 D1 存在张力）

`practices.md:17` 原文：

> Hiding tools from one agent is `ctx.tools.restrict()` on that agent's context;
> it keeps schema presentation, lookup, and execution aligned.

`practices.md:10` 把扩展点从弱到强排列：

> `ctx.tools.restrict()` can only remove tools; `ctx.tools.guard()` can only deny;
> waterfall listeners can rewrite and depend on registration order;
> `system-prompt/assemble` replaces the whole assembly.

**冲突记录**：官方推荐 `restrict()`，但本项目 D1 选择拦截 `register`，理由是 R2 需要"改写"而 `restrict()` 只能"移除"。
**未决**：这个偏离是否可接受，待审计结论。

### 6.2 UI 的硬约束

- `ui-plugin.md:11`：slot 的 props 与 options 用 `Slots.listSubTree` 查
- `practices.md:33`：**不得** serve HTML 页面再用 iframe 嵌入（拿不到主题 token / locale）
- `practices.md:35`：**不得** require 任何 `@deepseek-ai/dsh-client-ui-*` 包作为模块，会崩
- `practices.md:36`：`ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`
- `practices.md:34`：样式用 `--dsw-alias-*` 主题 token；管理列表的参照物是 Plugin Manager 页

### 6.3 插件数据的存放

`practices.md:21`：

> Do not append session events with a new `type` … keep plugin-owned data in a storage service found through inspection.

`practices.md:22`：

> Put tunable values in the plugin's `Config` so users change them in `cordis.patch.yml`;
> the user's patch layer survives upgrades.

**冲突记录**：这条推荐把可调值放 `Config`，而 D3 选择独立文件 `~/.dsh/tool-keeper.json`。
理由见 D3（UI 频繁写、避免覆盖用户主配置），但需记录这个偏离。

---

## 七、原计划的待验证项（部分已查清）

| 项 | 现状 | 影响 |
|---|---|---|
| slot 的 props 形状 | 可用 `Slots.listSubTree` 查；`settings.section` 已知 kind:list | 已缓解 |
| 客户端↔宿主 RPC | **仍 UNVERIFIABLE** | 阻塞 R3 |
| `dsh.client` 声明方式 | 已知：`package.json` 加 `dsh.client`（platform/immediately/inject）+ `./client` export | 已查清 |
| 改写后的 `definition` 是否被下游重新校验 | **仍 UNVERIFIABLE** | 影响 A3 |

**这两项 UNVERIFIABLE 查清之前，R3 界面不开工。R1/R2 宿主侧可以先做。**

---

## 八、已确认的事实（备查）

- 本机 DSH 版本 `0.2.2-rc.2`（L1）
- 当前工具总数 101，MCP 56 + 内置 45，合计约 52,100 tokens/轮（L1）
- `tool-mask` 已于 2026-11-13 从 profile 的 `cordis.patch.yml` 移除（L1，`include:tool-mask` 在 Loader 中已查不到）；`local/tool-mask.scope.mjs` 文件本体保留未删
- DSH 没有任何 MCP 管理界面包（L3，11 个 `ui-settings-*` 包中无一与 MCP 相关）
- MCP 服务器配置确实就是 `cordis.patch.yml` 里的 `mcp-manager.servers`（L1，读了实际文件）
- plugin-kit 自带 `host-skills/dsh-doc/` 可 grep 的文档副本（40 文件），不必读 app.asar（L1）
---

## 八、实现状态与偏离（审计后补记）

规格是决策记录，**不静默回改**。下面记「写的」与「做的」不一致的地方。

| 规格原文 | 实现 | 处理 |
|---|---|---|
| D2「参数级 description 改写**默认关闭**，需显式开启」 | 没有开关，`rewrite.<tool>.properties` 配了就生效 | **未实现**。已知限制。做开关要先定「默认关」的语义与页面上的位置，不宜顺手加 |
| D2「写类工具参数说明改写时界面给**显著警告**」 | 无 | **未实现**。同上 |
| D2 / R2.4「支持**字段级**回滚」 | `action=rewrite` 省略 `text` 是**整条删除**（description 与 properties 一起没） | **偏离**。当前实现做不到只删其中之一 |
| A8「界面三态：硬错误红色、警告黄色」 | 所有诊断挤在一行 `data-tone=warn`，不分色 | **偏离**。诊断目前只有一种呈现 |
| §七「这两项 UNVERIFIABLE 查清之前，R3 界面不开工」 | R3 已上线（0.3.0） | **已越过**。RPC 契约后来在本机 dsh-enhance 源码里查清（L3），前提消失 |
| R3.2「带勾选框和开关」 | 只有开关 | **偏离**。删掉组内批量按钮后勾选框没有用途，见 R3.2 正文 |

### 审计补充的要求

- **R3.6**（0.3.1）：页面显示的状态必须取自 `decide()` 的 `effective`，不由页面推断。
- **R3.7**（0.3.2）：改完未重启时，页面必须持续显示「尚未生效」，且该状态来自服务端比对
  配置指纹，不依赖页面内存——刷新后不能消失。
- **R4.6**（0.3.2）：总开关 `enabled:false` 只关「过滤」，**不关管理入口**。
  模型工具与设置页 API 始终注册，否则用户失去恢复路径。
- **A10**（0.3.2）：配置解析阶段必须拒绝 `__proto__` / `constructor` / `prototype`
  作为 `tools` / `servers` / `rewrite` 的键。它们会走到原型 setter，表现为「报成功但什么也没写」。
