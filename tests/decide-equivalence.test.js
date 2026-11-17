/**
 * decide() 的等价性守卫。
 *
 * 背景：decide() 里曾有两只字面完全相同的分支（服务器闸内与外各写一遍
 * 「单工具规则」判断），合并成一只时，最容易犯的错是把
 * `override === 'drop'` 又嵌回 `parts !== undefined` 里——那样 MCP 工具照常，
 * 原生工具（web_fetch、schedule_list 这些不在保护名单里的）全部漏网。
 *
 * 本文件把「合并前的旧实现」逐字保存在测试里，与新实现全组合对照。
 * 它不检查某个具体结论，而是检查**两种写法给出的每一个结果都相同**，
 * 所以将来无论谁再动这个函数，只要行为变了就会红。
 *
 * 旧实现来自 0.8.0 的 rules.js（合并前）；改动它等于改动被测的基准，
 * 不要为了让它变绿而修改 oldDecide。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, normalizeConfig, PROTECTED_TOOLS, splitMcpName } from '../rules.js';

/** 合并前的旧实现，与 0.8.0 逐字对应。 */
function oldDecide(name, rules) {
  if (typeof name !== 'string' || name === '') {
    return { action: 'keep', reason: 'unnamed' };
  }
  if (PROTECTED_TOOLS.includes(name)) {
    return { action: 'keep', reason: 'protected' };
  }
  const parts = splitMcpName(name);
  const override = rules.toolOverrides.get(name);
  if (parts !== undefined) {
    if (rules.disabledServers.has(parts.server)) {
      return { action: 'drop', reason: `server ${parts.server} disabled` };
    }
    if (override === 'drop') {
      return { action: 'drop', reason: 'tool override: drop' };
    }
  } else if (override === 'drop') {
    return { action: 'drop', reason: 'tool override: drop' };
  }
  const entry = rules.rewrites.get(name);
  if (entry !== undefined) {
    return { action: 'rewrite', rewrite: entry, reason: 'rewrite configured' };
  }
  return { action: 'keep', reason: override === 'keep' ? 'tool override: keep' : 'no rule' };
}

/** 去掉 rewrite 条目里的 Map，只比值语义，方便直接 deepEqual。 */
function comparable(verdict) {
  if (verdict.rewrite === undefined) return verdict;
  const { properties, ...rest } = verdict.rewrite;
  return { ...verdict, rewrite: { ...rest, properties: properties === undefined ? undefined : [...properties] } };
}

const NAMES = [
  // 受保护的
  'read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'present', 'todo_write',
  'ask_user_question', 'tool_keeper', 'skill',
  // 普通原生工具（可 drop，且不在保护名单）
  'web_fetch', 'web_search', 'schedule_list', 'create_goal', 'list_agents', 'workflow',
  // MCP：正常
  'mcp__exa__search', 'mcp__tinyfish__search', 'mcp__tinyfish__fetch_content',
  // MCP：被停用的服务器
  'mcp__rea__analyze_bundle', 'mcp__lexiang__whoami',
  // MCP：服务器名不在配置里
  'mcp__ghost__whatever',
  // MCP：解析不出 server 的畸形名（splitMcpName 返回 undefined）
  'mcp__nodouble', 'mcp__a__', 'mcp____x',
  // 完全不是 MCP
  'notmcp', 'some_native_tool', '',
];

const CONFIGS = [
  {},
  { tools: { 'mcp__exa__search': 'drop' } },
  { tools: { 'mcp__exa__search': 'keep' } },
  { tools: { web_fetch: 'drop' } },
  { tools: { 'notmcp': 'drop' } },
  { tools: { 'some_native_tool': 'drop' } },
  { tools: { 'mcp__nodouble': 'drop' } },
  { tools: { read: 'drop' } },
  { servers: { rea: { enabled: false } } },
  { servers: { rea: { enabled: false } }, tools: { 'mcp__rea__analyze_bundle': 'keep' } },
  { servers: { rea: { enabled: false } }, tools: { 'mcp__rea__analyze_bundle': 'drop' } },
  { servers: { lexiang: { enabled: false } }, tools: { web_fetch: 'drop' } },
  { rewrite: { 'mcp__exa__search': '说明' } },
  { rewrite: { web_fetch: '读网页' } },
  { rewrite: { read: '受保护也能配，只是不生效' } },
  { servers: { rea: { enabled: false } }, rewrite: { 'mcp__rea__analyze_bundle': '说明' } },
];

test('decide: 与合并前的旧实现在全部组合上结果一致', () => {
  let compared = 0;
  for (const config of CONFIGS) {
    const { rules } = normalizeConfig(config);
    for (const name of NAMES) {
      compared += 1;
      const oldVerdict = comparable(oldDecide(name, rules));
      const newVerdict = comparable(decide(name, rules));
      assert.deepEqual(
        newVerdict,
        oldVerdict,
        `decide(${JSON.stringify(name)}, ${JSON.stringify(config)}) 与旧实现不一致`,
      );
    }
  }
  assert.ok(compared >= 300, '组合数不应缩水，实际 ' + compared);
});

test('decide: 非 MCP 名字的 drop 规则不被 MCP 分支吞掉', () => {
  // 这一条专门守「合并时把判断嵌回 parts !== undefined」这个错法。
  const { rules } = normalizeConfig({ tools: { web_fetch: 'drop', 'notmcp': 'drop' } });
  assert.equal(decide('web_fetch', rules).action, 'drop');
  assert.equal(decide('notmcp', rules).action, 'drop');
});
