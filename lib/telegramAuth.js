import crypto from 'crypto';

// Проверяет initData, которую присылает Telegram Mini App, и достаёт из неё
// подлинного пользователя. Возвращает null, если подпись не совпадает —
// значит запрос не от настоящего Telegram-клиента.
export function verifyTelegramInitData(initData) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN || '')
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) return null;

  const userStr = params.get('user');
  if (!userStr) return null;

  try {
    return JSON.parse(userStr); // { id, first_name, username, ... }
  } catch {
    return null;
  }
}

// Достаёт id пользователя из заголовка запроса. Возвращает null, если
// заголовка нет или подпись невалидна.
export function getTelegramUserId(request) {
  const initData = request.headers.get('x-telegram-init-data');
  const user = verifyTelegramInitData(initData);
  return user ? user.id : null;
}

// Достаёт полный объект пользователя { id, username, first_name, ... }.
// Нужен там, где требуется ник — например, чтобы искать друзей.
export function getTelegramUser(request) {
  const initData = request.headers.get('x-telegram-init-data');
  return verifyTelegramInitData(initData);
}
