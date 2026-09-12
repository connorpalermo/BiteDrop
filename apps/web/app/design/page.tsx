'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sheet } from '@/components/ui/Sheet';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-fg mb-3">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function ButtonSection() {
  return (
    <Section title="Button">
      {(['primary', 'secondary', 'ghost'] as const).map((variant) =>
        (['sm', 'md'] as const).map((size) => (
          <Button key={`${variant}-${size}`} variant={variant} size={size}>
            {variant} {size}
          </Button>
        )),
      )}
      <Button disabled>disabled</Button>
    </Section>
  );
}

function ChipSection() {
  return (
    <Section title="Chip">
      <Chip label="Candy" emoji="🍫" count={5} selected={false} onToggle={() => {}} />
      <Chip label="Snacks" emoji="🍿" count={3} selected={true} onToggle={() => {}} />
      <Chip label="Empty" count={0} selected={false} disabled onToggle={() => {}} />
    </Section>
  );
}

function BadgeSection() {
  return (
    <Section title="Badge">
      <Badge label="New" tone="accent" />
      <Badge label="Limited Time" tone="amber" />
      <Badge label="Discontinued" tone="muted" />
      <Badge label="Coming Soon" tone="outline" />
      <Badge label="Unconfirmed" tone="dashed" />
    </Section>
  );
}

function CardSection() {
  return (
    <Section title="Card">
      <Card className="w-64 p-4">
        <p className="text-sm text-fg">A card is a plain surface — no routing.</p>
      </Card>
    </Section>
  );
}

function InputSelectSection() {
  return (
    <Section title="Input & Select">
      <Input label="Search" placeholder="Search drops…" className="w-56" />
      <Input label="Brand" hideLabel placeholder="Filter by brand" className="w-56" />
      <Select
        label="Sort"
        value="newest"
        onValueChange={() => {}}
        options={[
          { value: 'newest', label: 'Newest' },
          { value: 'trending', label: 'Trending' },
        ]}
      />
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section title="Skeleton">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-24 w-40" />
    </Section>
  );
}

function FieldGroupSection() {
  return (
    <Section title="FieldGroup">
      <div className="w-full">
        <FieldGroup legend="Category">
          <Chip label="Candy" selected={true} onToggle={() => {}} />
          <Chip label="Chips" selected={false} onToggle={() => {}} />
        </FieldGroup>
      </div>
    </Section>
  );
}

function SheetSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Sheet">
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filters">
        <p className="text-sm text-fg-muted">Sheet content goes here.</p>
      </Sheet>
    </Section>
  );
}

export default function DesignPage() {
  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8 flex flex-col gap-10">
      <h1 className="text-3xl font-bold text-fg">BiteDrop UI Primitives</h1>
      <ButtonSection />
      <ChipSection />
      <BadgeSection />
      <CardSection />
      <InputSelectSection />
      <SkeletonSection />
      <FieldGroupSection />
      <SheetSection />
    </main>
  );
}
