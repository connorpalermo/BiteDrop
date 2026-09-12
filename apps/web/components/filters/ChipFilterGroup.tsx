'use client';

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
}

export function ChipFilterGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: ChipFilterGroupProps<T>) {
  return (
    <FieldGroup legend={legend}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          emoji={option.emoji}
          count={option.count}
          selected={selected.includes(option.value)}
          disabled={option.count === 0}
          onToggle={() => onToggle(option.value)}
        />
      ))}
    </FieldGroup>
  );
}
