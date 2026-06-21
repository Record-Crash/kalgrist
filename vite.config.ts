import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import vue from '@vitejs/plugin-vue';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const buildId = Date.now().toString(36)

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    root: 'client',
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'api-sports-widget',
          },
        },
      }),
      {
        name: 'html-transform',
        transformIndexHtml(html) {
          return html.replace(
            /%VITE_DISCORD_CLIENT_ID%/g,
            env.DISCORD_CLIENT_ID || '123'
          );
        }
      },
          {
            name: 'write-build-id',
            closeBundle() {
              if (!existsSync('dist')) {
                mkdirSync('dist', { recursive: true });
              }
              writeFileSync('dist/build-id.txt', buildId);
            },
          },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'client/src'),
      },
    },
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    server: {
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
  };
});
