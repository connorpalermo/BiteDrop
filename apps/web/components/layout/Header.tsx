import Link from 'next/link';
import { FOCUS_RING } from '@/components/ui/focusRing';

export function Header() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-7xl items-center p-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className={`rounded-md font-display text-xl font-bold text-fg ${FOCUS_RING}`}
        >
          🍩 BiteDrop
        </Link>
      </div>
    </header>
  );
}
