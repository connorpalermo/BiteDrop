import type { ReactNode } from 'react';

interface FieldGroupProps {
  legend: string;
  children: ReactNode;
}

export function FieldGroup({ legend, children }: FieldGroupProps) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
