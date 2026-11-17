# ADR 0001：在工具注册期与提示词组装期拦截，不拦读取期

**状态**：采纳。日期 2026-11-17。

## 背景

本插件要保证「模型读到的工具说明书 == 它实际能做的」。要做到这点，得找到**发出去的那一刻**，在那之前改。

模型看到的东西有两个来源，各有一个这样的时刻：

- **工具**：模型每轮读到的工具定义（名字、说明、参数）来自工具注册表。
- **说明页**：每台 MCP 服务器在系统提示词里占一段正文，组装提示词时才拼进去。

## 决定

**工具半边**拦截 `ctx.tools.register(definition)`，在宿主把 definition 存进注册表之前，决定丢弃 / 改写 / 原样放行。

**说明页半边**监听宿主官方 waterfall `system-prompt/assemble`，在 `next()` 拿到上游结果之后，移除或替换 `mcp:<server>` 段、重写名单段。

## 为什么不是别的做法

### 不用 `restrict()`

宿主确有 `tools.restrict(filter)`，但它的参数是 `{ allow?, deny? }` —— **只有名字掩码，没有内容**。它只能改变「哪些 definition 可见」，不能改 definition 里的 `description`。

本插件一半的目标是改写说明文字，`restrict()` 做不到。只用它就得再找第二条路做改写，等于一件事做两遍、两套状态要同步。

出处：`cordis_inspect_query` host `Service.listService{service:'tools'}` 返回 `restrict(filter: ToolRestriction)`，`ToolRestriction = { allow?: readonly string[]; deny?: readonly string[] }`。

### 不拦读取期

等模型来读时再改，读取发生在 `dsh-tools` 内部。要拦就得改宿主代码，而且**每个请求都要改一遍**——这是每轮都付的成本，而注册期只付一次。

出处：模型看到的 schema 由 `projectToolSchema()` 从已注册的 definition 投影（`dsh-tools/src/schema.ts`），读的是存储值，不是每次重新构造。

### 为什么判定必须在每个工具的注册调用里发生

不能「插件加载时算一次要丢的名单」。MCP 服务器**异步连接**：插件先加载时工具清单还是空的，那时算出来的名单是空名单，冷启动必然失效——而冷启动最常见。

所以判定要在 `register` 被调用的那一刻、拿到具体 definition 时才算。

### 为什么说明页只能在组装期改

说明页的正文来自服务器自己下发（`connection.instructions()`），插件加载时还拿不到。宿主提供官方 waterfall，返回的 presentation 就是最终结果，这是唯一能改又不用动宿主代码的地方。

## 后果

**好的**：

- 改写只改一次，不进每轮请求路径。
- 冷启动即生效：补丁在 `apply()` 期间安装，早于任何 MCP 连接。
- 说明页改动走官方接缝，宿主升级时靠 `recheck` 判漂移。

**代价**：

- **改配置必须重启才生效**。工具在注册期定型，重启前已注册的不受影响。界面常驻「重启后生效」就是在说这件事。
- 拦截靠包装一个方法（`Reflect.set`），宿主若冻结服务或改签名就会装不上。装不上时 `patched:false` 并在界面告警，全部工具放行——失败必须可见，但不阻断。
- 完整提示词预设会在 waterfall **之后**恢复人设段，说明页那半边被覆盖且检测不到。这条如实记在 `KNOWN-ISSUES` 第二，不冒充已解决。

## 接口三问

**① 删掉这个模块，复杂度去了哪？**
删掉 `index.js` 的补丁，改写能力消失——宿主没给别的改写接缝（`restrict()` 只能加减名字）。删掉 `instructions.js`，说明页半边完全做不到。两者都不是透传：复杂度会以「改宿主代码」或「每轮重算」的形式在别处重现。

**② 接缝另一侧真有第二个适配器吗？**
有。`index.js` 包装的 `register` 与测试里假的 `ctx.tools.register` 是两套实现，`tests/index.test.js` 正是在假 ctx 上验的。`instructions.js` 的 `filterSections` 是纯函数，宿主的 waterfall 与测试直接调用它，同样两套。

**③ 依赖是参数传入还是模块内 new 的？**
都是传入。`applyToDefinition(definition, rules)`、`filterSections(sections, disabledServers, serverRewrites)`、`decide(name, rules)` 全部收参数，模块里没有任何 `new` 宿主对象。这是 `rules.js` 能做到零 import、可脱离宿主单测的前提。
