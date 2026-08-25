// src/modules/students/components/StudentAvatar.jsx
import { useMemo } from 'react';

const PALETTE = [
  { bg: 'rgba(59,130,246,.18)',   color: '#3b82f6' },
  { bg: 'rgba(16,185,129,.18)',   color: '#10b981' },
  { bg: 'rgba(245,158,11,.18)',   color: '#f59e0b' },
  { bg: 'rgba(139,92,246,.18)',   color: '#8b5cf6' },
  { bg: 'rgba(239,68,68,.18)',    color: '#ef4444' },
  { bg: 'rgba(6,182,212,.18)',    color: '#06b6d4' },
  { bg: 'rgba(244,63,94,.18)',    color: '#f43f5e' },
  { bg: 'rgba(20,184,166,.18)',   color: '#14b8a6' },
];

export function useAvatarStyle(name = '') {
  return useMemo(() => {
    const idx = ((name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)) % PALETTE.length;
    return PALETTE[idx];
  }, [name]);
}

export default function StudentAvatar({ name = '', size = 38, fontSize, style = {} }) {
  const { bg, color } = useAvatarStyle(name);
  const letters = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('');
  const fs = fontSize || Math.round(size * 0.35);

  return (
    <div style={{
      width:          size,
      height:         size,
      borderRadius:   '50%',
      background:     bg,
      color,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontSize:       fs,
      fontWeight:     700,
      flexShrink:     0,
      userSelect:     'none',
      ...style,
    }}>
      {letters}
    </div>
  );
}
