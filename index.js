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
  // 判断「保存后还没重启」这件事——否则页面会把未生效的配置当成已生效。
  const loadedHash = hashText(configText);

  if (readError !== undefined) {
    // 配置坏了按全放行跑，但必须报出来（DESIGN「七、可靠性与已知风险」）
    log.warn(readError + ' — running with an empty config (no tool filtered)');
  }
  for (const problem of problems) log.warn('config: ' + problem);

  /**
   * 工具名 → 当前注册着的份数。
   *
   * 不能用只增不减的 Set：宿主在服务器断开、作用域销毁、重连时都会调用
   * register 返回的 disposer 把工具注销掉（`dsh-tools/src/index.ts:148-152`
   * 返回 `layers.effect(...)` 的 disposer）。名字留在集合里，诊断就会以为
   * 那个工具还在——于是「这条规则已经失效」这类警告永远不出现，正好是本插件
   * 要消灭的那种静默。
   *
   * 用计数而不是集合：同一名字可能被注册不止一次（重连、多作用域），
   * 注销一份不等于它已经不在了。
   */
  const liveTools = new Map();
  /** 此刻真的注册着的工具名。 */
  const liveNames = () => [...liveTools.keys()];
  const catalog = new ToolCatalog();
  const missingParams = new Map(); // toolName -> string[]

  /**
   * 装补丁。任何异常都返回 patched:false 而不是抛出。
   * 插件级启停交给 DSH 插件页（关掉插件 = 本文件根本不执行），这里不再有全局开关。
   * @type {{patched: boolean, reason?: string, restore: () => void}}
   */
  const patch = installPatch(ctx, rules, liveTools, catalog, missingParams, log);

  if (!patch.patched) {
    log.warn('could not install the registration patch: ' + patch.reason);
  }

  // 说明页半边：与工具补丁分开安装、分开还原，读同一份启动时规则（重启生效）。
  const instructionsState = { installed: false, removed: [], rewritten: [], originals: new Map(), diagnostics: [] };
  const instructions = installInstructionsFilter(ctx, rules, instructionsState, log);

  // 定期把诊断算出来（首次注册后即可）。
  //
  // 参数 takeRules 允许调用方用「磁盘上的当前配置」再算一遍：诊断描述的是配置
  // 此刻对不对，而不是启动那一刻对不对。否则删掉一条有问题的配置后，那句诊断
  // 会一直挂到下次重启——而重启正是用户刚做过、却发现没用的事。
  //
  // 两个名字集合语义不同，都要给：
  // - catalog.names()：见过的全部（含被 drop 的）。判断「这个名字存在过吗」。
  //   被 drop 的工具按设计不注册，只用在线名会把用户有意关掉的规则全报成失效。
  // - liveNames()：此刻在线的。判断「这台服务器连上了吗」。
  const computeDiagnostics = (takeRules) => {
    try {
      const active = takeRules ?? rules;
      const base = diagnose(active, catalog.names(), liveNames());
      // 改写的参数名不存在也要报出来（DESIGN「只改文字，不碰结构」）
      for (const [tool, params] of missingParams) {
        const stillConfigured = active.rewrites?.has(tool) === true;
        if (!stillConfigured) continue;
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
    /**
     * 用另一份配置算诊断（设置页读磁盘当前内容时用）。
     * 传进来的若是坏配置，退回启动时那份，别把异常抛给调用方。
     */
    diagnosticsFor: (rawConfig) => {
      try {
        const { rules: diskRules } = normalizeConfig(rawConfig);
        return computeDiagnostics(diskRules);
      } catch {
        return computeDiagnostics();
      }
    },
    configPath: path,
    loadedHash,
    /**
     * 这个工具此刻是否真的注册着。
     *
     * 目录（catalog）只增不减，用来记住「见过哪些工具」——还原原文、
     * 展开编辑都要它。但它不能回答「现在在不在」，两者混用就会让页面
     * 把断线服务器的全套工具显示成可用。
     */
    isLive: (name) => liveTools.has(name),
    instructions: {
      installed: instructionsState.installed,
      removed: [...instructionsState.removed],
      rewritten: [...(instructionsState.rewritten || [])],
      // 原文只给设置页（api state）用；tool_keeper 的 status 会剥掉它，
      // 以免模型一句 status 就把每台服务器的整页原文倒进对话。
      texts: Object.fromEntries(instructionsState.originals instanceof Map ? instructionsState.originals : []),
    },
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

/**
 * 退掉一份注册计数。
 *
 * 用计数不用集合：同一名字可能被注册不止一次（服务器重连、多作用域共享
 * 一个进程级补丁），注销一份不等于它已经不在了。记到 0 才删键。
 *
 * @param liveTools - name → 当前份数
 * @param name - 工具名
 * @returns {boolean} 键是否存在并被减过；减一个不存在的键返回 false
 */
function decrementLive(liveTools, name) {
  const n = liveTools.get(name) ?? 0;
  if (n === 0) return false;
  if (n === 1) liveTools.delete(name);
  else liveTools.set(name, n - 1);
  return true;
}

/**
 * 给宿主的 disposer 挂上「注销即减计数」。
 *
 * 三个必须照顾到的性质（都来自宿主实现，`cordis` 的 `ctx.effect`）：
 *
 * 1. **返回值要透传**：宿主的 disposer 不是普通函数，是带 `.then` 的
 *    thenable（`wrapper.then = async (...) => ...`），调用方可以 `await` 它
 *    等异步拆除完成。包成返回 undefined 的普通函数，会让 `await` 立刻继续，
 *    等于报出一件还没发生的事。
 * 2. **幂等**：宿主自己的 disposer 是幂等的，重复调用是空操作。计数必须
 *    同样幂等，否则注销两次会退两份，把还活着的同名工具判成没了——从
 *    「该响的不响」变成「不该响的乱响」，更糟。
 * 3. **同步抛错也要减**：宿主的 undo 可能同步抛错，那时工具实际已经拆掉了。
 *
 * @param dispose - 宿主 register 返回的 disposer
 * @param nm - 工具名
 * @param named - 是否是有名字的工具（无名字的不计数）
 * @param liveTools - name → 当前份数
 * @param log - 日志出口
 * @returns 与原来等价的可调用对象（保持 thenable 性质）
 */
function trackDisposer(dispose, nm, named, liveTools, log, missingParams) {
  if (!named || typeof dispose !== 'function') return dispose;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (!decrementLive(liveTools, nm)) {
      // 减到不存在的键：说明计数与宿主状态已经对不上。
      // 计数方向保守（不多减），但要说出来，否则这种错位永远查不到。
      log.warn('live count underflow for ' + nm + ' (already zero)');
    }
    // 「参数名对不上」的结论也要跟着清掉：工具都注销了，那条记录描述的
    // 是上一轮的事。不清的话，下次注册同名的工具时它会带着旧参数名一起
    // 冒出来——用户改对了参数、重启了，警告还在。这是「某个时刻算出的
    // 结论被当作此刻的事实」的又一个实例。
    missingParams?.delete(nm);
  };

  const wrapper = function () {
    try {
      const result = dispose();
      // 宿主可能返回 Promise / thenable：等它落定再减，
      // 否则会出现「计数说没了、实际还没拆完」。
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        return Promise.resolve(result).finally(release);
      }
      release();
      return result;
    } catch (error) {
      // 同步抛错：宿主已经拆掉了，计数必须跟着退
      release();
      log.warn('tool disposer failed for ' + nm + ': ' + String(error?.message ?? error));
      throw error;
    }
  };

  // 保住 thenable：宿主靠 wrapper.then 支持 await dispose()。
  // 不复制它，调用方 await 我们的包装器会立刻继续，异步拆除还没完成。
  if (typeof dispose.then === 'function') {
    wrapper.then = (...args) => Promise.resolve(dispose.then(...args));
  }
  // 宿主在 disposer 上挂的元数据（`symbols.effect`）也带上，
  // 否则 ctx.getEffects() 的树里会看不到这个 effect。
  for (const sym of Object.getOwnPropertySymbols(dispose)) {
    try { wrapper[sym] = dispose[sym]; } catch { /* 只读符号，跳过 */ }
  }
  return wrapper;
}

/** 装 register 补丁。任何异常都返回 patched:false 而不是抛出。 */
function installPatch(ctx, rules, liveTools, catalog, missingParams, log) {
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
    const nm = definition === null || definition === undefined ? undefined : definition.name;
    const named = typeof nm === 'string' && nm !== '';
    let counted = false;
    try {
      // 先留原文（一键还原、界面展开编辑的共同前置），必须在改写之前
      catalog.record(definition);
      if (named) {
        liveTools.set(nm, (liveTools.get(nm) ?? 0) + 1);
        counted = true;
      }
      verdict = applyToDefinition(definition, rules);
    } catch (error) {
      // 自己的判定出错时绝不阻断注册（DESIGN「七、可靠性与已知风险」）。
      // 这里不退计数：紧跟着会调用 original.call 真的把它注册上，
      // 退掉就成了「明明注册成功、却被判为不在线」的假警报。
      // 只有宿主那一步也抛错时，才在下面退回去。
      log.warn('decision failed, passing the tool through unchanged: ' + String(error?.message ?? error));
      let handedOff;
      try {
        handedOff = original.call(this, definition, options);
      } catch (hostError) {
        if (counted) decrementLive(liveTools, nm);
        throw hostError;
      }
      return trackDisposer(handedOff, nm, named, liveTools, log, missingParams);
    }
    if (verdict.drop) {
      // 不注册：返回一个无害的 disposer，因为调用方会在下一轮同步时调用它。
      // 已经被隐藏的工具本来就没进注册表，计数要退回去——否则它会一直算作
      // 「在线」，而它其实从来没被注册。
      if (named) decrementLive(liveTools, nm);
      return () => {};
    }
    // 参数名没命中也要记录诊断，不能只在 definition 真的被改过时才记。
    // 反例：rewrite 只配了 properties 且参数名全部不存在 → definition 原样返回，
    // 若把记录放在 `definition !== definition` 里，missingParams 就永远丢失，
    // 用户看到的是一个「看起来生效了、其实一个字都没改」的改写。
    if (verdict.missingParams !== undefined && verdict.missingParams.length > 0) {
      if (named) {
        missingParams.set(nm, verdict.missingParams);
      }
    }
    // 宿主可能在这里抛错（重名、名字被保留、output 不合法……）。
    // 那这次注册根本没成，计数必须跟着退回——否则工具明明不在，
    // 诊断却以为它在线，那些「规则已失效」的警告从此再也不出现。
    let handedOff;
    try {
      handedOff = original.call(this, verdict.definition, options);
    } catch (error) {
      if (counted) decrementLive(liveTools, nm);
      throw error;
    }
    return trackDisposer(handedOff, nm, named, liveTools, log, missingParams);
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

/**
 * 把状态暴露成宿主服务，供其它插件或诊断读取。
 *
 * 这是对外契约，不是内部实现——本仓库没有消费者，不代表别处没有。
 * 缺 `provide` 能力时静默跳过（headless / 精简宿主），不影响过滤本身。
 */
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
