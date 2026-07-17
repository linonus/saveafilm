import { searchMulti, formatResult } from '../../../lib/tmdb';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || !q.trim()) {
    return Response.json({ results: [] });
  }

  try {
    const results = await searchMulti(q.trim());
    return Response.json({ results: results.slice(0, 10).map(formatResult) });
  } catch (err) {
    return Response.json({ error: 'search_failed' }, { status: 502 });
  }
}
