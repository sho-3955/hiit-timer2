# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
READY → WORK → REST → WORK → ... → REST → COOLDOWN
```

- `currentPhase` (`Phase` 型) がフェーズを管理
- `nextPhase()` がフェーズ遷移ロジック全体を担う
- `timerRef`（`useRef`）でインターバルを保持し、`useEffect` のクリーンアップで確実に解放する

### 状態の分離

- **設定**: `workTime`, `restTime`, `sets`, `cycles` — タイマー起動前に変更可能
- **ランタイム**: `isActive`, `timeLeft`, `currentPhase` — タイマー動作中の状態
- **進捗**: `currentSet`, `currentCycle` — 現在の進行状況

### スタイリング

Tailwind CSS 4 をViteプラグイン経由で使用（`tailwind.config.js` は存在しない）。カラーパレットはインラインで定義:
- ワーク: `#39FF14`（蛍光グリーン）
- レスト: `text-blue-400`
- 背景: `#121212`

### アニメーション

`motion/react`（Framer Motion）を使用:
- SVGサークルの `strokeDashoffset` アニメーションで残り時間を可視化
- `AnimatePresence` + `motion.div` でフェーズ名のフェードトランジション

## 注意点

- `@google/genai`、`express`、`dotenv` はpackage.jsonに含まれるが**現在未使用**（Google AI Studioテンプレート由来）
- `GEMINI_API_KEY` を使う場合は `.env.local` に設定する（`.env.example` 参照）
- `package-lock.json` は空ファイルのため、`npm install` 後に生成される
