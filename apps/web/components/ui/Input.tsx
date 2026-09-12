import { useId, type InputHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hideLabel?: boolean;
}

export function Input({ label, hideLabel, id, className = '', ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div>
      <label
        htmlFor={inputId}
        className={hideLabel ? 'sr-only' : 'block text-xs font-medium text-fg-muted mb-1'}
      >
        {label}
      </label>
      <input
        id={inputId}
        className={`h-[var(--control-h-md)] px-3 text-sm bg-surface border border-border rounded-md text-fg placeholder:text-fg-subtle w-full ${FOCUS_RING} ${className}`}
        {...rest}
      />
    </div>
  );
}
