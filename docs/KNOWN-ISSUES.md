# 已知缺陷

**缺陷的唯一真相源。** 修好一条就删一条，不要在别处另开一份。按影响排序。

---

## 一、双重加载时还原不干净

`installPatch()` 的 `restore()` 没有栈语义。

同一插件被两条 patch 行加载、或热重载时会包装两层。卸载时 A 的 restore 把 `register` 设回原始，B 的 restore 又设回 A 的包装，**残留一层**。如果别的插件在本插件之后也包装了 `register`，本插件的 restore 还会覆盖对方的补丁。

**触发条件**：同一插件被两条 patch 行加载，或热重载。日常使用碰不到。要修得改成带栈的补丁协议。

---

## 二、参数改写没有独立开关

只要配了 `rewrite.<工具>.properties` 就生效。一个手滑写进去的参数改写会立刻起作用，而它改的是模型理解参数含义的依据。

---

## 三、恢复出厂没有二次确认

点一下就把全部规则清空。后端会留备份（`tool-keeper.json.bak-<时间戳>`），但页面没有提示备份在哪，也没有撤销按钮。

---

## 四、drop 写错是 fail-open

选择层只有逐条 `drop`，没有 fail-closed 的兜底：

- `tools.<名>` 写错（typo）或工具改名 → 规则匹配不到任何工具，那个工具会**按默认值重新出现**在模型的可选范围里（它又多了一个要排除的选项，但不影响可用性）。
- 一台服务器可能有几百条 drop，工具改名/下线后会留下失效条目，长期存在。

**防线**：诊断会按服务器聚合报出「N 个工具名对不上（可能改名了）」，不会静默；按诊断删掉失效条目即可。

---

## 五、完整提示词预设下说明页过滤与改写都不生效，且检测不到

会话选用「完整提示词」类预设（dsh-persona `config.complete:true`）时，宿主在 waterfall **之后**无条件恢复 complete 段（`dsh-system-prompt/src/index.ts:693`），本插件对 sections 的过滤与改写被覆盖。

更麻烦的是**检测不到**：waterfall 里的段只有 name/text/interpolate，complete 标志被剥掉（同文件 667-672）；而 `deployment:persona-prefix` 段构造器恒注册（463-468），scoped 同名段又只在 complete 时出现——任何「数 persona-prefix 段」的启发式都会误报。

**当前行为**：不造假检测。组装里未见停用服务器的说明段时，诊断如实报「未连接，或该会话使用完整提示词预设——后者说明页过滤不生效」；配了改写却没见到段时，诊断报「改写本次未生效」。界面组头只在运行时事实（removed）成立时才说「说明页已一并隐藏」，面板只在 rewritten 含该服务器时才说「上次组装已生效」。工具半边不受此边界影响。

---

## 六、停用服务器的资源仍可读

服务器开关隐藏的是工具与说明页。`read_mcp_resource` 等内置资源工具背后的 provider 仍注册着停用服务器的资源（`dsh-mcp-client/src/server-context.ts:29-31`），模型若主动点名仍读得到。

**为什么不动**：资源读取是模型主动点名才发生的，不是每轮自动读到的自我描述——它不参与「模型以为自己能做什么」的判断，与本插件要修的那类失准无关。要堵得另包资源服务，超出「一个开关管两半」的范围。

---

## 七、`__proto__` 只在 `servers` 写入口被挡

`rules.js:226-231` 的注释专门解释过「报成功但什么都没写」的后果，`tool.js:149` 也据此挡住了 `servers.<名>`。但另外两个写入口漏了：

- `tool.js:199` `base.tools[name] = args.state`
- `tool.js:230` `properties[param] = args.text`

**实测**：`normalizeConfig({ tools: { "__proto__": "drop" } })` → `problems: []`、`toolOverrides.size: 0`；`rewrite.<工具>.properties` 写 `__proto__` 同样两类静默。调用方拿到 `ok: true`，磁盘上什么都没有。

**这是本项目最不该有的缺陷**：它宣称要消灭「说了不成立的话」，却在自己的写入口制造了一次。

**修法**：三处写入口统一走 `DANGEROUS_KEYS` 检查，命中即拒绝并说明原因。

---

## 八、`rewrite.<工具> = ""` 静默把工具说明清空

**实测**：`normalizeConfig({ rewrite: { "mcp__x__y": "" } })` → `problems: []`、键被视为已配置；`applyToDefinition` 返回 `description: ""`。

**同一个「空」在两侧含义相反**：`servers.<名>.rewrite` 为空或纯空白时被当作未配置忽略（`rules.js:119-123`）；`rewrite.<工具>` 为空时被当作「生效并把说明抹掉」。

**影响**：模型拿到一个没有说明的工具，全程无诊断。

**修法**：二选一——工具侧也把空白当未配置，或保留语义但必须落一条诊断。

---

## 九、`stale` 在配置读不出时永久失效

`config.js:43` 在 seed 也失败时返回 `text: undefined` → `index.js:58` `hashText(undefined)` 得 `''` → `api.js:117-118` 要求 `loadedHash !== ''` → `stale` 恒为 `false`。

**影响**：防「改了没重启被当已生效」是插件的招牌能力，它在最需要的时候安静关闭。

**修法**：`loadedHash === ''` 时给独立状态（如 `stale: null` 表示无法判定），不要静默取 `false`。

---

## 十、界面读一个永远不存在的字段

`ui/client.js:588` 拼提示时用 `data.reason || '未知原因'`，但 `api.js` 的 `state` 响应里**没有 `reason`**（实测键为 `ok, patched, configPath, stale, problems, diagnostics, instructions, groups, rules`）。

**影响**：补丁装不上时，界面永远显示「拦截补丁未安装：未知原因」，而 `index.js:110` 的 `snapshot().reason` 里其实有确切原因。用户被引导去查别的地方。

**修法**：`api.js` 的 state 响应补 `reason: s.reason`。

---

## 十一、空目录提示是一句确定的假话

`ui/client.js:669`：`还没有捕获到任何工具。重启 DSH 后这里会列出全部工具。`

若补丁装不上（`patched: false`），重启一百次也不会列出任何工具。两种完全不同的成因被说成一句确定的话。

**修法**：按 `patched` 分流文案。

---

## 十二、`problems` 双份拼装，且会长期挂着旧问题

`api.js:137` `problems: [...problems, ...s.problems]`：`problems` 是磁盘现算，`s.problems` 是启动时算（含 `readError`）。

**影响**：同一问题可能原样出现两次；更麻烦的是磁盘修好之后，启动期的旧问题仍挂在页面上——页面报出已经不存在的问题。

**修法**：去重，或明确标注每条问题的来源（本次现算 / 启动时）。

---

## 十三、死代码与过期注释

| 项 | 位置 | 状态 |
|---|---|---|
| `applied` 数组 | `rules.js:293,315,317` | 只 push 不读；两个调用方都只取 `parameters`/`missing` |
| `snapshot().groups` | `index.js:123-132` | 两个消费者都直接调 `catalog.groups()`，此映射白算 |
| `provideStatus` / `ctx.provide('tool_keeper')` | `index.js:135,243-251` | 全仓无消费者，失败还被吞掉 |
| `source` 字段 | `api.js:48,154` | UI 零引用 |
| `entry.leaf` | `api.js:149` | UI 零引用 |
| `entry.parameters` | `rules.js:389` | 写入后无人读；与 `rules.js:367`「只留存文本与归属」的自我描述矛盾 |
| `catalog.names()` | `rules.js:419` | 无调用 |
| `num()` | `ui/client.js:190` | 仅 `__testing` 引用 |
| 「三条边界」紧接「两条边界」 | `rules.js:23-24` | 空壳标题，自相矛盾 |
| 优先级注释仍写「服务器白名单」 | `rules.js:241` | 白名单已于 0.4.0 删除 |
| `keep` 残影 | `ui/client.js:891` | 判 `entry.keep`，但 `api.js` 从不返回该字段，条件恒为 undefined |
| 256KB 文案指错对象 | `api.js:264` | 限制的是**请求体**，文案说「配置文件」 |
| `renameSync` 静默降级 | `config.js:100-107` | Windows 目标被占用时改为直接写，可能写坏配置且无日志 |
| 空白「不落盘」契约无强制 | `rules.js:123` / `api.js:197` | 注释称调用方负责，实测 `{rewrite:" "}` 能落盘成死键 |

---

## 十四、preflight 有两项长期 UNVERIFIABLE

稳态输出 **7 PASS / 0 FAIL / 2 UNVERIFIABLE**。那两项只能在真机上判，判法与结论见 [TESTING](./TESTING.md) 的验收表：

- **slot 注册形态**：已真机确认 occupants 里有 `active: true`，页面可见；同宿主已上架插件用逐字相同写法。
- **完整插件集共存**：日常 profile 正常加载、无 entry 失败；一次性 profile 的完整流程未跑，不冒充通过。

---

## 不值得修的

| 项 | 为什么不动 |
|---|---|
| `splitMcpName` 允许空 leaf | leaf 现在只用于分组显示，不参与判定 |
| `reset` 的备份文件名可预测（`.bak-<时间戳>`） | 同源 + 本地操作，最坏只是同毫秒两个备份互相覆盖 |
| 同源校验信任客户端 `Host` 头 | 浏览器无法伪造 `Host`，浏览器侧不可利用 |
| `ctx.effect` 没传 label | 只影响调试可读性 |
| `package.json` 没有 `author` 字段 | 私有项目 |
