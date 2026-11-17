/**
 * dsh-tool-keeper —— 配置文件的读写。
 *
 * 三条入口（宿主半、设置页 API、模型工具）都通过这里读写：
 * 只有一份原子写、一份读解析、一份写前校验，不再各写各的。
 *
 * @module dsh-tool-keeper/config
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { normalizeConfig } from './rules.js';
import { createBaselineConfig } from './baseline.js';

/** 配置文件位置。可用 `config.configPath` 覆盖（测试用）。 */
export function configPath(config) {
  if (typeof config?.configPath === 'string' && config.configPath !== '') return config.configPath;
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'tool-keeper.json');
}

/**
 * 读配置文本并解析。
 *
 * 任何失败都返回 `error`，不抛出：宿主半绝不能因为坏配置中断注册。
 * 文件不存在时写入一份出厂基线（首次运行即得到可编辑的文件）。
 *
 * @param {string} path
 * @returns {{ raw: object|undefined, text: string|undefined, error: string|undefined }}
 */
export function readConfig(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const baseline = createBaselineConfig();
      try {
        writeConfig(path, baseline);
        return { raw: baseline, text: JSON.stringify(baseline, null, 2) + '\n', error: undefined };
      } catch (seedError) {
        return { raw: undefined, text: undefined, error: `cannot seed ${path}: ${String(seedError?.message ?? seedError)}` };
      }
    }
    return { raw: undefined, text: undefined, error: `cannot read ${path}: ${String(error?.message ?? error)}` };
  }
  try {
    return { raw: JSON.parse(text), text, error: undefined };
  } catch (error) {
    // 半截 JSON / 手改写坏：按空配置运行，绝不中断注册
    return { raw: undefined, text, error: `invalid JSON in ${path}: ${String(error?.message ?? error)}` };
  }
}

/**
 * 读配置用于写操作。文件不存在时得到出厂基线；文件坏了则拒绝（不覆盖用户数据）。
 *
 * 「坏」包含两种：JSON 解析失败，以及**解析成功但根不是对象**
 * （`null` / `42` / `"abc"` / `[]`）。后者若不在这里挡住，调用方拿到它去
 * 赋值 `.servers = {}` 会抛 TypeError，响应变成 500 EINTERNAL——用户既不知道
 * 配置坏了，也不知道该改什么。统一按 EINVALID 拒绝，调用方回 400 并说清原因。
 *
 * @param {string} path
 * @returns {object}
 * @throws 配置无法解析或不是对象时抛出（code = EINVALID）
 */
export function readConfigOrBaseline(path) {
  const { raw, error } = readConfig(path);
  if (raw !== undefined && raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  const failure = new Error(
    raw === undefined
      ? (error ?? `cannot read ${path}`)
      : `配置根必须是一个对象，实际是 ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}`,
  );
  failure.code = 'EINVALID';
  throw failure;
}

/**
 * 写前校验 + 原子写回。
 *
 * 校验走 `normalizeConfig`；危险键（`__proto__` 等）必须做 JSON 往返才看得见，
 * 而磁盘上的配置本来就是 JSON 文本，序列化再解析正好还原真实形态。
 * 校验不过抛 `EINVALID`，不落盘。
 *
 * @param {string} path
 * @param {object} data
 * @throws 配置有问题时抛出，且不写盘
 */
export function writeConfig(path, data) {
  // null / undefined 不能被当成「空配置」写出去：normalizeConfig 允许它们
  // （那是给「文件不存在」用的读语义），但写出 null 会造出一个下次读就报错的
  // 配置文件。写盘侧必须要求一个真对象，空对象 {} 才是合法的「什么都没有」。
  if (data === null || data === undefined) {
    const error = new Error('拒绝写入：配置必须是一个对象，不能是 ' + String(data));
    error.code = 'EINVALID';
    throw error;
  }
  let roundTripped = data;
  try {
    roundTripped = JSON.parse(JSON.stringify(data));
  } catch {
    // 无法序列化：交给 normalizeConfig 报问题
  }
  const { problems } = normalizeConfig(roundTripped);
  if (problems.length > 0) {
    const error = new Error('配置有问题，未保存：' + problems.join('；'));
    error.code = 'EINVALID';
    error.problems = problems;
    throw error;
  }

  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(data, null, 2) + '\n';
  const tmp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  writeFileSync(tmp, text, 'utf8');
  try {
    renameSync(tmp, path);
    return;
  } catch (error) {
    // Windows 上目标被占用时 rename 会失败；退化为直接写。
    // 不写就等于这次修改全丢，所以降级是对的——但必须把 tmp 清掉，
    // 否则每次占用都会在用户目录留一个 tool-keeper.json.tmp-<pid>-<rand>。
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(error?.code ?? '')) {
      cleanupTemp(tmp);
      throw error;
    }
  }
  try {
    writeFileSync(path, text, 'utf8');
  } finally {
    cleanupTemp(tmp);
  }
}

/** 删掉临时文件；清理失败不该让一次成功的写入变成失败。 */
function cleanupTemp(tmp) {
  try {
    if (existsSync(tmp)) unlinkSync(tmp);
  } catch {
    // 删不掉就留着：它是垃圾文件，不影响数据正确性
  }
}

/**
 * 把当前磁盘配置备份一份。
 * @param {string} path
 * @returns {string|undefined} 备份路径；文件不存在时返回 undefined
 */
export function backupConfig(path) {
  if (!existsSync(path)) return undefined;
  const backup = path + '.bak-' + Date.now();
  writeFileSync(backup, readFileSync(path), 'utf8');
  return backup;
}