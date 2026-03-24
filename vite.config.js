import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_GITHUB_PAGES_BASE || '/',
    plugins: [vue()],
    server: {
      port: 5173,
      host: '0.0.0.0',
    },
  };
});

