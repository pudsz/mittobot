import { QueryClient } from "@tanstack/react-query";

// One client for the whole app. 30s staleTime keeps tab-switching snappy
// without hammering the bot; mutations invalidate their own keys.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error: any) => {
        if (error?.status === 401 || error?.status === 403) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
