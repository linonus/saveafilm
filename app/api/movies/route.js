import { supabase } from '../../../lib/supabase';
import { getDetails } from '../../../lib/tmdb';
import { getTelegramUser } from '../../../lib/telegramAuth';

export const dynamic = 'force-dynamic';

async function upsertUser(user) {
  const payload = {
    telegram_id: user.id,
    username: user.username || null,
    first_name: user.first_name || null,
    updated_at: new Date().toISOString(),
  };
  if (user.photo_url) payload.photo_url = user.photo_url;
  await supabase.from('users').upsert(payload);
}

async function getAcceptedFriendIds(userId) {
  const { data } = await supabase
    .from('friends')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  return (data || []).map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id));
}

async function areFriends(a, b) {
  const { data } = await supabase
    .from('friends')
    .select('id')
    .eq('status', 'accepted')
    .or(
      `and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`
    )
    .maybeSingle();
  return !!data;
}

export async function GET(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  await upsertUser(user);
  const userId = user.id;

  const { searchParams } = new URL(request.url);
  const friendParam = searchParams.get('friend');

  if (friendParam === 'all') {
    const friendIds = await getAcceptedFriendIds(userId);
    if (friendIds.length === 0) {
      return Response.json({ movies: [], isOwn: false });
    }
    const { data, error } = await supabase
      .from('movies')
      .select('*')
      .in('telegram_id', friendIds)
      .order('added_at', { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ movies: data, isOwn: false });
  }

  let targetId = userId;

  if (friendParam) {
    const friendId = parseInt(friendParam, 10);
    if (!friendId || friendId === userId) {
      return Response.json({ error: 'invalid_friend' }, { status: 400 });
    }
    const ok = await areFriends(userId, friendId);
    if (!ok) {
      return Response.json({ error: 'not_friends' }, { status: 403 });
    }
    targetId = friendId;
  }

  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .eq('telegram_id', targetId)
    .order('added_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ movies: data, isOwn: targetId === userId });
}

export async function POST(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  await upsertUser(user);
  const userId = user.id;

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
      genres: item.genres,
      telegram_id: userId,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ movie: data });
}

// Переключение "любимого" — только для своих фильмов
export async function PATCH(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = user.id;

  const body = await request.json();
  const { id, is_favorite } = body || {};

  if (!id || typeof is_favorite !== 'boolean') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('movies')
    .update({ is_favorite })
    .eq('id', id)
    .eq('telegram_id', userId)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ movie: data });
}

export async function DELETE(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = user.id;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id обязателен' }, { status: 400 });
  }

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
