import { defineConfig } from 'vite'
export default defineConfig({ base: './', build: { outDir: 'dist', minify: true, rollupOptions: { input: { merge: 'merge.html', cm: 'cm.html', mon: 'mon.html', 'mon-api': 'mon-api.html', shiki: 'shiki.html' } } }, worker: { format: 'es' } })
