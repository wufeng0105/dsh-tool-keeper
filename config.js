/**
 * dsh-tool-keeper —— 配置文件的读写。
 *
 * 三条入口（宿主半、设置页 API、模型工具）都通过这里读写：
 * 只有一份原子写、一份读解析、一份写前校验，不再各写各的。
 *
 * @module dsh-tool-keeper/config
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
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
 * @param {string} path
 * @returns {object}
 * @throws 配置无法解析时抛出
 */
export function readConfigOrBaseline(path) {
  const { raw, error } = readConfig(path);
  if (raw !== undefined) return raw;
  const failure = new Error(error ?? `cannot read ${path}`);
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
    // Windows 上目标被占用时 rename 会失败；退化为直接写
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(error?.code ?? '')) throw error;
  }
  writeFileSync(path, text, 'utf8');
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