# 本地集成清单（合并上游后必检）

> fork = `dengjiquan/pi-for-excel`，长期跟进 `upstream = tmustier/pi-for-excel`。
> 上次合并：2026-11-24，合入 `upstream/main` 到 `899295f5`（v0.12.0-pre，Pi 1.4.0），合并提交 `99d7bfb9`。

## 合并策略

- **merge 模式**（非 rebase）：main 已上 origin，rebase 自找苦吃。
- `rerere.enabled = true` 已开：重复冲突自动复用上次解法。
- push：`git push origin main`（main 追踪 upstream，push 必须显式 origin）。
- **冲突文件取"纯上游 + 重新贴回本地意图"**：先落上游版本，再把本地功能按新结构贴回去。逐块调和会把 fork 的格式噪音永远带着走。
- 判断一个文件的本地改动是"功能"还是"格式噪音"：把 base 和 fork 两个版本都按语法单元（去空白、去注释）展开后 diff。只有格式差异的文件直接还原成上游版本。
- ⚠️ **不要用编辑器工具改仓库里的 `.ts` / `.mjs` / `.js`**：全局钩子 `meta-kim/post-format.mjs` 会在每次 Edit/Write 后跑 prettier（80 列 + 尾逗号），和上游风格不一致，整个文件被重排后下次合并会多出一堆假冲突。改用 `git show` 取版本 + 精确文本替换。`.css` / `.json` / `.md` / `.html` 不受影响。
- 品牌文案不手改语言文件：`src/language/fork-branding.ts` 在 `t()` 出口把 "Pi" 换成 "AI"。真实应用启动时调用 `enableForkBranding()`；单元测试和自动化浏览器里保持上游原文，所以上游测试一行不用改。

## 与上游重叠的本地功能

| 领域 | 文件 | 本地意图 |
|---|---|---|
| 自定义网关 | `src/auth/custom-gateways.ts`、`src/commands/builtins/custom-gateway-settings.ts`、`src/models/browser-model-runtime.ts`、`src/storage/local/custom-providers-store.ts` | 自定义请求头；协议三选（auto / completions / responses）；默认最大输出 65,536。请求头存在模型对象上，由 pi-ai 合并进请求 |
| DeepSeek | `src/auth/stream-proxy.ts`、`src/auth/dev-rewrites.ts`、`vite.config.ts` | 走代理；dev 模式走 Vite 的 `/api-proxy/deepseek`（避免双重代理）；`developer` 角色改 `system` |
| 粘贴图片 | `src/taskpane/action-queue.ts`、`src/taskpane/keyboard-shortcuts/editor-actions.ts`、`src/ui/pi-input.ts`、`src/ui/pi-sidebar.ts`、`src/ui/pasted-images.ts` | 输入框粘贴图片，随提示词发给模型 |
| 文件面板 | `src/ui/files-dialog-actions.ts`、`src/ui/files-dialog.ts`、`src/ui/overlay-ids.ts`、`src/ui/lucide-icons.ts` | 编辑工作区文本文件；预览区复制按钮 |
| 单元格样式 / 命名公式 | `src/tools/format-cells.ts`、`src/tools/format-cells-cell-style.ts`、`src/tools/get-workbook-overview.ts`、`src/workbook/recovery/{schemas,format-selection,format-state}.ts`、`src/prompt/system-prompt.ts`、`src/ui/humanize-params.ts` | `format_cells` 的 `cell_style`（Excel 内置样式，可恢复）；总览里列出命名公式的定义 |
| 截断提示 | `src/ui/messages/messages.ts` | 输出因 token 上限被截断时给出提示（`messages.lengthTruncated`） |
| 提示词 | `src/taskpane/init.ts`、语言文件里的 `hint.financial.*` / `hint.messy.*` | 工程造价方向的空状态提示 |
| 品牌 | `manifest*.xml`、`src/taskpane.html`、`src/taskpane/status-bar.ts`、`src/taskpane/welcome-login.ts`、`public/`、`README.md`、`src/language/fork-branding.ts` | "AI for Excel" |

## Windows / 端口契约

- 开发端口只在 `scripts/generate-dev-manifest.mjs` 定义：`DEV_SERVER_PORT = 3000`（上游 3141）。本地服务器（cors-proxy、python-bridge、tmux-bridge、background-verify）的默认来源和 `manifest.xml` 同步为 3000。上游测试会断言这些一致，漂移会直接挂测试。
- python bridge 的 spawn 参数必须带 `-X utf8`，否则 Windows 下 `python_run` 中文乱码。
- Office.js 放在 `public/vendor/`，`src/taskpane.html` 引用本地副本，避开 CDN 启动卡顿。
- Windows 测试加固（上游只在 macOS / Linux 上跑）：路径用 `fileURLToPath`；清掉用户环境里的 `ALLOW_ALL_TARGET_HOSTS`；生成证书时空置 `OPENSSL_CONF`；Vite 用 `node vite.js` 启动；临时目录可能是 8.3 短名，用 `realpathSync.native`。

## 已退役（上游已提供同等或更完整的实现）

- `src/tools/mcp-http.ts`：换成上游的 `mcp-transport.ts`。
- `src/utils/type-guards.ts`：上游政策不允许通用对象守卫。
- stream 出口处的网关请求头注入：模型对象已带请求头。
- `NESTED_OVERLAY_Z_INDEX`：上游的新浮层模型靠 DOM 顺序 + inert 叠放。
- 与上游重设计冲突的纯样式微调：紧凑标题、标签页和空状态间距、规则文本框和工具卡的复制按钮。

## fork 专属测试（独立文件，不会和上游冲突）

`tests/fork-branding.test.ts`、`tests/fork-integrations.test.ts`、`tests/format-cells-fork.test.ts`、`tests/files-dialog-actions.test.mjs`、`tests/get-workbook-overview.test.ts`、`tests/pasted-images.test.ts`。

新增本地功能时，测试优先写进这类独立文件。

## 回归命令

```bash
npm run check
npm run build
npm test
npm run test:browser   # 先 npx playwright install；本机旧版 Chromium 不匹配时整份套件在启动阶段失败
```

- `npm run check`、`npm test` 和浏览器测试不要同时跑：同时跑会出现 `tsgolint` 崩溃和成片的整文件超时，看起来像代码坏了，其实是资源争抢。
- 上游有些测试默认只在 macOS / Linux 上能过（路径分隔符、8.3 短名临时目录）。碰到只在 Windows 上挂的测试，先怀疑可移植性，再怀疑代码。

## 升级前先备份存储

上游发版说明里出现 "Stored data upgrade is one-way" 时，新版本第一次打开就会迁移数据，旧版本读不回来。合并这类版本后、打开 Excel 之前，先关掉 Excel，把 `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\webview2\<当前 profile>` 下的 `IndexedDB`、`File System`、`Local Storage`、`Session Storage`、`WebStorage` 整目录拷走（`scripts/recover-wef-storage.ps1 -DryRun` 能列出哪个是当前 profile）。回退 = 还原旧提交 + 把这几份拷回去。

## 本次合并后待办

- Windows 桌面版 Excel 手动冒烟。上游 v0.12 的验收只覆盖了网页版和 Mac。
- 建议把本仓库加进全局格式化钩子的排除名单。
