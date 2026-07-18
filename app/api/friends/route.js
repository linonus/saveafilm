import { supabase } from '../../../lib/supabase';
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

// Список друзей + входящие/исходящие заявки текущего пользователя
export async function GET(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  await upsertUser(user);
  const userId = user.id;

  const { data: rows, error } = await supabase
    .from('friends')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const otherIds = new Set();
  (rows || []).forEach((r) => {
    otherIds.add(r.requester_id === userId ? r.addressee_id : r.requester_id);
  });

  let profileById = {};
  if (otherIds.size > 0) {
    const { data: profiles } = await supabase
      .from('users')
      .select('telegram_id, username, first_name, photo_url')
      .in('telegram_id', Array.from(otherIds));
    (profiles || []).forEach((p) => {
      profileById[p.telegram_id] = p;
    });
  }

  const friends = [];
  const incoming = [];
  const outgoing = [];

  (rows || []).forEach((r) => {
    const otherId = r.requester_id === userId ? r.addressee_id : r.requester_id;
    const profile = profileById[otherId] || { telegram_id: otherId };
    if (r.status === 'accepted') {
      friends.push({ request_id: r.id, ...profile });
    } else if (r.status === 'pending' && r.addressee_id === userId) {
      incoming.push({ request_id: r.id, ...profile });
    } else if (r.status === 'pending' && r.requester_id === userId) {
      outgoing.push({ request_id: r.id, ...profile });
    }
  });

  return Response.json({
    me: {
      telegram_id: userId,
      username: user.username || null,
      first_name: user.first_name || null,
      photo_url: user.photo_url || null,
    },
    friends,
    incoming,
    outgoing,
  });
}

// Отправить заявку в друзья по нику (без @)
export async function POST(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  await upsertUser(user);

  const body = await request.json();
  const usernameRaw = (body?.username || '').trim().replace(/^@/, '');

  if (!usernameRaw) {
    return Response.json({ error: 'username_required' }, { status: 400 });
  }

  const { data: target } = await supabase
    .from('users')
    .select('telegram_id, username, first_name, photo_url')
    .ilike('username', usernameRaw)
    .maybeSingle();

  if (!target) {
    return Response.json({ error: 'user_not_found' }, { status: 404 });
  }

  if (target.telegram_id === user.id) {
    return Response.json({ error: 'self' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('friends')
    .select('id, status')
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${target.telegram_id}),and(requester_id.eq.${target.telegram_id},addressee_id.eq.${user.id})`
    )
    .maybeSingle();

  if (existing) {
    return Response.json({ error: 'already_exists', status: existing.status }, { status: 409 });
  }

  const { error } = await supabase.from('friends').insert({
    requester_id: user.id,
    addressee_id: target.telegram_id,
    status: 'pending',
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, target });
}

// Принять или отклонить входящую заявку
export async function PATCH(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { request_id, action } = body || {};

  if (!request_id || !['accept', 'decline'].includes(action)) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const { data: row } = await supabase
    .from('friends')
    .select('id, addressee_id, status')
    .eq('id', request_id)
    .maybeSingle();

  if (!row || row.addressee_id !== user.id || row.status !== 'pending') {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  if (action === 'decline') {
    await supabase.from('friends').delete().eq('id', request_id);
    return Response.json({ ok: true });
  }

  const { error } = await supabase
    .from('friends')
    .update({ status: 'accepted' })
    .eq('id', request_id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}

// Удалить друга или отменить свою исходящую заявку
export async function DELETE(request) {
  const user = getTelegramUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id_required' }, { status: 400 });
  }

  const { data: row } = await supabase
    .from('friends')
    .select('id, requester_id, addressee_id')
    .eq('id', id)
    .maybeSingle();

  if (!row || (row.requester_id !== user.id && row.addressee_id !== user.id)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  await supabase.from('friends').delete().eq('id', id);
  return Response.json({ ok: true });
}
