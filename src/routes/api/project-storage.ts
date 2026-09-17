import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/project-storage')({
  server: { handlers: {
    GET: async ({ request }) => (await import('../../lib/studio/project-library.server')).projectStorageRequest(request),
    POST: async ({ request }) => (await import('../../lib/studio/project-library.server')).projectStorageRequest(request),
  } },
});
