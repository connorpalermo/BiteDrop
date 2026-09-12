import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  /** Layout/positioning utilities ONLY — never colour, radius, or shadow. */
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg shadow-card overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}
