import { ChevronRight, Menu, Plus } from 'lucide-react';
import type { Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { buttonClasses } from '../components/ui/button-styles';
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
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <button
        ref={menuButtonRef}
        type="button"
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls={navOpen ? navId : undefined}
        onClick={onOpenNav}
        className="-ml-1.5 grid size-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-600 lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      {crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex items-center gap-1.5 text-sm text-gray-500">
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <li
                  key={crumb}
                  // On phones only the current page fits; the section name returns at sm.
                  className={
                    isLast
                      ? 'flex min-w-0 items-center gap-1.5'
                      : 'hidden items-center gap-1.5 sm:flex'
                  }
                >
                  {index > 0 ? (
                    <ChevronRight aria-hidden="true" className="hidden size-3.5 sm:block" />
                  ) : null}
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={isLast ? 'truncate font-semibold text-gray-900' : 'truncate'}
                  >
                    {crumb}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <Link to={`${NAV_ITEMS.documents.path}#upload`} className={buttonClasses('primary', 'sm')}>
          <Plus aria-hidden="true" className="size-4" />
          <span className="sr-only sm:not-sr-only">Upload</span>
        </Link>
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}
