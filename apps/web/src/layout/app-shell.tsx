import { currentUserSchema } from '@documind/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { CurrentUserContext, displayNameOf } from '../auth/current-user';
import { useAuth } from '../auth/use-auth';
import { ErrorState, Spinner } from '../components/ui/feedback';
import { useApiQuery } from '../services/use-api-query';
import { MobileNav } from './mobile-nav';
import { SidebarContent } from './sidebar';
import { TopBar } from './top-bar';

/**
 * Signed-in layout: fixed sidebar (a drawer on narrow screens), sticky top
 * bar and the page. It loads the user's profile once (GET /me) and provides
 * it to every page; pages render only after it has loaded.
 */
export function AppShell() {
  const { session } = useAuth();
  const me = useApiQuery('/me', currentUserSchema);
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
      main.current?.focus();
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
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-2 focus:outline-brand-600"
        >
          Skip to main content
        </a>

        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-gray-200 bg-white lg:block">
          <SidebarContent />
        </aside>

        <div className="lg:pl-64">
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

      {navOpen ? <MobileNav id={navId} onClose={closeNav} returnFocusTo={menuButton} /> : null}
    </>
  );
}
