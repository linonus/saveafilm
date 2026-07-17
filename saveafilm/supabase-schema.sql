create table if not exists movies (
  id bigint generated always as identity primary key,
  tmdb_id integer not null,
  media_type text not null check (media_type in ('movie','tv')),
  title text not null,
  poster_url text,
  description text,
  year text,
  rating numeric,
  google_query text,
  added_at timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

-- Включаем защиту строк. Доступ к таблице идёт только через
-- secret key на сервере (в API роутах Vercel), поэтому публичных
-- политик не создаём — это блокирует любой прямой доступ из браузера.
alter table movies enable row level security;
