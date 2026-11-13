# Changelog

版本号只升到 `0.3.x`：私有项目，不上 npm，版本号用于标记本机安装的形态变化。

## 0.3.5 — 2026-11-13

### 主线纠正：重点不是省 token

用户指出：真正的痛点是「MCP 默认塞十几个工具、你常用的两个、剩下的用不上，
**而且它的说明你改不了**」。省 token 只是副作用。

原来的 README 把 token 当成主线，那是错的。**如果只为省 token，用官方 `restrict()` 就够了**，
完全不必冒险拦截注册入口。值得冒这个险的是「改说明」这个能力本身。

按这个主线重写了 README，并把判断依据写进 DESIGN.md 第零节——
包括「如果主线是省 token，设计就不该是现在这样」这个自我检验。

### 文档按「一个文件一个主题」重组

原来 DESIGN.md 一个文件装了五个主题（范围/决策/宿主契约/验收/缺陷）。拆开：

```
README.md               是什么、怎么用 —— 面向使用者
docs/DESIGN.md          为什么这样实现，哪些路线被推翻过
docs/HOST-CONTRACT.md   DSH 接口事实，每条带出处
docs/KNOWN-ISSUES.md    缺陷唯一真相源，修好一条删一条
docs/TESTING.md         怎么判真假
AGENTS.md               怎么做事的规矩
CHANGELOG.md            版本历史
```

AGENTS.md 原来把宿主技术事实和协作纪律混在一起，现在只留纪律，技术事实指向 HOST-CONTRACT。

### README 重写

目标是「高中生能读懂」，不堆术语：
- 从「你配了个 MCP，它很高兴地告诉你我有 14 个工具」这种场景开头
- 解释为什么工具说明会影响模型行为（不是讲 token，讲的是模型会挑花眼、厂商的说明在跟你的需求打架）
- 每个术语第一次出现时当场解释
- 保留可操作内容（怎么说、怎么点、配置文件怎么写）

### 一体成文的检查做了什么

- 首句连读：六个文件的小节标题连起来读，无交叉主题
- 术语漂移：旧名「工具守卫」清零，「说明」统一（不再混用「描述」）
- 交叉引用：17 个内部链接全部可解析，零断链
- 累积矛盾：查出 README 里「重启提示怎么工作」说了两遍（界面章节 + 专门章节），
  界面章节改为指向后者
- 数字核对：161 条测试、105 个工具，与实机一致
- 主线兑现：统计 README 里各词出现次数，改写 8 次 > token 2 次

### 没有删的文件

上一轮已清过 5 篇过程文档。这一轮检查后确认：**没有整个文件是废的**，
但有一文件多主题的问题，所以做了拆分而不是删除。

161 条测试通过，preflight 7/9（0 FAIL，2 UNVERIFIABLE，均已核实并记录）。
## 0.3.4 — 2026-11-13

### 清理过程文档

原来 `docs/` 有 5 篇、38 KB：需求草案、工作协议、阶段验证记录、两次审计记录。
它们都是**做这件事的过程日志**，不是现行标准。留着会让后来者分不清哪份算数。

合并成一篇 `docs/DESIGN.md`（范围 + 技术决策 + 宿主契约 + 验收判法 + 已知缺陷），
删掉 5 篇过程文档。真正有长期价值的内容逐条搬到新文件，不是简单丢弃。

对照同作者已上架插件，它们的 `docs/` 放的是 `ARCHITECTURE.md` / `HOST-CONTRACT.md` /
`RELEASING.md` 这类长期参考，不是过程日记——这次对齐了这个做法。

新增一条项目纪律（写进 AGENTS.md）：**过程记录不落盘**。留痕只在两处——
CHANGELOG（版本变更与未修项）、DESIGN.md（决策与被推翻的路线）。

### 清理临时文件

- `~/.dsh/_archive-toolwarden/`（改名时留的 3 个旧配置备份）已删除。
  当前 `~/.dsh` 下与插件相关的只剩 `tool-keeper.json` 一个。
- 确认 profile 没有任何临时方案残留：`dependencies` 里只有 `@local/dsh-tool-keeper`，
  `cordis.patch.yml` 里没有 `tool-mask` / `toolgate` 等历史方案的行。

### 打包体积

`npm pack` 从 20 个文件降到 16 个。

### preflight 记录

稳态 **7 PASS / 0 FAIL / 2 UNVERIFIABLE**。两项 UNVERIFIABLE 的核实结论写进 DESIGN.md：
slot 注册形态经真机验证（occupants 里 `active: true`）且与已上架插件写法逐字相同，判为合法。
完整插件集共存仍需一次性 profile 验证，不冒充通过。

161 条测试通过。
## 0.3.3 — 2026-11-13

### 删：工具计数

`stats`（`total` / `dropped` / `rewritten` / `kept` / `paramsRewritten`）整套移除。

删的理由不是精简，是**它给出的数字是错的**：

```
action=status 的实测输出
  stats.total : 172
  toolCount   : 105     ← 同一份输出里两个数字互相矛盾
```

`stats.total` 数的是 `register()` 的调用次数（含重复注册、含插件自己的 `tool-keeper` 工具），
不是实际工具数。`paramsRewritten` 初始化后从未自增，恒为 0。

而且**没有任何消费者**：设置页的统计全部由目录（catalog）自行计算，
`stats` 只是从 `index.js` 透传到 `api.js` / `tool.js` 然后被丢掉。

维护一个不准、没人读、还自相矛盾的计数是净负债。真实的工具清单与开销由目录提供。

顺带：注册热路径上少了 4 次自增。

### 界面与模型是两条独立入口

- 设置页：给人用，点开关、展开改说明
- `tool-keeper` 工具：给模型用，`status` / `list` / `server` / `tool` / `rewrite` / `enable` / `reset`

两者写同一份 `~/.dsh/tool-keeper.json`，走同一套 `rules.js` 判定。
模型侧改动同样要重启才生效，设置页会显示「尚未生效」。

## 0.3.2 — 2026-11-13

一次独立对抗性审计（27 个变异，15 捕获 / 12 未捕获）后的修复。
独立审计的完整结论并入了本文件下方各条版本说明与 [docs/DESIGN.md](./docs/DESIGN.md)「已知缺陷」。

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
- 孤立术语 `schema` → 工具定义；加载态与加载后文案统一；类名 `tk-itemT` → `tk-item`；
  View 不再往传入的 props 对象上挂字段。

### 测试

138 条。针对本次审计的 5 个变异全部被捕获（`effective` 恒为 keep / `source` 恒为 none /
开关不读 `effective` / 摘要不跟搜索 / 内置工具标签写「服务器」）。

审计结论见下方各条。

## 0.3.0 — 2026-11-13

设置页。浏览器半 `ui/` + 宿主路由 `api.js`。

- `settings.section` 注册，导航位置 `order: 50`（避开 `dsh-draft-studio` 占用的 60）
- `/tool-keeper/api`：`state` / `set` / `reset`，同源校验，写前校验配置，`reset` 留备份
- `webServer` 走 `ctx.inject(['webServer'], cb)` 运行期注入——写进 `inject` 会让
  headless 下的插件永远 pending，宿主当 web boot 失败

版式参照同宿主内已上架的 `dsh-archive-manager` 设置页（`Disclosure` + `dsham_settings*`）：
分组卡片可折叠、行内展开编辑、原文与改写两栏等高。

## 0.2.0 — 2026-11-13

- 新增模型可调用的 `tool-keeper` 工具（`status` / `list` / `server` / `tool` / `rewrite` /
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
  `ask_user_question` `tool-keeper` `skill`
- 参数说明改写（R2.2）：只替换 `properties.<p>.description`，结构字段一个不动
- 全链路 fail-open：配置坏、插件出错、补丁装不上，都不阻断注册
