import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  resolve: {
    // يدعم .ts/.tsx و .js/.jsx في نفس الوقت — migration تدريجي
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    alias: {
      '@':           '/src',
      '@components': '/src/components',
      '@modules':    '/src/modules',
      '@services':   '/src/services',
      '@store':      '/src/store',
      '@utils':      '/src/utils',
      '@hooks':      '/src/hooks',
      '@types':      '/src/types',
    },
  },

  // ── React Router: إعادة توجيه كل الطلبات لـ index.html ─────────────────────
  // بدون هذا: تحديث الصفحة على /students يُعطي 404
  server: {
    historyApiFallback: true,
    proxy: {
      // في بيئة الـ dev: وجّه /api للـ Backend تلقائياً (يتجنب CORS)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  // ── Build: نفس الإعداد ─────────────────────────────────────────────────────
  build: {
    rollupOptions: {
      output: {
        // Code splitting تلقائي لكل صفحة
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          store:  ['zustand'],
        },
      },
    },
  },

  // ── Tests ──────────────────────────────────────────────────────────────────
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/services/**', 'src/utils/**', 'src/store/slices/**'],
      exclude: ['src/__tests__/**', 'src/data/**'],
      thresholds: {
        lines:      80,
        functions:  80,
        branches:   75,
        statements: 80,
      },
    },
  },
});
