/**
 * dsh-tool-keeper —— Host 半。
 *
 * 职责：在工具注册入口拦截，按规则决定「丢弃 / 改写 / 放行」。
 *
 * ## 为什么必须在注册期拦截（论证见 docs/DESIGN.md）
 *
 * - MCP 工具与内置工具走同一个入口：`ctx.tools.register(definition)`。
 * - `description` 在构造 definition 时就已固定，不是每次读取时取。
 * - 模型看到的 schema 由注册的 definition 投影而来。
 *
 * 所以：模型可见文本 = 注册时存入的字段。`restrict()` 只影响哪些可见，
 * 不改字段内容，改写只能在注册期做。
 *
 * ## 三条硬约束
 *
 * 1. **绝不中断注册链**：本插件自身的错误必须被吞掉并记为诊断，然后原样放行。
 * 2. **失败必须可见**：补丁装不上时报出来，不静默失效。
 * 3. **冷启动即生效**：补丁装在 `apply` 期间，早于任何 MCP 连接。
 *
 * @module dsh-tool-keeper
 */

import {
  normalizeConfig, applyToDefinition, diagnose, PROTECTED_TOOLS, ToolCatalog,
} from './rules.js';
import { configPath, readConfig } from './config.js';
import { installInstructionsFilter } from './instructions.js';
import { registerTool } from './tool.js';
import { mountApi } from './api.js';
import { hashText } from './hash.js';

export const name = '@wufeng0105/dsh-tool-keeper';

/** `tools` 是硬依赖：没有它就无法拦截。`agents` 用不到，不加。 */
export const inject = ['tools'];

/**
 * cordis 的 traceable 代理把真实目标存在这个 symbol 下。
 * 已在安装包的 `cordis/src/utils.ts` 中核实；说明见 docs/HOST-CONTRACT.md。
 */
const ORIGINAL = Symbol.for('cordis.original');
/**
 * 插件入口。
 * @param ctx - Cordis 上下文，`ctx.tools` 由 inject 保证
 * @param config - `{ configPath? }`；不导出 Config 以免触发 validate 缺陷
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {};
  const log = makeLogger(ctx);

  const path = configPath(settings);
  const { raw, error: readError, text: configText } = readConfig(path);
  const { rules, problems } = normalizeConfig(raw);

  // 启动时这份配置的指纹。设置页拿它跟磁盘当前内容比对，
  // 判断「保存后还没重启」这件事——否则页面会按未生效的配置算节省。
  const loadedHash = hashText(configText);

  if (readError !== undefined) {
    // 配置坏了按全放行跑，但必须报出来（DESIGN「七、可靠性与已知风险」）
    log.warn(readError + ' — running with an empty config (no tool filtered)');
  }
  for (const problem of problems) log.warn('config: ' + problem);

  const seen = new Set();
  const catalog = new ToolCatalog();
  const missingParams = new Map(); // toolName -> string[]

  /**
   * 装补丁。任何异常都返回 patched:false 而不是抛出。
   * 插件级启停交给 DSH 插件页（关掉插件 = 本文件根本不执行），这里不再有全局开关。
   * @type {{patched: boolean, reason?: string, restore: () => void}}
   */
  const patch = installPatch(ctx, rules, seen, catalog, missingParams, log);

  if (!patch.patched) {
    log.warn('could not install the registration patch: ' + patch.reason);
  }

  // 说明页半边：与工具补丁分开安装、分开还原，读同一份启动时规则（重启生效）。
  const instructionsState = { installed: false, removed: [], diagnostics: [] };
  const instructions = installInstructionsFilter(ctx, rules, instructionsState, log);

  // 定期把诊断算出来（首次注册后即可）
  const computeDiagnostics = () => {
    try {
      const base = diagnose(rules, [...seen]);
      // 改写的参数名不存在也要报出来（DESIGN「只改文字，不碰结构」）
      for (const [tool, params] of missingParams) {
        for (const p of params) {
          base.push({ kind: 'warning', target: `rewrite.${tool}.properties.${p}`, message: `改写里的参数 ${p} 在这个工具上不存在，这段参数说明不会生效` });
        }
      }
      // 说明页半边的诊断（最近一次组装的事实）
      base.push(...instructionsState.diagnostics);
      if (!instructionsState.installed && instructionsState.reason) {
        base.push({ kind: 'warning', target: 'instructions', message: instructionsState.reason });
      }
      return base;
    } catch (error) {
      log.warn('diagnose failed: ' + String(error?.message ?? error));
      return [];
    }
  };

  /** 供界面与模型工具读取的完整快照。 */
  const snapshot = () => ({
    patched: patch.patched,
    reason: patch.reason,
    problems: [...problems, readError].filter(Boolean),
    diagnostics: computeDiagnostics(),
    configPath: path,
    loadedHash,
    instructions: {
      installed: instructionsState.installed,
      removed: [...instructionsState.removed],
    },
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

  // 模型可调用的管理工具（与设置页共用同一份配置和判定）
  const offTool = registerTool(ctx, {
    configPath: path,
    catalog,
    snapshot,
    log,
  });

  // 设置页 API 路由。webServer 走运行期可选注入——不能写进 inject，
  // headless 下没有这个服务，写进去插件会永远 pending。
  const offApi = mountApi(ctx, { configPath: path, catalog, snapshot, log });

  ctx.effect(() => () => {
    patch.restore();
    instructions.restore();
    try {
      offTool();
    } catch {
      // 工具可能已随作用域销毁
    }
    try {
      offApi();
    } catch {
      // 路由可能已随作用域销毁
    }
  }, 'tool-keeper: restore register, tool and api');

  log.info(`patched; config=${path}`);
}

/** 装 register 补丁。任何异常都返回 patched:false 而不是抛出。 */
function installPatch(ctx, rules, seen, catalog, missingParams, log) {
  let underlying;
  let original;
  let hadOwn;
  try {
    const view = ctx.get('tools') ?? ctx.tools;
    if (view === undefined || view === null) {
      return { patched: false, reason: '宿主没有可用的工具服务（tools）', restore: () => {} };
    }
    underlying = Reflect.get(view, ORIGINAL) ?? view;
    original = underlying.register;
    if (typeof original !== 'function') {
      return { patched: false, reason: '工具服务的 register 不是函数', restore: () => {} };
    }
    hadOwn = Object.hasOwn(underlying, 'register');
  } catch (error) {
    return { patched: false, reason: '无法访问工具服务：' + String(error?.message ?? error), restore: () => {} };
  }

  const wrapped = function register(definition, options) {
    let verdict;
    try {
      // 先留原文（一键还原、界面展开编辑的共同前置），必须在改写之前
      catalog.record(definition);
      const nm = definition === null || definition === undefined ? undefined : definition.name;
      if (typeof nm === 'string' && nm !== '') seen.add(nm);
      verdict = applyToDefinition(definition, rules);
    } catch (error) {
      // 自己的判定出错时绝不阻断注册（DESIGN「七、可靠性与已知风险」）
      log.warn('decision failed, passing the tool through unchanged: ' + String(error?.message ?? error));
      return original.call(this, definition, options);
    }
    if (verdict.drop) {
      // 不注册：返回一个无害的 disposer，因为调用方会在下一轮同步时调用它
      return () => {};
    }
    // 参数名没命中也要记录诊断，不能只在 definition 真的被改过时才记。
    // 反例：rewrite 只配了 properties 且参数名全部不存在 → definition 原样返回，
    // 若把记录放在 `definition !== definition` 里，missingParams 就永远丢失，
    // 用户看到的是一个「看起来生效了、其实一个字都没改」的改写。
    if (verdict.missingParams !== undefined && verdict.missingParams.length > 0) {
      const nm = definition === null || definition === undefined ? undefined : definition.name;
      if (typeof nm === 'string' && nm !== '') {
        missingParams.set(nm, verdict.missingParams);
      }
    }
    return original.call(this, verdict.definition, options);
  };

  let installed = false;
  try {
    Reflect.set(underlying, 'register', wrapped);
    installed = underlying.register === wrapped;
  } catch (error) {
    return { patched: false, reason: '写入工具服务失败：' + String(error?.message ?? error), restore: () => {} };
  }
  if (!installed) {
    return { patched: false, reason: '补丁没生效（服务被冻结或被代理）', restore: () => {} };
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
      ctx.provide('tool_keeper', { status: getter, PROTECTED_TOOLS });
    }
  } catch {
    // provide 失败不影响过滤本身
  }
}

/** 统一的日志出口；拿不到 logger 就退回 console。 */
function makeLogger(ctx) {
  const emit = (level, message) => {
    const line = '[tool-keeper] ' + message;
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
