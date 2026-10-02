import { defineConfig } from 'vite'
export default defineConfig({ base: './', build: { outDir: 'dist', minify: true, chunkSizeWarningLimit: 99999, rollupOptions: { input: { mer: 'mer.html', elk: 'elk.html', dagre: 'dagre.html' } } } })
