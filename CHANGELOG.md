# Changelog

版本号只升到 `0.3.x`：私有项目，不上 npm，版本号用于标记本机安装的形态变化。

## 0.3.1 — 2026-11-13

一次前端审计（按 `ytcw` 的累积状态纪律）。**核心问题是页面在说谎**，不是样式问题。

### 修

- **开关状态改由引擎判定**。页面原来只读配置里的单工具规则（`rules.tools`）画开关，
  完全忽略服务器白名单与服务器总开关。而 `decide()` 的优先级是
  受保护 > 单工具 > 服务器白名单 > 服务器总开关 > 改写。

  后果是实测可复现的：配置 `servers: { tinyfish: { keep: ["search"] } }` 时，
  `fetch_content` / `create_dataset` 引擎判定为丢，页面显示为开。

  修法：`api.js` 的 `state` 直接用 `decide()` 算出每个工具的 `effective` 与 `source`，
  页面只认 `effective`。由服务器规则导致的关闭，行内注明「服务器规则关闭」。

- **摘要跟搜索走**。原来搜完只剩 2 行，摘要仍写「共 105 个工具」。
- **内置工具标签**不再写「服务器原始说明」（内置工具没有服务器）。
- **「受保护」的解释补回**。上一版重构时删掉了，某些行没开关且无任何说明。
- **刷新按钮**不再因别的操作显示「处理中…」。
- **「重启后对新注册的工具生效」**改为「重启后生效」（原句自相矛盾）。
- 孤立术语 `schema` → 工具定义；加载态与加载后文案统一；类名 `tw-itemT` → `tw-item`；
  View 不再往传入的 props 对象上挂字段。

### 测试

138 条。针对本次审计的 5 个变异全部被捕获（`effective` 恒为 keep / `source` 恒为 none /
开关不读 `effective` / 摘要不跟搜索 / 内置工具标签写「服务器」）。

审计记录见 [docs/UI-AUDIT.md](./docs/UI-AUDIT.md)。

## 0.3.0 — 2026-11-13

设置页。浏览器半 `ui/` + 宿主路由 `api.js`。

- `settings.section` 注册，导航位置 `order: 50`（避开 `dsh-draft-studio` 占用的 60）
- `/toolwarden/api`：`state` / `set` / `reset`，同源校验，写前校验配置，`reset` 留备份
- `webServer` 走 `ctx.inject(['webServer'], cb)` 运行期注入——写进 `inject` 会让
  headless 下的插件永远 pending，宿主当 web boot 失败

版式参照同宿主内已上架的 `dsh-archive-manager` 设置页（`Disclosure` + `dsham_settings*`）：
分组卡片可折叠、行内展开编辑、原文与改写两栏等高。

## 0.2.0 — 2026-11-13

- 新增模型可调用的 `toolwarden` 工具（`status` / `list` / `server` / `tool` / `rewrite` /
  `enable` / `reset`），不用手改 JSON
- **出厂基线改为全空**。之前两版都犯了同一个错：第一版关掉 6 个「低频」内置工具
  （那是砍功能），第二版预设了 tinyfish 白名单（仍然是替用户做决定）。
  结论：管理工具的出厂状态不应该管理任何东西。装完与没装完全一致。

## 0.1.0 — 2026-11-13

宿主半首个可用版本。

- `index.js` 包装 `ctx.tools.register`，在注册入口判定，早于任何 MCP 连接（冷启动有效）
- `rules.js` 纯函数核心，无宿主依赖：`normalizeConfig` / `decide` /
  `rewriteParameterDescriptions` / `applyToDefinition` / `ToolCatalog` / `diagnose`
- 保护名单：`read` `write` `edit` `glob` `grep` `pwsh` `present` `todo_write`
  `ask_user_question` `toolwarden` `skill`
- 参数说明改写（R2.2）：只替换 `properties.<p>.description`，结构字段一个不动
- 全链路 fail-open：配置坏、插件出错、补丁装不上，都不阻断注册
