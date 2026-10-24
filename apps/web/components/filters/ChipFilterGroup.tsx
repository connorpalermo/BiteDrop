'use client';

import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/Chip';
import { FieldGroup } from '@/components/ui/FieldGroup';

export interface ChipFilterOption<T extends string> {
  value: T;
  label: string;
  emoji?: string;
  count: number;
}

interface ChipFilterGroupProps<T extends string> {
  legend: string;
  options: ChipFilterOption<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  /** Overrides the emoji with a rendered icon (e.g. CategoryIcon) for just
   * this group — leave unset for groups that should keep the emoji (country
   * flags, status). */
  renderIcon?: (option: ChipFilterOption<T>) => ReactNode;
}

export function ChipFilterGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
  renderIcon,
}: ChipFilterGroupProps<T>) {
  return (
    <FieldGroup legend={legend}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          emoji={option.emoji}
          icon={renderIcon?.(option)}
          count={option.count}
          selected={selected.includes(option.value)}
          disabled={option.count === 0}
          onToggle={() => onToggle(option.value)}
        />
      ))}
    </FieldGroup>
  );
}
