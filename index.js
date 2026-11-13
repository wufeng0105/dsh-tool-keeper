/**
 * dsh-toolwarden —— Host 半。
 *
 * 职责：在工具注册入口拦截，按规则决定「丢弃 / 改写 / 放行」。
 *
 * ## 为什么要拦截 register（论证见 REQUIREMENTS.md D1.0）
 *
 * - MCP 工具与内置工具走**同一个入口**：`dsh-mcp-client/src/tools.ts:177`
 *   `ctx.tools.register(definition)`
 * - `description` 在**构造 definition 时**就已固定：`tools.ts:145-149, 257-260`
 * - 模型看到的 schema 从注册的 definition 投影：`dsh-tools/src/schema.ts:641-646`
 *
 * 所以：模型可见文本 = 注册时存入的字段。`restrict()` 只影响「哪些可见」，
 * 不改字段内容（`practices.md:10`）。改写必须在注册期。
 *
 * ## 三条硬约束
 *
 * 1. **绝不中断注册链**（R4.5）。任何本插件自身的错误都必须被吞掉并记为诊断，
 *    然后**原样放行**。一个坏配置不能让工具注册失败。
 * 2. **失败必须可见**（D6）。补丁装不上时要报出来，不能静默失效——
 *    `tool-mask` 就是静默失效的典型。
 * 3. **冷启动即生效**（R4.1）。补丁装在 `apply` 期间，早于任何 MCP 连接。
 *
 * @module @local/dsh-toolwarden
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  normalizeConfig, applyToDefinition, diagnose, splitMcpName, PROTECTED_TOOLS, ToolCatalog,
} from './rules.js';
import { registerTool } from './tool.js';
import { createBaselineConfig } from './baseline.js';

export const name = 'dsh-toolwarden';

/** `tools` 是硬依赖：没有它就无法拦截。`agents` 用不到，不加。 */
export const inject = ['tools'];

/**
 * cordis 的 traceable 代理把真实目标存在这个 symbol 下。
 * 已核实存在于 0.2.2-rc.2 的 `cordis/src/utils.ts`。
 */
const ORIGINAL = Symbol.for('cordis.original');

/** 配置文件位置。可用 configPath 覆盖（测试用）。 */
function configPath(config) {
  if (typeof config?.configPath === 'string' && config.configPath !== '') return config.configPath;
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'toolwarden.json');
}

/** 读配置。任何失败都退化为空配置（全放行），并返回原因。 */
function readConfig(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      // 首次运行：写入出厂基线（审计指出「出厂零配置等于没管理」）
      try {
        const baseline = createBaselineConfig();
        writeConfigFile(path, baseline);
        return { raw: baseline, error: undefined, seeded: true };
      } catch (seedError) {
        return { raw: undefined, error: `cannot seed ${path}: ${String(seedError?.message ?? seedError)}` };
      }
    }
    return { raw: undefined, error: `cannot read ${path}: ${String(error?.message ?? error)}` };
  }
  try {
    return { raw: JSON.parse(text), error: undefined };
  } catch (error) {
    // 半截 JSON / 手改写坏：按空配置运行，绝不中断注册（R4.5）
    return { raw: undefined, error: `invalid JSON in ${path}: ${String(error?.message ?? error)}` };
  }
}

/** 原子写配置：临时文件 + rename，避免崩溃留下半截文件。 */
export function writeConfigFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, path);
  } catch (error) {
    // Windows 上目标被占用时 rename 会失败；退化为直接写
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(error?.code ?? '')) throw error;
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}

/** 从 profile 的 cordis.patch.yml 读 mcp-manager.servers 的键名（用于诊断）。 */
function readKnownServers(config) {
  const explicit = config?.knownServers;
  if (Array.isArray(explicit)) return new Set(explicit.filter(s => typeof s === 'string'));

  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const profile = process.env.DSH_PROFILE || 'desktop';
  const patchPath = join(home, 'profiles', profile, 'cordis.patch.yml');

  let text;
  try {
    text = readFileSync(patchPath, 'utf8');
  } catch {
    return undefined; // 读不到就不做「未知服务器」判定，宁可放过
  }

  // 极简 YAML 提取：只找 mcp-manager 段下的 servers 子键。
  // 不引入 yaml 依赖，因为这一信息只用于诊断提示，不影响过滤正确性。
  const lines = text.split(/\r?\n/);
  const servers = new Set();
  let inMcpManager = false;
  let inServers = false;
  let serversIndent = -1;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === '' || trimmed.trimStart().startsWith('#')) continue;
    const indent = trimmed.length - trimmed.trimStart().length;

    if (/^-\s+id:\s*mcp-manager\s*$/.test(trimmed.trim())) {
      inMcpManager = true;
      inServers = false;
      continue;
    }
    if (inMcpManager && /^-\s+id:/.test(trimmed.trim())) {
      inMcpManager = false; // 下一个顶层条目，退出
      inServers = false;
      continue;
    }
    if (!inMcpManager) continue;

    if (/^servers:\s*$/.test(trimmed.trim())) {
      inServers = true;
      serversIndent = indent;
      continue;
    }
    if (inServers) {
      if (indent <= serversIndent) {
        inServers = false;
        continue;
      }
      // servers 下一层的键：`      context7:`
      if (indent === serversIndent + 2 && /^([A-Za-z0-9_-]+):\s*$/.test(trimmed.trim())) {
        servers.add(trimmed.trim().slice(0, -1));
      }
    }
  }
  return servers.size > 0 ? servers : undefined;
}

/**
 * 插件入口。
 * @param ctx - Cordis 上下文，`ctx.tools` 由 inject 保证
 * @param config - `{ enabled?, configPath?, knownServers? }`；不导出 Config 以免触发 validate 缺陷
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {};
  const log = makeLogger(ctx);

  const path = configPath(settings);
  const { raw, error: readError } = readConfig(path);
  const { rules, problems } = normalizeConfig(raw);

  if (readError !== undefined) {
    // R4.5：配置坏了按全放行跑，但必须报出来
    log.warn(readError + ' — running with an empty config (no tool filtered)');
  }
  for (const problem of problems) log.warn('config: ' + problem);

  // R4.4 总开关：读 toolwarden.json 的 enabled，不依赖插件 Config（那要改 YAML + 重启）
  if (rules.enabled === false) {
    log.info('disabled by toolwarden.json (enabled: false); no tool is filtered');
    provideStatus(ctx, () => ({
      patched: false,
      reason: 'disabled in config',
      stats: { total: 0, dropped: 0, rewritten: 0, kept: 0 },
      problems: [...problems, readError].filter(Boolean),
      diagnostics: [],
      catalog: [],
      configPath: path,
    }));
    return;
  }

  const knownServers = readKnownServers(settings);
  const seen = new Set();
  const catalog = new ToolCatalog();
  const stats = { total: 0, dropped: 0, rewritten: 0, kept: 0, paramsRewritten: 0 };
  const missingParams = new Map(); // toolName -> string[]

  /** 装补丁。返回 { patched, restore, reason } */
  const patch = installPatch(ctx, rules, knownServers, seen, stats, catalog, missingParams, log);

  if (!patch.patched) {
    log.warn('could not install the registration patch: ' + patch.reason);
    // D6：失败可见。通过一个自注册的诊断服务暴露给界面/其他消费者
    provideStatus(ctx, () => ({
      patched: false,
      reason: patch.reason,
      stats: { ...stats },
      problems: [...problems, readError].filter(Boolean),
      diagnostics: [],
      catalog: [],
      configPath: path,
    }));
    return;
  }

  // 定期把诊断算出来（首次注册后即可）
  const computeDiagnostics = () => {
    try {
      const base = diagnose(rules, [...seen], knownServers ?? new Set());
      // R2.2 的参数名不存在也要报出来
      for (const [tool, params] of missingParams) {
        for (const p of params) {
          base.push({ kind: 'warning', target: `rewrite.${tool}.properties.${p}`, message: 'parameter not found on this tool' });
        }
      }
      return base;
    } catch (error) {
      log.warn('diagnose failed: ' + String(error?.message ?? error));
      return [];
    }
  };

  /** 供界面与模型工具读取的完整快照。 */
  const snapshot = () => ({
    patched: true,
    reason: undefined,
    stats: { ...stats },
    problems: [...problems, readError].filter(Boolean),
    diagnostics: computeDiagnostics(),
    configPath: path,
    enabled: rules.enabled,
    groups: [...catalog.groups()].map(([group, entries]) => ({
      group,
      entries: entries.map(e => ({
        name: e.name,
        server: e.server,
        leaf: e.leaf,
        protected: e.protected,
        originalDescChars: e.originalDescChars,
        originalChars: e.originalChars,
        originalDescription: e.description,
      })),
    })),
  });

  provideStatus(ctx, snapshot);

  // 模型可调用的管理工具（审计建议：先给非 JSON 入口，界面是它的薄壳）
  const offTool = registerTool(ctx, {
    configPath: path,
    catalog,
    snapshot,
    log,
  });

  ctx.effect(() => () => {
    patch.restore();
    try {
      offTool();
    } catch {
      // 工具可能已随作用域销毁
    }
  }, 'toolwarden: restore register and tool');

  log.info(
    `patched; config=${path}${knownServers ? '; servers=' + [...knownServers].join(',') : '; servers=unknown'}`
  );
}

/** 装 register 补丁。任何异常都返回 patched:false 而不是抛出。 */
function installPatch(ctx, rules, knownServers, seen, stats, catalog, missingParams, log) {
  let underlying;
  let original;
  let hadOwn;
  try {
    const view = ctx.get('tools') ?? ctx.tools;
    if (view === undefined || view === null) {
      return { patched: false, reason: 'tools service unavailable', restore: () => {} };
    }
    underlying = Reflect.get(view, ORIGINAL) ?? view;
    original = underlying.register;
    if (typeof original !== 'function') {
      return { patched: false, reason: 'tools.register is not a function', restore: () => {} };
    }
    hadOwn = Object.hasOwn(underlying, 'register');
  } catch (error) {
    return { patched: false, reason: 'cannot reach the tools service: ' + String(error?.message ?? error), restore: () => {} };
  }

  const wrapped = function register(definition, options) {
    stats.total += 1;
    let verdict;
    try {
      // 先留原文（R2.4 / R3.3 / R3.4 的共同前置），必须在改写之前
      catalog.record(definition);
      const nm = definition === null || definition === undefined ? undefined : definition.name;
      if (typeof nm === 'string' && nm !== '') seen.add(nm);
      verdict = applyToDefinition(definition, rules, knownServers);
    } catch (error) {
      // 自己的判定出错时绝不阻断注册（R4.5）
      log.warn('decision failed, passing the tool through unchanged: ' + String(error?.message ?? error));
      return original.call(this, definition, options);
    }
    if (verdict.drop) {
      stats.dropped += 1;
      // 不注册：返回一个无害的 disposer，因为调用方会在下一轮同步时调用它
      return () => {};
    }
    if (verdict.definition !== definition) {
      stats.rewritten += 1;
      if (verdict.missingParams !== undefined) {
        const nm = definition === null || definition === undefined ? undefined : definition.name;
        if (typeof nm === 'string') {
          missingParams.set(nm, verdict.missingParams);
        }
      }
    } else {
      stats.kept += 1;
    }
    return original.call(this, verdict.definition, options);
  };

  let installed = false;
  try {
    Reflect.set(underlying, 'register', wrapped);
    installed = underlying.register === wrapped;
  } catch (error) {
    return { patched: false, reason: 'Reflect.set failed: ' + String(error?.message ?? error), restore: () => {} };
  }
  if (!installed) {
    return { patched: false, reason: 'patch did not take effect (frozen or proxied service)', restore: () => {} };
  }

  return {
    patched: true,
    reason: undefined,
    restore: () => {
      try {
        if (hadOwn) Reflect.set(underlying, 'register', original);
        else Reflect.deleteProperty(underlying, 'register');
      } catch (error) {
        log.warn('could not restore tools.register: ' + String(error?.message ?? error));
      }
    },
  };
}

/** 用可选服务把状态暴露出去，供界面或诊断读取。缺服务时静默跳过。 */
function provideStatus(ctx, getter) {
  try {
    if (typeof ctx.provide === 'function') {
      ctx.provide('toolwarden', { status: getter, PROTECTED_TOOLS });
    }
  } catch {
    // provide 失败不影响过滤本身
  }
}

/** 统一的日志出口；拿不到 logger 就退回 console。 */
function makeLogger(ctx) {
  const emit = (level, message) => {
    const line = '[toolwarden] ' + message;
    try {
      const logger = typeof ctx.get === 'function' ? ctx.get('logger') : undefined;
      if (logger && typeof logger[level] === 'function') {
        logger[level](line);
        return;
      }
    } catch {
      // 继续退回 console
    }
    try {
      console[level === 'info' ? 'log' : 'warn'](line);
    } catch {
      // 极简宿主连 console 都没有
    }
  };
  return {
    info: m => emit('info', m),
    warn: m => emit('warn', m),
  };
}
