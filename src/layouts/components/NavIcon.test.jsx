// src/layouts/components/NavIcon.test.jsx
// Every sidebar entry's `icon` (constants/nav.js) must have a NavIcon path — NavIcon renders
// nothing for an unknown name, so a missing mapping silently leaves the item without an icon.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NavIcon from './NavIcon';
import { NAV_ITEMS } from '../../constants/nav';

describe('NavIcon — covers every sidebar icon name', () => {
  const iconNames = [...new Set(NAV_ITEMS.map((item) => item.icon))];

  it.each(iconNames)('renders an icon for "%s"', (name) => {
    const { container } = render(<NavIcon name={name} />);
    expect(container.querySelector('svg path')).not.toBeNull();
  });
});
