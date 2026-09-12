'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { FOCUS_RING } from './focusRing';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Wraps Tab/Shift+Tab at the panel's edges so focus never escapes to the page
 * behind the modal, matching what aria-modal="true" promises assistive tech. */
function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  if (e.key !== 'Tab') return;
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Focus trap, Escape-to-close, and scroll lock while the sheet is open. */
function useSheetLifecycle(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (panelRef.current) trapTab(e, panelRef.current);
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose, panelRef]);
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useSheetLifecycle(open, onClose, panelRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 bg-fg/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto bg-surface border-t border-border rounded-t-lg p-4 ${FOCUS_RING}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`text-fg-muted hover:text-fg rounded-md p-1 ${FOCUS_RING}`}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
