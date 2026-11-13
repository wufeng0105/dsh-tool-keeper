/**
 * dsh-tool-keeper —— 出厂基线：**什么都不做**。
 *
 * ## 为什么是空的
 *
 * 初版基线我犯过两次同类错误，都记在这里：
 *
 * 1. 第一次写成了「关掉 6 个低频内置工具」（create_goal / exit_plan_mode /
 *    working_directory 等）。理由看起来成立——它们是低频——但这是错的：
 *    关掉等于砍功能，而用户装管理工具不是为了让宿主能力变少。
 *
 * 2. 第二次改成「不动内置工具，只对 tinyfish 保留 search + fetch_content」。
 *    看起来保守，但**仍然是替用户做决定**：用户可能根本没用过 tinyfish，
 *    可能想留 run_web_automation，可能第二天就换了服务器。
 *
 * 结论：**一个管理工具的出厂状态不应该管理任何东西。**
 *
 * 它该做的是：把所有能管的工具**摆出来**让用户看到（action=list），
 * 然后由用户决定关哪个。看到和关掉是两件事——前者是透明，后者是决策。
 *
 * ## 空基线意味着什么
 *
 * - 装完之后，工具数量和说明**与没装插件完全一致**
 * - 零风险：不可能因为默认规则误伤任何能力
 * - 节省为 0，除非用户自己动手
 *
 * 如果用户想要一套现成的推荐值，那是**预设（preset）**，应该显式选择，
 * 而不是偷偷写进出厂状态。
 *
 * @module dsh-tool-keeper/baseline
 */

/** 内置工具的出厂策略：一个都不关。 */
export const BASELINE_DROP = Object.freeze([]);

/** MCP 服务器的出厂策略：一个都不动。 */
export const BASELINE_SERVERS = Object.freeze({});

/**
 * 生成出厂配置：全空。
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled] - 总开关，默认 true
 * @returns {object} 可直接写入 tool-keeper.json 的对象
 */
export function createBaselineConfig(options = {}) {
  const enabled = options.enabled !== false;
  return {
    _comment: [
      'Tool Keeper 出厂状态：不管理任何工具，全部原样。',
      '要关工具，用 servers / tools 填写；要改说明，用 rewrite 填写。',
      '也可以用模型工具 tool-keeper（action=list 先看有哪些，再决定关哪个）。',
      '被 PROTECTED_TOOLS 保护的受保护工具（read/write/edit/pwsh 等）任何配置都关不掉。',
      '全部放行：把 enabled 设为 false。',
    ],
    enabled,
    servers: {},
    tools: {},
    rewrite: {},
  };
}
