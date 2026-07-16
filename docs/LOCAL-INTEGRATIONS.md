# 本地集成清单（合并上游后必检）

> fork = `dengjiquan/pi-for-excel`，长期跟进 `upstream = tmustier/pi-for-excel`。
> 定制已收敛，多为**新增文件**（scripts/、新 tools）→ merge 时自动并入不冲突；
> 真正的热冲突文件就下面标 🔴 的几个。每次 `git merge upstream/main` 后照此回归。

## 合并策略

- **merge 模式**（非 rebase）：30 个本地 commit 含 merge commit、main 已上 origin → rebase 自找苦吃
- `rerere.enabled = true` 已开：重复冲突自动复用上次解法
- push：`git push origin main`（main 追踪 upstream，push 必须显式 origin）

## 🔴 热冲突文件（本地改 + 上游也改，手工合）

| 文件 | 本地定制要点 | 不能被冲掉的点 |
|---|---|---|
| `src/language/locales/zh-CN.json` `en.json` | 中文翻译 + 本地新功能 key | 上游新 key 要补译；本地 key 不能丢 |
| `src/ui/pi-input.ts` | 响应式间距、自定义提示 | — |
| `src/ui/lucide-icons.ts` | 本地图标 | — |
| `src/tools/format-cells.ts` | 内置单元格样式 | — |

## 本地集成点（合并后必验证还活着）

1. **Windows / Python Bridge**
   - `scripts/python-bridge-server.mjs` · `watch-excel-pi-services.ps1` · `start-excel-with-pi.ps1` · `install-excel-watcher.ps1`
   - 🔑 python spawn 必须 `-X utf8`：args = `["-I","-X","utf8","-c",...]`（上游 merge 曾删掉，Windows 下中文乱码）
   - 绑定 ipv4 localhost、prefer system python
2. **Proxy origin**：watcher 必须 trust `localhost:3000` origin（ALLOWED_ORIGINS），否则 taskpane:3000 ↔ cors-proxy 误报 Proxy not running
3. **品牌**：add-in = "AI for Excel"（非 "Pi"）
4. **i18n**：zh-CN 完整、切换正常

## 新增功能（新文件，一般不冲突，确认还能跑）

DeepSeek/BigModel 网关 · MCP streamable HTTP(`mcp-http.ts`) · 粘贴图片(`pasted-images.ts`) · 编辑工作区文本文件 · 命名公式定义 · Excel 内置样式

## 回归命令

```bash
# 测试（必须带 TS loader，否则 .js import 报 ERR_MODULE_NOT_FOUND）
node --import ./scripts/register-test-ts-loader.mjs --test "tests/**/*.test.ts"
# 构建
npm run build
```
