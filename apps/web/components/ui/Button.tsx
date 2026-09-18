import type { ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

// primary/secondary get the bold-border, hard-shadow "sticker button" press
// interaction; ghost stays quiet on purpose — it's the low-emphasis variant,
// and a thick border would work against that.
const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-gradient-accent hover:brightness-110 text-accent-fg border-2 border-fg shadow-brutal-sm hover:shadow-brutal active:shadow-none active:translate-x-0.5 active:translate-y-0.5',
  secondary:
    'bg-surface hover:bg-surface-2 text-fg border-2 border-fg shadow-brutal-sm hover:shadow-brutal active:shadow-none active:translate-x-0.5 active:translate-y-0.5',
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
      className={`rounded-md font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${FOCUS_RING} ${className}`}
      {...rest}
    />
  );
}
