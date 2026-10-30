import { X } from 'lucide-react';
import { type RefObject, useEffect, useRef } from 'react';
import { SidebarContent } from './sidebar';

/** Matches Tailwind's `lg` breakpoint, where the fixed sidebar takes over. */
const DESKTOP_QUERY = '(min-width: 64rem)';

/**
 * Slide-in navigation for narrow screens, as a modal dialog. The app shell
 * marks the rest of the page `inert` while it is open, which keeps keyboard
 * focus and screen readers inside. Escape, the backdrop and following a link
 * close it, and focus returns to the button that opened it.
 */
export function MobileNav({
  id,
  onClose,
  returnFocusTo,
}: {
  id: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const opener = returnFocusTo.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    // Widening the window past the breakpoint hides the drawer, so close it too.
    const desktop =
      typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;
    function handleBreakpoint(event: MediaQueryListEvent) {
      if (event.matches) onClose();
    }
    desktop?.addEventListener('change', handleBreakpoint);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      desktop?.removeEventListener('change', handleBreakpoint);
      opener?.focus();
    };
  }, [onClose, returnFocusTo]);

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl"
      >
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute top-4 right-3 grid size-9 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>
  );
}
