# AGENTS.md

给在这个项目里写代码的智能体看的。**只讲怎么做事的规矩**，不讲技术事实。

- 技术事实（宿主接口、Cordis API、token 语义）→ [docs/HOST-CONTRACT.md](./docs/HOST-CONTRACT.md)
- 为什么这样设计、哪些路线被推翻过 → [docs/DESIGN.md](./docs/DESIGN.md)
- 怎么判真假 → [docs/TESTING.md](./docs/TESTING.md)
- 还有什么坑 → [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md)

---

## 开工前

1. **用 `skill` 工具加载 `plugin-kit`**。查契约的三步顺序、完成验证、升级保鲜都在那里，本文不复述。
2. 查宿主事实用 `cordis_inspect_query`（权威源，Service / Event / Config / Tools / Slots），
   不要凭印象，也不要只信上游文档——文档可能落后于实际运行版本。
3. 装配怎么写，看同宿主已上架的同类插件源码（`dsh-enhance`、`dsh-archive-manager`）。
   本项目的设置页版式就是照后者抄的。

---

## 这个项目的形态

| 部分 | 文件 | 说明 |
|---|---|---|
| 宿主半 | `index.js` | 包装 `ctx.tools.register`，`inject = ['tools']` |
| 判定核心 | `rules.js` | 纯函数，零宿主依赖，可直接单测 |
| 模型工具 | `tool.js` | `tool_keeper`，7 个 action |
| 设置页路由 | `api.js` | `/tool-keeper/api`，`state` / `set` / `reset` |
| 配置指纹 | `hash.js` | 判断「磁盘配置 ≠ 启动时加载的配置」 |
| 出厂配置 | `baseline.js` | **全空**：不替用户做决定 |
| 浏览器半 | `ui/` | `settings.section`，`order: 50` |

`rules.js` 刻意不依赖任何宿主 API 和 Node 内置模块（除了 crypto 被拆到 `hash.js`）。
**这条性质要保持**，否则核心判定就没法脱离宿主单测。

---

## 六条硬纪律

1. **每条验收必须能判真假**。靠人看的要给机判替代，给不了就标「人工判读」。
2. **每条关于宿主的断言必须带出处**（探测命令+返回，或安装包 `文件:行`）。
3. **任何检查先证明它会红，再用它判通过**。不跑变异的「测试通过」不算数。
4. **模块存在 ≠ 产品在用**：要证明它在 import 图里可达。
5. **「无法判定」不是「通过」**：判不了就标 `UNVERIFIABLE`，写明证据到哪一层。
6. **交付说明里的命令必须真跑过。**

---

## 交付前

1. `npm test` —— 174 条，全绿
2. `node <plugin-kit包>/skills/plugin-kit/scripts/preflight.mjs <项目根>` —— 0 FAIL
3. **改断言就必须做变异测试**：故意改坏实现，确认变红，再还原。
4. 升级 DSH 后：跑 `recheck.mjs`（触点复检）；
   文档副本过期判定用 `reextract.mjs --check`——**该脚本只在 plugin-kit 源码仓有**（不随包分发）。

---

## 不要做

| 不要 | 因为 |
|---|---|
| 把「测试全绿」当成「验收通过」 | 161 条绿过、功能错过的次数不止一次（测试数现已是 174，教训不变） |
| 把「无法判定」写成「通过」 | 证据等级不能说谎 |
| 在没跑过的情况下把命令写进文档 | 命令会过期 |
| 只改读写两侧中的一侧 | 把显示改成读 `effective` 之后写回路径没跟着改，造出「点关闭状态的开关反而关得更死」的 bug，测试全绿，独立审计才发现 |
| 用两字母前缀做全局替换 | `tw-` → `tk-` 时误伤了 `ToolwardenView`，变成含空格的非法标识符，63 个测试变红 |
| 替用户做默认决策 | 出厂基线因此被推翻过两次（详见 DESIGN 第六节） |
| 猜服务名 | `inject` 写错一个名字，插件永远 pending，宿主判定 web 启动失败 |

---

## 两条入口，同一份状态

| 入口 | 给谁 | 做什么 |
|---|---|---|
| 设置页 | 人 | 点开关、展开改说明、恢复出厂 |
| `tool_keeper` 工具 | 模型 | `status` / `list` / `server` / `tool` / `rewrite` / `enable` / `reset` |

两者写同一份 `~/.dsh/tool-keeper.json`，走同一套 `rules.js`。改一边另一边立刻可见。
两边改动都需要重启才生效。

---

## 文档纪律

**一个文件一个主题，过程记录不落盘。**

```
README.md              是什么、怎么用（面向使用者，尽量让人一次读懂）
docs/DESIGN.md         为什么这样实现，哪些路线被推翻过
docs/HOST-CONTRACT.md  DSH 接口事实，每条带出处
docs/KNOWN-ISSUES.md   缺陷的唯一真相源，修好一条删一条
docs/TESTING.md        怎么判真假
AGENTS.md              怎么做事的规矩（本文件）
CHANGELOG.md           版本历史
```

需求草案、工作协议、阶段验证记录、审计过程——**做完就清掉**，
结论并入上面某一个文件。留一堆过程文档会让后来者分不清哪份是现行标准。

写新内容前先问：这属于上面哪一个？都不属于，那它大概不该落盘。
