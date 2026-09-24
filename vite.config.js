import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  build: {
    sourcemap: false,
    target: 'es2020',
  },
})
