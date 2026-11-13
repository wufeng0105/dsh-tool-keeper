/**
 * 配置指纹。
 *
 * 用途只有一个：判断「磁盘上的配置」和「进程启动时加载的配置」是不是同一份。
 *
 * 为什么需要：工具在注册期拦截，改配置必须重启才生效。但设置页读的是磁盘，
 * 引擎跑的是启动时那份。不比对指纹的话，保存完之后页面会立刻按新配置算
 * 「已隐藏 N 个，每轮省 ≈X tokens」——而此刻一个字节都还没生效。
 * 刷新页面后提示还会消失，用户回来看到的就是「已经生效」的样子。
 *
 * 单独一个模块：`rules.js` 是纯函数核心、不依赖宿主也不用 node 内置模块，
 * 那条性质有测试守着；把 crypto 塞进去会毁掉它。
 *
 * @module dsh-toolwarden/hash
 */

import { createHash } from 'node:crypto';

/**
 * 文本指纹。不需要密码学强度，只要同一内容得同一值、不同内容几乎不会撞。
 * @param text - 配置文本；非字符串一律返回空串（表示「没有可比对的基准」）
 * @returns 16 位十六进制；不可比对时为空串
 */
export function hashText(text) {
  if (typeof text !== 'string') return '';
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}
