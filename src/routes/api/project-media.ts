import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/project-media')({
  server: { handlers: {
    GET: async ({ request }) => (await import('../../lib/studio/project-library.server')).projectMediaRequest(request),
  } },
});
