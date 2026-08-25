// src/components/ui/Button.jsx — Tailwind migrated
import { memo } from 'react';

const VARIANTS = {
  primary:   'bg-accent text-white hover:opacity-85 border-transparent',
  secondary: 'bg-surface2 text-text2 border-border hover:bg-surface3',
  danger:    'bg-red text-white hover:opacity-85 border-transparent',
  ghost:     'bg-transparent text-text2 border-transparent hover:bg-surface2',
  outline:   'bg-transparent text-accent border-accent hover:bg-accent hover:text-white',
};

const SIZES = {
  sm:  'text-xs  px-3   py-1.5 rounded-[7px]',
  md:  'text-sm  px-4   py-2   rounded-input',
  lg:  'text-sm  px-5   py-2.5 rounded-[10px]',
};

const Button = memo(function Button({
  children,
  variant  = 'primary',
  size     = 'md',
  disabled = false,
  loading  = false,
  icon,
  onClick,
  type     = 'button',
  className = '',
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`
        inline-flex items-center justify-center gap-2
        font-cairo font-semibold border
        transition-all duration-150 cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANTS[variant] || VARIANTS.primary}
        ${SIZES[size]       || SIZES.md}
        ${className}
      `}
      {...rest}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent
                         rounded-full animate-spin shrink-0" />
      )}
      {!loading && icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
});

export default Button;
