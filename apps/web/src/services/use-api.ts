import { useMemo } from 'react';
import { useAuth } from '../auth/use-auth';
import { type ApiClient, createApiClient } from './api-client';

export function useApi(): ApiClient {
  const { client } = useAuth();
  return useMemo(() => createApiClient(client), [client]);
}
