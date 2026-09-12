'use client';

import type { SortKey } from '@bitedrop/core';
import { Select } from '@/components/ui/Select';

interface SortSelectProps {
  value: SortKey;
  onChange: (value: SortKey) => void;
}

const OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'trending', label: 'Trending' },
];

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <Select
      label="Sort by"
      value={value}
      options={OPTIONS}
      onValueChange={(next) => onChange(next === 'trending' ? 'trending' : 'newest')}
    />
  );
}
