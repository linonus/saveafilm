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
  const text = (message.text || '').trim();

  if (text === '/start') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Привет! Напиши название фильма или сериала — найду постер и описание. А коллекцию можно открыть кнопкой ниже 👇',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎬 Открыть коллекцию', web_app: { url: APP_URL } }],
        ],
      },
    });
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
          text: '✅ Сохранить в коллекцию',
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
  const data = callback.data || '';

  if (!data.startsWith('save_')) return;

  const [, mediaType, tmdbIdStr] = data.split('_');
  const tmdbId = parseInt(tmdbIdStr, 10);

  const { data: existing } = await supabase
    .from('movies')
    .select('id')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .maybeSingle();

  if (existing) {
    await tg('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Уже в коллекции ✅',
    });
    return;
  }

  const item = await getDetails(mediaType, tmdbId);

  const { error } = await supabase.from('movies').insert({
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_url: item.poster_url,
    description: item.description,
    year: item.year,
    rating: item.rating,
    google_query: item.google_query,
  });

  if (error) {
    console.error(error);
    await tg('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Не получилось сохранить, попробуй ещё раз',
    });
    return;
  }

  await tg('answerCallbackQuery', {
    callback_query_id: callback.id,
    text: 'Сохранено в коллекцию 🎬',
  });
}

// Telegram иногда шлёт GET для проверки — отвечаем, чтобы не было 405 в логах
export async function GET() {
  return Response.json({ ok: true, info: 'Telegram webhook is alive' });
}
