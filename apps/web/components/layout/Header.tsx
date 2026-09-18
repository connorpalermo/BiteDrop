import Link from 'next/link';
import { Logo } from '@/components/layout/Logo';
import { FOCUS_RING } from '@/components/ui/focusRing';

export function Header() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-7xl items-center gap-2 p-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className={`flex items-center gap-2 rounded-md font-display text-xl font-bold text-fg ${FOCUS_RING}`}
        >
          <Logo className="h-9 w-9" />
          BiteDrop
        </Link>
      </div>
    </header>
  );
}
