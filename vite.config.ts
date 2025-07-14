import { defineConfig, loadEnv } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';

import manifest from './src/manifest';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), '');

  return {
    build: {
      emptyOutDir: true,
      outDir: 'build',
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    plugins: [crx({ manifest }), react()],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
    define: {
      // Explicitly expose environment variables to the extension
      'import.meta.env.VITE_TRANSLATION_API_KEY': JSON.stringify(env.VITE_TRANSLATION_API_KEY),
      'import.meta.env.VITE_TRANSLATION_API_REGION': JSON.stringify(
        env.VITE_TRANSLATION_API_REGION,
      ),
    },
  };
});
