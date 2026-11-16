/**
 * dsh-tool-keeper —— 说明页与工具说明的写作质量检查器。
 *
 * ## 为什么要有这个脚本
 *
 * 「改写工具说明」这件事改的是模型理解工具的唯一依据。改错了不会报错，
 * 只会让模型悄悄少看到一个工具、或者按一段错话去用它。
 * 单测管不了这层——它测的是代码行为，不是文字内容。
 *
 * 所以这里把「什么样的说明算合格」写成可机判的判据。每一条都能判真假，
 * 判不了的显式标出来，不冒充通过。
 *
 * ## 怎么跑
 *
 * 需要两个输入，都来自真机，脚本自身不连宿主：
 *
 *   1. 宿主实际注册的工具快照 —— cordis_inspect_query(platform=host,
 *      provider=Tool, method=listTools)，把返回的 JSON 落盘。
 *   2. 配置文件 ~/.dsh/tool-keeper.json。
 *
 *   node scripts/check-rewrites.mjs <listTools快照.json> <tool-keeper.json>
 *
 * 退出码 0 表示全部判据通过，1 表示有 FAIL。
 *
 * @module dsh-tool-keeper/scripts/check-rewrites
 */
import { readFileSync } from 'node:fs';

const [livePath, cfgPath] = process.argv.slice(2);
if (!livePath || !cfgPath) {
  console.error('用法: node scripts/check-rewrites.mjs <listTools快照.json> <tool-keeper.json>');
  process.exit(2);
}

const live = JSON.parse(readFileSync(livePath, 'utf8')).data.tools;
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const liveMap = new Map(live.map(t => [t.name, t]));

/** 本次检查覆盖的工具（改写了说明的 MCP 工具）。 */
const TARGETS = [
  'mcp__codegraph__codegraph_explore',
  'mcp__context7__resolve-library-id',
  'mcp__context7__query-docs',
  'mcp__exa__web_search_exa',
  'mcp__exa__web_search_advanced_exa',
  'mcp__exa__web_fetch_exa',
  'mcp__exa__agent_run',
  'mcp__tinyfish__search',
  'mcp__tinyfish__fetch_content',
];
/** 内置兜底工具：不在改写范围，但参与「不点名别家工具」与切换条件的判定。 */
const BUILTIN_FETCH = 'web_fetch';
/** 本次检查覆盖的服务器说明页。 */
const SERVERS = ['codegraph', 'context7', 'exa', 'tinyfish'];

/** 取改写后生效的说明文本（没有改写则取宿主原文）。 */
const effDesc = name => {
  const rw = cfg.rewrite?.[name];
  if (rw === undefined) return liveMap.get(name)?.description ?? '';
  return typeof rw === 'string' ? rw : (rw.description ?? '');
};
const effParams = name => {
  const def = liveMap.get(name)?.parameters?.properties ?? {};
  const rw = cfg.rewrite?.[name];
  const over = (rw && typeof rw === 'object' && rw.properties) ? rw.properties : {};
  const out = {};
  for (const [k, v] of Object.entries(def)) out[k] = over[k] ?? v.description ?? '';
  return out;
};

const results = [];
const record = (id, ok, total, failures, note) => results.push({ id, ok, total, failures, note });

// ---------- C1 语言统一：整段未译，不是个别专有名词 ----------
//
// 判据不能是「出现英文单词」——专有名词、枚举值、动词本来就会是英文。
// 真正的缺陷是「整句英文没翻译」。所以按标点切段，逐段判断：
//   该段中文字符数 == 0 且 英文单词数 >= 5  → 未译
// 单个技术名词（SQLite、grep、web）不会命中断句阈值。
const ENUMS = new Set(['web', 'news', 'research_paper', 'auto', 'lite', 'fast', 'instant',
  'markdown', 'html', 'json', 'true', 'false']);

const segments = s => s
  .replace(/`[^`]*`/g, ' ')                  // 反引号内容不参与判断
  .replace(/https?:\/\/\S+/g, ' ')
  .split(/[。；;：:\n,，、(（)）]/)
  .map(x => x.trim())
  .filter(Boolean);

/** 返回未译的段落（原始文本），供人工核对。 */
const untranslated = s => {
  const out = [];
  for (const seg of segments(s)) {
    const zh = (seg.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (seg.match(/\b[A-Za-z][A-Za-z'-]{1,}\b/g) || [])
      .filter(w => !ENUMS.has(w.toLowerCase()));
    if (zh === 0 && en.length >= 5) out.push(seg.slice(0, 60));
  }
  return out;
};

{
  const bad = [];
  let total = 0;
  for (const n of [...TARGETS, ...SERVERS.map(s => `servers.${s}`)]) {
    total++;
    const text = n.startsWith('servers.')
      ? (cfg.servers?.[n.slice(8)]?.rewrite ?? '')
      : effDesc(n);
    if (text === '') continue;   // 说明页未配改写，由 C3 单独管
    const hits = untranslated(text);
    if (hits.length) bad.push(`${n}: ${hits.length} 段未译，如「${hits[0]}…」`);
  }
  for (const n of TARGETS) {
    const p = effParams(n);
    const hits = Object.entries(p).filter(([, v]) => untranslated(String(v)).length > 0);
    if (hits.length) bad.push(`${n.split('__').pop()} 参数: ${hits.length} 个未译 (${hits.slice(0, 3).map(h => h[0]).join(', ')})`);
  }
  record('C1', bad.length === 0, total, bad, '描述与参数均已中文化');
}

// ---------- C2 工具说明不重复别家工具 ----------
// 只认「全名」引用：mcp__x__y、x.web_fetch_exa、或与某工具 leaf 完全一致的词。
// 普通英文单词（search 作动词、read 作动词）不算引用，避免误报。
{
  const leafOf = n => n.split('__').pop();
  const refPattern = new Map();   // leaf -> RegExp（带 server 前缀才算）
  for (const n of [...TARGETS, BUILTIN_FETCH]) {
    const leaf = leafOf(n);
    if (leaf.length < 6) continue;   // 过短的词（read）不作为引用判定
    refPattern.set(leaf, new RegExp(`(?:mcp__\\w+__|\\b\\w+\\.)${leaf}\\b|mcp__\\w+__${leaf}\\b`));
  }
  const bad = [];
  for (const n of TARGETS) {
    const d = effDesc(n);
    const self = leafOf(n);
    const mentioned = [];
    for (const [leaf, re] of refPattern) {
      if (leaf === self) continue;
      if (re.test(d)) mentioned.push(leaf);
    }
    if (mentioned.length) bad.push(`${self} 提到了 ${mentioned.join(', ')}`);
  }
  record('C2', bad.length === 0, TARGETS.length, bad, '路由只在说明页，工具说明不点名别家工具');
}

// ---------- C3 说明页自包含 ----------
// 说明页会被整段替换进系统提示词。若它写「见 AGENTS.md」之类的外部指针，
// 模型读到的就只是一句指向别处的话——那不是说明，是断掉的线索。
{
  const POINTER = ['见用户', 'AGENTS.md', '见别处', '详见', '参见', '规则见', '见上文', '见下'];
  const bad = [];
  for (const s of SERVERS) {
    const t = cfg.servers?.[s]?.rewrite ?? '';
    if (!t) { bad.push(`${s}: 未配说明页改写`); continue; }
    const hit = POINTER.filter(p => t.includes(p));
    if (hit.length) bad.push(`${s}: 含外部指针 ${hit.join(', ')}`);
  }
  record('C3', bad.length === 0, SERVERS.length, bad, '说明页不依赖外部文件');
}

// ---------- C4 路由完整 ----------
// 同类工具的选择条件、抓取簇各成员的选择条件，必须在对应说明页出现。
{
  const RULES = [
    { cluster: '搜索', member: 'recency_minutes', page: 'tinyfish', label: 'tinyfish.search 的时效条件' },
    { cluster: '搜索', member: 'research_paper', page: 'tinyfish', label: 'tinyfish.search 的学术条件' },
    { cluster: '搜索', member: 'web_search_advanced_exa', page: 'exa', label: 'exa 过滤检索的适用条件' },
    { cluster: '抓取', member: 'fetch_content', page: 'tinyfish', label: 'tinyfish.fetch_content 的抓取条件' },
    { cluster: '抓取', member: 'web_fetch_exa', page: 'exa', label: 'exa 抓取的替代条件' },
    { cluster: '抓取', member: 'web_fetch', page: 'tinyfish', label: '内置 web_fetch 兜底（tinyfish 侧）' },
    { cluster: '抓取', member: 'web_fetch', page: 'exa', label: '内置 web_fetch 兜底（exa 侧）' },
  ];
  const bad = [];
  for (const r of RULES) {
    const t = cfg.servers?.[r.page]?.rewrite ?? '';
    if (!t.includes(r.member)) bad.push(`${r.label}: 说明页未提及 ${r.member}`);
  }
  record('C4', bad.length === 0, RULES.length, bad, '同类工具的切换条件在说明页到位');
}

// ---------- C5 schema 陷阱已提示 ----------
// 有些工具的 JSON Schema 把「有默认值」的参数列进 required，模型会误以为必须逐个填。
// 这类参数超过一个时，工具说明必须点明「实际只有 X 必填」。
{
  const bad = [];
  for (const n of TARGETS) {
    const def = liveMap.get(n);
    const req = def?.parameters?.required ?? [];
    const props = def?.parameters?.properties ?? {};
    const fake = req.filter(k => props[k] && props[k].default !== undefined && k !== 'urls');
    if (fake.length === 0) continue;
    const d = effDesc(n);
    const hinted = /只需|只需要|仅需|只有.*必填|必填.*只有/.test(d);
    if (!hinted) bad.push(`${n.split('__').pop()}: ${fake.length} 个带默认值的必填参数未被提示`);
  }
  record('C5', bad.length === 0, TARGETS.length, bad, 'schema 假必填已在描述中点明');
}

// ---------- C6 无死键 ----------
// 改写里写的参数名必须真的存在于 schema，否则那条改写永远不会生效，也不会报错。
{
  const bad = [];
  for (const [n, e] of Object.entries(cfg.rewrite ?? {})) {
    if (typeof e !== 'object' || !e.properties) continue;
    const props = liveMap.get(n)?.parameters?.properties;
    if (!props) { bad.push(`${n}: 工具不存在`); continue; }
    for (const k of Object.keys(e.properties)) {
      if (!(k in props)) bad.push(`${n.split('__').pop()}.${k}: schema 无此参数`);
    }
  }
  record('C6', bad.length === 0, Object.keys(cfg.rewrite ?? {}).length, bad, '改写参数名全部存在');
}

// ---------- C7 说明页不裸写站点专名 ----------
// 站点风控是波动的：同一 URL 可能这次失败下次成功，把站名写死会把模型引向
// 一条并不稳定的路。可写的是「什么现象出现时换工具」，不是「哪个站怎么走」。
// 站名会过时（新站层出不穷），现象不会。
//
// 局限（UNVERIFIABLE 部分）：下面是手写枚举，只能拦已知站名，新站漏得掉。
// 它证明的是「没有出现这些站名」，不是「没有任何站名」。
const SITES = ['CSDN', '知乎', '掘金', '博客园', '思否', 'SegmentFault', '简书', '微博',
  '百度', 'gov.cn', '人民网', '新华网', 'StackOverflow', 'Stack Overflow'];
{
  const bad = [];
  for (const s of SERVERS) {
    const t = cfg.servers?.[s]?.rewrite ?? '';
    const hit = SITES.filter(site => t.includes(site));
    if (hit.length) bad.push(`${s}: 裸写站点名 ${hit.join(', ')}`);
  }
  record('C7', bad.length === 0, SERVERS.length, bad, '说明页写现象不写站点（仅拦已知站名）');
}

// ---------- 输出 ----------
let fail = 0;
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  if (!r.ok) fail++;
  console.log(`[${tag}] ${r.id}  ${r.note}  (${r.total} 项)`);
  for (const f of r.failures) console.log(`        - ${f}`);
}
console.log(`\n合计 ${results.length} 条判据，FAIL ${fail} 条`);
process.exit(fail === 0 ? 0 : 1);
