import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import aurelia from '@aurelia/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

const functionsEmulatorTarget = process.env.FUNCTIONS_EMULATOR_TARGET
  || 'http://127.0.0.1:5001/chronolens-a4ab6/us-central1/api';

export default defineConfig({
  server: {
    open: !process.env.CI,
    port: 9000,
    proxy: {
      '/api': {
        target: functionsEmulatorTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  esbuild: { target: 'es2022' },
  plugins: [
    aurelia({ useDev: true }),
    tailwindcss(),
    nodePolyfills(),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          aurelia: ['aurelia', '@aurelia/router'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
});
