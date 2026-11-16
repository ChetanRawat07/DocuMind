import { MAX_DOCUMENT_SEARCH_LENGTH } from '@documind/shared';
import { ChevronRight, Menu, Plus, Search } from 'lucide-react';
import { type Ref, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { INPUT_CLASS } from '../components/form-controls';
import { buttonClasses } from '../components/ui/button-styles';
import { cx } from '../lib/cx';
import { DEFAULT_DOCUMENT_VIEW, documentViewToParams } from '../lib/document-view';
import { breadcrumbFor, NAV_ITEMS } from './navigation';
import { UserMenu } from './user-menu';

export function TopBar({
  navOpen,
  navId,
  onOpenNav,
  menuButtonRef,
  userName,
  userEmail,
}: {
  navOpen: boolean;
  navId: string;
  onOpenNav: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
  userName: string;
  userEmail: string | null;
}) {
  const { pathname } = useLocation();
  const crumbs = breadcrumbFor(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 [view-transition-name:top-bar] items-center gap-3 border-b border-line bg-surface px-4 sm:px-6 lg:px-8">
      <button
        ref={menuButtonRef}
        type="button"
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls={navOpen ? navId : undefined}
        onClick={onOpenNav}
        className="-ml-2 grid size-8 place-items-center rounded-md text-fg-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent lg:hidden"
      >
        <Menu aria-hidden="true" className="size-4" />
      </button>

      {crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex items-center gap-1 text-compact text-fg-muted">
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <li
                  key={crumb}
                  // On phones only the current page fits; the section name returns at sm.
                  className={
                    isLast ? 'flex min-w-0 items-center gap-1' : 'hidden items-center gap-1 sm:flex'
                  }
                >
                  {index > 0 ? (
                    <ChevronRight aria-hidden="true" className="hidden size-3.5 sm:block" />
                  ) : null}
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={isLast ? 'truncate font-medium text-fg' : 'truncate'}
                  >
                    {crumb}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <QuickSearch />
        <Link
          to={`${NAV_ITEMS.documents.path}#upload`}
          viewTransition
          className={buttonClasses('primary', 'sm')}
        >
          <Plus aria-hidden="true" className="size-4" />
          <span className="sr-only sm:not-sr-only">Upload</span>
        </Link>
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}

/**
 * Filename search from anywhere: submitting opens the documents list with
 * the search applied. ⌘K (Ctrl+K elsewhere) focuses it.
 */
function QuickSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const input = useRef<HTMLInputElement>(null);
  const shortcut = navigator.userAgent.includes('Mac') ? '⌘K' : 'Ctrl K';

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <form
      role="search"
      aria-label="Documents"
      className="relative hidden md:block"
      onSubmit={(event) => {
        event.preventDefault();
        const q = input.current?.value.trim() ?? '';
        const params = documentViewToParams({ ...DEFAULT_DOCUMENT_VIEW, ...(q ? { q } : {}) });
        // Already on the list, a search only changes it: no page transition, no scroll reset.
        const onList = pathname === NAV_ITEMS.documents.path;
        void navigate(`${NAV_ITEMS.documents.path}?${params.toString()}`, {
          viewTransition: !onList,
          preventScrollReset: onList,
        });
        input.current?.blur();
      }}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted"
      />
      <input
        ref={input}
        type="search"
        aria-label="Search documents"
        placeholder="Search documents"
        maxLength={MAX_DOCUMENT_SEARCH_LENGTH}
        autoComplete="off"
        className={cx(INPUT_CLASS, 'peer h-8 w-56 pr-12 pl-8')}
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line bg-surface px-1 font-sans text-xs text-fg-muted peer-focus:hidden"
      >
        {shortcut}
      </kbd>
    </form>
  );
}
