# AGENTS.md

给在这个项目里写代码的智能体看的。**只讲怎么做事的规矩，不讲技术事实。**

| 想知道 | 看哪里 |
|---|---|
| DSH 接口事实 | [docs/HOST-CONTRACT.md](./docs/HOST-CONTRACT.md) |
| 为什么这样设计 | [docs/DESIGN.md](./docs/DESIGN.md) |
| 术语指什么 | [CONTEXT.md](./CONTEXT.md) |
| 怎么判真假 | [docs/TESTING.md](./docs/TESTING.md) |
| 还有什么坑 | [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) |

---

## 开工前

1. **加载 `plugin-kit` 技能**。契约查询顺序、完成验证、升级保鲜都在那里。
2. **查宿主事实用 `cordis_inspect_query`**，不要凭印象，也不要只信上游文档。
3. **改代码前先查图谱**：`codegraph_explore` 传本仓 `projectPath`。返回的源码视为已读过，不要再 `read` 同一文件。

本项目七个模块互相引用，`rules.js` 被四处 import。靠 `grep` 找一个符号容易漏掉某个调用方，而漏掉调用方就是「测试全绿但功能坏了」的来源。

---

## 项目形态

| 部分 | 文件 | 职责 |
|---|---|---|
| 宿主半 | `index.js` | 包装 `ctx.tools.register`，`inject = ['tools']` |
| 说明页半 | `instructions.js` | 组装期 waterfall：移除/改写 `mcp:<server>` 段、剔除名单名字、捕获原文 |
| 判定核心 | `rules.js` | 纯函数，零宿主依赖 |
| 模型工具 | `tool.js` | `tool_keeper`，6 个 action |
| 设置页路由 | `api.js` | `/tool-keeper/api`：`state` / `set` / `reset` / `export` / `import` |
| 配置读写 | `config.js` | 三条入口共用的读解析、写前校验、原子写、备份 |
| 配置指纹 | `hash.js` | 判断「磁盘配置 ≠ 启动时加载的配置」 |
| 出厂配置 | `baseline.js` | **全空**：不替用户做决定 |
| 浏览器半 | `ui/` | `settings.section`，`order: 50` |

**`rules.js` 不依赖任何宿主 API 和 Node 内置模块**（crypto 拆到 `hash.js`）。这条性质要保持，否则核心判定没法脱离宿主单测。

---

## 六条硬纪律

1. **每条验收必须能判真假**。靠人看的要给机判替代，给不了就标「人工判读」。
2. **每条关于宿主的断言必须带出处**：探测命令+返回，或安装包 `文件:行`。
3. **任何检查先证明它会红，再用它判通过**。不跑变异的「测试通过」不算数。
4. **模块存在 ≠ 产品在用**：要证明它在 import 图里可达。
5. **「无法判定」不是「通过」**：判不了就标 `UNVERIFIABLE`，写明证据到哪一层。
6. **交付说明里的命令必须真跑过。**

### 复杂度纪律

**简单优先。** 一段逻辑多一个分支，就要能说出它拦的是哪种真实情况。说不出就是在用复杂度替代思考。

改一个函数前先问：**它现在回答几个问题？** 超过一个就该拆。判据越多，越容易把正常状态报成问题——`diagnose` 的判据是「配置里的名字存在吗」，就看在线状态这一个额外条件，会让健康配置也报警。

---

## 交付前

1. `npm test` —— 全绿。条数与分组见 [TESTING](./docs/TESTING.md)，本文不复述。
2. **preflight** —— 0 FAIL。脚本在 plugin-kit 包里，按包名定位：
   ```bash
   node <plugin-kit>/skills/plugin-kit/scripts/preflight.mjs .
   ```
   包通常位于 `~/.dsh/profiles/<profile>/node_modules/@wufeng0105/dsh-plugin-kit`。
3. **改断言就必须做变异测试**：故意改坏实现，确认变红，再还原。
4. **升级 DSH 后跑体检三件套**：
   - `recheck.mjs --self-test` —— 先证明它的反例都会红
   - `recheck.mjs` —— 按 `touchpoints.json` 逐条复检，与 `host-snapshot.json` 比对签名漂移
   - `reextract.mjs --check` —— 判 dsh-doc 副本是否过期（只在 plugin-kit 源码仓有）
5. **升级后必做行为验收**，不只看 exit 0：真机跑一遍 `POST /tool-keeper/api`，确认 `patched=true`、`stale=false`。

### `touchpoints.json` 是什么

本项目的**宿主触点清单**：每处依赖 DSH 行为的地方（服务、slot、符号、版本范围、文档声明），加上「怎么机判」和「判不了时怎么办」。升级 DSH 后它就是复检清单。

两条维护规则：

- **`probe.kind: "none"` 的条目必须写清「为什么机器判不了」和「替代证据是什么」**，不许只写「需人工」。
- **引用代码位置优先用函数名**，行号会漂。

---

## 不要做

| 不要 | 因为 |
|---|---|
| 把「测试全绿」当成「验收通过」 | 功能错误的版本也全绿过 |
| 把「无法判定」写成「通过」 | 证据等级不能说谎 |
| 在没核实的情况下写数字 | 数字比命令更容易看过期，且没人会去复查 |
| 只改读写两侧中的一侧 | 显示读 `effective`、写回读配置条目，会造出「点关闭状态的开关反而关得更死」，且测试全绿 |
| 用两字母前缀做全局替换 | `tw-` → `tk-` 会误伤含该子串的标识符 |
| 替用户做默认决策 | 出厂基线必须是全空 |
| 猜服务名 | `inject` 写错一个名字，插件永远 pending，宿主判定 web 启动失败 |
| 为了修一个 bug 加三个分支 | 下次会为了修这三个分支再加五个 |

---

## 两条入口，同一份状态

| 入口 | 给谁 | 做什么 |
|---|---|---|
| 设置页 | 人 | 服务器开关、单工具开关、改写工具说明、改写服务器说明页、导入导出、恢复出厂 |
| `tool_keeper` | 模型 | `status` / `list` / `server` / `tool` / `rewrite` / `reset` |

两者写同一份 `~/.dsh/tool-keeper.json`，走同一套 `rules.js`。改一边另一边立刻可见，都需要重启才生效。

`status` 不带服务器原文（`texts`）：那是给编辑器看的，一次 status 把每台的整页原文倒进对话，等于让模型重读它刚被要求别再读的东西。

---

## 文档纪律

**一个文件一个主题，一体成文：一条主线、一件事只在一处说清、其余指过去。**

| 文件 | 主题 |
|---|---|
| `README.md` | 是什么、怎么用（面向使用者，一次读懂） |
| `CONTEXT.md` | 术语的唯一真相源：一个东西一个名字，别的叫法进 `_Avoid_` |
| `docs/DESIGN.md` | 为什么这样实现（当前依据与约束） |
| `docs/adr/` | 难回头的取舍：当时有哪些备选、为什么选了这个 |
| `docs/HOST-CONTRACT.md` | DSH 接口事实，每条带出处 |
| `docs/KNOWN-ISSUES.md` | 缺陷的唯一真相源，修好一条删一条 |
| `docs/TESTING.md` | 怎么判真假 |
| `AGENTS.md` | 怎么做事的规矩（本文件） |
| `CHANGELOG.md` | 版本记录，一行一版 |

写之前先定：**这篇整体在说什么**，然后顺着这条线写下去，别把几段拼起来。

- **只写当前成立的内容**：不写来历、不写改版过程、不写已被推翻的方案。历史归 CHANGELOG。
- **同一件事只有一个真相源**：验收判法在 TESTING，缺陷在 KNOWN-ISSUES，宿主事实在 HOST-CONTRACT，设计依据在 DESIGN，术语在 CONTEXT；别处只写一句并指过去。
- **过期的直接删**：死链接、旧设计、已经不成立的话，删掉而不是修补。
- **收尾交底**：这轮改了哪些文件、删了什么、还剩哪些坑。

**动笔前先查 CONTEXT.md 的术语**：一个概念已经有名字，就用那个名字；想改用新名字，先改 CONTEXT.md 的 `_Avoid_`。

需求草案、工作协议、阶段记录、审计过程——**做完就清掉**，结论并入上面其中一个文件。写新内容前先问：这属于哪一个？都不属于，那它大概不该落盘。
