import { FOCUS_RING } from '@/components/ui/focusRing';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={`sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg ${FOCUS_RING}`}
    >
      Skip to content
    </a>
  );
}
