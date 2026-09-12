import { useId } from 'react';
import { FOCUS_RING } from './focusRing';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  hideLabel?: boolean;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
}

export function Select({ label, hideLabel, value, options, onValueChange }: SelectProps) {
  const id = useId();

  return (
    <div>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'block text-xs font-medium text-fg-muted mb-1'}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={`h-[var(--control-h-md)] px-3 text-sm bg-surface border border-border rounded-md text-fg w-full ${FOCUS_RING}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
