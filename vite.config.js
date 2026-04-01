import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { frontendConfig } from './app.config.js';

export default defineConfig({
  base: frontendConfig.githubPagesBase || '/',
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});
