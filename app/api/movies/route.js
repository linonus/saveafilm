import { supabase } from '../../../lib/supabase';
import { getDetails } from '../../../lib/tmdb';
import { getTelegramUserId } from '../../../lib/telegramAuth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const userId = getTelegramUserId(request);
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .eq('telegram_id', userId)
    .order('added_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ movies: data });
}

export async function POST(request) {
  const userId = getTelegramUserId(request);
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { tmdb_id, media_type } = body || {};

  if (!tmdb_id || !media_type) {
    return Response.json({ error: 'tmdb_id и media_type обязательны' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('movies')
    .select('id')
    .eq('tmdb_id', tmdb_id)
    .eq('media_type', media_type)
    .eq('telegram_id', userId)
    .maybeSingle();

  if (existing) {
    return Response.json({ error: 'already_exists' }, { status: 409 });
  }

  let item;
  try {
    item = await getDetails(media_type, tmdb_id);
  } catch (err) {
    return Response.json({ error: 'tmdb_fetch_failed' }, { status: 502 });
  }

  const { data, error } = await supabase
    .from('movies')
    .insert({
      tmdb_id: item.tmdb_id,
      media_type: item.media_type,
      title: item.title,
      poster_url: item.poster_url,
      description: item.description,
      year: item.year,
      rating: item.rating,
      google_query: item.google_query,
      telegram_id: userId,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ movie: data });
}

export async function DELETE(request) {
  const userId = getTelegramUserId(request);
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id обязателен' }, { status: 400 });
  }

  // eq('telegram_id', userId) — чтобы нельзя было удалить чужой фильм, подставив id
  const { error } = await supabase
    .from('movies')
    .delete()
    .eq('id', id)
    .eq('telegram_id', userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
