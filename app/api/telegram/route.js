import { searchMulti, getDetails, formatResult } from '../../../lib/tmdb';
import { supabase } from '../../../lib/supabase';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
export const dynamic = 'force-dynamic';

async function tg(method, payload) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Сохраняем/обновляем базовые данные о пользователе — нужно, чтобы искать
// друзей по нику даже если человек ни разу не открывал Mini App
async function upsertUser(from) {
  if (!from?.id) return;
  await supabase.from('users').upsert({
    telegram_id: from.id,
    username: from.username || null,
    first_name: from.first_name || null,
    updated_at: new Date().toISOString(),
  });
}

export async function POST(request) {
  let update;
  try {
    update = await request.json();
  } catch {
    return Response.json({ ok: true });
  }

  try {
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }

  // Telegram ждёт быстрый 200 OK вне зависимости от результата обработки
  return Response.json({ ok: true });
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const text = (message.text || '').trim();

  await upsertUser(message.from);

  if (text === '/start' || text.startsWith('/start ')) {
    const payload = text.slice('/start'.length).trim();

    if (payload.startsWith('addfriend_')) {
      const inviterId = parseInt(payload.slice('addfriend_'.length), 10);
      if (inviterId && inviterId !== userId) {
        await handleFriendInvite(chatId, userId, inviterId);
      }
    }

    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Привет! Напиши название фильма или сериала — найду постер и описание. Либо сразу команду /ad Название — добавлю в избранное. А открыть коллекцию можно кнопкой ниже 👇',
      reply_markup: {

        inline_keyboard: [
          [{ text: '🎬 Открыть избранное', web_app: { url: APP_URL } }],
        ],
      },
    });
    return;
  }

  // Команда /ad <название> — добавляет фильм напрямую, без подтверждения
  if (/^\/ad(\s|$)/i.test(text)) {
    const query = text.replace(/^\/ad/i, '').trim();

    if (!query) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Напиши название после команды, например:\n/ad Матрица',
      });
      return;
    }

    await handleAddCommand(chatId, query, userId);
    return;
  }

  if (!text || text.startsWith('/')) return;

  let results;
  try {
    results = await searchMulti(text);
  } catch (err) {
    console.error(err);
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Что-то пошло не так при поиске. Попробуй ещё раз чуть позже.',
    });
    return;
  }

  if (!results || results.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Ничего не нашёл по запросу «${text}» 🤔`,
    });
    return;
  }

  const item = formatResult(results[0]);
  await sendMovieCard(chatId, item);
}

// Обработка /ad: если название совпадает точно — добавляем сразу,
// если нет — предлагаем ближайший вариант с кнопкой подтверждения
async function handleAddCommand(chatId, query, userId) {
  let results;
  try {
    results = await searchMulti(query);
  } catch (err) {
    console.error(err);
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не получилось найти. Попробуй ещё раз чуть позже.',
    });
    return;
  }

  if (!results || results.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Ничего не нашёл по запросу «${query}» 🤔 Проверь название и попробуй ещё раз.`,
    });
    return;
  }

  const top = formatResult(results[0]);
  const exact = normalize(top.title) === normalize(query);

  if (exact) {
    const outcome = await saveToCollection(top.media_type, top.tmdb_id, userId);

    if (outcome.alreadyExists) {
      await tg('sendMessage', { chat_id: chatId, text: `«${top.title}» уже в избранном ✅` });
    } else if (outcome.error) {
      await tg('sendMessage', { chat_id: chatId, text: 'Не получилось сохранить, попробуй ещё раз.' });
    } else {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `✅ Добавлено в избранное: ${top.title}${top.year ? ` (${top.year})` : ''}`,
      });
    }
    return;
  }

  const kindWord = top.media_type === 'tv' ? 'сериал' : 'фильм';
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Точного совпадения не нашёл. Может, вы имели в виду — «${top.title}»${top.year ? ` (${top.year})` : ''}, ${kindWord}?`,
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Добавить', callback_data: `save_${top.media_type}_${top.tmdb_id}` }]],
    },
  });
}

// Приводит строку к простому виду для сравнения ("Матрица!" -> "матрица")
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '')
    .trim();
}

// Кто-то перешёл по инвайт-ссылке ?start=addfriend_<id> — создаём заявку
// от того, кто поделился ссылкой, к тому, кто её открыл
async function handleFriendInvite(chatId, userId, inviterId) {
  const { data: existing } = await supabase
    .from('friends')
    .select('id, status')
    .or(
      `and(requester_id.eq.${inviterId},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${inviterId})`
    )
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') {
      await tg('sendMessage', { chat_id: chatId, text: 'Вы уже друзья в Save a Film 🎬' });
    }
    return;
  }

  const { error } = await supabase.from('friends').insert({
    requester_id: inviterId,
    addressee_id: userId,
    status: 'pending',
  });

  if (error) {
    console.error(error);
    return;
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Вас пригласили в друзья в Save a Film! Открой приложение → вкладка «Профиль», чтобы принять заявку и увидеть общие фильмы.',
    reply_markup: {
      inline_keyboard: [[{ text: '🎬 Открыть приложение', web_app: { url: APP_URL } }]],
    },
  });
}

async function sendMovieCard(chatId, item) {
  const ratingText = item.rating ? item.rating.toFixed(1) : '—';
  const description = item.description
    ? item.description.slice(0, 600)
    : 'Описание отсутствует.';

  const caption = `🎬 *${escapeMd(item.title)}*${item.year ? ` (${item.year})` : ''}\n⭐ ${ratingText}\n\n${escapeMd(description)}`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🔎 Искать в Google',
          url: `https://www.google.com/search?q=${encodeURIComponent(item.google_query)}`,
        },
      ],
      [
        {
          text: '✅ Сохранить в избранное',
          callback_data: `save_${item.media_type}_${item.tmdb_id}`,
        },
      ],
    ],
  };

  if (item.poster_url) {
    await tg('sendPhoto', {
      chat_id: chatId,
      photo: item.poster_url,
      caption,
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    });
  } else {
    await tg('sendMessage', {
      chat_id: chatId,
      text: caption,
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    });
  }
}

// Telegram MarkdownV2 требует экранировать спецсимволы
function escapeMd(str) {
  return String(str).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

async function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const userId = callback.from?.id ?? chatId;
  const data = callback.data || '';

  if (!data.startsWith('save_')) return;

  const [, mediaType, tmdbIdStr] = data.split('_');
  const tmdbId = parseInt(tmdbIdStr, 10);

  const outcome = await saveToCollection(mediaType, tmdbId, userId);

  if (outcome.alreadyExists) {
    await tg('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Уже в избранном ✅',
    });
    return;
  }

  if (outcome.error) {
    await tg('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Не получилось сохранить, попробуй ещё раз',
    });
    return;
  }

  await tg('answerCallbackQuery', {
    callback_query_id: callback.id,
    text: 'Сохранено в избранное 🎬',
  });
}

// Общая логика сохранения фильма/сериала в базу — используется и из /ad, и из кнопки
async function saveToCollection(mediaType, tmdbId, telegramId) {
  const { data: existing } = await supabase
    .from('movies')
    .select('id')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (existing) return { alreadyExists: true };

  let item;
  try {
    item = await getDetails(mediaType, tmdbId);
  } catch (err) {
    console.error(err);
    return { error: true };
  }

  const { error } = await supabase.from('movies').insert({
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_url: item.poster_url,
    description: item.description,
    year: item.year,
    rating: item.rating,
    google_query: item.google_query,
    genres: item.genres,
    telegram_id: telegramId,
  });

  if (error) {
    console.error(error);
    return { error: true };
  }

  return { ok: true, item };
}

// Telegram иногда шлёт GET для проверки — отвечаем, чтобы не было 405 в логах
export async function GET() {
  return Response.json({ ok: true, info: 'Telegram webhook is alive' });
}
