# Save a Film

Telegram-бот + Mini App для личной коллекции фильмов и сериалов.

## Что нужно сделать (по порядку)

### 1. Залить код в GitHub

Вариант А — через сайт GitHub (проще, без терминала):
1. Зайди в свой репозиторий `linonus/saveafilm`
2. Нажми "uploading an existing file" (или "Add file" → "Upload files")
3. Перетащи ВСЕ файлы и папки из этого проекта (сохраняя структуру папок app/, lib/ и т.д.)
4. Внизу нажми "Commit changes"

Вариант Б — через терминал, если есть git:
```
cd saveafilm
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/linonus/saveafilm.git
git push -u origin main
```

### 2. Выполнить SQL в Supabase

1. Зайди в свой проект на supabase.com
2. Слева в меню открой "SQL Editor"
3. Нажми "New query"
4. Скопируй туда всё содержимое файла `supabase-schema.sql` из этого проекта
5. Нажми "Run"

### 3. Добавить переменные окружения в Vercel

1. Зайди в свой проект на vercel.com → вкладка **Settings** → **Environment Variables**
2. Добавь по одной (Name / Value), для всех окружений (Production, Preview, Development):

| Name | Value |
|---|---|
| `TMDB_API_KEY` | твой ключ с themoviedb.org |
| `SUPABASE_URL` | твой Project URL из Supabase (Settings → General) |
| `SUPABASE_SECRET_KEY` | твой secret key из Supabase (Settings → API Keys) |
| `TELEGRAM_BOT_TOKEN` | токен от @BotFather |
| `NEXT_PUBLIC_APP_URL` | `https://saveafilm.vercel.app` (твой домен на Vercel) |

3. После добавления всех переменных зайди во вкладку **Deployments** → у последнего деплоя нажми "⋮" → **Redeploy** (чтобы новые переменные подхватились)

### 4. Подключить webhook бота

Когда деплой пройдёт успешно, открой в браузере (замени TOKEN на свой токен бота):

```
https://api.telegram.org/botTOKEN/setWebhook?url=https://saveafilm.vercel.app/api/telegram
```

Должен появиться ответ вида `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 5. Настроить кнопку меню в боте

В Telegram у @BotFather:
- `/mybots` → выбери `@saveafilm_bot` → **Bot Settings** → **Menu Button** → **Configure Menu Button**
- URL: `https://saveafilm.vercel.app`
- Текст кнопки: например "Открыть коллекцию"

### 6. Проверка

Напиши своему боту `/start`, затем название любого фильма — должна прийти карточка с постером и кнопками.
