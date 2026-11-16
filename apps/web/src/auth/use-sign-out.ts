import { useNavigate } from 'react-router';
import { useAuth } from './use-auth';

/** Signs out on purpose and lands on the login page. */
export function useSignOut() {
  const { client } = useAuth();
  const navigate = useNavigate();
  return async () => {
    await client.signOut({ scope: 'local' });
    await navigate('/login', { replace: true });
  };
}
