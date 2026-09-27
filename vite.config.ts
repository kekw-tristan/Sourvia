import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer', base: './', plugins: [react(), {
    name: 'development-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        // React Fast Refresh injects an inline bootstrap only in development.
        return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
      },
    },
  }],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
