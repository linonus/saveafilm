const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Ищет и фильмы, и сериалы по текстовому запросу
export async function searchMulti(query) {
  const url = `${BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = await res.json();
  return (data.results || []).filter(
    (r) => r.media_type === 'movie' || r.media_type === 'tv'
  );
}

// Получает полную карточку по id + типу (movie/tv)
export async function getDetails(mediaType, id) {
  const url = `${BASE_URL}/${mediaType}/${id}?api_key=${TMDB_API_KEY}&language=ru-RU`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB details failed: ${res.status}`);
  const item = await res.json();
  return formatResult({ ...item, media_type: mediaType });
}

// Приводит сырой ответ TMDB к единому формату, который мы храним в базе
export function formatResult(item) {
  const title = item.title || item.name || 'Без названия';
  const date = item.release_date || item.first_air_date || '';
  const year = date ? date.slice(0, 4) : '';
  const poster = item.poster_path ? `${IMAGE_BASE}${item.poster_path}` : null;
  const kindWord = item.media_type === 'tv' ? 'сериал' : 'фильм';

  return {
    tmdb_id: item.id,
    media_type: item.media_type,
    title,
    year,
    rating: typeof item.vote_average === 'number' ? item.vote_average : null,
    description: item.overview || '',
    poster_url: poster,
    google_query: `${title} ${kindWord}${year ? ` ${year}` : ''}`.trim(),
  };
}
