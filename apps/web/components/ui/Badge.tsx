interface BadgeProps {
  label: string;
  tone?: 'accent' | 'amber' | 'muted' | 'outline' | 'dashed';
}

const TONE_CLASSES: Record<NonNullable<BadgeProps['tone']>, string> = {
  accent: 'bg-accent text-accent-fg',
  amber: 'bg-amber text-amber-fg',
  muted: 'bg-surface-2 text-fg-subtle',
  outline: 'border border-border text-fg bg-surface/80',
  dashed: 'border border-dashed border-border text-fg-subtle bg-surface/80',
};

export function Badge({ label, tone = 'outline' }: BadgeProps) {
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-medium inline-flex items-center ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
