const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DB_NAME = 'bibliotheca-db-v1';
let db, books = [], notes = [], sessions = [], currentBook = null, currentFileUrl = null, timer = null, sessionStarted = null, activeFilter = 'all', currentPdfPage = 1, epubBook = null;
const colors = ['#71624e','#6d4c52','#465b52','#485c73','#765c48','#66506f','#496d70'];
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('files',{keyPath:'id'});d.createObjectStore('data',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function getStore(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function readData(key, fallback){return new Promise(resolve=>{const r=getStore('data').get(key);r.onsuccess=()=>resolve(r.result?.value ?? fallback);r.onerror=()=>resolve(fallback);});}
function saveData(key,value){return new Promise((resolve,reject)=>{const r=getStore('data','readwrite').put({key,value});r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
function saveFile(book,file){return new Promise((resolve,reject)=>{const r=getStore('files','readwrite').put({id:book.id,file});r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
function getFile(id){return new Promise(resolve=>{const r=getStore('files').get(id);r.onsuccess=()=>resolve(r.result?.file);r.onerror=()=>resolve(null);});}
function id(){return crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2);}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}
function fmt(min){min=Math.round(min);return min<60?`${min} min`:`${Math.floor(min/60)}h ${min%60}min`;}
function todayKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function dateMinutes(key){return sessions.filter(s=>s.date===key).reduce((n,s)=>n+s.minutes,0);}
function dayLabels(){return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];}
function renderStats(){
 const today=todayKey(), todayMin=dateMinutes(today);
 const days=[]; for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push({key:todayKey(d),label:dayLabels()[d.getDay()],min:dateMinutes(todayKey(d))});}
 const week=days.reduce((a,d)=>a+d.min,0);
 ['#todayTime','#statsToday'].forEach(s=>$(s).textContent=fmt(todayMin));
 ['#weekTime','#statsWeek'].forEach(s=>$(s).textContent=fmt(week));
 const max=Math.max(30,...days.map(d=>d.min));
 $('#weekChart').innerHTML=days.map(d=>`<div class="chart-day"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(3,d.min/max*100)}%" title="${fmt(d.min)}"></div></div><small>${d.label}</small></div>`).join('');
 const goal=Number((awaitlessReadGoal)||30);
 $('#goalInput').value=goal; $('#goalProgress').style.width=Math.min(100,todayMin/goal*100)+'%';$('#goalLabel').textContent=`${Math.round(todayMin)} de ${goal} minutos hoje`;
 $('#bookCount').textContent=books.length;$('#finishedCount').textContent=books.filter(b=>b.status==='finished').length;
}
let awaitlessReadGoal=30;
function coverColor(book){return colors[(book.title.length+(book.author||'').length)%colors.length]}
function card(book){const progress=book.progress||0;return `<article class="book-card" data-open="${book.id}"><div class="book-cover" style="background:linear-gradient(145deg,${coverColor(book)},#29231f)"><span class="cover-type">${(book.ext||'LIVRO').toUpperCase()}</span><span class="cover-title">${esc(book.title)}</span><span class="cover-author">${esc(book.author||'Autor desconhecido')}</span></div><div class="book-meta"><strong>${esc(book.title)}</strong><small>${esc(book.author||'Arquivo importado')}</small><div class="mini-progress"><span style="width:${progress}%"></span></div></div></article>`}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderBooks(){
 const q=$('#searchInput').value.toLowerCase();
 const filtered=books.filter(b=>(activeFilter==='all'||b.status===activeFilter)&&(`${b.title} ${b.author||''}`).toLowerCase().includes(q));
 $('#shelfList').innerHTML=filtered.map(card).join('');
 $('#emptyLibrary').style.display=books.length?'none':'block';
 $('#shelfList').style.display=filtered.length?'grid':'none';
 if(books.length && !filtered.length) $('#shelfList').innerHTML='<p class="muted">Nenhum livro encontrado nesta seleção.</p>';
 $('#continueList').innerHTML=books.filter(b=>b.status==='reading').slice(0,4).map(card).join('');
 if(!books.some(b=>b.status==='reading')) $('#continueList').innerHTML='<p class="muted">Seus livros em andamento aparecerão aqui.</p>';
 $('#shelfList').querySelectorAll('[data-open]').forEach(el=>el.addEventListener('click',()=>openBook(el.dataset.open)));
 $('#continueList').querySelectorAll('[data-open]').forEach(el=>el.addEventListener('click',()=>openBook(el.dataset.open)));
}
function renderNotes(){
 const all=notes.slice().sort((a,b)=>b.created-a.created);
 $('#notesList').innerHTML=all.map(n=>`<article class="note-card"><span class="note-type">${n.kind==='quote'?'Citação':n.kind==='marker'?'Marcador':'Adendo'} · ${esc(n.bookTitle||'Livro')}</span><p>${esc(n.text||'Página marcada')}</p><small>${new Date(n.created).toLocaleDateString('pt-BR')}${n.page?` · Página ${n.page}`:''}</small></article>`).join('');
 $('#emptyNotes').style.display=all.length?'none':'block';
}
function go(screen){
 $$('.screen').forEach(s=>s.classList.remove('active'));$('#'+screen).classList.add('active');
 $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.go===screen));
 if(screen==='stats')renderStats();if(screen==='notes')renderNotes();if(screen==='library'||screen==='home')renderBooks();
}
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$$('.filter-chip').forEach(b=>b.addEventListener('click',()=>{$$('.filter-chip').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');activeFilter=b.dataset.filter;renderBooks();}));
$('#searchInput').addEventListener('input',renderBooks);
$('#fileInput').addEventListener('change',async e=>{
 const files=[...e.target.files];if(!files.length)return;
 for(const file of files){
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['pdf','epub','mobi','txt'].includes(ext)){toast('Formato não reconhecido: '+file.name);continue;}
  if(ext==='mobi'){toast('MOBI ainda não abre neste protótipo. Converta para EPUB para testar.');continue;}
  const book={id:id(),title:file.name.replace(/\.[^.]+$/,''),author:'',ext,status:'want',progress:0,added:Date.now(),lastOpened:0};
  books.unshift(book);await saveFile(book,file);
 }
 await saveData('books',books);renderBooks();toast('Arquivo(s) adicionado(s) à biblioteca.');e.target.value='';
});
async function openBook(bookId){
 const b=books.find(x=>x.id===bookId);if(!b)return;currentBook=b;
 b.status=b.status==='finished'?'finished':'reading';b.lastOpened=Date.now();await saveData('books',books);
 $('#readerTitle').textContent=b.title;$('#readerPosition').textContent=b.ext.toUpperCase()+' · leitura local';$('#readerContent').innerHTML='<p class="muted">Carregando livro…</p>';
 go('reader');startSession();
 const file=await getFile(b.id);if(!file){$('#readerContent').innerHTML='<p>Não foi possível localizar o arquivo. Importe-o novamente.</p>';return;}
 if(currentFileUrl)URL.revokeObjectURL(currentFileUrl);currentFileUrl=URL.createObjectURL(file);
 try{
  if(b.ext==='pdf')await loadPdf(file,b);
  else if(b.ext==='epub')await loadEpub(file,b);
  else if(b.ext==='txt')await loadText(file,b);
 }catch(err){$('#readerContent').innerHTML='<p>Não foi possível abrir este arquivo. Tente outro arquivo ou formato.</p>';console.error(err);}
 renderBooks();
}
async function loadText(file,b){const text=await file.text();const chunks=text.match(/[\s\S]{1,1800}/g)||[text];const idx=Math.min(chunks.length-1,Math.floor((b.progress||0)/100*chunks.length));$('#readerPosition').textContent=`Trecho ${idx+1} de ${chunks.length}`;$('#readerContent').innerHTML=`<div class="reader-page">${esc(chunks[idx]||'')}</div><div style="display:flex;gap:8px;margin-top:22px"><button class="secondary-btn" id="prevPart">Anterior</button><button class="secondary-btn" id="nextPart">Próximo</button></div>`;$('#prevPart').onclick=()=>showTextPart(chunks,idx-1,b);$('#nextPart').onclick=()=>showTextPart(chunks,idx+1,b);b._chunks=chunks;}
async function showTextPart(chunks,i,b){i=Math.max(0,Math.min(chunks.length-1,i));$('#readerPosition').textContent=`Trecho ${i+1} de ${chunks.length}`;$('#readerContent').innerHTML=`<div class="reader-page">${esc(chunks[i]||'')}</div><div style="display:flex;gap:8px;margin-top:22px"><button class="secondary-btn" id="prevPart">Anterior</button><button class="secondary-btn" id="nextPart">Próximo</button></div>`;$('#prevPart').onclick=()=>showTextPart(chunks,i-1,b);$('#nextPart').onclick=()=>showTextPart(chunks,i+1,b);b.progress=Math.round((i+1)/chunks.length*100);await saveData('books',books);renderBooks();}
async function loadPdf(file,b){
 if(!window.pdfjsLib){$('#readerContent').innerHTML='<p>O leitor de PDF precisa de conexão para carregar o componente inicial.</p>';return;}
 pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 const bytes=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:bytes}).promise;currentPdfPage=Math.max(1,Math.min(pdf.numPages,Math.round((b.progress||0)/100*pdf.numPages)||1));
 await renderPdfPage(pdf,currentPdfPage);$('#readerContent').insertAdjacentHTML('beforeend',`<div style="display:flex;gap:8px;margin-top:18px"><button class="secondary-btn" id="prevPdf">← Anterior</button><button class="secondary-btn" id="nextPdf">Próxima →</button></div>`);
 $('#prevPdf').onclick=async()=>{if(currentPdfPage>1){currentPdfPage--;await renderPdfPage(pdf,currentPdfPage);updatePdfNav(pdf,b);}};
 $('#nextPdf').onclick=async()=>{if(currentPdfPage<pdf.numPages){currentPdfPage++;await renderPdfPage(pdf,currentPdfPage);updatePdfNav(pdf,b);}};
 await updatePdfNav(pdf,b);
}
async function renderPdfPage(pdf,n){const page=await pdf.getPage(n);const viewport=page.getViewport({scale:1.15});const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;canvas.style.width='100%';canvas.style.height='auto';const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;const old=$('#pdfCanvas');if(old)old.remove();$('#readerContent').prepend(canvas);canvas.id='pdfCanvas';}
async function updatePdfNav(pdf,b){$('#readerPosition').textContent=`Página ${currentPdfPage} de ${pdf.numPages}`;b.progress=Math.round(currentPdfPage/pdf.numPages*100);await saveData('books',books);renderBooks();}
async function loadEpub(file,b){
 if(!window.ePub){$('#readerContent').innerHTML='<p>O leitor EPUB precisa de conexão para carregar o componente inicial.</p>';return;}
 const buffer=await file.arrayBuffer();epubBook=ePub(buffer);$('#readerContent').innerHTML='<div id="epubView" style="height:60vh;overflow:hidden"></div>';
 const rendition=epubBook.renderTo('epubView',{width:'100%',height:'100%',flow:'paginated',spread:'none'});await rendition.display();
 rendition.on('relocated',loc=>{if(loc.start){$('#readerPosition').textContent='Leitura EPUB';b.progress=Math.round((loc.start.percentage||0)*100);saveData('books',books);renderBooks();}});
}
function startSession(){stopSession();sessionStarted=Date.now();timer=setInterval(async()=>{if(!currentBook||!sessionStarted)return;const elapsed=(Date.now()-sessionStarted)/60000;if(elapsed>=1){sessions.push({date:todayKey(),minutes:1,bookId:currentBook.id});sessionStarted+=60000;await saveData('sessions',sessions);renderStats();}},15000);}
async function stopSession(){if(timer)clearInterval(timer);timer=null;if(sessionStarted){const mins=(Date.now()-sessionStarted)/60000;if(mins>=0.5){sessions.push({date:todayKey(),minutes:mins,bookId:currentBook?.id});await saveData('sessions',sessions);}sessionStarted=null;await saveData('sessions',sessions);} }
$('#closeReader').addEventListener('click',async()=>{await stopSession();currentBook=null;if(epubBook){try{epubBook.destroy()}catch{}}go('library');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSession();else if(currentBook)startSession();});
function openNote(kind){if(!currentBook){toast('Abra um livro primeiro.');return;}$('#noteKind').value=kind;$('#noteText').value='';$('#noteDialogTitle').textContent=kind==='quote'?'Guardar citação':kind==='marker'?'Marcar página':'Novo adendo';$('#noteDialog').showModal();}
$('#markBtn').onclick=()=>openNote('marker');$('#quoteBtn').onclick=()=>openNote('quote');$('#noteBtn').onclick=()=>openNote('note');
$('#noteForm').addEventListener('submit',async e=>{if(e.submitter?.id!=='saveNote')return;e.preventDefault();const kind=$('#noteKind').value,text=$('#noteText').value.trim();if(!text&&kind!=='marker'){toast('Escreva algo antes de salvar.');return;}notes.unshift({id:id(),kind,text,bookId:currentBook?.id,bookTitle:currentBook?.title||'Livro',page:currentBook?.ext==='pdf'?currentPdfPage:null,created:Date.now()});await saveData('notes',notes);$('#noteDialog').close();renderNotes();toast('Anotação salva.');});
$('#themeBtn').onclick=()=>{const order=['light','sepia','dark'];const current=document.body.dataset.theme||'light';setTheme(order[(order.indexOf(current)+1)%order.length]);};
$('#readerTheme').onclick=()=>$('#themeBtn').click();
function setTheme(t){document.body.dataset.theme=t;localStorage.setItem('bibliotheca-theme',t);$$('.theme-choice').forEach(b=>b.style.borderColor=b.dataset.theme===t?'var(--accent)':'var(--line)');}
$$('.theme-choice').forEach(b=>b.onclick=()=>setTheme(b.dataset.theme));
$$('.accent-dot').forEach(b=>b.onclick=()=>{document.documentElement.style.setProperty('--accent',b.dataset.accent);localStorage.setItem('bibliotheca-accent',b.dataset.accent);});
$('#saveGoal').onclick=async()=>{await saveData('goal',Number($('#goalInput').value)||30);awaitlessReadGoal=Number($('#goalInput').value)||30;renderStats();toast('Meta diária salva.');};
$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({books:books.map(({id,title,author,ext,status,progress,added,lastOpened})=>({id,title,author,ext,status,progress,added,lastOpened})),notes,sessions,goal:awaitlessReadGoal},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bibliotheca-backup.json';a.click();URL.revokeObjectURL(a.href);};
async function init(){
 try{db=await openDB();books=await readData('books',[]);notes=await readData('notes',[]);sessions=await readData('sessions',[]);awaitlessReadGoal=await readData('goal',30);setTheme(localStorage.getItem('bibliotheca-theme')||'light');const accent=localStorage.getItem('bibliotheca-accent');if(accent)document.documentElement.style.setProperty('--accent',accent);renderBooks();renderNotes();renderStats();}
 catch(e){toast('Seu navegador não permitiu iniciar o armazenamento local.');console.error(e);}
}
if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
init();