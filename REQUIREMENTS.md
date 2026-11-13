# Toolwarden 需求与决策

> 本文是需求基线。功能点必须先在这里写清楚，再动代码。
> 证据分级：L1 运行时实测 / L3 源码核对 / UNVERIFIABLE 未验证。

---

## 一、这个项目是什么

**Toolwarden（工具守卫）决定模型能看见哪些工具，以及看见什么样的工具说明。**

一句话区别于已有的三个实现：

| 实现 | 能力 | 局限 |
|---|---|---|
| `tool-mask`（本机在用） | 按前缀隐藏 | 冷启动失效；单条硬编码；无界面 |
| `dsh-toolgate`（未安装） | 分组隐藏 + 分发守卫 | 只能"有/无"，不能改内容 |
| `dsh-mcp-tool-filter`（未安装） | 注册入口拦截 | 只管 MCP；不能改内容 |

**三者都只能隐藏，不能改写。** Toolwarden 的第一个差异化能力是：**工具说明的文字由你重写。**

---

## 二、需求（每条可判真假）

### R1 — 准入：决定哪些工具进入上下文

- R1.1 能按服务器整体开关（例：tinyfish 43 个工具全隐藏）
- R1.2 能按服务器保留白名单（例：tinyfish 只留 `search`、`fetch_content`）
- R1.3 能按单个工具开关（精确到 `mcp__tinyfish__create_dataset`）
- R1.4 原生工具与 MCP 工具一视同仁，同一套规则
- R1.5 被隐藏的工具**不进入注册表**，`tools.schemas()` 里查不到

**判据**：配置后调用 `cordis_inspect_query` 的 `Tool.listTools`，工具数从 101 降到预期值。

### R2 — 改写：重写工具说明文字

- R2.1 能改写工具的 `description`（例：删掉"默认、免费、最省 token"这句）
- R2.2 能改写单个参数的 `description`（例：`include_selectors` 那 1,080 字符的教程）
- R2.3 改写后工具**照常可调用**，只是模型看到的说明变了
- R2.4 能一键还原成服务器原始文本

**判据**：改写后 `Tool.listTools` 返回的 `description` 是改写后的文本；调用该工具仍然成功。

**当前实测体量**（L1，本机）：`mcp__tinyfish__fetch_content` 共 10,609 字符 ≈ 3,031 tokens/轮，其中工具说明 2,166、参数说明 4,682，合计 **6,848 字符是可安全改写的纯文本**。

### R3 — 界面

- R3.1 设置页里有一页（`settings.section`），不是侧边栏面板
- R3.2 工具按来源分组列出，带勾选框和开关
- R3.3 每个工具能展开看到并编辑说明文字
- R3.4 显示每个工具估算的 token 占用，让人知道改动值多少
- R3.5 配置写错的条目（服务器名不存在等）在界面上明确报出来，不静默失效

### R4 — 可靠性

- R4.1 **冷启动即生效**（这是 `tool-mask` 栽的地方）
- R4.2 保护名单硬编码：`read`/`write`/`edit`/`pwsh` 等基础工具任何配置都关不掉，避免把会话锁死
- R4.3 插件卸载/配置清空后，一切恢复服务器原样

---

## 三、技术决策（我定，不再征求选择）

### D1 机制：拦截 `tools.register`，不用 `restrict()`

**理由**（L3 核对 0.2.2-rc.2 源码）：

- `restrict()` 只能做遮罩，**无法改写内容**——它没有那个接口。R2 用 `restrict()` 做不到。
- `restrict()` 必须 scoped ctx，全局调用直接抛（`dsh-tools/src/index.ts:163-166`）
- `restrict()` 对未知名字抛异常（同文件 179-183），而 MCP 工具列表每次启动可能变
- `restrict()` 会**同步**触发 `tools/change`（`dsh-scope/src/store.ts:257-262`），自己监听自己就是无限递归——同类插件实测过 887 次 restrict / 458 层递归

拦截 `register` 的三个优势：
- 工具**从不进入注册表**，比遮罩更彻底
- 改写发生在注册前，模型拿到的就是改后的
- **无重入问题**：不调 `restrict()`，就没有 `tools/change` 回环

**依据**：`Symbol.for('cordis.original')` 在 0.2.2-rc.2 存在（L3，从 app.asar 提取 `cordis/src/utils.ts` 确认），是拿到服务实例的合法途径。

### D2 只改文本，不改结构

可改：`description`（工具级）、`properties.*.description`（参数级）
**不改**：`type` / `required` / `enum` / 参数集合 / 默认值

**理由**：文本改错最坏是模型不选这个工具，可逆；结构改错会让工具直接报错，不可逆。`fetch_content` 的 `required` 里有 5 个布尔，砍掉任何字段都可能让调用失败。

### D3 配置存独立文件

`~/.dsh/toolwarden.json`，不写进 `cordis.patch.yml`。

**理由**：界面要频繁写，而 profile 的 patch 是用户主配置、混着别人的行和注释；UI 程序化改写它有覆盖风险。这是 `dsh-skill-mcp-panel` 的 ADR-0003 踩过的坑。

### D4 界面形态：`settings.section` 一页

**理由**：它本质是配置，属于设置页；只需要一个 slot（`settings.section`，kind: list，注册 `{id, order?, label?}`），不需要 `sidebar.panellist` + `main` 的联动和 dispatch 协调。`dsh-enhance` 已证明这条路可行。

### D5 本次范围：只做工具页

MCP 服务器配置页（增删改启停）留到第二阶段。**理由**：那是写 `cordis.patch.yml` 的另一个数据模型，与工具可见性无关，混在一起会让两套状态互相纠缠。

---

## 四、明确不做

- 不碰 MCP 服务器连接（那是 `mcp-manager` 的事）
- 不做 `parameters` 结构裁剪（风险 > 收益，见 D2）
- 不做按会话/按预设的临时开关（未来再说）
- 不做分发守卫（`guard()`）——工具不进注册表，模型点名也调不到，不需要第二道

---

## 五、验收标准

| # | 标准 | 怎么判 |
|---|---|---|
| A1 | 装得上 | `install_bundle` 返回 `application: applied` |
| A2 | 隐藏生效 | 配置 tinyfish 只留 2 个 → 工具数 101 → 60 |
| A3 | 改写生效 | 改 `fetch_content` 说明 → `Tool.listTools` 返回改后文本 |
| A4 | 工具仍可用 | 改写后实际调用一次成功 |
| A5 | 冷启动生效 | 重启 DSH → 仍是配置后的数量 |
| A6 | 保护生效 | 尝试隐藏 `read` → 被拒绝且有提示 |
| A7 | 还原生效 | 清空配置 → 工具数回到 101 |
| A8 | 诊断可见 | 配置不存在的服务器名 → 界面报错，不是静默无效果 |

---

## 六、待验证项（动手前必须查清）

| 项 | 现状 | 影响 |
|---|---|---|
| 客户端↔宿主的 RPC 方式 | **UNVERIFIABLE**，未查清 `settings.section` 里的组件如何调用宿主方法 | 阻塞 R3 |
| `settings.section` 的 props 形状 | 已知 kind: list，`{id, order?, label?}`；渲染组件收什么 props 未查 | 阻塞 R3 |
| `dsh.client` 声明方式 | `dsh-enhance` 用 `./ui/index.js` + `ui/package.json` 的"最近 package.json"规则（L3，其 patch 注释里写明） | 影响打包 |
| 改写后的 `definition` 是否被下游重新校验 | 未查 | 影响 A3 |

**这四项查完之前不写功能代码。** 查法按 plugin-kit 三步：先 `cordis_inspect_query`，再 `dsh-doc`，最后读真实插件的 `lib/`。

---

## 七、已确认的事实（备查）

- 本机 DSH 版本 `0.2.2-rc.2`（L1）
- 当前工具总数 101，MCP 56 + 内置 45，合计约 52,100 tokens/轮（L1）
- `tool-mask` 当前**未生效**：重启后 tinyfish 仍是 43 个工具（L1）
- DSH 没有任何 MCP 管理界面包（L3，11 个 `ui-settings-*` 包中无一与 MCP 相关）
- MCP 服务器配置确实就是 `cordis.patch.yml` 里的 `mcp-manager.servers`（L1，读了实际文件）
