/**
 * config.js 的写盘测试。
 *
 * 重点测「原子写失败后降级」这条路：Windows 上目标被占用时 rename 会失败，
 * 必须退化为直接写，且不能留下垃圾文件。这条路径原先没有任何测试覆盖。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, openSync, closeSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeConfig, readConfig, readConfigOrBaseline, backupConfig } from '../config.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'tool-keeper-config-'));
}

test('config: 正常写入，内容正确', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeConfig(path, { tools: { 'mcp__x__y': 'drop' }, servers: {}, rewrite: {} });
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(saved.tools, { 'mcp__x__y': 'drop' });
  rmSync(dir, { recursive: true, force: true });
});

test('config: 写入后不残留临时文件', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeConfig(path, { tools: {}, servers: {}, rewrite: {} });
  const leftovers = readdirSync(dir).filter(f => f.includes('.tmp-'));
  assert.deepEqual(leftovers, [], '正常路径不该留 tmp 文件');
  rmSync(dir, { recursive: true, force: true });
});

test('config: rename 失败降级后也必须清理临时文件', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeFileSync(path, '{"tools":{}}', 'utf8');

  // 在 Windows 上对目标文件持有句柄能让 renameSync 失败，触发降级分支。
  // 若宿主平台不支持这种占用方式，写入会走正常路径，此时本测试退化为
  // 「不留垃圾」的弱断言，仍然成立。
  let handle;
  try {
    handle = openSync(path, 'r+');
    writeConfig(path, { tools: { 'mcp__x__y': 'drop' }, servers: {}, rewrite: {} });
  } finally {
    if (handle !== undefined) closeSync(handle);
  }

  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(saved.tools, { 'mcp__x__y': 'drop' }, '降级写必须真的写进去');

  const leftovers = readdirSync(dir).filter(f => f.includes('.tmp-'));
  assert.deepEqual(leftovers, [], '降级写成功后不得留下 tmp 文件');
  rmSync(dir, { recursive: true, force: true });
});

test('config: 坏配置时 readConfigOrBaseline 抛 EINVALID，不返回基线', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeFileSync(path, '{ broken json', 'utf8');

  let thrown;
  try {
    readConfigOrBaseline(path);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown !== undefined, '坏配置必须抛错，不能静默返回基线');
  assert.equal(thrown.code, 'EINVALID', 'api.js 依赖这个 code 返回 400 而不是 500');
  assert.equal(readFileSync(path, 'utf8'), '{ broken json', '抛错时不得改动磁盘');
  rmSync(dir, { recursive: true, force: true });
});

// 合法 JSON 但根不是对象，同样是「读不出可用配置」。
// 若放行，调用方会对 null/数字赋值而抛 TypeError，响应变成 500 EINTERNAL ——
// 比「400 说清配置有问题」差得多，用户也不知道该怎么办。
for (const content of ['null', '42', 'true', '"abc"', '[]', '[1,2]']) {
  test(`config: 根不是对象的配置（${content}）也必须抛 EINVALID`, () => {
    const dir = tempDir();
    const path = join(dir, 'tool-keeper.json');
    writeFileSync(path, content, 'utf8');

    let thrown;
    try {
      readConfigOrBaseline(path);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown !== undefined, `${content} 不是可用配置，必须拒绝`);
    assert.equal(thrown.code, 'EINVALID', '必须是 EINVALID（400），不是 TypeError（500）');
    assert.equal(readFileSync(path, 'utf8'), content, '拒绝时不得改动磁盘');
    rmSync(dir, { recursive: true, force: true });
  });
}

test('config: readConfig 对坏配置返回 error 而不抛', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeFileSync(path, '{ broken json', 'utf8');
  const r = readConfig(path);
  assert.equal(r.raw, undefined);
  assert.ok(typeof r.error === 'string' && r.error.length > 0, '必须给出错误说明');
  assert.equal(r.text, '{ broken json', '原文要带出来，供导出使用');
  rmSync(dir, { recursive: true, force: true });
});

test('config: backupConfig 文件不存在时返回 undefined', () => {
  const dir = tempDir();
  const path = join(dir, 'nope.json');
  assert.equal(backupConfig(path), undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('config: backupConfig 复制出可读的备份', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeFileSync(path, '{"tools":{"a":"drop"}}', 'utf8');
  const backup = backupConfig(path);
  assert.ok(typeof backup === 'string' && backup.includes('.bak-'));
  assert.equal(readFileSync(backup, 'utf8'), '{"tools":{"a":"drop"}}');
  rmSync(dir, { recursive: true, force: true });
});

// normalizeConfig 把 null/undefined 当作「没有配置」，这是给「文件不存在」用的，
// 写盘侧不能沿用：写出 null 会造出一个下次读就报错的配置文件。
for (const bad of ['null', 'undefined']) {
  const value = bad === 'null' ? null : undefined;
  test(`config: writeConfig 拒绝写入 ${bad}`, () => {
    const dir = tempDir();
    const path = join(dir, 'tool-keeper.json');

    let thrown;
    try {
      writeConfig(path, value);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown !== undefined, `不得把 ${bad} 写进配置文件`);
    assert.equal(thrown.code, 'EINVALID');
    assert.equal(existsSync(path), false, '拒绝时不得创建文件');

    rmSync(dir, { recursive: true, force: true });
  });
}

test('config: writeConfig 对空对象仍可写（不能矫枉过正）', () => {
  const dir = tempDir();
  const path = join(dir, 'tool-keeper.json');
  writeConfig(path, {});
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {});
  rmSync(dir, { recursive: true, force: true });
});
