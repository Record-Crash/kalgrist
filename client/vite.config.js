import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { writeFileSync } from 'fs'

const buildId = Date.now().toString(36)

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'api-sports-widget',
        },
      },
    }),
    {
      name: 'write-build-id',
      closeBundle() {
        writeFileSync('dist/build-id.txt', buildId)
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
})
