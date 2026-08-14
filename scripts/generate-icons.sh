#!/usr/bin/env bash
# public/icon.svg から PWA 用の PNG アイコン一式を再生成する。
#   npm run icons
#
# 生成物:
#   public/apple-touch-icon.png    180x180  不透明・角なし（iOS が独自の角丸マスクを当てるため）
#   public/icon-192.png            192x192  角丸・透明角あり（purpose: any）
#   public/icon-512.png            512x512  角丸・透明角あり（purpose: any）
#   public/icon-512-maskable.png   512x512  不透明・角なし（purpose: maskable）
#
# ラスタライズには Chrome ヘッドレス（Blink）を使う。SVG 内の <text>（Arial）と
# SVG フィルタ（ドロップシャドウ）を設計どおり描画できるレンダラが必要なため、
# rsvg-convert / ImageMagick は使わないこと。生成後は目視で確認する。
set -euo pipefail

cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="public/icon.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -x "$CHROME" ] || { echo "Chrome が見つかりません: $CHROME（環境変数 CHROME で指定可）" >&2; exit 1; }

# 角なしバリアント: 背景の全面 rect（rx=112）のみ角を落とす。
# 内側の装飾枠（rx=88）や小さいピル（rx=3）はそのまま。
sed 's/rx="112"/rx="0"/g' "$SRC" > "$TMP/icon-square.svg"
if [ "$(grep -c 'rx="0"' "$TMP/icon-square.svg")" != "2" ]; then
  echo "rx=112 の置換結果が想定（2箇所）と異なります。icon.svg の構造変更に合わせて更新してください。" >&2
  exit 1
fi

render() { # render <svg> <size> <out>
  local svg="$1" size="$2" out="$3"
  local html="$TMP/wrapper-$size-$(basename "$out" .png).html"
  {
    printf '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block;width:%spx;height:%spx}</style></head><body>' "$size" "$size"
    cat "$svg"
    printf '</body></html>'
  } > "$html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$size,$size" \
    --screenshot="$out" "file://$(cd "$(dirname "$html")" && pwd)/$(basename "$html")" 2>/dev/null
  echo "generated: $out"
}

render "$TMP/icon-square.svg" 180 public/apple-touch-icon.png
render "$SRC"                 192 public/icon-192.png
render "$SRC"                 512 public/icon-512.png
render "$TMP/icon-square.svg" 512 public/icon-512-maskable.png

echo "--- 検証（寸法とアルファ） ---"
sips -g pixelWidth -g pixelHeight -g hasAlpha public/apple-touch-icon.png public/icon-192.png public/icon-512.png public/icon-512-maskable.png
