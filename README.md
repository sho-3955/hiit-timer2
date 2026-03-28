# HIIT Timer

シンプルな HIIT インターバルタイマーです。React + Vite で構成されており、GitHub Pages で公開する前提の設定が入っています。

## Features

- Work / Rest / Cycle Break を含むインターバルタイマー
- Sets / Cycles / Cycle Break の調整
- フェーズ切り替え時の音とバイブ通知
- 設定の `localStorage` 保存
- PWA 対応

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
```

開発サーバーはポート `3000` で起動します。

## Deployment

- GitHub Pages 用の base path は `/hiit-timer2/` に設定しています
- Pages デプロイ用の GitHub Actions は `.github/workflows/deploy.yml` にあります

リポジトリ名を変える場合は、`vite.config.ts`、`index.html`、`public/manifest.json` 内のパスも合わせて更新してください。
