import { searchMulti, getDetails, formatResult } from '../../../lib/tmdb';
import { supabase } from '../../../lib/supabase';
import { guessTitleFromDescription, guessTitleFromImage } from '../../../lib/gemini';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
export const dynamic = 'force-dynamic';

const STOP_WORDS = ['стоп', 'нет', 'хватит', 'всё', 'все', 'спасибо', 'достаточно', 'выход', 'стой'];

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

// "Жду ответа" — чтобы помнить между сообщениями, что именно бот спросил
async function getPendingAction(userId) {
  const { data } = await supabase
    .from('users')
    .select('pending_action')
    .eq('telegram_id', userId)
    .maybeSingle();
  return data?.pending_action || null;
}

async function setPendingAction(userId, action) {
  await supabase.from('users').update({ pending_action: action }).eq('telegram_id', userId);
}

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '')
    .trim();
}

function isStopWord(text) {
  return STOP_WORDS.includes(normalize(text));
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

  return Response.json({ ok: true });
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const text = (message.text || message.caption || '').trim();

  await upsertUser(message.from);

  // Пришло фото — обрабатываем, только если это явно запрошено
  // (подпись /search_img или бот только что попросил прислать кадр)
  if (message.photo && message.photo.length > 0) {
    const isSearchImgCaption = /^\/search_img\b/i.test(text);
    const pending = await getPendingAction(userId);
    if (isSearchImgCaption || pending === 'search_image') {
      await setPendingAction(userId, 'search_image');
      await handleImageSearch(chatId, userId, message.photo);
    }
    return;
  }

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
      text:
        'Привет! Вот что я умею:\n\n' +
        '🎬 Просто напиши название — покажу карточку с кнопкой сохранить\n' +
        '➕ /ad — спрошу, что добавить, и сохраню сразу\n' +
        '🔎 /search — опиши сюжет, если не помнишь название\n' +
        '🖼 /search_img — пришли кадр из фильма, попробую узнать\n\n' +
        'А открыть коллекцию можно кнопкой ниже 👇',
      reply_markup: {
        inline_keyboard: [[{ text: '🎬 Открыть избранное', web_app: { url: APP_URL } }]],
      },
    });
    return;
  }

  // Голая команда /ad — спрашиваем название следующим сообщением
  if (/^\/ad$/i.test(text)) {
    await setPendingAction(userId, 'add_movie');
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Какой фильм или сериал хочешь добавить? Просто напиши название следующим сообщением 🎬',
    });
    return;
  }

  // /ad <название> одним сообщением
  if (/^\/ad\s/i.test(text)) {
    await setPendingAction(userId, 'add_movie');
    const query = text.replace(/^\/ad/i, '').trim();
    await handleAddCommand(chatId, query, userId);
    return;
  }

  // Голая команда /search_img — просим прислать фото следующим сообщением
  if (/^\/search_img$/i.test(text)) {
    await setPendingAction(userId, 'search_image');
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Пришли фото или кадр из фильма/сериала — постараюсь узнать, что это 🖼',
    });
    return;
  }

  // Команда /search — просим описать сюжет следующим сообщением
  if (/^\/search$/i.test(text)) {
    await setPendingAction(userId, 'search_describe');
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Опиши, что помнишь: сюжет, актёров, отдельные детали, эпоху — попробую угадать название 🔎',
    });
    return;
  }

  if (!text || text.startsWith('/')) return;

  const pending = await getPendingAction(userId);

  if (pending === 'add_movie') {
    await handleAddCommand(chatId, text, userId);
    return;
  }

  if (pending === 'search_describe') {
    if (isStopWord(text)) {
      await setPendingAction(userId, null);
      await tg('sendMessage', { chat_id: chatId, text: 'Хорошо! Если что — просто вызови /search снова 👋' });
      return;
    }
    await handleDescribeSearch(chatId, userId, text);
    return;
  }

  if (pending === 'search_image') {
    if (isStopWord(text)) {
      await setPendingAction(userId, null);
      await tg('sendMessage', { chat_id: chatId, text: 'Хорошо! Если что — просто вызови /search_img снова 👋' });
      return;
    }
    await tg('sendMessage', { chat_id: chatId, text: 'Жду именно фото/кадр 📸 Или напиши «стоп», чтобы закончить.' });
    return;
  }

  // Обычное сообщение без контекста — ищем и показываем карточку с кнопкой
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

// Обработка /ad: если название совпадает точно — добавляем сразу и
// присылаем картинку с подтверждением. Если TMDB вообще ничего не нашёл —
// просим ввести название ещё раз (pending остаётся активным). Если совпадение
// неточное — предлагаем ближайший вариант с кнопкой подтверждения.
async function handleAddCommand(chatId, query, userId) {
  if (!query) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Напиши название фильма или сериала, который хочешь добавить 🎬',
    });
    return; // pending остаётся 'add_movie'
  }

  let results;
  try {
    results = await searchMulti(query);
  } catch (err) {
    console.error(err);
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не получилось найти. Попробуй ещё раз чуть позже.',
    });
    return; // pending остаётся — разрешаем повторить
  }

  if (!results || results.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Не нашёл «${query}» 🤔 Попробуй написать название точнее — например, добавь год выхода.`,
    });
    return; // pending остаётся активным, ждём следующую попытку
  }

  const top = formatResult(results[0]);
  const exact = normalize(top.title) === normalize(query);

  if (exact) {
    const outcome = await saveToCollection(top.media_type, top.tmdb_id, userId);

    if (outcome.error) {
      await tg('sendMessage', { chat_id: chatId, text: 'Не получилось сохранить, попробуй ещё раз.' });
      return; // pending остаётся — можно повторить попытку
    }

    await setPendingAction(userId, null);

    if (outcome.alreadyExists) {
      await tg('sendMessage', { chat_id: chatId, text: `«${top.title}» уже в избранном ✅` });
      return;
    }

    const caption = `✅ Добавлено в избранное: ${top.title}${top.year ? ` (${top.year})` : ''}`;
    if (top.poster_url) {
      await tg('sendPhoto', { chat_id: chatId, photo: top.poster_url, caption });
    } else {
      await tg('sendMessage', { chat_id: chatId, text: caption });
    }
    return;
  }

  // Неточное совпадение — предлагаем вариант с кнопкой; решение теперь через неё
  await setPendingAction(userId, null);
  const kindWord = top.media_type === 'tv' ? 'сериал' : 'фильм';
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Точного совпадения не нашёл. Может, вы имели в виду — «${top.title}»${top.year ? ` (${top.year})` : ''}, ${kindWord}?`,
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Добавить', callback_data: `save_${top.media_type}_${top.tmdb_id}` }]],
    },
  });
}

// /search: угадываем название по описанию сюжета через Gemini. Если вариант
// один — показываем карточку. Если несколько — спрашиваем, какой из них.
// После ответа предлагаем продолжить поиск следующим описанием.
async function handleDescribeSearch(chatId, userId, description) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

  let titles;
  try {
    titles = await guessTitleFromDescription(description);
  } catch (err) {
    console.error(err);
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не получилось обратиться к ИИ-поиску. Попробуй ещё раз чуть позже.',
    });
    return; // pending остаётся 'search_describe'
  }

  if (!titles || titles.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не смог угадать по описанию 🤔 Попробуй добавить деталей — эпоху, актёров, сюжетные повороты.',
    });
    return; // pending остаётся, ждём новую попытку
  }

  const candidates = [];
  for (const title of titles.slice(0, 3)) {
    let results;
    try {
      results = await searchMulti(title);
    } catch (err) {
      continue;
    }
    if (results && results.length > 0) {
      candidates.push(formatResult(results[0]));
    }
  }

  if (candidates.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Угадал названия, но не нашёл карточки в базе TMDB. Попробуй описать иначе.',
    });
    return; // pending остаётся
  }

  if (candidates.length === 1) {
    await sendMovieCard(chatId, candidates[0]);
  } else {
    const buttons = candidates.map((c) => [
      {
        text: `${c.title}${c.year ? ` (${c.year})` : ''}`,
        callback_data: `pick_${c.media_type}_${c.tmdb_id}`,
      },
    ]);
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Похоже, это может быть один из этих вариантов — какой?',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Хочешь поискать что-то ещё? Опиши следующий фильм, или напиши «стоп», чтобы закончить.',
  });
  // pending остаётся 'search_describe' — можно продолжать искать дальше
}

// /search_img: скачиваем фото из Telegram, отправляем в Gemini, ищем найденное
// название в TMDB и показываем карточку с кнопкой сохранить. После ответа
// предлагаем прислать ещё один кадр.
async function handleImageSearch(chatId, userId, photoSizes) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

  const largest = photoSizes[photoSizes.length - 1];
  const fileInfo = await tg('getFile', { file_id: largest.file_id });
  const filePath = fileInfo?.result?.file_path;

  if (!filePath) {
    await tg('sendMessage', { chat_id: chatId, text: 'Не получилось загрузить фото. Попробуй ещё раз.' });
    return;
  }

  let base64Image;
  try {
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const fileRes = await fetch(fileUrl);
    const buffer = await fileRes.arrayBuffer();
    base64Image = Buffer.from(buffer).toString('base64');
  } catch (err) {
    console.error(err);
    await tg('sendMessage', { chat_id: chatId, text: 'Не получилось загрузить фото. Попробуй ещё раз.' });
    return;
  }

  let titles;
  try {
    titles = await guessTitleFromImage(base64Image, 'image/jpeg');
  } catch (err) {
    console.error(err);
    await tg('sendMessage', { chat_id: chatId, text: 'Не получилось распознать кадр. Попробуй другое фото.' });
    return;
  }

  if (!titles || titles.length === 0) {
    await tg('sendMessage', { chat_id: chatId, text: 'Не смог узнать, что это за фильм 🤔 Пришли другой кадр.' });
    return;
  }

  const title = titles[0];
  let results;
  try {
    results = await searchMulti(title);
  } catch (err) {
    results = [];
  }

  if (!results || results.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Похоже, это «${title}», но не нашёл карточку в базе TMDB.`,
    });
  } else {
    const item = formatResult(results[0]);
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Похоже, это: «${item.title}»${item.year ? ` (${item.year})` : ''}`,
    });
    await sendMovieCard(chatId, item);
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Хочешь узнать что-то ещё? Пришли следующее фото, или напиши «стоп», чтобы закончить.',
  });
  // pending остаётся 'search_image' — можно продолжать присылать кадры
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

  // Пользователь выбрал один из нескольких вариантов в /search — показываем
  // его карточку с кнопкой сохранить
  if (data.startsWith('pick_')) {
    const [, mediaType, tmdbIdStr] = data.split('_');
    const tmdbId = parseInt(tmdbIdStr, 10);
    await tg('answerCallbackQuery', { callback_query_id: callback.id });

    let item;
    try {
      item = await getDetails(mediaType, tmdbId);
    } catch (err) {
      console.error(err);
      await tg('sendMessage', { chat_id: chatId, text: 'Не получилось загрузить карточку, попробуй ещё раз.' });
      return;
    }
    await sendMovieCard(chatId, item);
    return;
  }

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

// Общая логика сохранения фильма/сериала в базу
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
