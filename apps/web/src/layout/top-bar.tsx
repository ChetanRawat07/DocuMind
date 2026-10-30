import { ChevronRight, Menu } from 'lucide-react';
import type { Ref } from 'react';
import { useLocation } from 'react-router';
import { breadcrumbFor } from './navigation';
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
                <li key={crumb} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5" /> : null}
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

      <div className="ml-auto">
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}
