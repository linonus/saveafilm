import { getDetails } from '../../../lib/tmdb';

export const dynamic = 'force-dynamic';

// Поиск (/api/search) отдаёt данные TMDB без жанров — их присылает только
// details-эндпоинт. Этот роут дотягивает полную карточку, когда пользователь
// открывает фильм из результатов поиска.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mediaType = searchParams.get('media_type');
  const id = searchParams.get('id');

  if (!mediaType || !id) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    const item = await getDetails(mediaType, id);
    return Response.json({ item });
  } catch (err) {
    return Response.json({ error: 'tmdb_fetch_failed' }, { status: 502 });
  }
}
