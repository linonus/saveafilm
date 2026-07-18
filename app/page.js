'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import styles from './page.module.css';

const BOT_USERNAME = 'saveafilm_bot';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5l2.94 6.34 6.98.7-5.24 4.77 1.5 6.9L12 17.9l-6.18 3.31 1.5-6.9L2.08 9.54l6.98-.7z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Достаёт initData из Telegram WebApp — это подписанная строка, по которой
// сервер узнаёт, какой именно пользователь Telegram сделал запрос
function getInitData() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) {
    return window.Telegram.WebApp.initData;
  }
  return '';
}

// Обёртка над fetch — добавляет заголовок с подписью Telegram ко всем запросам
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Telegram-Init-Data': getInitData(),
    },
  });
}

function displayName(person) {
  if (!person) return '';
  if (person.first_name) return person.first_name;
  if (person.username) return `@${person.username}`;
  return `id${person.telegram_id}`;
}

export default function Home() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('favorites'); // 'favorites' | 'search' | 'profile'
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [removingIds, setRemovingIds] = useState(new Set());
  const [authError, setAuthError] = useState(false);
  const debounceRef = useRef(null);

  // Друзья и профиль
  const [profile, setProfile] = useState(null); // { me, friends, incoming, outgoing }
  const [profileLoading, setProfileLoading] = useState(false);
  const [friendUsername, setFriendUsername] = useState('');
  const [friendMsg, setFriendMsg] = useState('');

  // Просмотр чужого избранного + фильтры
  const [viewingFriendId, setViewingFriendId] = useState(''); // '' = своё
  const [filterYear, setFilterYear] = useState('');
  const [filterGenre, setFilterGenre] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
    loadMovies('');
    loadProfile();
  }, []);

  async function loadMovies(friendId) {
    setLoading(true);
    try {
      const url = friendId ? `/api/movies?friend=${friendId}` : '/api/movies';
      const res = await apiFetch(url);
      if (res.status === 401) {
        setAuthError(true);
        setMovies([]);
        return;
      }
      setAuthError(false);
      const data = await res.json();
      setMovies(data.movies || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile() {
    setProfileLoading(true);
    try {
      const res = await apiFetch('/api/friends');
      if (res.status === 401) return;
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error(err);
    } finally {
      setProfileLoading(false);
    }
  }

  function selectFriendView(friendId) {
    setViewingFriendId(friendId);
    setFilterYear('');
    setFilterGenre('');
    setSelectMode(false);
    setSelectedIds(new Set());
    loadMovies(friendId);
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
      const res = await apiFetch('/api/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type }),
      });
      if (res.ok) {
        setQuery('');
        setSearchResults([]);
        setViewingFriendId('');
        await loadMovies('');
        setTab('favorites');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingId(null);
    }
  }

  function deleteMovie(id) {
    setSelected(null);
    setRemovingIds((prev) => new Set(prev).add(id));
    setTimeout(async () => {
      try {
        await apiFetch(`/api/movies?id=${id}`, { method: 'DELETE' });
      } catch (err) {
        console.error(err);
      }
      setMovies((prev) => prev.filter((m) => m.id !== id));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 420);
  }

  function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setRemovingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setSelectMode(false);
    setSelectedIds(new Set());
    setTimeout(async () => {
      try {
        await Promise.all(ids.map((id) => apiFetch(`/api/movies?id=${id}`, { method: 'DELETE' })));
      } catch (err) {
        console.error(err);
      }
      setMovies((prev) => prev.filter((m) => !ids.includes(m.id)));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, 420);
  }

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function onPosterClick(m) {
    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(m.id)) next.delete(m.id);
        else next.add(m.id);
        return next;
      });
      return;
    }
    setSelected(m);
  }

  // Друзья: заявки
  async function sendFriendRequest() {
    const username = friendUsername.trim();
    if (!username) return;
    setFriendMsg('');
    try {
      const res = await apiFetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (res.ok) {
        setFriendMsg(`Заявка отправлена: ${displayName(data.target)}`);
        setFriendUsername('');
        await loadProfile();
      } else if (data.error === 'user_not_found') {
        setFriendMsg('Такого пользователя нет — он ещё не открывал приложение или не писал боту');
      } else if (data.error === 'already_exists') {
        setFriendMsg(data.status === 'accepted' ? 'Уже в друзьях' : 'Заявка уже отправлена');
      } else if (data.error === 'self') {
        setFriendMsg('Это твой собственный ник :)');
      } else {
        setFriendMsg('Не получилось отправить заявку');
      }
    } catch (err) {
      console.error(err);
      setFriendMsg('Не получилось отправить заявку');
    }
  }

  async function respondRequest(requestId, action) {
    try {
      await apiFetch('/api/friends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action }),
      });
      await loadProfile();
    } catch (err) {
      console.error(err);
    }
  }

  async function removeFriend(requestId) {
    try {
      await apiFetch(`/api/friends?id=${requestId}`, { method: 'DELETE' });
      if (viewingFriendId) selectFriendView('');
      await loadProfile();
    } catch (err) {
      console.error(err);
    }
  }

  function shareInviteLink() {
    const myId = profile?.me?.telegram_id;
    if (!myId) return;
    const link = `https://t.me/${BOT_USERNAME}?start=addfriend_${myId}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
      'Го сохранять фильмы вместе в Save a Film 🎬'
    )}`;
    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else if (typeof window !== 'undefined') {
      window.open(shareUrl, '_blank');
    }
  }

  // Опции для фильтров считаем из текущего списка фильмов
  const yearOptions = useMemo(() => {
    const years = new Set(movies.map((m) => m.year).filter(Boolean));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [movies]);

  const genreOptions = useMemo(() => {
    const genres = new Set();
    movies.forEach((m) => (m.genres || []).forEach((g) => genres.add(g)));
    return Array.from(genres).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [movies]);

  const filteredMovies = useMemo(() => {
    return movies.filter((m) => {
      if (filterYear && m.year !== filterYear) return false;
      if (filterGenre && !(m.genres || []).includes(filterGenre)) return false;
      return true;
    });
  }, [movies, filterYear, filterGenre]);

  const isOwnView = !viewingFriendId;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={`marquee ${styles.title}`}>SAVE A FILM</h1>
        </div>
        {tab === 'favorites' && isOwnView && movies.length > 0 && (
          <div className={styles.headerLeft}>
            <span className={styles.count}>{movies.length} в избранном</span>
            <button
              className={`${styles.iconBtn} ${selectMode ? styles.iconBtnActive : ''}`}
              onClick={toggleSelectMode}
              aria-label="Удалить фильмы"
            >
              {selectMode ? <CloseIcon /> : <TrashIcon />}
            </button>
          </div>
        )}
        {tab === 'favorites' && !isOwnView && (
          <span className={styles.count}>
            {filteredMovies.length} у {displayName(profile?.friends?.find((f) => String(f.telegram_id) === String(viewingFriendId)))}
          </span>
        )}
      </div>

      {authError && (
        <div className={styles.empty}>
          <div className={`marquee ${styles.emptyTitle}`}>Открой через бота</div>
          <p>
            Это приложение показывает личную коллекцию каждого пользователя, поэтому
            оно должно быть открыто изнутри Telegram — через кнопку в чате с ботом.
          </p>
        </div>
      )}

      {!authError && (
      <>
      {tab === 'search' && (
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            placeholder="Найти фильм или сериал…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoFocus
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

          {!query.trim() && (
            <div className={styles.searchHint}>
              Начни вводить название фильма или сериала
            </div>
          )}
        </div>
      )}

      {tab === 'favorites' && (
        <>
          {(profile?.friends?.length > 0 || yearOptions.length > 0 || genreOptions.length > 0) && (
            <div className={styles.filterBar}>
              {profile?.friends?.length > 0 && (
                <select
                  className={styles.filterSelect}
                  value={viewingFriendId}
                  onChange={(e) => selectFriendView(e.target.value)}
                >
                  <option value="">Я</option>
                  {profile.friends.map((f) => (
                    <option key={f.telegram_id} value={f.telegram_id}>
                      {displayName(f)}
                    </option>
                  ))}
                </select>
              )}
              {yearOptions.length > 0 && (
                <select
                  className={styles.filterSelect}
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                >
                  <option value="">Год: все</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              )}
              {genreOptions.length > 0 && (
                <select
                  className={styles.filterSelect}
                  value={filterGenre}
                  onChange={(e) => setFilterGenre(e.target.value)}
                >
                  <option value="">Жанр: все</option>
                  {genreOptions.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!loading && filteredMovies.length === 0 && (
            <div className={styles.empty}>
              <div className={`marquee ${styles.emptyTitle}`}>
                {movies.length === 0 ? 'Зал пуст' : 'Ничего не найдено'}
              </div>
              <p>
                {movies.length === 0
                  ? isOwnView
                    ? 'Найди фильм во вкладке «Поиск» внизу — и он появится здесь ⭐'
                    : 'У этого друга пока нет фильмов в избранном'
                  : 'Попробуй сбросить фильтры'}
              </p>
            </div>
          )}

          <div className={styles.grid}>
            {filteredMovies.map((m) => {
              const isSelected = selectedIds.has(m.id);
              const isRemoving = removingIds.has(m.id);
              return (
                <div
                  className={[
                    styles.posterCard,
                    isSelected ? styles.posterCardSelected : '',
                    isRemoving ? styles.posterCardRemoving : '',
                  ].join(' ')}
                  key={m.id}
                  onClick={() => onPosterClick(m)}
                >
                  {selectMode && isOwnView && (
                    <div className={styles.selectBadge}>
                      <CheckIcon />
                    </div>
                  )}
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
              );
            })}
          </div>
        </>
      )}

      {tab === 'profile' && (
        <div className={styles.profileWrap}>
          <div className={styles.profileCard}>
            <div className={styles.profileAvatar}>
              {(profile?.me?.first_name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className={styles.profileName}>{displayName(profile?.me)}</div>
              {profile?.me?.username && (
                <div className={styles.profileUsername}>@{profile.me.username}</div>
              )}
            </div>
          </div>

          <div className={styles.inviteCard}>
            <div className={styles.inviteTitle}>Сохраняйте фильмы вместе</div>
            <p className={styles.inviteText}>
              Позови друга — сможете смотреть избранное друг друга и фильтровать по годам и жанрам.
            </p>
            <button className={styles.inviteBtn} onClick={shareInviteLink}>
              Пригласить друга
            </button>
          </div>

          <div className={styles.sectionLabel}>Добавить по нику</div>
          <div className={styles.addFriendRow}>
            <input
              className={styles.searchInput}
              placeholder="username без @"
              value={friendUsername}
              onChange={(e) => setFriendUsername(e.target.value)}
            />
            <button className={styles.addBtn} onClick={sendFriendRequest}>
              Отправить
            </button>
          </div>
          {friendMsg && <div className={styles.friendMsg}>{friendMsg}</div>}

          {profile?.incoming?.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Заявки в друзья</div>
              {profile.incoming.map((r) => (
                <div className={styles.friendRow} key={r.request_id}>
                  <span className={styles.friendRowName}>{displayName(r)}</span>
                  <div className={styles.friendRowActions}>
                    <button
                      className={styles.acceptBtn}
                      onClick={() => respondRequest(r.request_id, 'accept')}
                    >
                      Принять
                    </button>
                    <button
                      className={styles.declineBtn}
                      onClick={() => respondRequest(r.request_id, 'decline')}
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {profile?.outgoing?.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Ожидают подтверждения</div>
              {profile.outgoing.map((r) => (
                <div className={styles.friendRow} key={r.request_id}>
                  <span className={styles.friendRowName}>{displayName(r)}</span>
                  <button className={styles.declineBtn} onClick={() => removeFriend(r.request_id)}>
                    Отменить
                  </button>
                </div>
              ))}
            </>
          )}

          <div className={styles.sectionLabel}>
            Друзья {profile?.friends?.length ? `(${profile.friends.length})` : ''}
          </div>
          {!profileLoading && (!profile?.friends || profile.friends.length === 0) && (
            <p className={styles.inviteText}>Пока никого нет — пригласи первого друга выше 👆</p>
          )}
          {profile?.friends?.map((f) => (
            <div className={styles.friendRow} key={f.request_id}>
              <span className={styles.friendRowName}>{displayName(f)}</span>
              <button className={styles.declineBtn} onClick={() => removeFriend(f.request_id)}>
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}

      </>
      )}

      {selectMode && (
        <div className={styles.selectBar}>
          <span className={styles.selectBarCount}>Выбрано: {selectedIds.size}</span>
          <button
            className={styles.selectBarDelete}
            disabled={selectedIds.size === 0}
            onClick={deleteSelected}
          >
            Удалить
          </button>
        </div>
      )}

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
                  {selected.year || ''}
                  {selected.rating ? (
                    <>
                      {' · '}
                      <img className={styles.ratingIcon} src="/img/star.png" alt="" />
                      {Number(selected.rating).toFixed(1)}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className={styles.descCard}>
              <div className={styles.descLabel}>Описание</div>
              <p className={styles.modalDesc}>{selected.description || 'Описание отсутствует.'}</p>
            </div>
            <div className={styles.modalActions}>
              <a
                className={styles.googleBtn}
                href={`https://www.google.com/search?q=${encodeURIComponent(selected.google_query)}`}
                target="_blank"
                rel="noreferrer"
              >
                🔎 Искать в Google
              </a>
              {isOwnView && (
                <button className={styles.deleteBtn} onClick={() => deleteMovie(selected.id)}>
                  Удалить из избранного
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className={styles.bottomNav}>
        <button
          className={`${styles.navBtn} ${tab === 'search' ? styles.navBtnActive : ''}`}
          onClick={() => setTab('search')}
        >
          <SearchIcon />
          Поиск
        </button>
        <button
          className={`${styles.navBtn} ${tab === 'favorites' ? styles.navBtnActive : ''}`}
          onClick={() => setTab('favorites')}
        >
          <StarIcon />
          Избранное
        </button>
        <button
          className={`${styles.navBtn} ${tab === 'profile' ? styles.navBtnActive : ''}`}
          onClick={() => setTab('profile')}
        >
          <PersonIcon />
          Профиль
        </button>
      </nav>
    </div>
  );
}
