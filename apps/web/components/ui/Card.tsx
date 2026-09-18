import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  /** Layout/positioning utilities ONLY — never colour, radius, or shadow. */
  className?: string;
  /** True for cards that are themselves the clickable target (e.g. wrapped in
   * a Link) — adds the hover-lift/press interaction. Leave false for a
   * static container (e.g. SourceList's wrapper), where a hover affordance
   * on the whole box would be misleading since nothing there is clickable
   * as a unit. */
  interactive?: boolean;
}

export function Card({ children, className = '', interactive = false }: CardProps) {
  // Neo-brutalist "sticker" interaction: the shadow grows on hover (lift)
  // and disappears on active/press while the card shifts into the shadow's
  // old position — the classic tactile push-down. transition-all covers
  // both the shadow and transform changes without arbitrary transition-
  // property syntax.
  const interactiveClasses = interactive
    ? 'transition-all duration-150 hover:-translate-y-1 hover:shadow-brutal-lg active:translate-x-1 active:translate-y-1 active:shadow-none'
    : '';

  return (
    <div
      className={`bg-surface border-2 border-fg rounded-lg shadow-card overflow-hidden ${interactiveClasses} ${className}`}
    >
      {children}
    </div>
  );
}
