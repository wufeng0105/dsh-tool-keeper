# AGENTS.md

> 本项目是一个 DSH 插件。**0.3.1 已完成首个可用形态**——宿主半拦截 + 设置页。
>
> **「能用」的判定不是「测试全绿」**：`node --check` 和 `npm pack` 全绿也证明不了它装得上。
> 判定它真的能用，只有三条：①`preflight` 零 FAIL；②装一次，读返回里的 `application`；
> ③重启后 poke 真实端点（`POST /toolwarden/api`）与 `slots` 里能看到自己这一页。

## 开工前

1. **用 `skill` 工具加载 `plugin-kit`**。查契约的三步顺序、完成验证、升级保鲜都在那里，本文不复述。
2. 查宿主契约：**`cordis_inspect_query` 是权威源**（Service / Event / Config / Tools / Slots），
   文档副本 `host-skills/dsh-doc/`（在 plugin-kit 包里）讲机制原则，真实运行的同类插件源码讲装配。
   本项目的设置页版式就是照同宿主的 `dsh-archive-manager` 抄的。
3. 每条关于宿主的断言必须带出处（探测命令+返回，或安装包 `文件:行`）。

## 最常踩的六条

1. **每条验收必须能判真假**；靠人看的必须给机判替代，否则标「人工判读」。
2. **每条关于宿主的断言必须带出处**。
3. **任何检查先证明它会红**，再用它判通过。
4. **模块存在 ≠ 产品在用**：必须证明它在 import 图里可达。
5. **「无法判定」不是「通过」**：探测不到就标 `UNVERIFIABLE`，写明证据等级。
6. **交付说明里的命令必须真跑过。**

## 本项目的形态

| 部分 | 文件 | 说明 |
|---|---|---|
| 宿主半 | `index.js` | 包装 `ctx.tools.register`，`inject = ['tools']` |
| 判定核心 | `rules.js` | 纯函数，无宿主依赖，可直接单测 |
| 模型工具 | `tool.js` | `toolwarden`，7 个 action |
| 设置页路由 | `api.js` | `/toolwarden/api`，`state` / `set` / `reset` |
| 出厂配置 | `baseline.js` | **全空**：不替用户做决定 |
| 浏览器半 | `ui/` | `settings.section`，`order: 50` |

几条硬约束，踩过：

- 要配置就用 schemastery 的 `Schema.object(...)`；**不要导出普通的 `Config = {}`**
  （会报 `Cannot read properties of undefined (reading 'validate')`）
- **`webServer` 不能写进 `inject`**：headless 下没有这个服务，写进去插件会永远 pending，
  宿主把它当 web boot 失败。必须用 `ctx.inject(['webServer'], cb)` 运行期可选注入。
- 界面半（`ui/client.js`）用 `window.__ModuleLoader__.load({ id, factory })` 形态，
  **不能有 ESM export/import**——宿主把所有插件的 client.js 拼成一个大脚本加载，
  一个坏插件让整个 web boot 崩。
- 浏览器半的发现只认「包的精确包名」或「路径里的最近 package.json」，
  所以 `ui/` 必须有自己的 `package.json`（声明 `dsh.client.platform = "web"`）。
- `settings.section` 的 `order` 不能和别人撞号，撞了导航顺序不稳定。
  现占用：0/10/15/20/30/40/45/60/440，本插件取 50。
- **页面状态一律以引擎判定为准**。`api.js` 用 `decide()` 算 `effective`，
  页面不自己从 `rules.tools` 推——那样会漏掉服务器白名单与总开关，显示假状态。

## 交付前

1. `npm test` —— 138 条，全绿
2. `node <plugin-kit包>/skills/plugin-kit/scripts/preflight.mjs <项目根>` —— 0 FAIL
3. **改断言就必须做变异测试**：故意改坏实现，确认测试变红，再还原。
   不跑变异的「测试通过」不算数。
4. 升级 DSH 后：跑 `recheck.mjs`（触点复检，`<plugin-kit包>/skills/plugin-kit/scripts/`）；
   文档副本过期判定用 `reextract.mjs --check`——**该脚本只在 plugin-kit 源码仓有**（不随包分发），
   用法见 `plugin-kit` skill §三的两态说明

## 不要做

- 不要把「测试全绿」当成「验收通过」
- 不要把「无法判定」写成「通过」
- 不要在没跑过的情况下把命令写进交付说明
- 不要猜服务名——`inject` 写错一个名字，插件永远 pending，宿主当 web boot 失败
- 不要替用户做默认决策（出厂基线两次因此被推翻）
