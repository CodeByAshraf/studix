// src/utils/helpers.js

export const initials = (name = '') => {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? parts[0][0] + parts[1][0] : name.substring(0, 2);
};

export const formatDate = (d, opts = {}) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'long', day: 'numeric', ...opts,
    });
  } catch { return '—'; }
};

export const formatCurrency = (n, currency = 'ج.م') => {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return `${Math.round(n).toLocaleString('ar-EG')} ${currency}`;
};

export const formatPercent = (value, total) => {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
};

export const paginate = (items, page, pageSize) => {
  const total      = items.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const safePage   = Math.max(1, Math.min(page, totalPages));
  const start      = (safePage - 1) * pageSize;
  return {
    items:      items.slice(start, start + pageSize),
    page:       safePage,
    totalPages,
    total,
    start:      start + 1,
    end:        Math.min(start + pageSize, total),
    hasPrev:    safePage > 1,
    hasNext:    safePage < totalPages,
  };
};

export const generateCode = (prefix = 'TC', seq, len = 4) =>
  `${prefix}-${new Date().getFullYear()}-${String(seq).padStart(len, '0')}`;

export const debounce = (fn, ms = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

export const groupBy = (arr, key) =>
  arr.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});

export const sortBy = (arr, key, dir = 'asc') =>
  [...arr].sort((a, b) => {
    const va = typeof key === 'function' ? key(a) : a[key];
    const vb = typeof key === 'function' ? key(b) : b[key];
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });

export const isValidPhone = (phone) =>
  /^01[0-9]{9}$/.test((phone || '').replace(/\s/g, ''));

export const uuid = () =>
  crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Avatar color pairs [bg:color]
const AV_PAIRS = [
  ['#bbf7d0','#166534'], ['#bfdbfe','#1d4ed8'], ['#fde68a','#92400e'],
  ['#ddd6fe','#5b21b6'], ['#99f6e4','#0f766e'], ['#fecaca','#991b1b'],
  ['#fed7aa','#9a3412'], ['#d9f99d','#365314'],
];

export const avatarStyle = (name = '') => {
  const idx = ((name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)) % AV_PAIRS.length;
  const [bg, color] = AV_PAIRS[idx];
  return { background: bg, color };
};
