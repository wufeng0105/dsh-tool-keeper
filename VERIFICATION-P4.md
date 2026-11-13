# P4 运行时验证记录

> 2026-11-13。完整进程重启后实测，非页面刷新、非热重载。
> 证据等级：L1（运行时实测）

---

## 验证环境

- DSH `0.2.2-rc.2`，desktop profile
- 装着 15 个 bundle：dshmarket、dsh-enhance、teammate-model-picker、draft-studio、xdpool、archive-manager、plugin-kit、toolwarden 等
- 4 个 MCP 服务器：context7、exa、tinyfish、lexiang

**这是真实环境，不是最小 profile。** 满足 WORKING-AGREEMENT 对 P4 的要求。

---

## A2 隐藏生效 — PASS

配置：
```json
{ "servers": { "tinyfish": { "keep": ["search", "fetch_content"] } } }
```

结果（集合断言，不是数量断言）：

| | 基线 | 现在 |
|---|---|---|
| 工具总数 | 101 | 60 |
| tinyfish | 43 | 2 |
| 消失 | — | 41 |
| **新增** | — | **0** |

tinyfish 仅剩：`mcp__tinyfish__search`、`mcp__tinyfish__fetch_content`

---

## A3 改写生效 — PASS

配置：
```json
{ "rewrite": { "mcp__tinyfish__fetch_content": "读取网页正文，支持一次 10 个 URL，返回干净的 Markdown。" } }
```

结果：

| 字段 | 基线 | 现在 |
|---|---|---|
| `fetch_content.description` | 2,166 字符 | **36 字符** |
| 内容 | "Default, free, and most token-efficient…" | 配置的中文文本 |

---

## D2 结构未动 — PASS

| 工具 | 基线 parameters | 现在 |
|---|---|---|
| `fetch_content` | 8,443 字符 | **8,443 字符**（逐字节一致） |
| `search` | 4,057 字符 | **4,057 字符**（逐字节一致） |

证明 `applyToDefinition` 只替换 `description`，`parameters` / `output` 保持同一引用。

---

## A5 冷启动生效 — PASS

上述全部结果来自**完整进程重启后的首轮**。双断言：
1. 工具名集合 == 基线 − 隐藏集合 ✅
2. 改写文本存活 ✅

这是 `tool-mask` 栽的地方（一次性计算 + MCP 异步注册错配），Toolwarden 用注册入口拦截规避了。

---

## A6 保护名单 — PASS（逻辑层）

配置试图隐藏 `read` / `write` / `pwsh`：

```
配置里的 tools 键: read, write, pwsh
归一化后 toolOverrides: (空)
problems:
  - tools.read is protected and cannot be overridden; ignored
  - tools.write is protected and cannot be overridden; ignored
  - tools.pwsh is protected and cannot be overridden; ignored

read  → keep (protected)
write → keep (protected)
pwsh  → keep (protected)
```

**未做**：界面层验证（本期无界面）。运行时层已由逻辑保证——保护工具永不进入 deny 集合。

---

## A9 配置损坏不锁死 — PASS（逻辑层）

写入半截 JSON：
```
{ "servers": { "tinyfish": { "keep": ["search"
```

结果：
```
解析结果: 失败 → Expected ',' or ']' after array element in JSON at position 46
退化为空规则后，tinyfish__search 判定: keep (no rule)
```

**坏配置绝不隐藏任何工具，绝不中断注册链。**

**未做**：真机重启验证（重启脚本在解析失败时走 `readError` 分支，代码路径已覆盖但未真机触发）。

---

## 实测收益

| 项 | 字符 | ≈tokens/轮 |
|---|---|---|
| 隐藏 41 个 tinyfish 工具 | 79,505 | 22,716 |
| 改写 fetch_content 说明 | 2,130 | 609 |
| **合计** | **81,635** | **≈23,300** |

工具总数减少 41%。

---

## 仍未验证（UNVERIFIABLE，不冒充通过）

| 项 | 原因 | 影响 |
|---|---|---|
| 改写后的 definition 是否被下游重新校验 | 无法从外部观测 | 低——A3 已证实模型侧看到的是改写后文本 |
| 补丁在服务冻结时的失败路径 | 未真机触发 | 低——代码有 `patched: false` 分支，但未验证其可见性 |
| 客户端↔宿主 RPC | 未查清 | 阻塞第二期界面 |

---

## 证据等级说明

本节全部结论为 **L1（运行时实测）**，除标注"逻辑层"的两条为 **L2（离线执行真实代码）**。

`A6` / `A9` 的逻辑层验证方式：用真实的 `rules.js` 配合真实配置文件离线执行，不是模拟。
