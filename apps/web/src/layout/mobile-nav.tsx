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
  userName,
  reviewCount,
}: {
  id: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  userName: string;
  reviewCount: string | null;
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
      <div aria-hidden="true" className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 w-60 max-w-[85vw] border-r border-showcase-line bg-showcase shadow-sm"
      >
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute top-3 right-2 grid size-8 place-items-center rounded-lg text-showcase-muted transition-colors duration-150 hover:bg-showcase-raised hover:text-showcase-fg focus-visible:outline-2 focus-visible:outline-showcase-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
        <SidebarContent onNavigate={onClose} userName={userName} reviewCount={reviewCount} />
      </div>
    </div>
  );
}
