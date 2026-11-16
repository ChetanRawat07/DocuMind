import { currentUserSchema, documentListResponseSchema } from '@documind/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { CurrentUserContext, displayNameOf } from '../auth/current-user';
import { useAuth } from '../auth/use-auth';
import { ErrorState, Spinner } from '../components/ui/feedback';
import { useApiQuery } from '../services/use-api-query';
import { MobileNav } from './mobile-nav';
import { REVIEW_COUNT_LIMIT, REVIEW_COUNT_PATH } from './navigation';
import { SidebarContent } from './sidebar';
import { TopBar } from './top-bar';

/**
 * How many documents wait for review, for the sidebar badge: "100+" past one
 * page, null at zero or while unknown. It refreshes whenever document data
 * changes (a review decision, an upload, a delete): see invalidateDocumentData.
 */
function useReviewCount(): string | null {
  const queue = useApiQuery(REVIEW_COUNT_PATH, documentListResponseSchema);
  if (queue.status !== 'success' || queue.data.items.length === 0) return null;
  return queue.data.nextCursor ? `${String(REVIEW_COUNT_LIMIT)}+` : String(queue.data.items.length);
}

/**
 * Signed-in layout: fixed sidebar (a drawer on narrow screens), sticky top
 * bar and the page. It loads the user's profile once (GET /me) and provides
 * it to every page; pages render only after it has loaded.
 */
export function AppShell() {
  const { session } = useAuth();
  const me = useApiQuery('/me', currentUserSchema);
  const reviewCount = useReviewCount();
  const [navOpen, setNavOpen] = useState(false);
  const navId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const closeNav = useCallback(() => {
    setNavOpen(false);
  }, []);

  // After client-side navigation, move focus to the new page so keyboard and
  // screen-reader users start there instead of on the link they followed.
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      main.current?.focus({ preventScroll: true });
    }
  }, [pathname]);

  const fallbackEmail = session?.user.email ?? null;
  const userName = me.status === 'success' ? displayNameOf(me.data) : (fallbackEmail ?? 'Account');
  const userEmail = me.status === 'success' ? me.data.email : fallbackEmail;

  return (
    <>
      <div inert={navOpen} className="min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-sm focus:outline-2 focus:outline-accent"
        >
          Skip to main content
        </a>

        <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-showcase-line bg-showcase [view-transition-name:sidebar] lg:block">
          <SidebarContent userName={userName} reviewCount={reviewCount} />
        </aside>

        <div className="lg:pl-60">
          <TopBar
            navOpen={navOpen}
            navId={navId}
            onOpenNav={() => {
              setNavOpen(true);
            }}
            menuButtonRef={menuButton}
            userName={userName}
            userEmail={userEmail}
          />
          <main
            id="main-content"
            ref={main}
            tabIndex={-1}
            className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
          >
            {me.status === 'loading' ? (
              <Spinner label="Loading your workspace…" className="py-16" />
            ) : me.status === 'error' ? (
              <ErrorState
                title="Could not load your workspace"
                description="Check your connection and try again."
                onRetry={me.retry}
                className="py-16"
              />
            ) : (
              <CurrentUserContext value={me.data}>
                <Outlet />
              </CurrentUserContext>
            )}
          </main>
        </div>
      </div>

      {navOpen ? (
        <MobileNav
          id={navId}
          onClose={closeNav}
          returnFocusTo={menuButton}
          userName={userName}
          reviewCount={reviewCount}
        />
      ) : null}
    </>
  );
}
