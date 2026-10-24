import type { IngestSourceType, SourceAdapter } from '@bitedrop/core';
import { rssAdapter } from './adapters/rss';

const ADAPTERS: Partial<Record<IngestSourceType, SourceAdapter>> = {
  rss: rssAdapter,
};

export function getAdapter(type: IngestSourceType): SourceAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`No adapter registered for source type "${type}"`);
  return adapter;
}
