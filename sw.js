// Service worker: guarda o "esqueleto" do app (HTML, manifest, ícones) E as
// bibliotecas externas usadas (Tailwind, ícones, jsPDF, xlsx, fontes do
// Google) para o app funcionar 100% OFFLINE depois da primeira vez que for
// aberto com internet.
//
// Estratégia:
// - Página (index.html): tenta buscar a versão mais nova na rede primeiro
//   (para o app se atualizar sozinho quando você publica uma mudança);
//   se não tiver internet, usa a cópia guardada.
// - Arquivos do próprio site e bibliotecas externas confiáveis (Tailwind,
//   unpkg, jsdelivr, fontes Google): mostra a cópia guardada na hora
//   (rápido/offline) e atualiza em segundo plano quando há internet.
// - Chamadas do Firebase (login/notas) NÃO passam pelo cache — o próprio
//   Firebase cuida da parte offline delas (fica guardado no IndexedDB).
//
// Dica: se um dia quiser forçar todo mundo a baixar tudo de novo do zero
// (trocou ícones, nomes de arquivo etc.), só mudar o número da versão
// abaixo (v3 -> v4...). Para atualizações normais de conteúdo do
// index.html isso NÃO é necessário.
const CACHE_NAME = "pbf-app-shell-v13";

// Arquivos do próprio site que são ESSENCIAIS: sem eles o app não tem como
// funcionar offline, então se algum faltar o install falha mesmo (são
// poucos e sempre devem existir).
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json"
];

// Imagens do próprio site: importantes para a aparência do app (ícone da
// tela inicial, logo nas telas de senha/login), mas NÃO essenciais para o
// funcionamento — por isso são "melhor esforço" (ver mais abaixo), igual
// às bibliotecas externas. Assim, se um ícone estiver com o nome errado ou
// faltando no repositório, isso não derruba o app offline inteiro; só essa
// imagem específica não aparece.
const SHELL_IMAGES = [
  "./icon-192.png",
  "./icon-512.png"
];

// Bibliotecas externas usadas pelo app — sem elas o app perde estilo,
// ícones ou a exportação de PDF quando está offline.
const EXTERNAL_FILES = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/lucide@0.469.0",
  "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js",
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;0,700;1,600&family=Inter:wght@400;500;600;700;800&display=swap"
];

// Hosts externos que podem ser guardados em cache normalmente (bibliotecas
// e fontes). Tudo que não é do próprio site nem está nesta lista (ex:
// domínios do Firebase) passa direto pela rede, sem cache.
const RUNTIME_CACHEABLE_HOSTS = [
  "cdn.tailwindcss.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Arquivos essenciais do próprio site: se algum falhar, o install
      // falha (ok, são poucos e sempre devem existir).
      await cache.addAll(SHELL_FILES);

      // Imagens do site e bibliotecas externas: baixa cada uma por conta
      // própria e ignora silenciosamente qualquer uma que falhar (ícone
      // com nome errado, CDN fora do ar etc.), para não travar a
      // instalação do app inteiro por causa de UM arquivo que faltou.
      await Promise.allSettled(
        SHELL_IMAGES.map((url) =>
          fetch(url).then((res) => cache.put(url, res))
        )
      );
      await Promise.allSettled(
        EXTERNAL_FILES.map((url) =>
          fetch(url, { mode: "no-cors" }).then((res) => cache.put(url, res))
        )
      );
    })
  );
  // Faz a nova versão do service worker ficar pronta imediatamente.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Permite que a página peça para o service worker "novo" assumir o
// controle na hora (usado pelo index.html para recarregar sozinho).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCacheableExternal = RUNTIME_CACHEABLE_HOSTS.includes(url.hostname);

  // Não é do próprio site nem é uma biblioteca conhecida (ex: chamadas do
  // Firebase para login/notas) -> deixa passar direto pela rede. O próprio
  // Firebase guarda uma cópia offline dessas informações sozinho.
  if (!isSameOrigin && !isCacheableExternal) {
    return;
  }

  const isPageRequest =
    isSameOrigin &&
    (req.mode === "navigate" ||
      (req.headers.get("accept") || "").includes("text/html") ||
      url.pathname.endsWith("/index.html"));

  if (isPageRequest) {
    // NETWORK-FIRST: sempre tenta buscar a página mais nova primeiro. Isso
    // é o que faz o app se atualizar sozinho quando você publica uma
    // mudança. Sem internet, cai para a cópia guardada.
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return response;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  // Demais arquivos (ícones, manifest, Tailwind, lucide, jsPDF, fontes):
  // mostra a cópia guardada na hora (funciona offline) e atualiza o cache
  // em segundo plano quando há internet.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req, isSameOrigin ? {} : { mode: "no-cors" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
