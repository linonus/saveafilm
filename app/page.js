'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import styles from './page.module.css';

export default function Home() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
    loadMovies();
  }, []);

  async function loadMovies() {
    setLoading(true);
    try {
      const res = await fetch('/api/movies');
      const data = await res.json();
      setMovies(data.movies || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const onQueryChange = useCallback((value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (err) {
        console.error(err);
      }
    }, 400);
  }, []);

  async function addMovie(item) {
    setAddingId(item.tmdb_id);
    try {
      const res = await fetch('/api/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type }),
      });
      if (res.ok) {
        setQuery('');
        setSearchResults([]);
        await loadMovies();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingId(null);
    }
  }

  async function deleteMovie(id) {
    try {
      await fetch(`/api/movies?id=${id}`, { method: 'DELETE' });
      setSelected(null);
      await loadMovies();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={`marquee ${styles.title}`}>SAVE A FILM</h1>
        <span className={styles.count}>{movies.length} в коллекции</span>
      </div>

      <div className={styles.searchWrap}>
        <input
          className={styles.searchInput}
          placeholder="Найти фильм или сериал…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {searchResults.length > 0 && (
          <div className={styles.searchResults}>
            {searchResults.map((item) => (
              <div className={styles.searchItem} key={`${item.media_type}_${item.tmdb_id}`}>
                {item.poster_url ? (
                  <img className={styles.searchPoster} src={item.poster_url} alt="" />
                ) : (
                  <div className={styles.searchPoster} />
                )}
                <div className={styles.searchInfo}>
                  <div className={styles.searchInfoTitle}>{item.title}</div>
                  <div className={styles.searchInfoMeta}>
                    {item.media_type === 'tv' ? 'Сериал' : 'Фильм'}
                    {item.year ? ` · ${item.year}` : ''}
                  </div>
                </div>
                <button
                  className={styles.addBtn}
                  disabled={addingId === item.tmdb_id}
                  onClick={() => addMovie(item)}
                >
                  {addingId === item.tmdb_id ? '…' : '+ Добавить'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && movies.length === 0 && (
        <div className={styles.empty}>
          <div className={`marquee ${styles.emptyTitle}`}>Зал пуст</div>
          <p>Напиши боту название фильма или найди его тут через поиск ↑</p>
        </div>
      )}

      <div className={styles.grid}>
        {movies.map((m) => (
          <div className={styles.posterCard} key={m.id} onClick={() => setSelected(m)}>
            {m.poster_url ? (
              <img className={styles.posterImg} src={m.poster_url} alt={m.title} />
            ) : (
              <div className={styles.posterFallback}>{m.title}</div>
            )}
            <div className={styles.posterOverlay}>
              <div className={styles.posterTitle}>{m.title}</div>
              {m.year && <div className={styles.posterYear}>{m.year}</div>}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className={styles.modalBackdrop} onClick={() => setSelected(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setSelected(null)}>
              ✕
            </button>
            <div className={styles.modalTop}>
              {selected.poster_url ? (
                <img className={styles.modalPoster} src={selected.poster_url} alt="" />
              ) : (
                <div className={styles.modalPoster} />
              )}
              <div>
                <h2 className={styles.modalTitle}>{selected.title}</h2>
                <div className={styles.modalMeta}>
                  {selected.year || ''} {selected.rating ? `· ⭐ ${Number(selected.rating).toFixed(1)}` : ''}
                </div>
              </div>
            </div>
            <p className={styles.modalDesc}>{selected.description || 'Описание отсутствует.'}</p>
            <div className={styles.modalActions}>
              <a
                className={styles.googleBtn}
                href={`https://www.google.com/search?q=${encodeURIComponent(selected.google_query)}`}
                target="_blank"
                rel="noreferrer"
              >
                🔎 Искать в Google
              </a>
              <button className={styles.deleteBtn} onClick={() => deleteMovie(selected.id)}>
                Удалить из коллекции
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
