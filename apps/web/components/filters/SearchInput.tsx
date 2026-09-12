'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

const DEBOUNCE_MS = 300;

export function SearchInput({ value, onChange }: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);

  // Reset the draft when the URL-driven value changes from outside this input
  // (Clear all, a removed ActivePills pill, browser back/forward) — a render-time
  // comparison rather than an effect, per React's guidance on adjusting state
  // when a prop changes, so it doesn't cost an extra cascading render.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <Input
      label="Search food drops"
      hideLabel
      type="search"
      placeholder="Search Oreo, Taco Bell, pickle…"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}
