import { supabase } from '../../../lib/supabase';
import { getDetails } from '../../../lib/tmdb';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ movies: data });
}

export async function POST(request) {
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
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ movie: data });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id обязателен' }, { status: 400 });
  }

  const { error } = await supabase.from('movies').delete().eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
