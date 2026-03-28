import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  base: '/hiit-timer2/',
  plugins: [react(), tailwindcss()],
});
