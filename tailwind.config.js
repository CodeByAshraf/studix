/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Cairo لكل شيء — الواجهة، النصوص، الأرقام، كل حاجة
        cairo: ['Cairo', 'sans-serif'],
        sans:  ['Cairo', 'sans-serif'],
        mono:  ['Cairo', 'sans-serif'], // override mono بـ Cairo
      },
      colors: {
        bg:       'var(--bg)',
        surface:  'var(--surface)',
        surface2: 'var(--surface2)',
        surface3: 'var(--surface3)',
        border:   'var(--border)',
        border2:  'var(--border2)',
        accent:   'var(--accent)',
        accent2:  'var(--accent2)',
        green:    'var(--green)',
        red:      'var(--red)',
        blue:     'var(--blue)',
        purple:   'var(--purple)',
        orange:   'var(--orange)',
        text:     'var(--text)',
        text2:    'var(--text2)',
        text3:    'var(--text3)',
      },
      borderRadius: {
        card:    '14px',
        input:   '9px',
        badge:   '99px',
        DEFAULT: '9px',
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
    },
  },
  plugins: [],
};
