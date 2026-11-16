/**
 * dsh-tool-keeper —— 出厂基线：**什么都不做**。
 *
 * ## 为什么是空的
 *
 * **一个管理工具的出厂状态不应该管理任何东西。** 装完之后，工具数量和说明
 * 与没装插件完全一致；零风险，也不会替用户做决定——关掉任何东西都等于砍功能。
 *
 * 它该做的是把能管的工具摆出来让用户看到（action=list），由用户决定关哪个。
 * 看到和关掉是两件事：前者是透明，后者是决策。想要现成的推荐值那是预设，
 * 应该由用户显式选择，而不是写进出厂状态。
 *
 * @module dsh-tool-keeper/baseline
 */

/**
 * 生成出厂配置：全空。
 *
 * @returns {object} 可直接写入 tool-keeper.json 的对象
 */
export function createBaselineConfig() {
  return {
    _comment: [
      'Tool Keeper 出厂状态：不管理任何工具，全部原样。',
      '关工具：tools 里填 "drop"；改工具说明：rewrite 里写。',
      '关整台服务器：servers 里写 enabled:false；改它的说明页：servers 里写 rewrite。',
      '也可以用模型工具 tool_keeper（action=list 先看有哪些，再决定关哪个）。',
      'read/write/edit/pwsh 等基础工具任何配置都关不掉（会被拒绝并说明原因）。',
      '插件级启停由 DSH 插件页负责，本文件没有 enabled 全局字段。',
    ],
    servers: {},
    tools: {},
    rewrite: {},
  };
}
