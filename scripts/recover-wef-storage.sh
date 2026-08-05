#!/usr/bin/env bash
# recover-wef-storage.sh — 恢复 pi-for-excel 加载项配置
#
# 用途：Office 更新会换 WebView2 的 WEF profile 路径，导致加载项的
#   IndexedDB（API key / 工作簿规则）和 OPFS（自定义技能）数据被遗弃
#   在旧 profile、当前 profile 变空，表现为"配置全没了"。本脚本把旧
#   profile 的数据搬到当前活跃 profile。
#
# 用法：
#   bash scripts/recover-wef-storage.sh            # 交互式，带确认
#   bash scripts/recover-wef-storage.sh --dry-run  # 只预览，不执行
#   bash scripts/recover-wef-storage.sh -y         # 跳过确认（慎用）
#
# 前提：实际执行前 Excel 必须完全退出（否则文件锁会损坏数据）。
# 原理：跟着 https_localhost_3000.indexeddb.leveldb 找各 profile 的存储根，
#   按 size 揪出"满的旧库"（源）和"空的新库"（目标），复制
#   IndexedDB/{leveldb,blob} + File System(OPFS) 三项。目标原数据保留为
#   .bak，验证无误后可手动删。

set -euo pipefail

DRY_RUN=0; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1;;
    -y|--yes)  ASSUME_YES=1;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "未知参数: $arg（--help 查看用法）"; exit 1;;
  esac
done

LOCAL="${LOCALAPPDATA:-${USERPROFILE:-$HOME}/AppData/Local}"
ROOT="$LOCAL/Microsoft/Office/16.0/Wef/webview2"
DB="https_localhost_3000.indexeddb.leveldb"

[ -d "$ROOT" ] || { echo "✗ 找不到 WEF 目录: $ROOT"; exit 1; }

echo "扫描 profile: $ROOT"
mapfile -t LINES < <(
  while IFS= read -r dbdir; do
    sroot="$(dirname "$(dirname "$dbdir")")"      # IndexedDB/https_... 上两级 = 存储根
    sz=$(du -sb "$dbdir" 2>/dev/null | cut -f1); sz=${sz:-0}
    mt=$(stat -c '%Y' "$dbdir" 2>/dev/null || echo 0)
    echo "${sz}|${mt}|${sroot}"
  done < <(find "$ROOT" -type d -name "$DB" 2>/dev/null)
)
mapfile -t LINES < <(printf '%s\n' "${LINES[@]}" | grep -v '^$' | sort -t'|' -k1,1 -rn || true)

if [ "${#LINES[@]}" -eq 0 ]; then
  echo "✗ 没找到任何 pi-for-excel 加载项数据（$DB）。"
  echo "  是否从没在 https://localhost:3000 配过？或一直没用 dev server？"
  exit 1
fi

echo; echo "发现 ${#LINES[@]} 个含数据的 profile："
for idx in "${!LINES[@]}"; do
  IFS='|' read -r sz mt sroot <<< "${LINES[$idx]}"
  kb=$((sz/1024)); dt=$(date -d "@$mt" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?')
  echo "  [$idx] ${kb} KB  ${dt}  ${sroot}"
done

# 源 = size 最大（含旧数据）；目标 = mtime 最新（当前活跃 profile）
IFS='|' read -r SRC_SZ SRC_MT SRC_ROOT <<< "${LINES[0]}"
DST_IDX=0; DST_BEST_MT=-1
for idx in "${!LINES[@]}"; do
  IFS='|' read -r _ mt _ <<< "${LINES[$idx]}"
  if [ "$mt" -gt "$DST_BEST_MT" ]; then DST_BEST_MT=$mt; DST_IDX=$idx; fi
done
IFS='|' read -r DST_SZ _ DST_ROOT <<< "${LINES[$DST_IDX]}"
SRC_KB=$((SRC_SZ/1024)); DST_KB=$((DST_SZ/1024))

if [ "${#LINES[@]}" -eq 1 ]; then
  echo; echo "✓ 只有一个 profile，没有'旧库'可恢复（还没发生切换，或已恢复过）。"
  exit 0
fi

if [ "$SRC_ROOT" == "$DST_ROOT" ]; then
  echo; echo "✓ 数据最多的 profile 也是最近活跃的（${SRC_KB} KB），当前 profile 已含数据，无需恢复。"
  echo "  若配置确实仍丢失，可能另有原因，需单独排查。"
  exit 0
fi

echo
echo "══════════════════════════════════════════════════════"
echo " 源（旧库） : ${SRC_KB} KB"
echo "   ${SRC_ROOT}"
echo " 目标(活跃) : ${DST_KB} KB"
echo "   ${DST_ROOT}"
echo "══════════════════════════════════════════════════════"

if [ "$DRY_RUN" -eq 1 ]; then
  echo; echo "[dry-run] 将复制以下三项 源→目标（不实际执行）："
  echo "  - IndexedDB/https_localhost_3000.indexeddb.leveldb"
  echo "  - IndexedDB/https_localhost_3000.indexeddb.blob（若存在）"
  echo "  - File System/（OPFS，自定义技能）"
  echo "若上面的「目标」不是当前活跃 profile，下次可手动核对路径。"
  exit 0
fi

echo; echo "检查 Excel 进程..."
if tasklist 2>/dev/null | grep -iq "EXCEL.EXE"; then
  echo "✗ EXCEL.EXE 正在运行！请先完全退出 Excel 再跑此脚本（否则数据会损坏）。"
  exit 1
fi
echo "✓ Excel 未运行"

if [ "$DST_KB" -gt 1024 ]; then
  echo "⚠️  目标已有 ${DST_KB} KB 数据（非空壳），可能已恢复过；继续会保留为 .bak 再覆盖。"
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  echo; read -r -p "确认把旧库搬到目标 profile？[y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "已取消。"; exit 0;; esac
fi

migrate() {
  local name="$1" rel="$2"
  local sp="$SRC_ROOT/$rel" dp="$DST_ROOT/$rel"
  if [ ! -e "$sp" ]; then echo "  ℹ 源无 $name，跳过"; return 0; fi
  if [ -e "$dp" ]; then rm -rf "${dp}.bak"; mv "$dp" "${dp}.bak"; fi
  cp -r "$sp" "$dp"
  echo "  ✓ $name → $(du -sh "$dp" 2>/dev/null | cut -f1)（目标原数据→.bak）"
}

echo; echo "搬运中..."
migrate "IndexedDB(leveldb)" "IndexedDB/https_localhost_3000.indexeddb.leveldb"
migrate "IndexedDB(blob)"    "IndexedDB/https_localhost_3000.indexeddb.blob"
migrate "OPFS(File System)"  "File System"

echo; echo "🎉 完成！重开 Excel + 加载项，配置应全部回来。"
echo "   验证无误后可删 .bak："
echo "   rm -rf \"${DST_ROOT}/IndexedDB/https_localhost_3000.indexeddb.leveldb.bak\" \"${DST_ROOT}/IndexedDB/https_localhost_3000.indexeddb.blob.bak\" \"${DST_ROOT}/File System.bak\""
