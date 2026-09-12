import { FOCUS_RING } from './focusRing';

interface ChipProps {
  label: string;
  emoji?: string;
  count?: number;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function Chip({ label, emoji, count, selected, onToggle, disabled }: ChipProps) {
  const stateClasses = selected
    ? 'bg-accent text-accent-fg border border-accent'
    : 'bg-surface text-fg-muted border border-border';

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`rounded-full h-8 px-3 text-xs inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none ${stateClasses} ${FOCUS_RING}`}
    >
      {emoji ? <span aria-hidden="true">{emoji}</span> : null}
      <span>{label}</span>
      {count !== undefined ? <span className="text-fg-subtle">({count})</span> : null}
    </button>
  );
}
