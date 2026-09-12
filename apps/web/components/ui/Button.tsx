import type { ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-accent-fg',
  secondary: 'bg-surface hover:bg-surface-2 text-fg border border-border',
  ghost: 'bg-transparent hover:bg-surface-2 text-fg-muted',
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-[var(--control-h-sm)] px-3 text-xs',
  md: 'h-[var(--control-h-md)] px-4 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`rounded-md font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${FOCUS_RING} ${className}`}
      {...rest}
    />
  );
}
