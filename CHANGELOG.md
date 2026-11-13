# Changelog

版本号只升到 `0.3.x`：私有项目，不上 npm，版本号用于标记本机安装的形态变化。

## 0.3.2 — 2026-11-13

一次独立对抗性审计（27 个变异，15 捕获 / 12 未捕获）后的修复。
完整记录见 [docs/INDEPENDENT-AUDIT.md](./docs/INDEPENDENT-AUDIT.md)。

### 修（会给出错误事实的）

- **被服务器规则关掉的行，点开关是「再关一次」而不是打开**。
  显示改成读 `effective` 之后，写回路径仍读 `rules.tools`——被服务器白名单关掉的行
  在 `tools` 里没有条目，于是点一下写 `drop`，再点一下只是删掉它，服务器规则还在。
  从界面永远打不开那类工具。改为按 `effective` 决定写 `keep` 还是 `drop`。
- **总开关 `enabled:false` 是单向门**。原来 `apply()` 在这里直接 return，
  重启后模型工具与设置页 API 一起消失，恢复路径只剩手改 JSON。
  现在只跳过「装补丁」，工具与 API 始终注册。
- **页面按磁盘配置算「省了多少」，而引擎跑的是启动时那份**。
  重启前是假数字，且刷新一次提示就消失。
  现在 `index.js` 暴露启动时配置指纹，`api.js` 比对磁盘得出 `state.stale`，
  页面顶部常驻提示；提示来自服务端，刷新不消失。
- **`__proto__` / `constructor` / `prototype` 能当配置键**。`servers.__proto__` 走原型
  setter，表现为「报成功但什么也没写」。解析阶段拒绝并记 `problems`。
- **只配参数改写的条目一展开就报「有未保存修改」**（`'' !== undefined` 恒真）。

### 测试

- 新增 `tests/index.test.js`（12 条）。这个文件原来零覆盖，审计的 5 个针对性变异全部漏网。
- 修掉一条空转断言：`aria-expanded="true"` 被分组头满足，改成按工具名单独取。
- 修掉一个标题与断言相反的 API 测试（标题写「白名单会反映」，断言却是 `source==='none'`）。
- 合计 161 条。

### 未修（已记录）

`readKnownServers` 的手写正则只认一种 YAML 写法（引号、带点名字、4 空格缩进、行尾注释、
流式对象五种全失效）；三类静默失效无诊断；双重 apply 的 restore 无栈语义；
`tool.js` 写配置不校验。详见审计文档「未修」表。

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
