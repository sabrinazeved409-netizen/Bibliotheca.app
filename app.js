
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const DB_NAME = 'bibliotheca-db-v1';

let db;
let books = [];
let notes = [];
let sessions = [];
let gardenBookIds = [];
let currentBook = null;
let currentFileUrl = null;
let timer = null;
let sessionStarted = null;
let activeFilter = 'all';
let selectedGenre = null;
let enabledExtraGenres = [];
let showAddGenreOptions = false;
let currentPdfPage = 1;
let currentTextChunkIndex = 0;
let epubBook = null;
let epubRendition = null;
let currentPdfDocument = null;
let readerFlow = localStorage.getItem('bibliotheca-reader-flow') || 'paginated';
let readerAxis = localStorage.getItem('bibliotheca-reader-axis') || 'horizontal';
let readerFontSize = Number(localStorage.getItem('bibliotheca-reader-font') || 100);
let readerLineSpacing = Number(localStorage.getItem('bibliotheca-reader-line') || 1.8);
let readerParagraphSpacing = Number(localStorage.getItem('bibliotheca-reader-paragraph') || 1.2);
let readerBrightness = Number(localStorage.getItem('bibliotheca-reader-brightness') || 100);
let showQuickBrightness = localStorage.getItem('bibliotheca-show-quick-brightness') !== 'false';
let readerScreenLocked = false;
let lockIconTimer = null;
let readerFontFamily = localStorage.getItem('bibliotheca-reader-font-family') || 'Georgia, serif';
let readerFontWeight = Number(localStorage.getItem('bibliotheca-reader-font-weight') || 400);
let awaitlessReadGoal = 30;

const colors = [
  '#71624e', '#6d4c52', '#465b52', '#485c73',
  '#765c48', '#66506f', '#496d70'
];


function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function toast(message) {
  const element = $('#toast');
  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2600);
}

function fmt(minutes) {
  minutes = Math.round(minutes);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateMinutes(key) {
  return sessions
    .filter(session => session.date === key)
    .reduce((total, session) => total + session.minutes, 0);
}

function dayLabels() {
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
}

/* BANCO DE DADOS */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains('files')) {
        database.createObjectStore('files', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('data')) {
        database.createObjectStore('data', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getStore(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function readData(key, fallback) {
  return new Promise(resolve => {
    const request = getStore('data').get(key);

    request.onsuccess = () => {
      resolve(request.result?.value ?? fallback);
    };

    request.onerror = () => resolve(fallback);
  });
}

function saveData(key, value) {
  return new Promise((resolve, reject) => {
    const request = getStore('data', 'readwrite')
      .put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function saveFile(book, file) {
  return new Promise((resolve, reject) => {
    const request = getStore('files', 'readwrite')
      .put({ id: book.id, file });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getFile(bookId) {
  return new Promise(resolve => {
    const request = getStore('files').get(bookId);

    request.onsuccess = () => {
      resolve(request.result?.file || null);
    };

    request.onerror = () => resolve(null);
  });
}

/* ESTATÍSTICAS */

function renderStats() {
  const today = todayKey();
  const todayMin = dateMinutes(today);
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const key = todayKey(date);

    days.push({
      key,
      label: dayLabels()[date.getDay()],
      min: dateMinutes(key)
    });
  }

  const week = days.reduce((total, day) => total + day.min, 0);

  ['#todayTime', '#statsToday'].forEach(selector => {
    const element = $(selector);
    if (element) element.textContent = fmt(todayMin);
  });

  ['#weekTime', '#statsWeek'].forEach(selector => {
    const element = $(selector);
    if (element) element.textContent = fmt(week);
  });

  const chart = $('#weekChart');

  if (chart) {
    const max = Math.max(30, ...days.map(day => day.min));

    chart.innerHTML = days.map(day => `
      <div class="chart-day">
        <div class="chart-bar-wrap">
          <div class="chart-bar"
               style="height:${Math.max(3, day.min / max * 100)}%"
               title="${fmt(day.min)}"></div>
        </div>
        <small>${day.label}</small>
      </div>
    `).join('');
  }

  const goal = Number(awaitlessReadGoal) || 30;
  const goalInput = $('#goalInput');
  const goalProgress = $('#goalProgress');
  const goalLabel = $('#goalLabel');
  const bookCount = $('#bookCount');
  const finishedCount = $('#finishedCount');

  if (goalInput) goalInput.value = goal;

  if (goalProgress) {
    goalProgress.style.width =
      `${Math.min(100, todayMin / goal * 100)}%`;
  }

  if (goalLabel) {
    goalLabel.textContent = `${Math.round(todayMin)} de ${goal} minutos hoje`;
  }

  if (bookCount) bookCount.textContent = books.length;

  if (finishedCount) {
    finishedCount.textContent =
      books.filter(book => book.status === 'finished').length;
  }
}

/* CAPAS E CARTÕES */

function coverColor(book) {
  return colors[
    (book.title.length + (book.author || '').length) % colors.length
  ];
}

const GENRE_CONFIG = [
  { name: 'Romance', icon: '🌹', desc: 'Jardins secretos, cartas de amor e histórias que florescem.', style: 'romance', core: true },
  { name: 'Fantasia', icon: '✨', desc: 'Reinos encantados, magia antiga e mundos impossíveis.', style: 'fantasia', core: true },
  { name: 'Terror', icon: '🕯️', desc: 'Sombras, casas assombradas e arrepios na noite.', style: 'terror', core: true },
  { name: 'Ficção científica', icon: '🚀', desc: 'Galáxias distantes, tecnologia e futuros extraordinários.', style: 'ficcao', core: true },
  { name: 'Mistério e suspense', icon: '🔎', desc: 'Passagens ocultas, pistas e segredos por desvendar.', style: 'misterio' },
  { name: 'Clássicos', icon: '🏛️', desc: 'Salões históricos e obras que atravessam gerações.', style: 'classicos' },
  { name: 'Drama', icon: '🎭', desc: 'Sentimentos intensos, escolhas difíceis e vidas cruzadas.', style: 'drama' },
  { name: 'Aventura', icon: '🧭', desc: 'Mapas, jornadas e descobertas além do horizonte.', style: 'aventura' },
  { name: 'Poesia', icon: '🪶', desc: 'Palavras, imagens e emoções em versos.', style: 'poesia' },
  { name: 'Não ficção', icon: '📚', desc: 'Conhecimento, biografias e histórias reais.', style: 'nao-ficcao' },
  { name: 'Infantil e juvenil', icon: '🦊', desc: 'Descobertas, imaginação e grandes primeiras leituras.', style: 'juvenil' },
  { name: 'Não classificado', icon: '📖', desc: 'Livros que ainda estão esperando seu lugar.', style: 'outros' },
  { name: 'Outros', icon: '🗂️', desc: 'Um espaço para todos os outros estilos.', style: 'outros' }
];
const GENRES = GENRE_CONFIG.map(item => item.name);
const MAIN_GENRES = GENRE_CONFIG.filter(item => item.core).map(item => item.name);

function card(book) {
  const progress = book.progress || 0;
  const genre = book.genre || 'Não classificado';
  const options = GENRES.map(item =>
    '<option value="' + esc(item) + '"' + (item === genre ? ' selected' : '') + '>' + esc(item) + '</option>'
  ).join('');

  return `
    <article class="book-card" data-open="${esc(book.id)}">
      <div class="book-cover"
           style="background:linear-gradient(145deg,${coverColor(book)},#29231f)">
        <span class="cover-type">${esc((book.ext || 'LIVRO').toUpperCase())}</span>
        <span class="cover-title">${esc(book.title)}</span>
        <span class="cover-author">${esc(book.author || 'Autor desconhecido')}</span>
      </div>
      <div class="book-meta">
        <strong>${esc(book.title)}</strong>
        <small>${esc(book.author || 'Arquivo importado')}</small>
        <div class="mini-progress"><span style="width:${progress}%"></span></div>
        <label class="genre-picker-label">Gênero literário
          <select class="genre-picker" data-genre-book="${esc(book.id)}">${options}</select>
        </label>
      </div>
    </article>
  `;
}

/* A organização por gênero agora acontece dentro da biblioteca. */

/* BIBLIOTECA */

function genreCoverArt(style) {
  const art = {
    romance: '<path d="M80 111 C49 87 59 63 78 68 C89 71 91 82 91 82 C98 62 121 65 123 83 C125 100 103 114 80 129Z" fill="#a91f35" stroke="#e9a0a1" stroke-width="2"/><path d="M89 83 C86 68 78 57 67 52 M96 92 C111 91 120 98 127 109 M84 112 C71 112 64 121 61 131" fill="none" stroke="#68814a" stroke-width="4" stroke-linecap="round"/><path d="M70 54 Q82 47 91 60 M112 108 Q126 106 132 118" fill="none" stroke="#9b6b35" stroke-width="1.5"/>',
    fantasia: '<path d="M99 48 L108 82 L139 91 L108 100 L99 134 L90 100 L59 91 L90 82Z" fill="#d9c58d" stroke="#f5e8bd" stroke-width="2"/><path d="M126 53 L130 65 L142 69 L130 73 L126 85 L122 73 L110 69 L122 65Z" fill="#a9b8d8"/><circle cx="70" cy="119" r="5" fill="#d9c58d"/><path d="M58 132 Q99 111 140 132" fill="none" stroke="#7d91a9" stroke-width="2"/>',
    terror: '<path d="M100 56 C76 56 61 74 64 98 L68 119 L80 132 L120 132 L132 119 L136 98 C139 74 124 56 100 56Z" fill="#8d1f28" stroke="#e06a60" stroke-width="2.5"/><path d="M72 82 L88 76 L92 94 L78 99Z M108 76 L126 82 L120 99 L106 94Z" fill="#180f13" stroke="#d78a7a" stroke-width="1.5"/><path d="M87 110 L113 110 L119 125 L81 125Z" fill="#1b1014" stroke="#d78a7a" stroke-width="1.5"/><path d="M94 112 V122 M100 111 V124 M106 112 V122" stroke="#e4c1a0" stroke-width="2"/><path d="M54 65 L63 76 M137 65 L128 76 M57 119 L69 115 M143 119 L131 115" stroke="#a42b35" stroke-width="3"/>',
    ficcao: '<circle cx="100" cy="92" r="25" fill="#263b53" stroke="#c1d8e2" stroke-width="2"/><ellipse cx="100" cy="92" rx="43" ry="14" fill="none" stroke="#d4b77d" stroke-width="3" transform="rotate(-25 100 92)"/><path d="M91 77 L111 92 L91 107Z" fill="#e3e5d2"/><circle cx="129" cy="73" r="4" fill="#e2c987"/><circle cx="67" cy="112" r="3" fill="#e2c987"/><path d="M100 50 V59 M100 125 V135" stroke="#9ebdcb" stroke-width="2"/>',
    misterio: '<path d="M100 58 C81 58 67 75 67 94 C67 116 83 130 100 130 C117 130 133 116 133 94 C133 75 119 58 100 58Z" fill="#282a31" stroke="#c7a86d" stroke-width="2"/><circle cx="100" cy="91" r="17" fill="none" stroke="#d9c18d" stroke-width="3"/><path d="M112 104 L131 123" stroke="#d9c18d" stroke-width="6" stroke-linecap="round"/><circle cx="100" cy="91" r="6" fill="#8b2930"/><path d="M56 69 L68 81 M132 113 L145 125" stroke="#8b2930" stroke-width="2"/>',
    classicos: '<path d="M68 126 V72 L84 61 L100 72 L116 61 L132 72 V126Z" fill="#a8895d" stroke="#e2cda2" stroke-width="2"/><path d="M78 126 V83 M91 126 V83 M109 126 V83 M122 126 V83" stroke="#4b3b2b" stroke-width="4"/><path d="M62 79 H138 M62 126 H138" stroke="#e2cda2" stroke-width="4"/><path d="M100 49 L105 59 L117 61 L108 69 L110 81 L100 75 L90 81 L92 69 L83 61 L95 59Z" fill="#d8bf87"/>',
    drama: '<path d="M66 66 Q83 58 99 70 Q115 58 134 66 L128 112 Q111 125 100 114 Q89 125 72 112Z" fill="#702b35" stroke="#d7a37e" stroke-width="2"/><path d="M79 80 Q88 74 95 82 L91 94 Q84 97 79 90Z M106 82 Q113 74 122 80 L122 90 Q115 97 108 94Z" fill="#e2c7a0"/><path d="M82 103 Q100 94 118 103 Q110 117 100 116 Q90 117 82 103Z" fill="#25191c" stroke="#d7a37e" stroke-width="2"/>',
    aventura: '<path d="M61 120 L83 75 L97 97 L113 62 L140 120Z" fill="#5e6b4c" stroke="#c6b07c" stroke-width="2"/><path d="M83 75 L88 93 L78 91Z M113 62 L120 91 L107 84Z" fill="#d6c69c"/><path d="M74 124 L127 124 L120 135 L81 135Z" fill="#9a6e3e"/><path d="M100 78 L106 94 L100 107 L94 94Z" fill="#c9a76b"/>',
    poesia: '<path d="M77 127 C76 95 91 66 124 54 C124 87 111 117 77 127Z" fill="#627957" stroke="#c8d0a1" stroke-width="2"/><path d="M78 126 Q98 94 119 64" fill="none" stroke="#e1d4a7" stroke-width="2"/><path d="M85 108 L72 97 M96 91 L85 78 M105 79 L105 66" stroke="#c8d0a1" stroke-width="2"/><path d="M69 132 Q101 139 132 126" fill="none" stroke="#b18a74" stroke-width="2"/>',
    'nao-ficcao': '<path d="M64 68 Q82 61 100 74 Q118 61 136 68 V122 Q117 115 100 130 Q83 115 64 122Z" fill="#6e6248" stroke="#e0cba0" stroke-width="2"/><path d="M100 74 V129 M74 83 Q86 80 92 86 M74 96 Q85 93 92 99 M108 86 Q119 80 127 83 M108 99 Q119 93 127 96" fill="none" stroke="#e8d9b8" stroke-width="2"/><circle cx="100" cy="55" r="8" fill="#c5a35e" stroke="#f0dbac" stroke-width="2"/>',
    juvenil: '<path d="M100 51 L111 76 L139 80 L119 99 L124 128 L100 114 L76 128 L81 99 L61 80 L89 76Z" fill="#8a9a68" stroke="#e4d3a2" stroke-width="2"/><circle cx="100" cy="91" r="12" fill="#e5d7a8"/><path d="M95 88 L99 92 L107 83" fill="none" stroke="#5b704e" stroke-width="3" stroke-linecap="round"/>',
    outros: '<path d="M100 55 L111 80 L138 91 L111 102 L100 129 L89 102 L62 91 L89 80Z" fill="#70616f" stroke="#d4bd98" stroke-width="2"/><circle cx="100" cy="91" r="14" fill="#28222c" stroke="#d4bd98" stroke-width="2"/><path d="M92 91 H108 M100 83 V99" stroke="#d4bd98" stroke-width="2"/>'
  };
  const motif = art[style] || art.outros;
  return '<svg class="genre-cover-art" viewBox="0 0 200 170" role="img" aria-label="Ilustração ornamental da estante" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="cover-'+style+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#48332c"/><stop offset=".52" stop-color="#171b1a"/><stop offset="1" stop-color="#382128"/></linearGradient><radialGradient id="shine-'+style+'"><stop stop-color="#92734a" stop-opacity=".35"/><stop offset="1" stop-color="#171b1a" stop-opacity="0"/></radialGradient></defs><rect x="5" y="5" width="190" height="160" rx="8" fill="url(#cover-'+style+')" stroke="#a98a5d" stroke-width="2"/><rect x="11" y="11" width="178" height="148" rx="5" fill="none" stroke="#6e563b" stroke-width="1"/><rect x="16" y="16" width="168" height="138" rx="4" fill="url(#shine-'+style+')"/><path d="M20 38 V20 H38 M162 20 H180 V38 M20 132 V150 H38 M162 150 H180 V132" fill="none" stroke="#c5a36a" stroke-width="2"/><circle cx="100" cy="91" r="49" fill="#151716" fill-opacity=".65" stroke="#b99a66" stroke-width="2"/><circle cx="100" cy="91" r="43" fill="none" stroke="#6f583c" stroke-width="1.5" stroke-dasharray="2 4"/><path d="M100 36 l4 7 -4 7 -4 -7Z M100 132 l4 7 -4 7 -4 -7Z M45 91 l7 -4 7 4 -7 4Z M141 91 l7 -4 7 4 -7 4Z" fill="#d0b27a"/>'+motif+'<path d="M30 30 l5 5 -5 5 -5 -5Z M170 30 l5 5 -5 5 -5 -5Z M30 140 l5 5 -5 5 -5 -5Z M170 140 l5 5 -5 5 -5 -5Z" fill="#a88a5b"/></svg>';
}

function genreSigilSvg(style) {
  if (style === 'terror') return '<svg viewBox="0 0 100 100" aria-label="Pentagrama vermelho" role="img"><circle cx="50" cy="50" r="39" fill="none" stroke="#a51f2d" stroke-width="2" opacity=".85"/><path d="M50 11 L59 39 L89 39 L65 57 L74 86 L50 68 L26 86 L35 57 L11 39 L41 39 Z" fill="none" stroke="#c32635" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="50" r="3" fill="#d54a4f"/></svg>';
  if (style === 'romance') return '<svg viewBox="0 0 100 100" aria-label="Rosa vermelha" role="img"><path d="M50 84 C25 69 28 48 44 48 C51 48 54 55 54 55 C61 38 80 44 78 58 C77 72 60 81 50 84Z" fill="#b82138" stroke="#e3a1a2" stroke-width="2"/><path d="M51 82 L50 95 M50 91 L37 83 M50 91 L63 81" fill="none" stroke="#718354" stroke-width="3" stroke-linecap="round"/></svg>';
  const sigils = {
    fantasia: '<path d="M50 12 L59 40 L88 50 L59 60 L50 88 L41 60 L12 50 L41 40Z" fill="none" stroke="#c6ad78" stroke-width="3"/>',
    misterio: '<circle cx="43" cy="42" r="22" fill="none" stroke="#c6ad78" stroke-width="5"/><path d="M59 59 L81 81 M43 31 V53 M32 42 H54" stroke="#c6ad78" stroke-width="4" stroke-linecap="round"/>',
    ficcao: '<ellipse cx="50" cy="50" rx="37" ry="14" fill="none" stroke="#9cbfd0" stroke-width="3" transform="rotate(-25 50 50)"/><circle cx="50" cy="50" r="14" fill="none" stroke="#c6ad78" stroke-width="3"/>',
    classicos: '<path d="M20 78 V35 L35 24 L50 35 L65 24 L80 35 V78Z M28 78 V45 M42 78 V45 M58 78 V45 M72 78 V45 M16 80 H84" fill="none" stroke="#c6ad78" stroke-width="3"/>',
    drama: '<path d="M18 25 Q35 18 49 29 Q65 18 82 25 L77 68 Q61 82 50 70 Q38 82 23 68Z" fill="none" stroke="#b97875" stroke-width="3"/><path d="M30 43 Q39 34 46 45 L42 54Z M55 45 Q63 34 72 43 L60 54Z" fill="none" stroke="#c6ad78" stroke-width="2"/>',
    aventura: '<path d="M12 77 L40 28 L54 52 L66 20 L90 77Z M48 48 L54 62 L48 70 L42 62Z" fill="none" stroke="#c6ad78" stroke-width="3"/>',
    poesia: '<path d="M25 82 Q25 35 77 17 Q76 66 25 82Z M27 80 Q52 47 70 26" fill="none" stroke="#9eaf85" stroke-width="3"/>',
    'nao-ficcao': '<path d="M15 30 Q32 22 50 36 Q68 22 85 30 V78 Q66 70 50 84 Q34 70 15 78Z M50 36 V84" fill="none" stroke="#c6ad78" stroke-width="3"/>',
    juvenil: '<path d="M50 13 L61 38 L88 41 L68 59 L73 86 L50 72 L27 86 L32 59 L12 41 L39 38Z" fill="none" stroke="#b8c38c" stroke-width="3"/>',
    outros: '<path d="M50 13 L61 39 L88 50 L61 61 L50 87 L39 61 L12 50 L39 39Z" fill="none" stroke="#c6ad78" stroke-width="3"/>'
  };
  return '<svg viewBox="0 0 100 100" role="img" aria-label="Símbolo da estante">'+(sigils[style] || sigils.outros)+'</svg>';
}

function renderGenreRooms() {
  const container = $('#genreRooms');
  if (!container) return;
  const enabledGenres = new Set([
    ...MAIN_GENRES,
    ...enabledExtraGenres,
    ...books.map(book => book.genre || 'Não classificado').filter(name => name !== 'Não classificado' && !MAIN_GENRES.includes(name))
  ]);
  const rooms = GENRE_CONFIG.filter(genre => enabledGenres.has(genre.name));
  const addable = GENRE_CONFIG.filter(genre => !enabledGenres.has(genre.name));
  container.innerHTML = rooms.map(genre => {
    const count = books.filter(book => (book.genre || 'Não classificado') === genre.name).length;
    return `<button type="button" class="genre-room room-${esc(genre.style)}" data-open-genre="${esc(genre.name)}">
      ${genreCoverArt(genre.style)}
      <span class="room-name">${esc(genre.name)}</span>
      <span class="room-desc">${esc(genre.desc)}</span>
      <span class="room-count">${count} livro(s) <span aria-hidden="true">→</span></span>
    </button>`;
  }).join('') + (addable.length ? `
    <section class="add-genre-area">
      <button type="button" class="add-genre-toggle" aria-expanded="${showAddGenreOptions}">
        <span>＋</span> Adicionar estante <small>${addable.length} opções</small>
      </button>
      ${showAddGenreOptions ? `<div class="add-genre-options"><p>Escolha quais salas quer adicionar.</p><div class="add-genre-list">${addable.map(genre => `<button type="button" class="add-genre-btn" data-add-genre="${esc(genre.name)}"><span>${genre.icon} ${esc(genre.name)}</span><strong>＋ Adicionar</strong></button>`).join('')}</div></div>` : ''}
    </section>` : '');
  container.querySelector('.add-genre-toggle')?.addEventListener('click', () => {
    showAddGenreOptions = !showAddGenreOptions;
    renderGenreRooms();
  });
  container.querySelectorAll('[data-open-genre]').forEach(button => {
    button.addEventListener('click', () => {
      selectedGenre = button.dataset.openGenre;
      renderBooks();
      $('#searchInput')?.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
  container.querySelectorAll('[data-add-genre]').forEach(button => {
    button.addEventListener('click', async () => {
      const genre = button.dataset.addGenre;
      if (!enabledExtraGenres.includes(genre)) enabledExtraGenres.push(genre);
      await saveData('enabledExtraGenres', enabledExtraGenres);
      showAddGenreOptions = false;
      selectedGenre = genre;
      renderBooks();
      toast('Sala adicionada à sua biblioteca.');
      $('#searchInput')?.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
}

function bindBookCards(container) {
  if (!container) return;
  container.querySelectorAll('.book-card[data-open], .continue-card[data-open]').forEach(cardElement => {
    cardElement.addEventListener('click', event => {
      if (event.target.closest('.genre-picker-label, .genre-picker')) return;
      openBook(cardElement.dataset.open);
    });
  });
}

function bindGenrePickers(container) {
  if (!container) return;
  container.querySelectorAll('[data-genre-book]').forEach(select => {
    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', async event => {
      event.stopPropagation();
      const book = books.find(item => item.id === select.dataset.genreBook);
      if (!book) return;
      book.genre = select.value;
      await saveData('books', books);
      renderBooks();
      toast('Livro movido para ' + book.genre + '.');
    });
  });
}

function renderContinueCard(book) {
  const genreName = book.genre || 'Não classificado';
  const genre = GENRE_CONFIG.find(item => item.name === genreName) || GENRE_CONFIG.find(item => item.name === 'Outros');
  const style = genre?.style || 'outros';
  return `
    <article class="continue-card" data-open="${esc(book.id)}">
      <div class="continue-cover" style="background:linear-gradient(155deg,${coverColor(book)},#211c19)">
        <span>${esc((book.ext || 'LIVRO').toUpperCase())}</span>
        <strong>${esc(book.title)}</strong>
        <small>${esc(book.author || 'Autor desconhecido')}</small>
      </div>
      <div class="continue-details">
        <span class="continue-eyebrow">CONTINUAR LENDO</span>
        <strong class="continue-title">${esc(book.title)}</strong>
        <small class="continue-author">${esc(book.author || 'Autor desconhecido')}</small>
        <div class="continue-progress"><span style="width:${Math.max(0, Math.min(100, Number(book.progress) || 0))}%"></span></div>
        <div class="continue-world room-${esc(style)}">
          <span class="continue-world-art" aria-hidden="true">${genre?.icon || '📚'}</span>
          <span class="continue-world-label">SUA ESTANTE</span>
          <strong>${esc(genreName)}</strong>
        </div>
      </div>
    </article>
  `;
}

async function loadScriptOnce(src, readyCheck) {
  if (readyCheck()) return;
  await new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(script => script.src === src);
    if (existing) {
      if (existing.dataset.loaded === 'true' || readyCheck()) { resolve(); return; }
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Não foi possível carregar o leitor do arquivo.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor do arquivo.'));
    document.head.appendChild(script);
  });
}

function chooseReadableExcerpt(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 80) return '';
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const usable = sentences.map(s => s.trim()).filter(s => s.length >= 45 && s.length <= 320);
  if (usable.length) return usable[Math.floor(Math.random() * Math.min(usable.length, 12))];
  return text.slice(0, 220).trim() + (text.length > 220 ? '…' : '');
}

async function extractBookExcerpt(book) {
  const file = await getFile(book.id);
  if (!file) return '';
  try {
    if (String(book.ext).toLowerCase() === 'txt') return chooseReadableExcerpt(await file.text());

    if (String(book.ext).toLowerCase() === 'pdf') {
      await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => !!window.pdfjsLib);
      const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [];
      for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 3); pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str || '').join(' '));
      }
      return chooseReadableExcerpt(pages.join(' '));
    }

    if (String(book.ext).toLowerCase() === 'epub') {
      // Sempre carregar JSZip antes do epub.js, inclusive ao extrair a frase da página inicial.
      // Carregar epub.js sozinho aqui pode inicializá-lo sem JSZip e impedir a abertura do livro.
      await ensureEpubLibrary();
      const epub = window.ePub(await file.arrayBuffer());
      try {
        const spine = await epub.loaded.spine;
        for (const item of (spine.items || []).slice(0, 4)) {
          try {
            const doc = await item.load(epub.load.bind(epub));
            const excerpt = chooseReadableExcerpt(doc?.body?.innerText || doc?.body?.textContent || doc?.documentElement?.textContent || '');
            item.unload?.();
            if (excerpt) return excerpt;
          } catch (_) {}
        }
      } finally {
        epub.destroy?.();
      }
    }
  } catch (error) {
    console.warn('Não foi possível extrair um trecho de ' + book.title, error);
  }
  return '';
}

let lastReadingBookId = null;

async function renderReadingQuote() {
  const quote = $('#readingQuote');
  const source = $('#quoteSource');
  if (!quote || !source) return;

  // Só usar arquivos adicionados à biblioteca e marcados como "Lendo".
  const readingBooks = books.filter(book =>
    book.status === 'reading' && ['txt', 'pdf', 'epub'].includes(String(book.ext || '').toLowerCase())
  );

  if (!readingBooks.length) {
    quote.textContent = 'Quando você começar a ler um livro da sua estante, uma passagem dele aparecerá aqui.';
    source.textContent = 'Trechos dos seus livros em andamento';
    return;
  }

  const shuffled = [...readingBooks].sort(() => Math.random() - 0.5);
  if (shuffled.length > 1 && shuffled[0].id === lastReadingBookId) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }

  for (const book of shuffled) {
    const excerpt = await extractBookExcerpt(book);
    if (!excerpt) continue;

    lastReadingBookId = book.id;
    quote.textContent = '“' + excerpt + '”';
    source.textContent = '— ' + (book.title || 'Seu livro') +
      (book.author ? ', ' + book.author : '') + ' · do seu arquivo';
    source.removeAttribute('href');
    source.removeAttribute('target');
    source.removeAttribute('rel');
    return;
  }

  quote.textContent = 'Não consegui ler o texto dos seus livros em andamento.';
  source.textContent = 'Confira se o arquivo EPUB, PDF ou TXT está disponível na biblioteca';
}
function renderBooks() {
  const romancePill = document.getElementById('romanceActionPill');
  if (romancePill) romancePill.style.display = selectedGenre === 'Romance' ? 'flex' : 'none';
  const romanceAdd = document.getElementById('romanceAddBtn');
  if (romanceAdd) romanceAdd.onclick = () => document.getElementById('fileInput')?.click();
  const romanceCount = document.getElementById('romanceCountBtn');
  if (romanceCount) {
    const romanceTotal = books.filter(book => (book.genre || 'Não classificado') === 'Romance').length;
    romanceCount.textContent = romanceTotal + (romanceTotal === 1 ? ' livro ›' : ' livros ›');
    romanceCount.onclick = () => { const input = document.getElementById('searchInput'); if (input) { input.value = ''; activeFilter = 'all'; renderBooks(); } };
  }

  document.body.classList.toggle('romance-room-open', selectedGenre === 'Romance');
  const search = $('#searchInput');
  const query = search ? search.value.toLowerCase() : '';
  const rooms = $('#genreRooms');
  const intro = $('#genreIntro');
  const roomPanel = $('#selectedGenrePanel');
  const roomTitle = $('#selectedGenreTitle');
  const roomDescription = $('#selectedGenreDescription');
  const backButton = $('#backToRooms');
  const shelf = $('#shelfList');
  const emptyLibrary = $('#emptyLibrary');

  if (rooms) rooms.style.display = selectedGenre ? 'none' : 'grid';
  if (intro) intro.style.display = selectedGenre ? 'none' : 'block';
  if (roomPanel) roomPanel.style.display = selectedGenre ? 'block' : 'none';
  if (backButton) backButton.onclick = () => { selectedGenre = null; renderBooks(); };
  if (selectedGenre) {
    const config = GENRE_CONFIG.find(item => item.name === selectedGenre);
    if (roomTitle) roomTitle.textContent = selectedGenre;
    if (roomDescription) roomDescription.textContent = config ? config.desc : 'Sua coleção neste gênero.';
    if (roomPanel) {
      const style = config?.style || 'outros';
      roomPanel.className = 'selected-genre-panel room-' + style + ' world-entering';
      let atmosphere = roomPanel.querySelector('.room-atmosphere');
      if (!atmosphere) {
        atmosphere = document.createElement('div');
        atmosphere.className = 'room-atmosphere';
        roomPanel.prepend(atmosphere);
      }
      const scenes = {
        romance: ['JARDIM DAS PROMESSAS', 'rosas antigas • cartas seladas • luar'],
        fantasia: ['FLORESTA ENCANTADA', 'runas esquecidas • estrelas • magia'],
        misterio: ['ARQUIVO DAS SOMBRAS', 'segredos • névoa • portas proibidas'],
        ficcao: ['FRONTEIRA ESTELAR', 'mundos distantes • sinais • infinito'],
        terror: ['MANSÃO ESQUECIDA', 'sussurros • espinhos • meia-noite'],
        classicos: ['SALÃO ATEMPORAL', 'veludo antigo • ouro gasto • memórias'],
        drama: ['TEATRO DAS ALMAS', 'destinos cruzados • paixão • perda'],
        aventura: ['TERRAS INDOMADAS', 'mapas secretos • ruínas • jornada'],
        poesia: ['JARDIM DOS VERSOS', 'flores noturnas • tinta • silêncio'],
        'nao-ficcao': ['CÂMARA DO CONHECIMENTO', 'ideias • descobertas • verdades'],
        juvenil: ['REINO DOS POSSÍVEIS', 'maravilhas • coragem • descoberta'],
        outros: ['MUNDOS INCLASSIFICÁVEIS', 'histórias à espera de um nome']
      };
      const scene = scenes[style] || scenes.outros;
      atmosphere.innerHTML = '<div class="world-sky-symbol" aria-hidden="true">' + genreSigilSvg(style) + '</div><div class="world-scene-copy"><span class="world-kicker">VOCÊ ATRAVESSOU A ESTANTE</span><strong>' + scene[0] + '</strong><small>' + scene[1] + '</small></div>' + (style === 'romance' ? '<blockquote class="romance-quote">Porque não há nada mais perigoso do que um coração apaixonado.</blockquote>' : '') + '<span class="world-scene-glint" aria-hidden="true">✧</span>';
      atmosphere.setAttribute('aria-label', scene[1]);
      requestAnimationFrame(() => roomPanel.classList.remove('world-entering'));
    }
  }

  const filtered = books.filter(book =>
    (activeFilter === 'all' || book.status === activeFilter) &&
    `${book.title} ${book.author || ''}`.toLowerCase().includes(query) &&
    (!selectedGenre || (book.genre || 'Não classificado') === selectedGenre)
  );

  if (shelf) {
    if (!selectedGenre) {
      shelf.innerHTML = '';
      shelf.style.display = 'none';
    } else if (!filtered.length) {
      shelf.innerHTML = '<div class="room-empty"><span>📚</span><h3>Esta sala está esperando seus livros</h3><p>Adicione um livro ou escolha o gênero ao editar um cartão da sua biblioteca.</p></div>';
      shelf.style.display = 'block';
    } else {
      shelf.innerHTML = `<div class="book-grid">${filtered.map(card).join('')}</div>`;
      shelf.style.display = 'block';
    }
    if (emptyLibrary) emptyLibrary.style.display = books.length || selectedGenre ? 'none' : 'block';
    bindBookCards(shelf);
    bindGenrePickers(shelf);
  }

  renderGenreRooms();
  const continueList = $('#continueList');
  if (continueList) {
    const reading = books.filter(book => book.status === 'reading').slice(0, 2);
    continueList.innerHTML = reading.map(renderContinueCard).join('') || '<p class="muted">Seus livros em andamento aparecerão aqui.</p>';
    bindBookCards(continueList);
  }
}

/* ANOTAÇÕES */

function renderNotes() {
  const list = $('#notesList');
  const empty = $('#emptyNotes');

  if (!list) return;

  const all = notes.slice().sort((a, b) => b.created - a.created);

  list.innerHTML = all.map(note => `
    <article class="note-card">
      <span class="note-type">
        ${note.kind === 'quote' ? 'Citação' :
          note.kind === 'marker' ? 'Marcador' : 'Adendo'}
        · ${esc(note.bookTitle || 'Livro')}
      </span>

      <p>${esc(note.text || 'Página marcada')}</p>

      <small>
        ${new Date(note.created).toLocaleDateString('pt-BR')}
        ${note.page ? ` · Página ${note.page}` : ''}
      </small>
    </article>
  `).join('');

  if (empty) {
    empty.style.display = all.length ? 'none' : 'block';
  }
}

/* NAVEGAÇÃO */

function go(screen) {
  const target = $('#' + screen);

  if (!target) {
    toast('Esta tela não foi encontrada.');
    return;
  }

  $$('.screen').forEach(element => {
    element.classList.remove('active');
  });

  target.classList.add('active');
  if (screen === 'reader') document.body.classList.add('reading-mode');
  else document.body.classList.remove('reading-mode');

  $$('.nav-item').forEach(button => {
    button.classList.toggle('active', button.dataset.go === screen);
  });

  if (screen === 'stats') renderStats();
  if (screen === 'notes') renderNotes();

  if (screen === 'library' || screen === 'home') {
    renderBooks();
  }
}

$$('[data-go]').forEach(button => {
  button.addEventListener('click', () => go(button.dataset.go));
});

$$('.filter-chip').forEach(button => {
  button.addEventListener('click', () => {
    $$('.filter-chip').forEach(item => {
      item.classList.remove('selected');
    });

    button.classList.add('selected');
    activeFilter = button.dataset.filter;
    renderBooks();
  });
});

const searchInput = $('#searchInput');

if (searchInput) {
  searchInput.addEventListener('input', renderBooks);
}

/* IMPORTAR LIVROS */

const fileInput = $('#fileInput');

if (fileInput) {
  fileInput.addEventListener('change', async event => {
    const files = [...event.target.files];

    if (!files.length) return;

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();

      if (!['pdf', 'epub', 'mobi', 'txt'].includes(ext)) {
        toast('Formato não reconhecido: ' + file.name);
        continue;
      }

      if (ext === 'mobi') {
        toast('MOBI ainda não é compatível. Converta para EPUB.');
        continue;
      }

      const book = {
        id: makeId(),
        title: file.name.replace(/\.[^.]+$/, ''),
        author: '',
        ext,
        genre: 'Não classificado',
        status: 'want',
        progress: 0,
        added: Date.now(),
        lastOpened: 0
      };

      books.unshift(book);
      await saveFile(book, file);
    }

    await saveData('books', books);
    renderBooks();
    renderStats();
    toast('Arquivo(s) adicionado(s) à biblioteca.');
    event.target.value = '';
  });
}

/* LEITURA */

async function openBook(bookId) {
  const book = books.find(item => item.id === bookId);

  if (!book) return;

  currentBook = book;
  book.status = book.status === 'finished' ? 'finished' : 'reading';
  book.lastOpened = Date.now();

  await saveData('books', books);

  const readerTitle = $('#readerTitle');
  const readerPosition = $('#readerPosition');
  const readerContent = $('#readerContent');

  if (readerTitle) readerTitle.textContent = book.title;

  if (readerPosition) {
    readerPosition.textContent = book.ext.toUpperCase() + ' · leitura local';
  }

  if (readerContent) {
    readerContent.innerHTML = '<p class="muted">Carregando livro…</p>';
  }

  go('reader');
  document.body.classList.add('reading-mode');
  readerScreenLocked = false;
  clearTimeout(lockIconTimer);
  // Limpar o estado antigo antes de mostrar os controles; a ordem importa.
  $('#reader')?.classList.remove('screen-locked', 'reader-controls-visible');
  $('#readerLockIndicator')?.classList.remove('visible');
  toggleReaderControls(true);
  updateReaderProgress(Number(book.progress) || 0);
  if ($('#readerChapterSelect')) { $('#readerChapterSelect').hidden = true; $('#readerChapterSelect').innerHTML = '<option value="">Ir para capítulo</option>'; }
  $('#readerSettings')?.classList.remove('open');
  applyReaderPreferences();
  startSession();

  const file = await getFile(book.id);

  if (!file) {
    if (readerContent) {
      readerContent.innerHTML =
        '<p>Não foi possível localizar o arquivo. Importe-o novamente.</p>';
    }
    return;
  }

  if (currentFileUrl) URL.revokeObjectURL(currentFileUrl);

  currentFileUrl = URL.createObjectURL(file);

  try {
    const extension = String(book.ext || '').toLowerCase();
    if (extension === 'pdf') await loadPdf(file, book);
    else if (extension === 'epub') await loadEpub(file, book);
    else if (extension === 'txt') await loadText(file, book);
    else throw new Error('Formato de arquivo não compatível: ' + extension);
  } catch (error) {
    if (readerContent) {
      const detail = error && error.message ? error.message : String(error || 'Erro desconhecido');
      readerContent.innerHTML =
        '<p>Não foi possível abrir este livro.</p><p class="muted">Detalhe: ' + esc(detail) + '</p><p class="muted">Se for EPUB, confira se o arquivo abre normalmente em outro leitor.</p>';
    }
    console.error('Erro ao abrir livro:', error);
  }

  renderBooks();
}

async function loadText(file, book) {
  const text = await file.text();
  book._fullText = text;
  const chunks = text.match(/[\s\S]{1,1800}/g) || [text];

  book._chunks = chunks;

  const index = Math.min(
    chunks.length - 1,
    Math.floor((book.progress || 0) / 100 * chunks.length)
  );

  await showTextPart(chunks, index, book);
}

async function showTextPart(chunks, index, book) {
  index = Math.max(0, Math.min(chunks.length - 1, index));
  currentTextChunkIndex = index;

  const position = $('#readerPosition');
  const content = $('#readerContent');

  if (position) {
    position.textContent = `Trecho ${index + 1} de ${chunks.length}`;
  }

  if (!content) return;
  const savedProgress = Math.max(0, Math.min(100, Number(book.progress) || 0));

  const textToShow = readerFlow === 'scrolled' ? (book._fullText || chunks.join('')) : (chunks[index] || '');
  content.innerHTML = `<div class="reader-page">${esc(textToShow)}</div>`;
  applyReaderPreferences();
  if (readerFlow === 'scrolled') {
    book.progress = savedProgress;
    updateReaderProgress(savedProgress);
    requestAnimationFrame(() => {
      const max = Math.max(0, content.scrollHeight - content.clientHeight);
      content.scrollTop = (savedProgress / 100) * max;
      updateReaderProgress(savedProgress);
    });
  } else {
    book.progress = Math.round((index + 1) / chunks.length * 100);
    updateReaderProgress(book.progress);
  }

  await saveData('books', books);
  renderBooks();
}

async function loadPdf(file, book) {
  if (!window.pdfjsLib) {
    $('#readerContent').innerHTML =
      '<p>O leitor de PDF precisa carregar o componente PDF.js.</p>';
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  currentPdfDocument = pdf;

  if (readerFlow === 'scrolled') {
    await renderPdfContinuous(pdf, book);
    return;
  }

  currentPdfPage = Math.max(
    1,
    Math.min(
      pdf.numPages,
      Math.round((book.progress || 0) / 100 * pdf.numPages) || 1
    )
  );

  await renderPdfPage(pdf, currentPdfPage);

  await updatePdfNav(pdf, book);
}

async function renderPdfContinuous(pdf, book) {
  const content = $('#readerContent');
  if (!content) return;
  content.innerHTML = '';
  const startPage = Math.max(1, Math.min(pdf.numPages, Math.round((Number(book.progress) || 0) / 100 * pdf.numPages) || 1));
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1.15 });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-continuous-page';
    canvas.dataset.page = String(number);
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto 18px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    content.appendChild(canvas);
  }
  currentPdfPage = startPage;
  const position = $('#readerPosition');
  if (position) position.textContent = 'PDF · ' + pdf.numPages + ' páginas';
  requestAnimationFrame(() => {
    const target = content.querySelector('[data-page="' + startPage + '"]');
    if (target) content.scrollTop = target.offsetTop - content.offsetTop;
  });
  applyReaderPreferences();
}

async function renderPdfPage(pdf, number) {
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ scale: 1.15 });
  const canvas = document.createElement('canvas');

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';

  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport
  }).promise;

  const oldCanvas = $('#pdfCanvas');
  if (oldCanvas) oldCanvas.remove();

  const content = $('#readerContent');
  content.prepend(canvas);
  canvas.id = 'pdfCanvas';
}

async function updatePdfNav(pdf, book) {
  const position = $('#readerPosition');

  if (position) {
    position.textContent = `Página ${currentPdfPage} de ${pdf.numPages}`;
  }

  book.progress = Math.round(currentPdfPage / pdf.numPages * 100);
  updateReaderProgress(book.progress);

  await saveData('books', books);
  renderBooks();
}

async function loadExternalScript(src, readyCheck, label) {
  if (readyCheck()) return;
  let lastError;

  for (const url of src) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => readyCheck()
          ? resolve()
          : reject(new Error(label + ' carregou, mas não ficou disponível.'));
        script.onerror = () => reject(new Error('Falha ao carregar ' + label + ' em ' + new URL(url).hostname));
        document.head.appendChild(script);
      });
      if (readyCheck()) return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Não foi possível carregar ' + label + '.');
}

async function ensureEpubLibrary() {
  // epub.js usa JSZip para descompactar os arquivos internos do EPUB.
  await loadExternalScript([
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
  ], () => typeof window.JSZip === 'function', 'a biblioteca JSZip');

  await loadExternalScript([
    'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
    'https://unpkg.com/epubjs@0.3.93/dist/epub.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.88/epub.min.js'
  ], () => typeof window.ePub === 'function', 'o leitor EPUB');
}

async function loadEpub(file, book) {
  await ensureEpubLibrary();

  const content = $('#readerContent');
  if (!content) throw new Error('A área de leitura não foi encontrada.');

  content.innerHTML = `
    <div id="epubLoading" class="muted" role="status" style="padding:16px 0">Preparando o EPUB…</div>
    <div id="epubView" style="width:100%;min-height:320px;overflow:hidden;background:var(--panel);color:var(--text)"></div>
  `;

  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength < 100) {
    throw new Error('O arquivo EPUB parece vazio ou incompleto.');
  }

  try {
    // Definir uma altura real evita que epub.js crie páginas com altura zero
    // em leitores móveis com layout flexível e viewport dinâmica.
    const view = $('#epubView');
    const availableHeight = Math.max(320, (content.clientHeight || window.innerHeight) - 8);
    view.style.height = availableHeight + 'px';

    epubBook = window.ePub(buffer);
    const rendition = epubBook.renderTo(view, {
      width: '100%',
      height: availableHeight,
      flow: readerFlow === 'scrolled' ? 'scrolled-continuous' : 'paginated',
      axis: readerAxis,
      spread: 'none',
      manager: readerFlow === 'scrolled' ? 'continuous' : 'default',
      allowScriptedContent: false
    });

    epubRendition = rendition;
    rendition.on('relocated', location => {
      if (!location?.start) return;
      const percentage = Math.round((location.start.percentage || 0) * 100);
      if (location.start.cfi) book.epubCfi = location.start.cfi;
      const position = $('#readerPosition');
      if (position) position.textContent = 'EPUB · ' + percentage + '%';
      book.progress = percentage;
      updateReaderProgress(percentage);
      saveData('books', books).catch(console.warn);
      renderBooks();
    });

    await rendition.display();
    // Restaurar o ponto exato salvo; se ainda não houver CFI, usar o percentual guardado.
    if (book.epubCfi) {
      await rendition.display(book.epubCfi);
    } else if (Number(book.progress) > 0) {
      try {
        if (!epubBook.locations?.length?.()) await epubBook.locations.generate(1000);
        const savedCfi = epubBook.locations?.cfiFromPercentage?.(Math.min(1, Math.max(0, Number(book.progress) / 100)));
        if (savedCfi) {
          book.epubCfi = savedCfi;
          await rendition.display(savedCfi);
        }
      } catch (restoreError) { console.warn('Não foi possível restaurar o ponto de leitura:', restoreError); }
    }
    fillReaderChapters();
    // Recalcular depois que o leitor estiver visível, já com a tela cheia aplicada.
    const finalHeight = Math.max(320, (content.clientHeight || window.innerHeight) - 8);
    view.style.height = finalHeight + 'px';
    rendition.resize('100%', finalHeight);
    applyReaderPreferences();
    const epubFrame = $('#epubView iframe');
    if (epubFrame) {
      epubFrame.addEventListener('load', () => {
        try { epubRendition?.resize('100%', Math.max(320, content.clientHeight - 8)); } catch (_) {}
      });
    }
    if (epubFrame) {
      try {
        const frameDoc = epubFrame.contentDocument;
        if (frameDoc && frameDoc.documentElement.dataset.readerControlsBound !== 'yes') {
          frameDoc.documentElement.dataset.readerControlsBound = 'yes';
          const restoreControls = event => {
            if (event.target?.closest?.('a, button, input, select')) return;
            if ($('#readerSettings')?.classList.contains('open')) return;
            if (readerScreenLocked) { showLockIndicator(); return; }
            // Um toque alterna entre leitura limpa e controles.
            toggleReaderControls();
          };
          frameDoc.addEventListener('click', restoreControls, true);
        }
      } catch (_) {}
    }
    const loading = $('#epubLoading');
    if (loading) loading.remove();

  } catch (error) {
    try { epubBook?.destroy(); } catch (_) {}
    epubBook = null;
    throw new Error('O leitor não conseguiu interpretar este EPUB. O arquivo pode estar incompleto ou usar uma estrutura não compatível. Detalhe: ' +
      (error?.message || String(error)));
  }
}

/* PROGRESSO E NAVEGAÇÃO RÁPIDA */
function updateReaderProgress(value) {
  const content = $('#readerContent');
  let percent = Number(value);
  if (!Number.isFinite(percent) && content) percent = content.scrollHeight > content.clientHeight
    ? content.scrollTop / (content.scrollHeight - content.clientHeight) * 100 : 0;
  percent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const fill = $('#readerProgressFill');
  const track = $('#readerProgressTrack');
  const progressText = $('#readerProgressText');
  const remainingText = $('#readerRemainingText');
  if (fill) fill.style.width = percent + '%';
  if (track) track.setAttribute('aria-valuenow', String(percent));
  if (progressText) progressText.textContent = percent + '% lido';
  if (remainingText) remainingText.textContent = percent >= 100 ? 'Livro concluído' : percent >= 85 ? 'Quase no fim' : percent >= 60 ? 'Falta pouco' : percent >= 25 ? 'Em andamento' : 'Ainda no começo';
}
function fillReaderChapters() {
  const select = $('#readerChapterSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Ir para capítulo</option>';
  const flatten = (items, depth = 0) => (items || []).forEach(item => {
    if (item?.href) {
      const option = document.createElement('option');
      option.value = item.href;
      option.textContent = '　'.repeat(Math.min(depth, 4)) + (item.label || 'Capítulo');
      select.appendChild(option);
    }
    if (Array.isArray(item?.subitems)) flatten(item.subitems, depth + 1);
  });
  flatten(epubBook?.navigation?.toc || []);
  select.hidden = select.options.length <= 1;
}
async function navigateReader(delta) {
  if (!currentBook) return;
  const content = $('#readerContent');
  if (currentBook.ext === 'epub' && epubRendition) {
    try {
      if (delta < 0) await epubRendition.prev();
      else await epubRendition.next();
    } catch (error) { console.warn('Navegação EPUB:', error); }
    return;
  }
  if (currentBook.ext === 'pdf' && currentPdfDocument) {
    if (readerFlow === 'scrolled') {
      const pages = [...(content?.querySelectorAll('.pdf-continuous-page') || [])];
      if (!pages.length || !content) return;
      let visible = pages.findIndex(page => page.offsetTop + page.offsetHeight > content.scrollTop + 12);
      if (visible < 0) visible = pages.length - 1;
      const targetIndex = Math.max(0, Math.min(pages.length - 1, visible + delta));
      currentPdfPage = targetIndex + 1;
      pages[targetIndex].scrollIntoView({behavior:'smooth', block:'start'});
      updateReaderProgress((currentPdfPage / currentPdfDocument.numPages) * 100);
    } else {
      const target = Math.max(1, Math.min(currentPdfDocument.numPages, currentPdfPage + delta));
      if (target !== currentPdfPage) {
        currentPdfPage = target;
        await renderPdfPage(currentPdfDocument, target);
        await updatePdfNav(currentPdfDocument, currentBook);
      }
    }
    return;
  }
  if (currentBook.ext === 'txt' && content) {
    if (readerFlow === 'scrolled') content.scrollBy({top: delta * Math.max(240, content.clientHeight * 0.82), behavior:'smooth'});
    else await showTextPart(currentBook._chunks || [], currentTextChunkIndex + delta, currentBook);
  }
}
if ($('#readerPrevBtn')) $('#readerPrevBtn').addEventListener('click', () => navigateReader(-1));
if ($('#readerNextBtn')) $('#readerNextBtn').addEventListener('click', () => navigateReader(1));
if ($('#readerChapterSelect')) $('#readerChapterSelect').addEventListener('change', async event => {
  const href = event.target.value;
  if (!href || !epubRendition) return;
  try { await epubRendition.display(href); }
  catch (error) { console.warn('Não foi possível abrir o capítulo:', error); }
});
/* CONTROLES DO MODO DE LEITURA */
function applyReaderPreferences() {
  const content = $('#readerContent');
  if (content) {
    content.style.filter = 'brightness(' + (readerBrightness / 100) + ')';
    content.style.fontSize = (17 * readerFontSize / 100) + 'px';
    content.style.lineHeight = String(readerLineSpacing);
    content.style.fontFamily = readerFontFamily;
    content.style.fontWeight = String(Math.max(500, readerFontWeight));
    content.style.color = 'var(--text)';
    content.querySelectorAll('.reader-page').forEach(page => {
      page.style.fontSize = (17 * readerFontSize / 100) + 'px';
      page.style.lineHeight = String(readerLineSpacing);
      page.style.fontFamily = readerFontFamily;
      page.style.fontWeight = String(Math.max(500, readerFontWeight));
      page.style.color = 'var(--text)';
    });
    content.querySelectorAll('.reader-page p, p').forEach(paragraph => {
      paragraph.style.marginBottom = readerParagraphSpacing + 'em';
    });
  }
  const font = $('#readerFont'), line = $('#readerLine'), paragraph = $('#readerParagraph');
  const brightness = $('#readerBrightness');
  const fontFamily = $('#readerFontFamily'), fontWeight = $('#readerFontWeight');
  if (font) font.value = readerFontSize;
  if (fontFamily) fontFamily.value = readerFontFamily;
  if (fontWeight) fontWeight.value = String(readerFontWeight);
  if (line) line.value = readerLineSpacing;
  if (paragraph) paragraph.value = readerParagraphSpacing;
  if (brightness) brightness.value = readerBrightness;
  const quickBrightness = $('#readerBrightnessQuick');
  if (quickBrightness) quickBrightness.value = readerBrightness;
  if ($('#fontValue')) $('#fontValue').textContent = readerFontSize + '%';
  if ($('#lineValue')) $('#lineValue').textContent = readerLineSpacing.toLocaleString('pt-BR', {maximumFractionDigits:1});
  if ($('#paragraphValue')) $('#paragraphValue').textContent = readerParagraphSpacing.toLocaleString('pt-BR', {maximumFractionDigits:1});
  if ($('#brightnessValue')) $('#brightnessValue').textContent = readerBrightness + '%';
  if ($('#quickBrightnessValue')) $('#quickBrightnessValue').textContent = readerBrightness + '%';
  const quickBrightnessPanel = $('#readerQuickBrightness');
  if (quickBrightnessPanel) {
    quickBrightnessPanel.hidden = !showQuickBrightness;
    quickBrightnessPanel.setAttribute('aria-hidden', String(!showQuickBrightness || !$('#reader')?.classList.contains('reader-controls-visible')));
  }
  const brightnessToggle = $('#showQuickBrightness');
  if (brightnessToggle) brightnessToggle.checked = showQuickBrightness;
  const lockToggle = $('#readerLockToggle');
  if (lockToggle) lockToggle.textContent = readerScreenLocked ? '🔓 Destravar tela' : '🔒 Travar tela';
  if (epubRendition) {
    try {
      epubRendition.themes.default({
        body: {
          'font-size': readerFontSize + '% !important',
          'line-height': readerLineSpacing + ' !important',
          'font-family': readerFontFamily + ' !important',
          'font-weight': readerFontWeight + ' !important',
          'color': (getComputedStyle(document.body).getPropertyValue('--text').trim() || '#302b27') + ' !important',
          'background-color': (getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#fffdf9') + ' !important',
          'paragraph-margin-bottom': readerParagraphSpacing + 'em !important'
        },
        p: { 'margin-bottom': readerParagraphSpacing + 'em !important', 'font-weight': Math.max(500, readerFontWeight) + ' !important', 'color': (getComputedStyle(document.body).getPropertyValue('--text').trim() || '#302b27') + ' !important' }
      });
      epubRendition.settings.axis = readerAxis;
      epubRendition.resize();
    } catch (error) { console.warn('Não foi possível aplicar todos os ajustes EPUB:', error); }
  }
  updateFontPreview();
}
function setReaderFlow(value) {
  const content = $('#readerContent');
  const oldProgress = content && content.scrollHeight > content.clientHeight
    ? content.scrollTop / (content.scrollHeight - content.clientHeight) : (Number(currentBook?.progress) || 0) / 100;
  readerFlow = value === 'scrolled' ? 'scrolled' : 'paginated';
  localStorage.setItem('bibliotheca-reader-flow', readerFlow);
  if ($('#readerFlow')) $('#readerFlow').value = readerFlow;
  if (epubRendition && epubBook && currentBook?.ext === 'epub') {
    const view = $('#epubView');
    const height = Math.max(320, (content?.clientHeight || window.innerHeight) - 8);
    const percentage = Math.max(0, Math.min(1, Number(currentBook.progress || 0) / 100));
    try {
      epubRendition.destroy();
      epubRendition = epubBook.renderTo(view, {
        width: '100%', height,
        flow: readerFlow === 'scrolled' ? 'scrolled-continuous' : 'paginated',
        axis: readerAxis, spread: 'none',
        manager: readerFlow === 'scrolled' ? 'continuous' : 'default',
        allowScriptedContent: false
      });
      const rendition = epubRendition;
      rendition.on('relocated', location => {
        if (!location?.start || !currentBook) return;
        const percent = Math.round((location.start.percentage || 0) * 100);
        currentBook.progress = percent;
        const position = $('#readerPosition');
        if (position) position.textContent = 'EPUB · ' + percent + '%';
        updateReaderProgress(percent);
        saveData('books', books).catch(console.warn);
      });
      rendition.display().then(async () => {
        try {
          if (currentBook?.epubCfi) await rendition.display(currentBook.epubCfi);
          else if (percentage > 0) {
            if (!epubBook.locations?.length?.()) await epubBook.locations.generate(1000);
            const cfi = epubBook.locations?.cfiFromPercentage?.(percentage);
            if (cfi) await rendition.display(cfi);
          }
        } catch (restoreError) { console.warn('Não foi possível restaurar a posição após mudar o modo:', restoreError); }
        rendition.resize('100%', height);
      }).catch(console.warn);
    } catch (error) { console.warn('Não foi possível mudar o movimento EPUB:', error); }
  } else if (currentBook?.ext === 'txt' && currentBook._chunks) {
    showTextPart(currentBook._chunks, currentTextChunkIndex, currentBook);
    requestAnimationFrame(() => {
      const target = $('#readerContent');
      if (target && readerFlow === 'scrolled') target.scrollTop = oldProgress * Math.max(0, target.scrollHeight - target.clientHeight);
    });
  } else if (currentBook?.ext === 'pdf' && currentPdfDocument) {
    if (readerFlow === 'scrolled') renderPdfContinuous(currentPdfDocument, currentBook);
    else {
      currentPdfPage = Math.max(1, Math.min(currentPdfDocument.numPages, currentPdfPage || 1));
      renderPdfPage(currentPdfDocument, currentPdfPage).then(() => updatePdfNav(currentPdfDocument, currentBook));
    }
  }
  updateReaderProgress(oldProgress * 100);
  toggleReaderControls(true);
  const reader = $('#reader');
  reader?.classList.add('reader-controls-visible');
  requestAnimationFrame(() => {
    const target = $('#readerContent');
    if (target && readerFlow === 'scrolled' && currentBook?.ext !== 'epub') {
      target.scrollTop = oldProgress * Math.max(0, target.scrollHeight - target.clientHeight);
    }
  });
}
function toggleReaderControls(force) {
  const reader = $('#reader');
  if (!reader) return;
  if (readerScreenLocked) { showLockIndicator(); return; }
  const show = typeof force === 'boolean' ? force : !reader.classList.contains('reader-controls-visible');
  reader.classList.toggle('reader-controls-visible', show);
  if (!show) $('#readerSettings')?.classList.remove('open');
}
if ($('#readerMenuBtn')) $('#readerMenuBtn').addEventListener('click', event => {
  event.stopPropagation();
  toggleReaderControls(true);
  $('#readerSettings')?.classList.toggle('open');
});
if ($('#readerSettingsClose')) $('#readerSettingsClose').addEventListener('click', () => {
  $('#readerSettings')?.classList.remove('open');
  toggleReaderControls(false);
});
if ($('#showQuickBrightness')) $('#showQuickBrightness').addEventListener('change', event => {
  showQuickBrightness = event.target.checked;
  localStorage.setItem('bibliotheca-show-quick-brightness', String(showQuickBrightness));
  applyReaderPreferences();
  toast(showQuickBrightness ? 'Atalho de brilho ativado.' : 'Atalho de brilho oculto.');
});
function showLockIndicator() {
  const indicator = $('#readerLockIndicator');
  if (!indicator || !readerScreenLocked) return;
  indicator.classList.add('visible');
  clearTimeout(lockIconTimer);
  lockIconTimer = setTimeout(() => indicator.classList.remove('visible'), 1800);
}
function setReaderScreenLock(locked) {
  readerScreenLocked = !!locked;
  $('#reader')?.classList.toggle('screen-locked', readerScreenLocked);
  $('#readerSettings')?.classList.remove('open');
  if (readerScreenLocked) {
    $('#reader')?.classList.remove('reader-controls-visible');
    $('#readerQuickBrightness')?.setAttribute('hidden', '');
    showLockIndicator();
    toast('Tela travada. A leitura continua no modo escolhido.');
  } else {
    clearTimeout(lockIconTimer);
    $('#readerLockIndicator')?.classList.remove('visible');
    $('#reader')?.classList.remove('screen-locked');
    toggleReaderControls(false);
    applyReaderPreferences();
    toast('Tela destravada.');
    return;
  }
  applyReaderPreferences();
}
if ($('#readerLockToggle')) $('#readerLockToggle').addEventListener('click', () => setReaderScreenLock(!readerScreenLocked));
if ($('#readerLockIndicator')) $('#readerLockIndicator').addEventListener('click', event => {
  event.stopPropagation();
  setReaderScreenLock(false);
});
if ($('#readerFlow')) {
  $('#readerFlow').value = readerFlow;
  $('#readerFlow').addEventListener('change', event => setReaderFlow(event.target.value));
}
if ($('#readerAxis')) {
  $('#readerAxis').value = readerAxis;
  $('#readerAxis').addEventListener('change', event => {
    readerAxis = event.target.value === 'vertical' ? 'vertical' : 'horizontal';
    localStorage.setItem('bibliotheca-reader-axis', readerAxis);
    if (epubRendition) {
      try { epubRendition.settings.axis = readerAxis; epubRendition.resize(); } catch (_) {}
    }
    toast(readerAxis === 'horizontal' ? 'Direção horizontal selecionada.' : 'Direção vertical selecionada.');
  });
}
function updateFontPreview() {
  const preview = $('#readerFontPreview');
  if (!preview) return;
  preview.style.fontFamily = readerFontFamily;
  preview.style.fontWeight = String(Math.max(500, readerFontWeight));
  preview.style.fontSize = (17 * readerFontSize / 100) + 'px';
  preview.textContent = 'A leitura fica assim: Era uma vez, entre páginas e sonhos.';
}
if ($('#readerFontFamily')) $('#readerFontFamily').addEventListener('change', event => {
  readerFontFamily = event.target.value;
  localStorage.setItem('bibliotheca-reader-font-family', readerFontFamily);
  applyReaderPreferences();
  updateFontPreview();
});
if ($('#readerFontWeight')) $('#readerFontWeight').addEventListener('change', event => {
  readerFontWeight = Number(event.target.value) || 400;
  localStorage.setItem('bibliotheca-reader-font-weight', readerFontWeight);
  applyReaderPreferences();
  updateFontPreview();
});
if ($('#readerFont')) $('#readerFont').addEventListener('input', event => {
  readerFontSize = Number(event.target.value) || 100;
  localStorage.setItem('bibliotheca-reader-font', readerFontSize);
  applyReaderPreferences();
});
if ($('#readerLine')) $('#readerLine').addEventListener('input', event => {
  readerLineSpacing = Number(event.target.value) || 1.8;
  localStorage.setItem('bibliotheca-reader-line', readerLineSpacing);
  applyReaderPreferences();
});
if ($('#readerParagraph')) $('#readerParagraph').addEventListener('input', event => {
  readerParagraphSpacing = Number(event.target.value) || 1.2;
  localStorage.setItem('bibliotheca-reader-paragraph', readerParagraphSpacing);
  applyReaderPreferences();
});
const updateReaderBrightness = value => {
  readerBrightness = Math.max(35, Math.min(100, Number(value) || 100));
  localStorage.setItem('bibliotheca-reader-brightness', readerBrightness);
  applyReaderPreferences();
};
if ($('#readerBrightness')) $('#readerBrightness').addEventListener('input', event => updateReaderBrightness(event.target.value));
if ($('#readerBrightnessQuick')) $('#readerBrightnessQuick').addEventListener('input', event => updateReaderBrightness(event.target.value));
if ($('#readerContent')) {
  $('#readerContent').addEventListener('click', event => {
    if (event.target.closest('button, input, select, a, #epubView')) return;
    if (readerScreenLocked) { showLockIndicator(); return; }
    if ($('#readerSettings')?.classList.contains('open')) return;
    toggleReaderControls();
  });
  let touchStartX = 0, touchStartY = 0;
  const navigateReaderSwipe = (dx, dy, startX = touchStartX) => {
    if (readerScreenLocked) { showLockIndicator(); return; }
    if (!currentBook || $('#readerSettings')?.classList.contains('open')) return;
    // Gestos verticais ficam livres para a rolagem contínua; não interceptar o movimento da página.
    if (readerFlow === 'scrolled') return; // A rolagem contínua usa o gesto nativo, sem saltos forçados.
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    if (currentBook.ext === 'epub' && epubRendition) {
      (dx < 0 ? epubRendition.next() : epubRendition.prev()).catch(() => {});
    } else if (currentBook.ext === 'pdf' && currentPdfDocument) {
      const target = dx < 0 ? currentPdfPage + 1 : currentPdfPage - 1;
      if (target >= 1 && target <= currentPdfDocument.numPages) {
        currentPdfPage = target;
        renderPdfPage(currentPdfDocument, target).then(() => updatePdfNav(currentPdfDocument, currentBook));
      }
    } else if (currentBook.ext === 'txt' && currentBook._chunks) {
      showTextPart(currentBook._chunks, currentTextChunkIndex + (dx < 0 ? 1 : -1), currentBook);
    }
  };
  $('#readerContent').addEventListener('scroll', () => {
    if (!currentBook || readerFlow !== 'scrolled') return;
    const content = $('#readerContent');
    let rawPercent = content.scrollTop / Math.max(1, content.scrollHeight - content.clientHeight) * 100;
    if (currentBook.ext === 'pdf' && currentPdfDocument) {
      const pages = [...content.querySelectorAll('.pdf-continuous-page')];
      const visible = pages.find(page => page.offsetTop + page.offsetHeight > content.scrollTop + 2);
      if (visible) {
        const pageNumber = Number(visible.dataset.page) || 1;
        const within = Math.max(0, Math.min(1, (content.scrollTop - visible.offsetTop) / Math.max(1, visible.offsetHeight)));
        rawPercent = ((pageNumber - 1 + within) / currentPdfDocument.numPages) * 100;
        currentPdfPage = pageNumber;
      }
    }
    const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));
    if (currentBook.ext !== 'epub') currentBook.progress = percent;
    const position = $('#readerPosition');
    if (position) position.textContent = (currentBook.ext === 'pdf' ? 'PDF · ' : 'Leitura contínua · ') + percent + '%';
    updateReaderProgress(percent);
    if (currentBook.ext !== 'epub') saveData('books', books).catch(console.warn);
  }, {passive:true});
  $('#readerContent').addEventListener('touchstart', event => {
    if (readerScreenLocked) showLockIndicator();
    touchStartX = event.changedTouches[0]?.clientX || 0;
    touchStartY = event.changedTouches[0]?.clientY || 0;
  }, {passive:true});
  $('#readerContent').addEventListener('touchend', event => {
    navigateReaderSwipe((event.changedTouches[0]?.clientX || 0) - touchStartX, (event.changedTouches[0]?.clientY || 0) - touchStartY, touchStartX);
  }, {passive:true});
  // EPUB aparece dentro de iframe, então escutamos o gesto dentro dele também.
  const bindEpubSwipe = () => {
    const frame = $('#epubView iframe');
    if (!frame) return;
    try {
      const frameDoc = frame.contentDocument;
      if (frameDoc?.documentElement && frameDoc.documentElement.dataset.readerControlsBound !== 'yes') {
        frameDoc.documentElement.dataset.readerControlsBound = 'yes';
        frameDoc.addEventListener('click', event => {
          if (event.target?.closest?.('a, button, input, select')) return;
          if ($('#readerSettings')?.classList.contains('open')) return;
          if (!$('#reader')?.classList.contains('reader-controls-visible')) toggleReaderControls(true);
          else toggleReaderControls(false);
        }, true);
      }
    } catch (_) {}
    // O iframe do epub.js pode carregar depois da primeira tentativa; ligar o gesto no evento load.
    if (frame.dataset.swipeLoadBound !== 'yes') {
      frame.dataset.swipeLoadBound = 'yes';
      frame.addEventListener('load', () => {
        frame.dataset.swipeLoadBound = '';
        bindEpubSwipe();
      });
    }
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement || doc.documentElement.dataset.swipeBound === 'yes') return;
      doc.documentElement.dataset.swipeBound = 'yes';
      let sx = 0, sy = 0;
      doc.addEventListener('touchstart', event => {
        sx = event.changedTouches[0]?.clientX || 0;
        sy = event.changedTouches[0]?.clientY || 0;
      }, {passive:true});
      doc.addEventListener('touchend', event => {
        const ex = event.changedTouches[0]?.clientX || 0;
        const ey = event.changedTouches[0]?.clientY || 0;
        navigateReaderSwipe(ex - sx, ey - sy, sx);
      }, {passive:true});
    } catch (_) {}
  };
  const epubSwipeObserver = new MutationObserver(bindEpubSwipe);
  epubSwipeObserver.observe($('#readerContent'), {childList:true, subtree:true});
  // Tentar novamente após a primeira renderização e em caso de iframe tardio.
  setTimeout(bindEpubSwipe, 250);
  setTimeout(bindEpubSwipe, 900);
}

/* TEMPO DE LEITURA */

function startSession() {
  stopSession();
  sessionStarted = Date.now();

  timer = setInterval(async () => {
    if (!currentBook || !sessionStarted) return;

    const elapsed = (Date.now() - sessionStarted) / 60000;

    if (elapsed >= 1) {
      sessions.push({
        date: todayKey(),
        minutes: 1,
        bookId: currentBook.id
      });

      sessionStarted += 60000;

      await saveData('sessions', sessions);
      renderStats();
    }
  }, 15000);
}

async function stopSession() {
  if (timer) clearInterval(timer);
  timer = null;

  if (!sessionStarted) return;

  const minutes = (Date.now() - sessionStarted) / 60000;

  if (minutes >= 0.5) {
    sessions.push({
      date: todayKey(),
      minutes,
      bookId: currentBook?.id
    });
  }

  sessionStarted = null;
  await saveData('sessions', sessions);
}

const closeReader = $('#closeReader');

if (closeReader) {
  closeReader.addEventListener('click', async () => {
    await stopSession();
    currentBook = null;

    if (epubBook) {
      try {
        epubBook.destroy();
      } catch (error) {
        console.warn(error);
      }
      epubBook = null;
      epubRendition = null;
    }
    currentPdfDocument = null;
    document.body.classList.remove('reading-mode');

    go('library');
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopSession();
  } else if (currentBook) {
    startSession();
  }
});

/* NOTAS, CITAÇÕES E MARCADORES */

function openNote(kind) {
  if (!currentBook) {
    toast('Abra um livro primeiro.');
    return;
  }

  const kindInput = $('#noteKind');
  const textInput = $('#noteText');
  const title = $('#noteDialogTitle');
  const dialog = $('#noteDialog');

  if (!kindInput || !textInput || !dialog) return;

  kindInput.value = kind;
  textInput.value = '';

  if (title) {
    title.textContent =
      kind === 'quote' ? 'Guardar citação' :
      kind === 'marker' ? 'Marcar página' : 'Novo adendo';
  }

  dialog.showModal();
}

if ($('#markBtn')) {
  $('#markBtn').onclick = () => openNote('marker');
}

if ($('#quoteBtn')) {
  $('#quoteBtn').onclick = () => openNote('quote');
}

if ($('#noteBtn')) {
  $('#noteBtn').onclick = () => openNote('note');
}

const noteForm = $('#noteForm');

if (noteForm) {
  noteForm.addEventListener('submit', async event => {
    if (event.submitter?.id !== 'saveNote') return;

    event.preventDefault();

    const kind = $('#noteKind').value;
    const text = $('#noteText').value.trim();

    if (!text && kind !== 'marker') {
      toast('Escreva algo antes de salvar.');
      return;
    }

    notes.unshift({
      id: makeId(),
      kind,
      text,
      bookId: currentBook?.id,
      bookTitle: currentBook?.title || 'Livro',
      page: currentBook?.ext === 'pdf' ? currentPdfPage : null,
      created: Date.now()
    });

    await saveData('notes', notes);
    $('#noteDialog').close();
    renderNotes();
    toast('Anotação salva.');
  });
}

/* TEMAS E CORES */

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('bibliotheca-theme', theme);

  $$('.theme-choice').forEach(button => {
    button.style.borderColor =
      button.dataset.theme === theme ? 'var(--accent)' : 'var(--line)';
  });
}

if ($('#themeBtn')) {
  $('#themeBtn').onclick = () => {
    const order = ['light', 'sepia', 'dark'];
    const current = document.body.dataset.theme || 'light';

    setTheme(order[(order.indexOf(current) + 1) % order.length]);
  };
}

if ($('#readerTheme')) {
  $('#readerTheme').onclick = () => {
    if ($('#themeBtn')) $('#themeBtn').click();
  };
}

$$('.theme-choice').forEach(button => {
  button.onclick = () => setTheme(button.dataset.theme);
});

$$('.accent-dot').forEach(button => {
  button.onclick = () => {
    document.documentElement.style.setProperty(
      '--accent',
      button.dataset.accent
    );

    localStorage.setItem('bibliotheca-accent', button.dataset.accent);
  };
});

/* META DE LEITURA */

if ($('#saveGoal')) {
  $('#saveGoal').onclick = async () => {
    awaitlessReadGoal = Number($('#goalInput')?.value) || 30;

    await saveData('goal', awaitlessReadGoal);
    renderStats();
    toast('Meta diária salva.');
  };
}

/* EXPORTAÇÃO DE DADOS */

if ($('#exportBtn')) {
  $('#exportBtn').onclick = () => {
    const backup = {
      books: books.map(({
        id, title, author, ext, status, progress, added, lastOpened
      }) => ({
        id, title, author, ext, status, progress, added, lastOpened
      })),
      notes,
      sessions,
      goal: awaitlessReadGoal,
      gardenBookIds
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'bibliotheca-backup.json';
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

/* INICIALIZAÇÃO — versão 31 */

async function init() {
  try {
    db = await openDB();

    books = await readData('books', []);
    notes = await readData('notes', []);
    sessions = await readData('sessions', []);
    gardenBookIds = await readData('gardenBookIds', []);
    enabledExtraGenres = await readData('enabledExtraGenres', []);
    awaitlessReadGoal = await readData('goal', 30);

    setTheme(localStorage.getItem('bibliotheca-theme') || 'light');

    const accent = localStorage.getItem('bibliotheca-accent');

    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
    }

    renderBooks();
    renderNotes();
    renderStats();
    renderReadingQuote();
  } catch (error) {
    toast('Não foi possível iniciar o armazenamento local.');
    console.error(error);
  }
}

init();

/* Atualização automática do aplicativo */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js?v=80', { updateViaCache: 'none' });
      registration.update().catch(() => {});
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) worker.postMessage({ type: 'SKIP_WAITING' });
        });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (error) { console.warn('Atualização automática indisponível:', error); }
  });
}
