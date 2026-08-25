// src/components/ui/Avatar.jsx
import { useMemo } from 'react';
import { initials, avatarStyle } from '../../utils/helpers';

export default function Avatar({ name = '', size = 36, className = '', style: extStyle = {} }) {
  const { background, color } = useMemo(() => avatarStyle(name), [name]);
  const letters = useMemo(() => initials(name), [name]);

  return (
    <div
      className={`user-av ${className}`}
      style={{
        width:          size,
        height:         size,
        borderRadius:   '50%',
        background,
        color,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       Math.round(size * 0.33),
        fontWeight:     500,
        flexShrink:     0,
        ...extStyle,
      }}
    >
      {letters}
    </div>
  );
}

export function AvatarWithName({ name, subtitle, size = 34 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} size={size}/>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13.5, color: 'var(--text)' }}>{name}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'Cairo, sans-serif' }}>{subtitle}</div>}
      </div>
    </div>
  );
}
