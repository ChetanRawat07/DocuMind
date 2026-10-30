import type { CurrentUser } from '@documind/shared';
import { createContext, useContext } from 'react';

/** The signed-in user's profile from GET /me, provided by the app shell once it has loaded. */
export const CurrentUserContext = createContext<CurrentUser | null>(null);

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (!user) {
    throw new Error('useCurrentUser must be used inside the app shell');
  }
  return user;
}

/** The name to greet and label the user with. */
export function displayNameOf(user: Pick<CurrentUser, 'displayName' | 'email'>): string {
  return user.displayName ?? user.email;
}
