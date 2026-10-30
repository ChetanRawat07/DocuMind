import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { Avatar } from '../components/ui/avatar';
import { NAV_ITEMS } from './navigation';

const ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-600';

/**
 * Account disclosure in the top bar. A disclosure (button + panel) rather
 * than an ARIA menu: it holds a link and a button, and Tab moves through
 * them normally. Escape and clicks outside close it.
 */
export function UserMenu({ name, email }: { name: string; email: string | null }) {
  const { client } = useAuth();
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
        className="flex items-center gap-2 rounded-full p-0.5 pr-1.5 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <Avatar name={name} />
        <ChevronDown aria-hidden="true" className="size-4 text-gray-500" />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
      >
        <div className="border-b border-gray-100 px-2.5 pt-1.5 pb-2.5">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          {email && email !== name ? (
            <p className="truncate text-xs text-gray-500">{email}</p>
          ) : null}
        </div>
        <ul className="pt-1.5">
          <li>
            <Link
              to={NAV_ITEMS.settings.path}
              className={ITEM_CLASS}
              onClick={() => {
                setOpen(false);
              }}
            >
              <Settings aria-hidden="true" className="size-4 text-gray-500" />
              Settings
            </Link>
          </li>
          <li>
            <button
              type="button"
              className={ITEM_CLASS}
              onClick={() => void client.signOut({ scope: 'local' })}
            >
              <LogOut aria-hidden="true" className="size-4 text-gray-500" />
              Sign out
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
