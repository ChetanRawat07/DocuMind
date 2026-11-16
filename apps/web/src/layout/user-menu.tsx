import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSignOut } from '../auth/use-sign-out';
import { Avatar } from '../components/ui/avatar';
import { NAV_ITEMS } from './navigation';

const ITEM_CLASS =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-compact text-fg transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent';

/**
 * Account disclosure in the top bar. A disclosure (button + panel) rather
 * than an ARIA menu: it holds a link and a button, and Tab moves through
 * them normally. Escape and clicks outside close it.
 */
export function UserMenu({ name, email }: { name: string; email: string | null }) {
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Account"
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className="flex items-center gap-1 rounded-lg p-1 transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Avatar name={name} className="size-6 text-xs" />
        <ChevronDown aria-hidden="true" className="size-4 text-fg-muted" />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-line bg-surface p-1 shadow-sm"
      >
        <div className="border-b border-line-subtle px-2 pt-1 pb-2">
          <p className="truncate text-compact font-medium text-fg">{name}</p>
          {email && email !== name ? (
            <p className="truncate text-xs text-fg-muted">{email}</p>
          ) : null}
        </div>
        <ul className="pt-1">
          <li>
            <Link
              to={NAV_ITEMS.settings.path}
              viewTransition
              className={ITEM_CLASS}
              onClick={() => {
                setOpen(false);
              }}
            >
              <Settings aria-hidden="true" className="size-4 text-fg-muted" />
              Settings
            </Link>
          </li>
          <li>
            <button type="button" className={ITEM_CLASS} onClick={() => void signOut()}>
              <LogOut aria-hidden="true" className="size-4 text-fg-muted" />
              Sign out
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
