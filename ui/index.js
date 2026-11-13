/**
 * 设置页外壳 —— 宿主半。
 *
 * 页面本身在 `client.js`（浏览器半），这里只需要让 Loader 有一行可 import 的宿主入口：
 * 它不注册任何服务、不监听任何事件。
 *
 * 把客户端半挂上去靠 `ui/package.json` 的 `dsh.client.platform = "web"`
 * 与 `exports["./client"]`。
 *
 * 为什么单独一个 package.json：DSH 的浏览器半发现只认「包的精确包名」或
 * 「路径里的最近 package.json」。裸子路径会被当成非包跳过。
 * 这个坑记在 dsh-enhance 的 cordis.patch.yml 注释里。
 */

/** 诊断标签；只出现在 Loader 日志与失败链里。 */
export const name = 'tool-keeper-ui';

/** 宿主侧无事可做。 */
export function apply() {}
