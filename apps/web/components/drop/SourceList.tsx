import { formatRelativeTime, type SourceRef } from '@bitedrop/core';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { FOCUS_RING } from '@/components/ui/focusRing';

function SourceItem({ source, now }: { source: SourceRef; now: Date }) {
  return (
    <li>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex flex-col gap-1 rounded-md p-3 transition-colors hover:bg-surface-2 ${FOCUS_RING}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">{source.sourceName}</span>
          {source.isPrimary ? <Badge label="Primary source" tone="outline" /> : null}
        </div>
        <span className="text-sm text-fg-muted">{source.title}</span>
        <span className="text-xs text-fg-subtle">
          Discovered {formatRelativeTime(source.discoveredAt, now)}
        </span>
      </a>
    </li>
  );
}

export function SourceList({ sources }: { sources: SourceRef[] }) {
  const now = new Date();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold text-fg">
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          {sources.map((source) => (
            <SourceItem key={source.id} source={source} now={now} />
          ))}
        </ul>
      </Card>
    </section>
  );
}
