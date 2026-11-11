/* Anona — service worker (funcionamento offline + atualização automática).
 *
 * ATENÇÃO: este arquivo precisa ser JavaScript. Na cópia recebida para revisão ele continha o HTML do index.html
 * (provavelmente um upload trocado no GitHub): o navegador recusava registrá-lo e o app nunca ficava instalável/offline.
 *
 * Como funciona:
 *  - instalação: guarda o "esqueleto" do app (HTML, CSS, scripts locais, ícones) e as bibliotecas externas
 *    (jsPDF, pdf-lib, JSZip, xlsx-js-style, lucide, Firebase), para PDFs/planilhas/anotações funcionarem sem internet;
 *  - index.html: tenta a rede primeiro (versão mais nova); se demorar mais de 4 s ou não houver internet, usa a cópia guardada;
 *  - demais arquivos: usa a cópia guardada na hora e atualiza em segundo plano;
 *  - só guarda respostas válidas (200 OK, ou "opaca" das bibliotecas carregadas por <script>): página de erro nunca entra no cache;
 *  - Firestore/Auth/Gemini NÃO passam por aqui (dados e login sempre direto na rede).
 * Para forçar todo mundo a baixar tudo de novo, aumente o número de CACHE_NAME.
 */
const CACHE_NAME = 'anona-app-shell-v37';
const PREFIXOS_ANTIGOS = ['anona-app-shell-', 'pbf-app-shell-'];

const ARQUIVOS_LOCAIS = [
  './', 'index.html', 'styles.css', 'manifest.json',
  'anona-tabelas.js', 'anona-rota.js', 'anona-mascot.js', 'anona-presenca.js', 'paulus.v1.js', 'paulus-anona.js', 'conhecimento.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];
const BIBLIOTECAS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@0.469.0',
  'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js'
];
// Hosts de bibliotecas/fontes que podem ser guardados no cache durante o uso.
const HOSTS_CACHEAVEIS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const respostaBoa = (res) => !!res && (res.status === 200 || res.type === 'opaque');

async function guardar(cache, req, res) {
  try { if (respostaBoa(res)) await cache.put(req, res.clone()); } catch (e) { /* cota cheia etc.: segue sem guardar */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Um arquivo que falhe (ex.: ícone ausente, CDN fora do ar) NÃO pode travar a instalação inteira.
    await Promise.all(ARQUIVOS_LOCAIS.map(async (url) => {
      try { const req = new Request(url, { cache: 'reload' }); const res = await fetch(req); if (res.status === 200) await cache.put(url, res); } catch (e) {}
    }));
    await Promise.all(BIBLIOTECAS.map(async (url) => {
      try {
        // Scripts comuns (<script src>) são pedidos sem CORS; os módulos do Firebase, com CORS. Tenta o modo que a página usa.
        const modulo = url.includes('gstatic.com/firebasejs');
        const res = await fetch(url, modulo ? { mode: 'cors' } : { mode: 'no-cors' });
        await guardar(cache, url, res);
      } catch (e) {}
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== CACHE_NAME && PREFIXOS_ANTIGOS.some(p => n.startsWith(p))).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Rede primeiro, com limite de tempo: conexão lenta em campo não deixa a tela esperando.
async function redePrimeiro(req, chaveCache) {
  const cache = await caches.open(CACHE_NAME);
  const rede = fetch(req).then(async (res) => { if (res && res.status === 200) await guardar(cache, chaveCache, res); return res; });
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  try {
    const res = await Promise.race([rede, limite]);
    if (res && res.status === 200) return res;
    const guardado = await cache.match(chaveCache);
    if (guardado) { rede.catch(() => {}); return guardado; }   // a busca continua em segundo plano e atualiza o cache
    return res || await rede;
  } catch (e) {
    const guardado = await cache.match(chaveCache);
    if (guardado) return guardado;
    throw e;
  }
}

async function guardadoPrimeiro(req) {
  const cache = await caches.open(CACHE_NAME);
  const guardado = await cache.match(req);
  const atualizar = fetch(req).then(async (res) => { await guardar(cache, req, res); return res; });
  if (guardado) { atualizar.catch(() => {}); return guardado; }
  return atualizar;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;
  if (!mesmaOrigem && !HOSTS_CACHEAVEIS.includes(url.hostname)) return;     // Firestore, Auth, Gemini etc.: direto na rede
  if (mesmaOrigem && req.mode === 'navigate') { event.respondWith(redePrimeiro(req, 'index.html')); return; }
  if (mesmaOrigem && /\/(index\.html)?$/.test(url.pathname)) { event.respondWith(redePrimeiro(req, 'index.html')); return; }
  event.respondWith(guardadoPrimeiro(req).catch(() => caches.match(req).then(r => r || Response.error())));
});
