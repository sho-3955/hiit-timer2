# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # 依存関係のインストール
npm run dev        # 開発サーバー起動 (http://localhost:3000)
npm run build      # プロダクションビルド
npm run lint       # TypeScript型チェック (tsc --noEmit)
npm run clean      # dist ディレクトリの削除
```

## Architecture

シングルコンポーネント構成のSPA。ロジック・UIすべてが `src/App.tsx` に集約されている。

### タイマーのフェーズ遷移

```
READY → WORK → REST → ... → CYCLE_BREAK → WORK → ... → COOLDOWN
```

- `currentPhase` (`Phase` 型) がフェーズを管理
- `nextPhase()` がフェーズ遷移ロジック全体を担う
- `timerRef`（`useRef`）でインターバルを保持し、`useEffect` のクリーンアップで確実に解放する

### 状態の分離

- **設定**: `workTime`, `restTime`, `sets`, `cycles`, `cycleBreak` — タイマー起動前に変更可能
- **ランタイム**: `isActive`, `timeLeft`, `currentPhase` — タイマー動作中の状態
- **進捗**: `currentSet`, `currentCycle` — 現在の進行状況

### スタイリング

Tailwind CSS 4 をViteプラグイン経由で使用（`tailwind.config.js` は存在しない）。カラーパレットはインラインで定義:
- ワーク: `#39FF14`（蛍光グリーン）
- レスト: `text-blue-400`
- サイクル間休憩: `text-amber-400`
- 背景: `#121212`

### アニメーション

`motion/react`（Framer Motion）を使用:
- SVGサークルの `strokeDashoffset` アニメーションで残り時間を可視化
- `AnimatePresence` + `motion.div` でフェーズ名のフェードトランジション
- サークルは `key` の切り替えでフェーズ更新時も反時計回りアニメーションを維持する

## 注意点

- 設定値は `localStorage` の `hiit-timer-settings` に保存される
- GitHub Pages 配信用に `vite.config.ts` の `base` は `/hiit-timer2/` 固定
- PWA 用の `manifest.json` と `icon.svg` は `public/` 配下にある
