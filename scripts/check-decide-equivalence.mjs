// D2 的等价性证明：合并前后 decide() 行为必须完全一致。
// 与 ROADMAP-AUDIT 里那份穷举脚本同源，这里用真实 decide() 与旧实现逐组对照。
import { decide, normalizeConfig } from '../rules.js';

const PROTECTED = ['read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'present', 'todo_write', 'ask_user_question', 'tool_keeper', 'skill'];
function split(n) {
  if (typeof n !== 'string' || !n.startsWith('mcp__')) return undefined;
  const rest = n.slice(5);
  const cut = rest.indexOf('__');
  if (cut <= 0 || cut + 2 >= rest.length) return undefined;
  return { server: rest.slice(0, cut), leaf: rest.slice(cut + 2) };
}

// 合并前的旧实现（逐字照抄 git 历史）
function oldDecide(name, rules) {
  if (typeof name !== 'string' || name === '') return { action: 'keep', reason: 'unnamed' };
  if (PROTECTED.includes(name)) return { action: 'keep', reason: 'protected' };
  const parts = split(name);
  const override = rules.toolOverrides.get(name);
  if (parts !== undefined) {
    if (rules.disabledServers.has(parts.server)) return { action: 'drop', reason: `server ${parts.server} disabled` };
    if (override === 'drop') return { action: 'drop', reason: 'tool override: drop' };
  } else if (override === 'drop') {
    return { action: 'drop', reason: 'tool override: drop' };
  }
  const entry = rules.rewrites.get(name);
  if (entry !== undefined) return { action: 'rewrite', rewrite: entry, reason: 'rewrite configured' };
  return { action: 'keep', reason: override === 'keep' ? 'tool override: keep' : 'no rule' };
}

const names = [
  'read', 'write', 'pwsh', 'tool_keeper', 'skill', 'glob',
  'mcp__exa__search', 'mcp__exa__agent_run', 'mcp__tinyfish__search',
  'mcp__disabledsrv__x', 'mcp__nodouble', 'notmcp', '', 'mcp__a__b',
];
const configs = [
  {},
  { tools: { 'mcp__exa__search': 'drop' } },
  { tools: { 'mcp__exa__search': 'keep' } },
  { tools: { read: 'drop' } },                       // 受保护：应被忽略
  { tools: { notmcp: 'drop' } },                     // 非 MCP 名有 drop 规则
  { tools: { 'mcp__nodouble': 'drop' } },            // 解析不出 server 的名字
  { servers: { exa: { enabled: false } } },
  { servers: { exa: { enabled: false } }, tools: { 'mcp__exa__search': 'keep' } },
  { servers: { exa: { enabled: false } }, tools: { 'mcp__exa__search': 'drop' } },
  { servers: { disabledsrv: { enabled: false } } },
  { servers: { disabledsrv: { enabled: false } }, tools: { notmcp: 'drop' } },
  { rewrite: { 'mcp__exa__search': '说明' } },
  { rewrite: { read: '说明' } },
  { rewrite: { notmcp: '说明' } },
  { servers: { exa: { enabled: false } }, rewrite: { 'mcp__exa__search': '说明' } },
];

let bad = 0, total = 0;
for (const cfg of configs) {
  const { rules } = normalizeConfig(cfg);
  for (const n of names) {
    total++;
    const a = JSON.stringify(oldDecide(n, rules));
    const b = JSON.stringify(decide(n, rules));
    if (a !== b) { bad++; console.log('不等价:', n, JSON.stringify(cfg), a, b); }
  }
}
console.log(`D2 等价性: ${total} 组对照，${bad} 处不等`);
console.log(bad === 0 ? '=> 合并后行为与旧实现完全一致' : '=> 存在差异，不可合并');
process.exit(bad === 0 ? 0 : 1);
