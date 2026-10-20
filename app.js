
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
let currentPdfPage = 1;
let epubBook = null;
let awaitlessReadGoal = 30;

const colors = [
  '#71624e', '#6d4c52', '#465b52', '#485c73',
  '#765c48', '#66506f', '#496d70'
];

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return [...document.querySelectorAll(selector)];
}

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

function card(book) {
  const progress = book.progress || 0;
  const inGarden = gardenBookIds.includes(book.id);

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

        <div class="mini-progress">
          <span style="width:${progress}%"></span>
        </div>

        <button type="button"
                class="secondary-btn garden-toggle"
                data-garden="${esc(book.id)}"
                aria-pressed="${inGarden}">
          ${inGarden ? '♥ No Jardim' : '＋ Jardim dos Romances'}
        </button>
      </div>
    </article>
  `;
}

/* JARDIM DOS ROMANCES */

 
function ensureGardenSection() {
  const home = $('#home');
  if (!home) return;

  let section = $('#gardenSection');

  if (!section) {
    section = document.createElement('section');
    section.id = 'gardenSection';
    section.className = 'garden-section';

    section.innerHTML = `
      <div class="section-head">
        <h2>🌷 Jardim dos Romances</h2>
        <button type="button" class="text-btn" id="gardenManage">
          Escolher livros
        </button>
      </div>

      <p class="muted small">
        Seu cantinho especial para os romances escolhidos por você.
      </p>

      <div id="gardenList" class="book-grid compact-grid"></div>

      <p id="gardenEmpty" class="muted">
        Seu jardim está vazio. Entre na biblioteca e toque em
        “Jardim dos Romances” no livro que deseja adicionar.
      </p>
    `;

    home.appendChild(section);

    const manageButton = $('#gardenManage');
    if (manageButton) {
      manageButton.addEventListener('click', () => go('library'));
    }
  }
}{
  const home = $('#home');

  if (!home || $('#gardenSection')) return;

  const section = document.createElement('section');

  section.id = 'gardenSection';
  section.className = 'garden-section';

  section.innerHTML = `
    <div class="section-head">
      <h2>🌷 Jardim dos Romances</h2>
      <button type="button" class="text-btn" id="gardenManage">
        Escolher livros
      </button>
    </div>

    <p class="muted small">
      Seu cantinho especial para os romances escolhidos por você.
    </p>

    <div id="gardenList" class="book-grid compact-grid"></div>

    <p id="gardenEmpty" class="muted">
      Seu jardim está vazio. Entre na biblioteca e toque em
      “Jardim dos Romances” no livro que deseja adicionar.
    </p>
  `;

  home.appendChild(section);

  const manageButton = $('#gardenManage');

  if (manageButton) {
    manageButton.addEventListener('click', () => go('library'));
  }
}

async function toggleGarden(bookId) {
  if (gardenBookIds.includes(bookId)) {
    gardenBookIds = gardenBookIds.filter(id => id !== bookId);
    toast('Livro removido do Jardim dos Romances.');
  } else {
    gardenBookIds.push(bookId);
    toast('Livro adicionado ao Jardim dos Romances! 🌷');
  }

  await saveData('gardenBookIds', gardenBookIds);
  renderBooks();
}

function bindBookCards(container) {
  if (!container) return;

  container.querySelectorAll('[data-open]').forEach(element => {
    element.addEventListener('click', event => {
      if (event.target.closest('[data-garden]')) return;
      openBook(element.dataset.open);
    });
  });

  container.querySelectorAll('[data-garden]').forEach(button => {
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();

      await toggleGarden(button.dataset.garden);
    });
  });
}

/* BIBLIOTECA */

function renderBooks() {
  const search = $('#searchInput');
  const query = search ? search.value.toLowerCase() : '';

  const filtered = books.filter(book =>
    (activeFilter === 'all' || book.status === activeFilter) &&
    `${book.title} ${book.author || ''}`.toLowerCase().includes(query)
  );

  const shelf = $('#shelfList');
  const emptyLibrary = $('#emptyLibrary');

  if (shelf) {
    shelf.innerHTML = filtered.map(card).join('');

    if (emptyLibrary) {
      emptyLibrary.style.display = books.length ? 'none' : 'block';
    }

    shelf.style.display = filtered.length ? 'grid' : 'none';

    if (books.length && !filtered.length) {
      shelf.innerHTML =
        '<p class="muted">Nenhum livro encontrado nesta seleção.</p>';
      shelf.style.display = 'block';
    }

    bindBookCards(shelf);
  }

  const continueList = $('#continueList');

  if (continueList) {
    const reading = books
      .filter(book => book.status === 'reading')
      .slice(0, 4);

    continueList.innerHTML = reading.map(card).join('');

    if (!reading.length) {
      continueList.innerHTML =
        '<p class="muted">Seus livros em andamento aparecerão aqui.</p>';
    }

    bindBookCards(continueList);
  }

  ensureGardenSection();

  const gardenList = $('#gardenList');
  const gardenEmpty = $('#gardenEmpty');

  if (gardenList) {
    const gardenBooks = books.filter(book =>
      gardenBookIds.includes(book.id)
    );

    gardenList.innerHTML = gardenBooks.map(card).join('');

    if (gardenEmpty) {
      gardenEmpty.style.display = gardenBooks.length ? 'none' : 'block';
    }

    bindBookCards(gardenList);
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
    if (book.ext === 'pdf') await loadPdf(file, book);
    else if (book.ext === 'epub') await loadEpub(file, book);
    else if (book.ext === 'txt') await loadText(file, book);
  } catch (error) {
    if (readerContent) {
      readerContent.innerHTML =
        '<p>Não foi possível abrir este arquivo. Tente outro arquivo ou formato.</p>';
    }
    console.error(error);
  }

  renderBooks();
}

async function loadText(file, book) {
  const text = await file.text();
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

  const position = $('#readerPosition');
  const content = $('#readerContent');

  if (position) {
    position.textContent = `Trecho ${index + 1} de ${chunks.length}`;
  }

  if (!content) return;

  content.innerHTML = `
    <div class="reader-page">${esc(chunks[index] || '')}</div>
    <div style="display:flex;gap:8px;margin-top:22px">
      <button class="secondary-btn" id="prevPart">Anterior</button>
      <button class="secondary-btn" id="nextPart">Próximo</button>
    </div>
  `;

  $('#prevPart').onclick = () => showTextPart(chunks, index - 1, book);
  $('#nextPart').onclick = () => showTextPart(chunks, index + 1, book);

  book.progress = Math.round((index + 1) / chunks.length * 100);

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

  currentPdfPage = Math.max(
    1,
    Math.min(
      pdf.numPages,
      Math.round((book.progress || 0) / 100 * pdf.numPages) || 1
    )
  );

  await renderPdfPage(pdf, currentPdfPage);

  $('#readerContent').insertAdjacentHTML('beforeend', `
    <div style="display:flex;gap:8px;margin-top:18px">
      <button class="secondary-btn" id="prevPdf">← Anterior</button>
      <button class="secondary-btn" id="nextPdf">Próxima →</button>
    </div>
  `);

  $('#prevPdf').onclick = async () => {
    if (currentPdfPage > 1) {
      currentPdfPage--;
      await renderPdfPage(pdf, currentPdfPage);
      await updatePdfNav(pdf, book);
    }
  };

  $('#nextPdf').onclick = async () => {
    if (currentPdfPage < pdf.numPages) {
      currentPdfPage++;
      await renderPdfPage(pdf, currentPdfPage);
      await updatePdfNav(pdf, book);
    }
  };

  await updatePdfNav(pdf, book);
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

async function loadEpub(file, book) {
  if (!window.ePub) {
    $('#readerContent').innerHTML =
      '<p>O leitor EPUB precisa carregar o componente EPUB.js.</p>';
    return;
  }

  const buffer = await file.arrayBuffer();
  epubBook = ePub(buffer);

  $('#readerContent').innerHTML =
    '<div id="epubView" style="height:60vh;overflow:hidden"></div>';

  const rendition = epubBook.renderTo('epubView', {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'none'
  });

  await rendition.display();

  rendition.on('relocated', location => {
    if (!location.start) return;

    const position = $('#readerPosition');

    if (position) position.textContent = 'Leitura EPUB';

    book.progress = Math.round((location.start.percentage || 0) * 100);
    saveData('books', books);
    renderBooks();
  });
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
    }

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

/* INICIALIZAÇÃO */

async function init() {
  try {
    db = await openDB();

    books = await readData('books', []);
    notes = await readData('notes', []);
    sessions = await readData('sessions', []);
    gardenBookIds = await readData('gardenBookIds', []);
    awaitlessReadGoal = await readData('goal', 30);

    setTheme(localStorage.getItem('bibliotheca-theme') || 'light');

    const accent = localStorage.getItem('bibliotheca-accent');

    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
    }

    renderBooks();
    renderNotes();
    renderStats();
  } catch (error) {
    toast('Não foi possível iniciar o armazenamento local.');
    console.error(error);
  }
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    console.warn('Service Worker não registrado:', error);
  });
}

init();
