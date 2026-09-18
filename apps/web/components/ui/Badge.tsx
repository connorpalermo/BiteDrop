interface BadgeProps {
  label: string;
  tone?: 'accent' | 'amber' | 'muted' | 'outline' | 'dashed';
}

// Bold 2px ink border on every tone, for the same genre-coherence reason
// Card and Button use it. Only `accent` (the highest-urgency tone — status
// "new") gets the ambient pulse: pulsing every badge at once across a full
// feed of cards would read as visual noise, not excitement, so the "alive"
// signal is reserved for the one tone that's actually rare and worth
// noticing.
const TONE_CLASSES: Record<NonNullable<BadgeProps['tone']>, string> = {
  accent: 'bg-gradient-accent text-accent-fg border-2 border-fg animate-brutal-pulse',
  amber: 'bg-amber text-amber-fg border-2 border-fg',
  muted: 'bg-surface-2 text-fg-subtle border-2 border-fg',
  outline: 'border-2 border-fg text-fg bg-surface',
  dashed: 'border-2 border-dashed border-fg text-fg-subtle bg-surface',
};

export function Badge({ label, tone = 'outline' }: BadgeProps) {
  return (
    <span
      className={`rounded-full px-3 py-0.5 text-xs font-bold inline-flex items-center ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
