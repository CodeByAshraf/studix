// eslint.config.js
import js         from '@eslint/js';
import globals    from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react      from 'eslint-plugin-react';

export default [
  // ── Files to ignore ─────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/__tests__/**',   // tests لها قواعد مختلفة
    ],
  },

  // ── Base JS rules ────────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── React + Hooks ─────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react,
      'react-hooks':    reactHooks,
      'react-refresh':  reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // ── React ──────────────────────────────────────────────────────────────
      'react/react-in-jsx-scope':       'off',   // React 17+ لا يحتاجها
      'react/prop-types':               'off',   // سنضيف TypeScript لاحقاً
      'react/display-name':             'warn',
      'react/no-unused-prop-types':     'warn',
      'react/jsx-no-target-blank':      'error', // security

      // ── React Hooks ────────────────────────────────────────────────────────
      'react-hooks/rules-of-hooks':     'error', // لا hooks خارج components
      'react-hooks/exhaustive-deps':    'warn',  // deps arrays كاملة

      // ── React Refresh (Vite HMR) ───────────────────────────────────────────
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ── Variables ──────────────────────────────────────────────────────────
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_',   // _ignored مسموح
        argsIgnorePattern: '^_',
      }],
      'no-undef': 'error',

      // ── Code Quality ───────────────────────────────────────────────────────
      'no-console':         ['warn', { allow: ['warn', 'error'] }],
      'no-debugger':        'error',
      'no-duplicate-imports': 'error',
      'no-var':             'error',
      'prefer-const':       'warn',
      'eqeqeq':             ['error', 'always', { null: 'ignore' }],

      // ── Security ───────────────────────────────────────────────────────────
      'no-eval':            'error',
      'no-implied-eval':    'error',
      'no-new-func':        'error',
    },
  },

  // ── Test files — relaxed rules ────────────────────────────────────────────────
  {
    files: ['src/__tests__/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        describe: 'readonly',
        it:       'readonly',
        expect:   'readonly',
        beforeEach: 'readonly',
        afterEach:  'readonly',
        vi:       'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console':     'off',
    },
  },
];
