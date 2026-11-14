/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

/** `/mapeditor` → `/mapeditor/` in dev and preview (GitHub Pages redirects folders by itself). */
const editorRedirect = (): Plugin => {
  const mw = (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(): void }, next: () => void) => {
    const [path, query] = (req.url ?? '').split('?');
    if (path?.endsWith('/mapeditor')) {
      res.statusCode = 301;
      res.setHeader('Location', `${path}/${query ? `?${query}` : ''}`);
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'editor-redirect',
    configureServer: (s) => void s.middlewares.use(mw),
    configurePreviewServer: (s) => void s.middlewares.use(mw),
  };
};

export default defineConfig({
  plugins: [
    editorRedirect(),
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Steam Racers',
        short_name: 'Steam Racers',
        description: 'Steam-powered combat racing in the Southern Wastelands.',
        theme_color: '#1B1210',
        background_color: '#1B1210',
        display: 'fullscreen',
        orientation: 'landscape',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,glb,ktx2,json,wasm}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // The track editor is its own page (doc 05): never answer it with the game's index.html.
        navigateFallbackDenylist: [/\/mapeditor/],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    // Two pages: the game and the track editor (/mapeditor/, doc 05).
    rollupOptions: { input: { main: 'index.html', mapeditor: 'mapeditor/index.html' } },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
