# Toolwarden · 工具守卫

决定哪些工具进入模型的上下文，并能重写工具与参数的说明文字。

> DSH 插件。实测环境 `0.2.2-rc.2`。私有项目，不发布 npm。

---

## 它解决什么

一个 MCP 服务器挂上来就是几十个工具，每个工具的说明和参数 schema 都进每一轮请求。

实测（本机）：tinyfish 43 个工具 = 96,413 字符 ≈ 27,500 tokens/轮，占全部工具开销的一半以上，而其中大部分是 `create_dataset` / `top_up_wallet` / `cancel_monitor` 这类平时用不到的管理工具。

**Toolwarden 做两件事：**

1. **准入** —— 决定哪些工具进入上下文
2. **改写** —— 决定进来的工具说什么话

第 2 件是它与同类插件的差别。`restrict()` 只能隐藏，不能改内容。

---

## 快速开始

装上即用。**出厂状态不管理任何工具** —— 工具数量和说明与没装插件完全一致，由你自己决定关哪个、改哪个。

配置在 `~/.dsh/toolwarden.json`，首次运行自动生成（全空的基线）。

**改完需重启 DSH 生效**（工具在注册期拦截，已注册的不会自动更新）。

> **为什么出厂是空的**：一个管理工具的默认值不应该替用户做决定。
> 关掉某个工具是砍功能，预设某个服务器的白名单是猜用户怎么用。
> 它该做的是把全部工具**摆出来**（`action=list`），让用户看到之后再决定。
> 看到是透明，关掉是决策 —— 前者默认给，后者等用户说。

---

## 用对话管理

不用手改 JSON，直接跟模型说。模型会调 `toolwarden` 工具：

| 你说 | 它做什么 |
|---|---|
| 「看看现在工具占多少」 | `action=status` |
| 「列出所有工具」 | `action=list`，按来源分组带字符数 |
| 「exa 只留网页搜索」 | `action=server server=exa keep=[web_search_exa]` |
| 「把 lexiang 整个关掉」 | `action=server server=lexiang keep=[]` |
| 「关掉 create_dataset」 | `action=tool name=mcp__tinyfish__create_dataset state=drop` |
| 「fetch_content 的说明改成…」 | `action=rewrite target=description text=…` |
| 「include_selectors 参数说明太长了，改成…」 | `action=rewrite target=param param=include_selectors text=…` |
| 「恢复那个工具的原始说明」 | `action=rewrite`（省略 text） |
| 「全部关掉，别管工具了」 | `action=enable value=false` |
| 「恢复出厂设置」 | `action=reset` |

---

## 手改配置

也可以直接编辑 `~/.dsh/toolwarden.json`：

```jsonc
{
  "enabled": true,                          // 总开关，false = 全部放行

  "servers": {
    // keep 白名单：只保留列出的工具
    "tinyfish": { "keep": ["search", "fetch_content"] },
    // enabled: false：整个服务器关闭
    "lexiang": { "enabled": false }
  },

  "tools": {
    // 单工具开关。受保护的工具写了也会被拒绝并报错
    "mcp__exa__agent_run": "drop"
  },

  "rewrite": {
    // 简单形态：只改工具说明
    "mcp__tinyfish__search": "搜索网页与外部知识。",

    // 完整形态：同时改工具说明和参数说明
    "mcp__tinyfish__fetch_content": {
      "description": "读取网页正文，支持一次 10 个 URL。",
      "properties": {
        "include_selectors": "CSS 选择器数组，只提取匹配的元素。",
        "ttl": "缓存有效秒数。"
      }
    }
  }
}
```

### 优先级

冲突时**最具体者胜**：

```
单工具规则  >  服务器白名单  >  服务器总开关
```

### 保护名单

这些工具**任何配置都关不掉**（关掉等于把会话锁死）：

```
read  write  edit  glob  grep  pwsh
present  todo_write  ask_user_question  toolwarden  skill
```

写入受保护工具会得到明确的诊断，不是静默忽略。

---

## 实测效果

以下数据来自实装测试（配置是我为验证写的，不是出厂值）：

| 项 | 改前 | 改后 |
|---|---|---|
| 工具总数 | 101 | 60 |
| tinyfish | 43 | 2 |
| `fetch_content` 工具说明 | 2,166 字符 | 36 字符 |
| `include_selectors` 参数说明 | 1,080 字符 | 19 字符 |
| `exclude_selectors` 参数说明 | 497 字符 | 22 字符 |
| `parameters` 结构 | 8,443 字符 | 未改动的保持原样 |
| **该配置合计节省** | — | **≈ 23,300 tokens/轮** |

**结构字段（type / required / enum / 默认值）一个不动**，只改说明文本。

省多少取决于你关多少。出厂状态是 0。

---

## 可靠性

| 场景 | 行为 |
|---|---|
| 冷启动 | 生效（补丁在注册入口，早于任何 MCP 连接） |
| 配置损坏 | 按全放行运行，日志与诊断报错，**绝不中断注册链** |
| 插件自身出错 | 原样放行该工具，不阻断注册 |
| 卸载插件 | 恢复服务器原样 |
| 补丁装不上 | 显式报 `patched: false`，不静默失效 |

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 改配置需重启 | 工具在注册期拦截，已注册的不自动更新。**即时生效需另加 `restrict()` 路径**（未实现） |
| 无界面 | 目前靠 `toolwarden` 工具或手改 JSON。设置页是下一期 |
| 不改结构 | 有意为之：结构改错会让工具直接报错，文本改错只是说明不准 |
| 出厂零配置 | 有意为之：不替用户做决定。装完节省为 0，需自己关 |

---

## 项目文档

| 文件 | 内容 |
|---|---|
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 需求、技术决策、验收标准 |
| [VERIFICATION-P4.md](./VERIFICATION-P4.md) | 运行时验证记录（含未验证项） |
| [WORKING-AGREEMENT.md](./WORKING-AGREEMENT.md) | 阶段模型、授权边界、证据分级 |

---

## 开发

```bash
npm test    # 66 条测试
node <plugin-kit>/skills/plugin-kit/scripts/preflight.mjs .
```

**测试纪律**：每个断言型检查都做过变异测试——故意改坏实现，确认测试会红。
