import { defineConfig } from 'vite'
export default defineConfig({ base: './', build: { outDir: 'dist', minify: true, chunkSizeWarningLimit: 99999, rollupOptions: { input: { cm: 'cm.html', pm: 'pm.html', tiptap: 'tiptap.html', lexical: 'lexical.html', milkdown: 'milkdown.html' } } } })
