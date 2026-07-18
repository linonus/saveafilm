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

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SmallChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function getInitData() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) {
    return window.Telegram.WebApp.initData;
  }
  return '';
}

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

// Имя + ник в две строки — чтобы карточка друга выглядела одинаково
// аккуратно и с коротким, и с длинным ником
function FriendLabel({ person }) {
  return (
    <div className={styles.friendRowText}>
      <span className={styles.friendRowName}>{displayName(person)}</span>
      {person?.username && <span className={styles.friendRowSub}>@{person.username}</span>}
    </div>
  );
}

function movieKey(m) {
  return `${m.tmdb_id}_${m.media_type}`;
}

// Аватарка — фото из Telegram, если есть, иначе кружок с первой буквой имени
function Avatar({ person, size = 32, className = '' }) {
  const initial = (person?.first_name || person?.username || '?').slice(0, 1).toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.42) };
  if (person?.photo_url) {
    return (
      <img
        src={person.photo_url}
        alt=""
        className={`${styles.avatarImg} ${className}`}
        style={style}
      />
    );
  }
  return (
    <div className={`${styles.avatarFallback} ${className}`} style={style}>
      {initial}
    </div>
  );
}

// Группирует фильмы друзей по tmdb_id+media_type, собирая владельцев
function groupByMovie(rawMovies) {
  const map = new Map();
  rawMovies.forEach((m) => {
    const key = movieKey(m);
    if (!map.has(key)) {
      map.set(key, { ...m, ownerIds: [m.telegram_id] });
    } else {
      map.get(key).ownerIds.push(m.telegram_id);
    }
  });
  return Array.from(map.values());
}

export default function Home() {
  const [appLoading, setAppLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  const [myMovies, setMyMovies] = useState([]);
  const [friendMovies, setFriendMovies] = useState([]);
  const [friendMoviesLoading, setFriendMoviesLoading] = useState(false);

  const [tab, setTab] = useState('favorites'); // 'favorites' | 'search' | 'profile'
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [selected, setSelected] = useState(null); // фильм из коллекции или из поиска
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [removingIds, setRemovingIds] = useState(new Set());
  const debounceRef = useRef(null);

  const [profile, setProfile] = useState(null); // { me, friends, incoming, outgoing }
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [friendUsername, setFriendUsername] = useState('');
  const [friendMsg, setFriendMsg] = useState('');

  const [viewingFriendId, setViewingFriendId] = useState(''); // '' | 'all' | id
  const [filterYear, setFilterYear] = useState('');
  const [filterGenre, setFilterGenre] = useState('');
  const [openPicker, setOpenPicker] = useState(null); // null | 'friend' | 'year' | 'genre'

  useEffect(() => {
    let cancelled = false;

    // Скрипт Telegram иногда отдаёт initData не сразу в момент монтирования —
    // ждём до 2 секунд, проверяя каждые 100мс, прежде чем стучаться в API
    function tryInit(retriesLeft) {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
      if (cancelled) return;

      const initData = getInitData();
      if (initData || retriesLeft <= 0) {
        bootstrap();
        return;
      }
      setTimeout(() => tryInit(retriesLeft - 1), 100);
    }

    async function bootstrap() {
      const res = await loadMyMovies();
      await loadProfile();
      if (!cancelled) setAppLoading(false);
    }

    tryInit(20);
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMyMovies() {
    try {
      const res = await apiFetch('/api/movies');
      if (res.status === 401) {
        setAuthError(true);
        return;
      }
      setAuthError(false);
      const data = await res.json();
      setMyMovies(data.movies || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadFriendMovies(friendId) {
    setFriendMoviesLoading(true);
    try {
      const res = await apiFetch(`/api/movies?friend=${friendId}`);
      if (res.status === 401) {
        setAuthError(true);
        return;
      }
      const data = await res.json();
      setFriendMovies(data.movies || []);
    } catch (err) {
      console.error(err);
    } finally {
      setFriendMoviesLoading(false);
    }
  }

  async function loadProfile() {
    try {
      const res = await apiFetch('/api/friends');
      if (res.status === 401) return;
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error(err);
    }
  }

  function selectFriendView(value) {
    setViewingFriendId(value);
    setFilterYear('');
    setFilterGenre('');
    setSelectMode(false);
    setSelectedIds(new Set());
    if (value) loadFriendMovies(value);
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
        await loadMyMovies();
        setSelected(null);
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
      setMyMovies((prev) => prev.filter((m) => m.id !== id));
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
      setMyMovies((prev) => prev.filter((m) => !ids.includes(m.id)));
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

  const isOwnView = !viewingFriendId;
  const isAllView = viewingFriendId === 'all';

  const ownKeys = useMemo(() => new Set(myMovies.map(movieKey)), [myMovies]);

  const baseMovies = useMemo(() => {
    if (isOwnView) return myMovies;
    if (isAllView) return groupByMovie(friendMovies);
    return friendMovies;
  }, [isOwnView, isAllView, myMovies, friendMovies]);

  const yearOptions = useMemo(() => {
    const years = new Set(baseMovies.map((m) => m.year).filter(Boolean));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [baseMovies]);

  const genreOptions = useMemo(() => {
    const genres = new Set();
    baseMovies.forEach((m) => (m.genres || []).forEach((g) => genres.add(g)));
    return Array.from(genres).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [baseMovies]);

  const filteredMovies = useMemo(() => {
    return baseMovies.filter((m) => {
      if (filterYear && m.year !== filterYear) return false;
      if (filterGenre && !(m.genres || []).includes(filterGenre)) return false;
      return true;
    });
  }, [baseMovies, filterYear, filterGenre]);

  const friendProfileById = useMemo(() => {
    const map = {};
    (profile?.friends || []).forEach((f) => {
      map[f.telegram_id] = f;
    });
    return map;
  }, [profile]);

  const currentFriendLabel = viewingFriendId && !isAllView
    ? displayName(friendProfileById[viewingFriendId])
    : '';

  const friendPillLabel = isAllView ? 'Все друзья' : isOwnView ? 'Я' : currentFriendLabel;

  const pickerConfig = {
    friend: {
      title: 'Чья коллекция',
      current: viewingFriendId,
      onSelect: selectFriendView,
      options: [
        { value: '', label: 'Я' },
        { value: 'all', label: 'Все друзья' },
        ...(profile?.friends || []).map((f) => ({ value: String(f.telegram_id), label: displayName(f) })),
      ],
    },
    year: {
      title: 'Год',
      current: filterYear,
      onSelect: setFilterYear,
      options: [{ value: '', label: 'Все года' }, ...yearOptions.map((y) => ({ value: y, label: y }))],
    },
    genre: {
      title: 'Жанр',
      current: filterGenre,
      onSelect: setFilterGenre,
      options: [{ value: '', label: 'Все жанры' }, ...genreOptions.map((g) => ({ value: g, label: g }))],
    },
  };
  const activePicker = openPicker ? pickerConfig[openPicker] : null;

  if (appLoading) {
    return (
      <div className={styles.splash}>
        <div className={styles.splashLogo}>
          <span className={`marquee ${styles.splashWord} ${styles.splashSave}`}>Save</span>
          <span className={`marquee ${styles.splashWord} ${styles.splashA}`}>A</span>
          <span className={`marquee ${styles.splashWord} ${styles.splashFilm}`}>Film</span>
        </div>
        <div className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={`marquee ${styles.title}`}>SAVE A FILM</h1>
        </div>
        {tab === 'favorites' && isOwnView && myMovies.length > 0 && (
          <div className={styles.headerLeft}>
            <span className={styles.count}>{myMovies.length} в избранном</span>
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
            {filteredMovies.length} {isAllView ? 'у друзей' : `у ${currentFriendLabel}`}
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
              {searchResults.map((item) => {
                const added = ownKeys.has(movieKey(item));
                return (
                  <div
                    className={styles.searchItem}
                    key={`${item.media_type}_${item.tmdb_id}`}
                    onClick={() => setSelected({ ...item, _fromSearch: true })}
                  >
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
                    {added ? (
                      <span className={styles.addedBadge}>Добавлено</span>
                    ) : (
                      <button
                        className={styles.addBtn}
                        disabled={addingId === item.tmdb_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          addMovie(item);
                        }}
                      >
                        {addingId === item.tmdb_id ? '…' : '+ Добавить'}
                      </button>
                    )}
                  </div>
                );
              })}
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
                <button
                  className={`${styles.filterPillBtn} ${viewingFriendId ? styles.filterPillBtnActive : ''}`}
                  onClick={() => setOpenPicker('friend')}
                >
                  {friendPillLabel}
                  <SmallChevronDown />
                </button>
              )}
              {yearOptions.length > 0 && (
                <button
                  className={`${styles.filterPillBtn} ${filterYear ? styles.filterPillBtnActive : ''}`}
                  onClick={() => setOpenPicker('year')}
                >
                  {filterYear || 'Год: все'}
                  <SmallChevronDown />
                </button>
              )}
              {genreOptions.length > 0 && (
                <button
                  className={`${styles.filterPillBtn} ${filterGenre ? styles.filterPillBtnActive : ''}`}
                  onClick={() => setOpenPicker('genre')}
                >
                  {filterGenre || 'Жанр: все'}
                  <SmallChevronDown />
                </button>
              )}
            </div>
          )}

          {!friendMoviesLoading && filteredMovies.length === 0 && (
            <div className={styles.empty}>
              <div className={`marquee ${styles.emptyTitle}`}>
                {baseMovies.length === 0 ? 'Зал пуст' : 'Ничего не найдено'}
              </div>
              <p>
                {baseMovies.length === 0
                  ? isOwnView
                    ? 'Найди фильм во вкладке «Поиск» внизу — и он появится здесь ⭐'
                    : 'Тут пока пусто'
                  : 'Попробуй сбросить фильтры'}
              </p>
            </div>
          )}

          <div className={styles.grid}>
            {filteredMovies.map((m) => {
              const isSelected = selectedIds.has(m.id);
              const isRemoving = removingIds.has(m.id);
              const owners = isAllView ? m.ownerIds || [] : [];
              return (
                <div
                  className={[
                    styles.posterCard,
                    isSelected ? styles.posterCardSelected : '',
                    isRemoving ? styles.posterCardRemoving : '',
                  ].join(' ')}
                  key={isAllView ? movieKey(m) : m.id}
                  onClick={() => onPosterClick(m)}
                >
                  {selectMode && isOwnView && (
                    <div className={styles.selectBadge}>
                      <CheckIcon />
                    </div>
                  )}
                  {owners.length > 0 && (
                    <div className={styles.ownerAvatars}>
                      {owners.slice(0, 3).map((oid) => (
                        <Avatar key={oid} person={friendProfileById[oid]} size={22} className={styles.ownerAvatar} />
                      ))}
                      {owners.length > 3 && (
                        <span className={styles.ownerMore}>+{owners.length - 3}</span>
                      )}
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
            <Avatar person={profile?.me} size={52} />
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
                  <div className={styles.friendRowLeft}>
                    <Avatar person={r} size={32} />
                    <FriendLabel person={r} />
                  </div>
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
                  <div className={styles.friendRowLeft}>
                    <Avatar person={r} size={32} />
                    <FriendLabel person={r} />
                  </div>
                  <button className={styles.declineBtn} onClick={() => removeFriend(r.request_id)}>
                    Отменить
                  </button>
                </div>
              ))}
            </>
          )}

          <button className={styles.friendsToggle} onClick={() => setFriendsOpen((v) => !v)}>
            <span>Друзья {profile?.friends?.length ? `(${profile.friends.length})` : ''}</span>
            <ChevronIcon open={friendsOpen} />
          </button>

          {friendsOpen && (
            <div className={styles.friendsList}>
              {(!profile?.friends || profile.friends.length === 0) && (
                <p className={styles.inviteText}>Пока никого нет — пригласи первого друга выше 👆</p>
              )}
              {profile?.friends?.map((f) => (
                <div className={styles.friendRow} key={f.request_id}>
                  <div className={styles.friendRowLeft}>
                    <Avatar person={f} size={32} />
                    <FriendLabel person={f} />
                  </div>
                  <button className={styles.declineBtn} onClick={() => removeFriend(f.request_id)}>
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          )}
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

      {activePicker && (
        <div className={styles.modalBackdrop} onClick={() => setOpenPicker(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setOpenPicker(null)}>
              ✕
            </button>
            <div className={styles.pickerTitle}>{activePicker.title}</div>
            <div className={styles.pickerList}>
              {activePicker.options.map((opt) => (
                <button
                  key={opt.value || 'none'}
                  className={`${styles.pickerOption} ${opt.value === activePicker.current ? styles.pickerOptionActive : ''}`}
                  onClick={() => {
                    activePicker.onSelect(opt.value);
                    setOpenPicker(null);
                  }}
                >
                  {opt.label}
                  {opt.value === activePicker.current && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
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
              {selected._fromSearch ? (
                ownKeys.has(movieKey(selected)) ? (
                  <div className={styles.addedBadgeWide}>Уже в избранном</div>
                ) : (
                  <button
                    className={styles.addBtnWide}
                    disabled={addingId === selected.tmdb_id}
                    onClick={() => addMovie(selected)}
                  >
                    {addingId === selected.tmdb_id ? 'Добавляю…' : '+ Добавить в избранное'}
                  </button>
                )
              ) : (
                isOwnView && (
                  <button className={styles.deleteBtn} onClick={() => deleteMovie(selected.id)}>
                    Удалить из избранного
                  </button>
                )
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
