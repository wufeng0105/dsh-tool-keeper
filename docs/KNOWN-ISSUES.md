# 已知缺陷

**缺陷的唯一真相源。** 修好一条就删一条，不要在别处另开一份。

按影响排序。

---

## 一、双重加载时还原不干净

`installPatch()` 的 `restore()` 没有栈语义。

同一插件被两条 patch 行加载、或热重载时会包装两层。卸载时 A 的 restore 把 `register` 设回原始，B 的 restore 又设回 A 的包装，**残留一层**。如果别的插件在本插件之后也包装了 `register`，本插件的 restore 还会覆盖对方的补丁。

**触发条件**：同一插件被两条 patch 行加载，或热重载。日常使用碰不到。要修得改成带栈的补丁协议。

---

## 二、state 返回的死字段

`api.js` 的 `state` 返回的 `chars` 和 `descChars` 页面零引用，可以从 `state` 里删掉；留着只会让后来者以为某处还在用。

---

## 三、参数改写没有独立开关

只要配了 `rewrite.<工具>.properties` 就生效。一个手滑写进去的参数改写会立刻起作用，而它改的是模型理解参数含义的依据。

---

## 四、恢复出厂没有二次确认

点一下就把全部规则清空。后端会留备份（`tool-keeper.json.bak-<时间戳>`），但页面没有提示备份在哪，也没有撤销按钮。

---

## 五、drop 写错是 fail-open

选择层只有逐条 `drop`，没有 fail-closed 的兜底：

- `tools.<名>` 写错（typo）或工具改名 → 规则匹配不到任何工具，那个工具会**按默认值重新出现**在模型上下文里（浪费上下文，但不影响可用性）。
- 一台服务器可能有几百条 drop，工具改名/下线后会留下失效条目，长期存在。

**防线**：诊断会按服务器聚合报出「N 个工具名对不上（可能改名了）」，不会静默；按诊断删掉失效条目即可。

---

## 六、preflight 有两项长期 UNVERIFIABLE

稳态输出 **7 PASS / 0 FAIL / 2 UNVERIFIABLE**。那两项只能在真机上判。

### ① slot 注册形态

preflight 会标记 `slots.inject` 回调里出现 `slots.register` 的写法。

**本项目判定为合法**，两条依据：

1. 真机验证：重启后 `Slots.listSubTree('settings.section')` 的 occupants 里有
   `{ id: "tool-keeper", order: 50, active: true }`，页面可见。
2. 同宿主已上架的 `dsh-enhance` 浏览器半用的是逐字相同的写法。

### ② 完整插件集共存

只能在设备齐全的真机上验证：把插件装进复刻目标 bundle 组合的**一次性 profile**，启动看是否出现 `1 entry did not activate`。

**当前状态**：本机日常 profile 正常加载、没有 entry 失败；一次性 profile 的完整流程未跑，不冒充通过。

---

## 不值得修的

| 项 | 为什么不动 |
|---|---|
| `splitMcpName` 允许空 leaf | leaf 现在只用于分组显示，不参与判定 |
| `reset` 的备份文件名可预测（`.bak-<时间戳>`） | 同源 + 本地操作，最坏只是同毫秒两个备份互相覆盖 |
| 同源校验信任客户端 `Host` 头 | 浏览器无法伪造 `Host`，浏览器侧不可利用 |
| `ctx.effect` 没传 label | 只影响调试可读性 |
| `package.json` 没有 `author` 字段 | 私有项目 |