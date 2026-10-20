
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
      <span class="room-icon">${genre.icon}</span>
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
    if (roomTitle) roomTitle.textContent = (config ? config.icon + ' ' : '') + selectedGenre;
    if (roomDescription) roomDescription.textContent = config ? config.desc : 'Sua coleção neste gênero.';
    if (roomPanel) roomPanel.className = 'selected-genre-panel room-' + (config?.style || 'outros');
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

  const textToShow = readerFlow === 'scrolled' ? (book._fullText || chunks.join('')) : (chunks[index] || '');
  content.innerHTML = `<div class="reader-page">${esc(textToShow)}</div>`;
  applyReaderPreferences();
  if (readerFlow === 'scrolled') {
    const percent = Math.round((content.scrollTop + content.clientHeight) / Math.max(content.scrollHeight, 1) * 100);
    book.progress = Math.max(book.progress || 0, percent);
  }


  if (readerFlow !== 'scrolled') book.progress = Math.round((index + 1) / chunks.length * 100);

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
    const availableHeight = Math.max(320, content.clientHeight - 8);
    view.style.height = availableHeight + 'px';

    epubBook = window.ePub(buffer);
    const rendition = epubBook.renderTo(view, {
      width: '100%',
      height: availableHeight,
      flow: readerFlow === 'scrolled' ? 'scrolled-doc' : 'paginated',
      axis: readerAxis,
      spread: 'none',
      manager: 'default',
      allowScriptedContent: false
    });

    epubRendition = rendition;
    rendition.on('relocated', location => {
      if (!location?.start) return;
      const percentage = Math.round((location.start.percentage || 0) * 100);
      const position = $('#readerPosition');
      if (position) position.textContent = 'EPUB · ' + percentage + '%';
      book.progress = percentage;
      saveData('books', books).catch(console.warn);
      renderBooks();
    });

    await rendition.display();
    // Recalcular depois que o leitor estiver visível, já com a tela cheia aplicada.
    const finalHeight = Math.max(320, content.clientHeight - 8);
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
        epubFrame.contentDocument?.addEventListener('click', () => {
          if (!$('#readerSettings')?.classList.contains('open')) toggleReaderControls();
        });
      } catch (_) {}
    }
    const loading = $('#epubLoading');
    if (loading) loading.remove();

    // Garantir que o primeiro capítulo seja posicionado no centro do leitor.
    if (epubRendition && !book.progress) {
      try { await epubRendition.display(); } catch (_) {}
    }
  } catch (error) {
    try { epubBook?.destroy(); } catch (_) {}
    epubBook = null;
    throw new Error('O leitor não conseguiu interpretar este EPUB. O arquivo pode estar incompleto ou usar uma estrutura não compatível. Detalhe: ' +
      (error?.message || String(error)));
  }
}

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
  readerFlow = value === 'scrolled' ? 'scrolled' : 'paginated';
  localStorage.setItem('bibliotheca-reader-flow', readerFlow);
  if ($('#readerFlow')) $('#readerFlow').value = readerFlow;
  if (epubRendition) {
    epubRendition.flow(readerFlow === 'scrolled' ? 'scrolled-doc' : 'paginated');
    epubRendition.resize();
  } else if (currentBook?.ext === 'txt' && currentBook._chunks) {
    const chunks = currentBook._chunks;
    showTextPart(chunks, currentTextChunkIndex, currentBook);
  } else if (currentBook?.ext === 'pdf' && currentPdfDocument) {
    $('#readerContent')?.scrollTo({top:0, behavior:'smooth'});
  }
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
    showLockIndicator();
    toast('Tela travada. Toque no cadeado para destravar.');
  } else {
    clearTimeout(lockIconTimer);
    $('#readerLockIndicator')?.classList.remove('visible');
    $('#reader')?.classList.remove('screen-locked');
    toggleReaderControls(false);
    toast('Tela destravada.');
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
    if (event.target.closest('button, input, select, a')) return;
    if (readerScreenLocked) { showLockIndicator(); return; }
    if ($('#readerSettings')?.classList.contains('open')) return;
    toggleReaderControls();
  });
  let touchStartX = 0, touchStartY = 0;
  const navigateReaderSwipe = (dx, dy, startX = touchStartX) => {
    if (readerScreenLocked) { showLockIndicator(); return; }
    if (!currentBook || $('#readerSettings')?.classList.contains('open')) return;
    // Deslize para cima/baixo na faixa direita para ajustar o brilho sem sair do livro.
    if (startX >= window.innerWidth * 0.76 && Math.abs(dy) >= 24 && Math.abs(dy) > Math.abs(dx)) {
      readerBrightness = Math.max(35, Math.min(100, readerBrightness + (dy < 0 ? 5 : -5)));
      localStorage.setItem('bibliotheca-reader-brightness', readerBrightness);
      applyReaderPreferences();
      return;
    }
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
    if (readerFlow !== 'scrolled' || !currentBook) return;
    const content = $('#readerContent');
    const max = Math.max(1, content.scrollHeight - content.clientHeight);
    const percent = Math.max(0, Math.min(100, Math.round(content.scrollTop / max * 100)));
    currentBook.progress = percent;
    const position = $('#readerPosition');
    if (position) position.textContent = 'Leitura contínua · ' + percent + '%';
    saveData('books', books).catch(console.warn);
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
      const registration = await navigator.serviceWorker.register('./sw.js?v=33', { updateViaCache: 'none' });
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
