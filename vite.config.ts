import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  define: { __RISE_BUILD__: JSON.stringify(process.env.RISE_BUILD || new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  base: mode === 'preview' ? './' : '/',
  build: {
    outDir: mode === 'preview' ? 'dist-preview' : 'dist',
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        // Keep the on-device coach library in its own file so it only downloads when you turn the coach on.
        manualChunks: (id) => (id.includes('@mlc-ai/web-llm') ? 'webllm' : undefined)
      }
    }
  },
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo-mark.svg'],
      manifest: {
        name: 'Rise: Learn Out Loud',
        short_name: 'Rise',
        description: 'Listen to anything, get quizzed out loud, and level up. By Jesse Abrams Coaching.',
        theme_color: '#024272',
        background_color: '#F4F8FB',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The app page itself always comes from the network when there is signal, so a new version shows up the next time you open Rise.
        // The saved copy is only used offline.
        navigateFallback: null,
        globPatterns: ['**/*.{js,mjs,css,svg,png,woff2}'],
        // Big on-device model code is cached the first time you download offline answers or the coach.
        globIgnores: ['**/webllm-*.js', '**/llm.worker-*.js', '**/ml.worker-*.js', '**/tts.worker-*.js', '**/*.wasm'],
        maximumFileSizeToCacheInBytes: 9_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 5, expiration: { maxEntries: 5 } }
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/(webllm-|llm\.worker-|ml\.worker-|tts\.worker-|ort-wasm).*/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'ml-code', expiration: { maxEntries: 20 } }
          },
          {
            // Runtime files for the on-device models (offline grading and voice answers).
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@huggingface|onnxruntime-web).*/,
            handler: 'CacheFirst',
            options: { cacheName: 'ml-runtime', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 }, cacheableResponse: { statuses: [0, 200] } }
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 31536000 } }
          }
        ]
      }
    })
  ]
}));
