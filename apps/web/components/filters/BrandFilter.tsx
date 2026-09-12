'use client';

import { useState } from 'react';
import type { FacetCount } from '@bitedrop/core';
import { Chip } from '@/components/ui/Chip';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';

interface BrandFilterProps {
  options: FacetCount<string>[];
  selected: string[];
  onToggle: (slug: string) => void;
}

const VISIBLE_LIMIT = 12;

export function BrandFilter({ options, selected, onToggle }: BrandFilterProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  return (
    <FieldGroup legend="Brand">
      <div className="w-full">
        <Input
          label="Filter brands"
          hideLabel
          placeholder="Filter brands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered.slice(0, VISIBLE_LIMIT).map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          count={option.count}
          selected={selected.includes(option.value)}
          onToggle={() => onToggle(option.value)}
        />
      ))}
    </FieldGroup>
  );
}
