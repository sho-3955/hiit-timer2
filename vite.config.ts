import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// 本番ビルドの index.html にだけ CSP を埋め込む。
// 開発サーバーは React Refresh のインラインスクリプトを挿入するため、同じ CSP を当てると動かない。
// media-src の blob: は iOS マナーモード対策の無音WAV（URL.createObjectURL）に必要。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {tag: 'meta', attrs: {'http-equiv': 'Content-Security-Policy', content: CSP}, injectTo: 'head-prepend'},
  ],
});

export default defineConfig(({mode}) => {
  // DEV_HOST は .env.local などで指定する（例: Tailscale の IP）。
  // 未指定なら localhost のみで待ち受け、LAN など他のネットワークには公開しない。
  const env = loadEnv(mode, process.cwd(), 'DEV_');
  return {
    base: '/hiit-timer2/',
    plugins: [react(), tailwindcss(), cspPlugin()],
    server: {
      host: env.DEV_HOST || 'localhost',
      port: 3000,
    },
  };
});
