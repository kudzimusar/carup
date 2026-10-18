import { QueryClient } from '@tanstack/react-query';

/**
 * Process-global native query client.
 *
 * Normal requests keep the existing five-minute stale window. Identity authority
 * boundaries use clearIdentityQueryCache() so cached account/role/tenant data can
 * never be observed by the next authority context in the same process.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

export function clearIdentityQueryCache(): void {
  queryClient.clear();
}
