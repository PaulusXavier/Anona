/* Anona — "Mapa e rotas": procura de endereços (como no Google Maps) e rota a partir da posição do aparelho.
 * Mapa: Leaflet (vendor/leaflet, carregado só quando a seção aparece) + OpenStreetMap.
 * Busca de endereço: Nominatim. Rota: routing.openstreetmap.de (OSRM). Não precisa de chave.
 * Só o texto do endereço digitado e as coordenadas (posição/destino) saem do aparelho; nada é guardado. */
(function () {
  'use strict';
  const sec = document.getElementById('mapaRotas');
  if (!sec) return;
  const $ = (id) => document.getElementById(id);

  const PARTIDA = { rotulo: 'Rua Santo Agostinho, 193 — Centenário, Boa Vista/RR', consulta: 'Rua Santo Agostinho 193, Centenário, Boa Vista, Roraima' };
  const CENTRO = [2.8235, -60.6758];                 // Boa Vista/RR
  const VIEWBOX = '-60.85,2.95,-60.55,2.70';         // esquerda,topo,direita,base: dá preferência a Boa Vista (não limita a busca)
  const PERFIS = {
    carro: { caminho: 'routed-car', google: 'driving' },
    pe:    { caminho: 'routed-foot', google: 'walking' },
    bike:  { caminho: 'routed-bike', google: 'bicycling' }
  };
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const ROTAS = 'https://routing.openstreetmap.de';

  let L = null, mapa = null, camadaRota = null, mDestino = null, mOrigem = null, mPos = null, circPos = null;
  let posicao = null;            // { lat, lng, precisao }
  let destino = null;            // { lat, lng, rotulo }
  let partidaCache = null;       // coordenadas do endereço de partida padrão (só nesta sessão)
  let modo = lerPref('anonaMapaModo', 'carro'); if (!PERFIS[modo]) modo = 'carro';
  let senha = 0;                 // descarta respostas antigas quando o usuário já pediu outra coisa
  let promessaLeaflet = null, ultimoNominatim = 0;

  function lerPref(k, f) { try { return localStorage.getItem(k) || f; } catch (e) { return f; } }
  function gravarPref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento: tudo bem */ } }

  function status(msg, tipo) {
    const el = $('mapaStatus'); if (!el) return;
    el.textContent = msg || '';
    el.className = 'mp-status' + (tipo ? ' is-' + tipo : '') + (msg ? '' : ' hidden');
  }
  const ocupado = (sim) => { sec.classList.toggle('is-busy', !!sim); sec.setAttribute('aria-busy', sim ? 'true' : 'false'); };
  const iconesRefresh = () => { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* ícones são só enfeite */ } };

  // ---------- Leaflet (carregado só quando preciso) ----------
  function carregarLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (promessaLeaflet) return promessaLeaflet;
    promessaLeaflet = new Promise((ok, falha) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js';
      js.onload = () => (window.L && window.L.map) ? ok(window.L) : falha(new Error('Leaflet inválido'));
      js.onerror = () => { promessaLeaflet = null; falha(new Error('Não consegui carregar o mapa. Confira a internet.')); };
      document.head.appendChild(js);
    });
    return promessaLeaflet;
  }

  function icone(classe, tam) { return L.divIcon({ className: 'mp-pino ' + classe, iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2], html: '<span></span>' }); }

  async function garantirMapa() {
    if (mapa) return mapa;
    L = await carregarLeaflet();
    if (mapa) return mapa;
    mapa = L.map('mapaCanvas', { zoomControl: false }).setView(CENTRO, 13);
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(mapa);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · rotas: OSRM'
    }).addTo(mapa);
    mapa.on('click', (e) => escolherNoMapa(e.latlng.lat, e.latlng.lng));
    setTimeout(() => mapa.invalidateSize(), 150);
    return mapa;
  }

  // ---------- Nominatim (máx. 1 pedido por segundo) ----------
  async function nominatim(caminho, params) {
    const espera = ultimoNominatim + 1100 - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimoNominatim = Date.now();
    const url = NOMINATIM + caminho + '?' + new URLSearchParams(Object.assign({ format: 'jsonv2', 'accept-language': 'pt-BR' }, params));
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('O serviço de busca respondeu com erro (' + r.status + ').');
      return await r.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('A busca demorou demais. Tente de novo.');
      if (e instanceof TypeError) throw new Error('Sem conexão com o serviço de busca. Confira a internet.');
      throw e;
    } finally { clearTimeout(t); }
  }
  const buscarEndereco = (q) => nominatim('/search', { q, limit: 6, countrycodes: 'br', viewbox: VIEWBOX, addressdetails: 1 });
  const buscarCoordenada = (lat, lng) => nominatim('/reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: 18 });

  function rotuloCurto(r) {
    const a = r.address || {};
    const via = a.road || a.pedestrian || a.footway || a.path || a.suburb || '';
    const num = a.house_number ? ', ' + a.house_number : '';
    const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
    const cidade = a.city || a.town || a.village || a.municipality || '';
    const partes = [via + num, bairro && bairro !== via ? bairro : '', cidade].filter(Boolean);
    return partes.length >= 2 ? partes.join(' — ') : String(r.display_name || '').split(',').slice(0, 3).join(',').trim();
  }

  // ---------- origem ----------
  function lerPosicao() {
    return new Promise((ok, falha) => {
      if (!navigator.geolocation) return falha(new Error('Este aparelho/navegador não informa a localização.'));
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy || 0 }),
        (e) => falha(new Error(e && e.code === 1 ? 'A localização foi negada. Permita o acesso à localização no navegador (ícone de cadeado, ao lado do endereço) ou escolha outro ponto de partida.'
          : e && e.code === 3 ? 'Não consegui obter sua posição a tempo. Vá para um local aberto e tente de novo.'
          : 'Não consegui obter sua posição agora.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  async function mostrarPosicao(p) {
    await garantirMapa();
    if (mPos) mapa.removeLayer(mPos); if (circPos) mapa.removeLayer(circPos);
    circPos = L.circle([p.lat, p.lng], { radius: Math.min(p.precisao || 0, 2000), color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(mapa);
    mPos = L.marker([p.lat, p.lng], { icon: icone('mp-pino-pos', 18), keyboard: false, interactive: false }).addTo(mapa);
  }

  async function usarMinhaPosicao(centralizar) {
    status('Obtendo a sua posição…'); ocupado(true);
    try {
      posicao = await lerPosicao();
      await mostrarPosicao(posicao);
      if (centralizar) mapa.setView([posicao.lat, posicao.lng], 16);
      const m = posicao.precisao ? ' (precisão de cerca de ' + Math.round(posicao.precisao) + ' m)' : '';
      status('Posição encontrada' + m + '.', 'ok');
      return posicao;
    } finally { ocupado(false); }
  }

  async function obterOrigem() {
    const tipo = $('mapaOrigem').value;
    if (tipo === 'pos') {
      const p = posicao || await usarMinhaPosicao(false);
      return { lat: p.lat, lng: p.lng, rotulo: 'Minha posição' };
    }
    if (tipo === 'partida') {
      if (!partidaCache) {
        const r = await buscarEndereco(PARTIDA.consulta);
        if (!r.length) throw new Error('Não consegui localizar o endereço de partida no mapa. Use "Outro endereço".');
        partidaCache = { lat: +r[0].lat, lng: +r[0].lon, rotulo: PARTIDA.rotulo };
      }
      return partidaCache;
    }
    const txt = ($('mapaOrigemTexto').value || '').trim();
    if (!txt) throw new Error('Digite o endereço de partida.');
    const r = await buscarEndereco(txt);
    if (!r.length) throw new Error('Não encontrei o endereço de partida "' + txt + '".');
    return { lat: +r[0].lat, lng: +r[0].lon, rotulo: rotuloCurto(r[0]) || txt };
  }

  // ---------- destino ----------
  async function marcarDestino(d) {
    destino = d;
    await garantirMapa();
    if (mDestino) mapa.removeLayer(mDestino);
    mDestino = L.marker([d.lat, d.lng], { icon: icone('mp-pino-dest', 26), title: d.rotulo, keyboard: false }).addTo(mapa);
    $('mapaDestinoTexto').textContent = d.rotulo;
    $('mapaDestinoBox').classList.remove('hidden');
  }

  async function escolherDestino(d) {
    await marcarDestino(d);
    mapa.setView([d.lat, d.lng], Math.max(mapa.getZoom(), 16));
    await tracarRota();
  }

  async function escolherNoMapa(lat, lng) {
    const minha = ++senha;
    await marcarDestino({ lat, lng, rotulo: lat.toFixed(5) + ', ' + lng.toFixed(5) });
    status('Procurando o endereço desse ponto…'); ocupado(true);
    try {
      const r = await buscarCoordenada(lat, lng);
      if (minha === senha && r && (r.address || r.display_name)) { destino.rotulo = rotuloCurto(r) || destino.rotulo; $('mapaDestinoTexto').textContent = destino.rotulo; }
    } catch (e) { /* mantém as coordenadas como nome; a rota ainda funciona */ }
    finally { ocupado(false); }
    if (minha === senha) await tracarRota();
  }

  // ---------- busca ----------
  function listarResultados(rs) {
    const ul = $('mapaResultados'); ul.textContent = '';
    if (rs.length < 2) { ul.classList.add('hidden'); return; }
    rs.slice(1).forEach((r) => {
      const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button';
      b.textContent = rotuloCurto(r) || r.display_name;
      b.addEventListener('click', () => { senha++; ul.classList.add('hidden'); escolherDestino({ lat: +r.lat, lng: +r.lon, rotulo: b.textContent }).catch(mostrarErro); });
      li.appendChild(b); ul.appendChild(li);
    });
    const t = document.createElement('li'); t.className = 'mp-res-titulo'; t.textContent = 'Outros resultados'; ul.insertBefore(t, ul.firstChild);
    ul.classList.remove('hidden');
  }

  async function buscar(ev) {
    ev.preventDefault();
    const q = ($('mapaBusca').value || '').trim();
    if (q.length < 3) { status('Digite o endereço (rua, número, bairro) para buscar.', 'erro'); return; }
    const minha = ++senha;
    status('Procurando o endereço…'); ocupado(true);
    try {
      await garantirMapa();
      const rs = await buscarEndereco(q);
      if (minha !== senha) return;
      if (!rs.length) { listarResultados([]); status('Não encontrei esse endereço. Tente só a rua e o bairro (ex.: "Rua Santo Agostinho, Centenário") ou toque no mapa para marcar o ponto.', 'erro'); return; }
      listarResultados(rs);
      await escolherDestino({ lat: +rs[0].lat, lng: +rs[0].lon, rotulo: rotuloCurto(rs[0]) || q });
    } catch (e) { mostrarErro(e); }
    finally { ocupado(false); }
  }

  // ---------- rota ----------
  const MOD = { left: 'à esquerda', right: 'à direita', 'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita',
    'sharp left': 'fechando à esquerda', 'sharp right': 'fechando à direita', straight: 'em frente', uturn: 'e faça o retorno' };
  function instrucao(s) {
    const m = s.maneuver || {}, nome = s.name ? ' em ' + s.name : '', mod = MOD[m.modifier] || '';
    switch (m.type) {
      case 'depart': return 'Siga' + (s.name ? ' por ' + s.name : '') + (mod && m.modifier !== 'straight' ? ' ' + mod : '');
      case 'arrive': return 'Você chegou ao destino' + (m.modifier === 'left' ? ' (à esquerda)' : m.modifier === 'right' ? ' (à direita)' : '');
      case 'turn': case 'end of road': return (m.type === 'end of road' ? 'No fim da via, vire ' : 'Vire ') + (mod || 'em frente') + nome;
      case 'fork': return 'Mantenha-se ' + (mod || 'em frente') + nome;
      case 'merge': return 'Entre' + (s.name ? ' em ' + s.name : '') + (mod ? ' ' + mod : '');
      case 'on ramp': case 'off ramp': return 'Pegue a ' + (m.type === 'on ramp' ? 'entrada' : 'saída') + (mod ? ' ' + mod : '') + nome;
      case 'roundabout': case 'rotary': return 'Na rotatória, pegue a ' + (m.exit || '') + 'ª saída' + (s.name ? ' para ' + s.name : '');
      case 'roundabout turn': return 'Na rotatória, vire ' + (mod || 'em frente') + nome;
      case 'exit roundabout': case 'exit rotary': return 'Saia da rotatória' + (s.name ? ' para ' + s.name : '');
      default: return 'Continue' + (s.name ? ' por ' + s.name : ' em frente');
    }
  }
  const fmtDist = (m) => m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
  function fmtTempo(s) {
    const min = Math.max(1, Math.round(s / 60));
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + String(min % 60).padStart(2, '0') + ' min' : '');
  }

  async function tracarRota() {
    if (!destino) return;
    const minha = ++senha;
    status('Traçando a rota…'); ocupado(true);
    try {
      const o = await obterOrigem();
      if (minha !== senha) return;
      await garantirMapa();
      const perfil = PERFIS[modo];
      const url = `${ROTAS}/${perfil.caminho}/route/v1/driving/${o.lng},${o.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&steps=true`;
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      let dados;
      try {
        const r = await fetch(url, { signal: ctl.signal });
        dados = await r.json().catch(() => null);
        if (!r.ok && !(dados && dados.code)) throw new Error('O serviço de rotas respondeu com erro (' + r.status + ').');
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('O cálculo da rota demorou demais. Tente de novo.');
        if (e instanceof TypeError) throw new Error('Sem conexão com o serviço de rotas. Confira a internet.');
        throw e;
      } finally { clearTimeout(t); }
      if (minha !== senha) return;
      if (!dados || dados.code !== 'Ok' || !dados.routes || !dados.routes.length) {
        limparRota();
        throw new Error(dados && dados.code === 'NoRoute' ? 'Não achei caminho entre os dois pontos para esse meio de transporte.' : 'Não consegui traçar a rota agora.');
      }
      desenharRota(o, dados.routes[0]);
      status('');
    } catch (e) { mostrarErro(e); }
    finally { if (minha === senha) ocupado(false); }
  }

  function limparRota() {
    if (camadaRota) { mapa.removeLayer(camadaRota); camadaRota = null; }
    if (mOrigem) { mapa.removeLayer(mOrigem); mOrigem = null; }
    $('mapaResumo').classList.add('hidden'); $('mapaPassos').textContent = '';
  }

  function desenharRota(o, rota) {
    limparRota();
    const pontos = rota.geometry.coordinates.map(c => [c[1], c[0]]);
    camadaRota = L.layerGroup([
      L.polyline(pontos, { color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }),
      L.polyline(pontos, { color: '#146B47', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' })
    ]).addTo(mapa);
    if (o.rotulo !== 'Minha posição') mOrigem = L.marker([o.lat, o.lng], { icon: icone('mp-pino-orig', 16), title: o.rotulo, keyboard: false }).addTo(mapa);
    $('mapaDist').textContent = fmtDist(rota.distance);
    $('mapaTempo').textContent = fmtTempo(rota.duration);
    $('mapaDeAte').textContent = o.rotulo + ' → ' + destino.rotulo;
    $('mapaGoogle').href = 'https://www.google.com/maps/dir/?api=1&origin=' + o.lat + ',' + o.lng + '&destination=' + destino.lat + ',' + destino.lng + '&travelmode=' + PERFIS[modo].google;
    const ol = $('mapaPassos'); ol.textContent = '';
    ((rota.legs && rota.legs[0] && rota.legs[0].steps) || []).forEach((s) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = instrucao(s);
      li.appendChild(a);
      if (s.distance && s.maneuver && s.maneuver.type !== 'arrive') { const d = document.createElement('small'); d.textContent = fmtDist(s.distance); li.appendChild(d); }
      ol.appendChild(li);
    });
    $('mapaResumo').classList.remove('hidden');
    if (cheia && MOBILE()) recolherMais(true);
    mapa.fitBounds(L.latLngBounds(pontos), margens());
  }

  function mostrarErro(e) { status((e && e.message) || 'Algo deu errado.', 'erro'); ocupado(false); }

  function limparTudo() {
    senha++;
    destino = null;
    if (mapa) { if (mDestino) { mapa.removeLayer(mDestino); mDestino = null; } limparRota(); }
    $('mapaBusca').value = ''; $('mapaResultados').classList.add('hidden'); $('mapaDestinoBox').classList.add('hidden');
    status(''); ocupado(false);
  }

  // ---------- ligações ----------
  function definirModo(m) {
    modo = m; gravarPref('anonaMapaModo', m);
    sec.querySelectorAll('[data-modo]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modo === m ? 'true' : 'false'));
  }
  definirModo(modo);
  sec.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => { definirModo(b.dataset.modo); if (destino) tracarRota(); }));

  const selOrigem = $('mapaOrigem');
  const origemSalva = lerPref('anonaMapaOrigem', 'pos');
  if (['pos', 'partida', 'outro'].includes(origemSalva)) selOrigem.value = origemSalva;
  const ajustarOrigem = () => $('mapaOrigemBox').classList.toggle('hidden', selOrigem.value !== 'outro');
  ajustarOrigem();
  selOrigem.addEventListener('change', () => { gravarPref('anonaMapaOrigem', selOrigem.value); ajustarOrigem(); if (selOrigem.value === 'outro') $('mapaOrigemTexto').focus(); else if (destino) tracarRota(); });
  $('mapaOrigemTexto').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (destino) tracarRota(); } });



  // ---------- tela cheia (CSS + API de tela cheia do navegador; o botão Voltar do Android também sai) ----------
  let cheia = false, viaApi = false, saindo = false;
  const MOBILE = () => window.matchMedia('(max-width: 1023px)').matches;
  const ajustarMapa = () => { if (mapa) setTimeout(() => { mapa.invalidateSize(); }, 80); };
  function recolherMais(sim) { const m = sec.querySelector('.mp-mais'); m.classList.toggle('is-recolhido', !!sim); $('mapaMais').setAttribute('aria-expanded', sim ? 'false' : 'true'); }
  function margens() {
    if (!cheia) return { padding: [30, 30] };
    const topo = sec.querySelector('.mp-topo').offsetHeight, base = sec.querySelector('.mp-base').offsetHeight;
    if (MOBILE()) return { paddingTopLeft: [24, topo + 16], paddingBottomRight: [24, base + 16] };
    return { paddingTopLeft: [sec.querySelector('.mp-topo').offsetWidth + 40, 30], paddingBottomRight: [30, 30] };
  }
  function entrarCheia() {
    if (cheia) return;
    cheia = true;
    sec.classList.add('is-tela-cheia'); document.documentElement.classList.add('mp-sem-rolagem');
    $('mapaTelaCheia').setAttribute('aria-pressed', 'true'); $('mapaSairCheia').classList.remove('hidden');
    recolherMais(MOBILE()); $('mapaMais').classList.remove('hidden');
    $('mapaResumo').classList.add('is-passos-fechados'); $('mapaPassosBtn').setAttribute('aria-expanded', 'false');
    try { history.pushState({ anonaMapaCheia: 1 }, ''); } catch (e) { /* sem histórico: o botão Sair continua funcionando */ }
    try { if (sec.requestFullscreen) sec.requestFullscreen({ navigationUI: 'hide' }).then(() => { viaApi = true; }).catch(() => {}); } catch (e) { /* só a versão em CSS */ }
    garantirMapa().then(ajustarMapa).catch(() => {}); ajustarMapa();
  }
  function fecharCheia() {
    if (!cheia) return;
    cheia = false; saindo = false;
    sec.classList.remove('is-tela-cheia'); document.documentElement.classList.remove('mp-sem-rolagem');
    $('mapaTelaCheia').setAttribute('aria-pressed', 'false'); $('mapaSairCheia').classList.add('hidden'); $('mapaMais').classList.add('hidden');
    sec.querySelector('.mp-mais').classList.remove('is-recolhido');
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* já saiu */ } }
    viaApi = false; ajustarMapa();
    try { sec.scrollIntoView({ block: 'start' }); } catch (e) { /* sem rolagem automática */ }
  }
  function sairCheia() {
    if (!cheia || saindo) return;
    saindo = true;   // Esc/Voltar/botão podem chegar juntos: só um history.back()
    if (history.state && history.state.anonaMapaCheia) history.back();   // dispara o popstate abaixo, que fecha
    else fecharCheia();
  }
  $('mapaTelaCheia').addEventListener('click', () => (cheia ? sairCheia() : entrarCheia()));
  $('mapaSairCheia').addEventListener('click', sairCheia);
  $('mapaMais').addEventListener('click', () => recolherMais(!sec.querySelector('.mp-mais').classList.contains('is-recolhido')));
  $('mapaPassosBtn').addEventListener('click', () => { const f = $('mapaResumo').classList.toggle('is-passos-fechados'); $('mapaPassosBtn').setAttribute('aria-expanded', f ? 'false' : 'true'); });
  window.addEventListener('popstate', fecharCheia);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cheia) sairCheia(); });
  document.addEventListener('fullscreenchange', () => { if (cheia && viaApi && !document.fullscreenElement) sairCheia(); else ajustarMapa(); });
  window.addEventListener('resize', ajustarMapa); window.addEventListener('orientationchange', ajustarMapa);
  // o painel de baixo cobre a atribuição do mapa: sobe os controles do Leaflet acima dele
  if ('ResizeObserver' in window) new ResizeObserver(() => sec.style.setProperty('--mp-base-h', (sec.querySelector('.mp-base').offsetHeight + 8) + 'px')).observe(sec.querySelector('.mp-base'));

  // ---------- voz (Web Speech API do navegador; pt-BR) ----------
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;

  // "ir para rua santo agostinho número 193 bairro centenário" -> "Rua santo agostinho, 193, centenário"
  function limparFala(t) {
    let s = String(t || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(?:por favor[, ]+)?(?:ir|vá|va|levar|leve|me leve|navegar|navegue|traçar|trace|rota|buscar|busque|procurar|procure|endereço|destino)(?:\s+(?:até|ate|para|pra|a|o|ao|na|no|de|do|da))*\s+/i, '');
    s = s.replace(/\s*\b(?:n[úu]mero|n[º°]\.?)\s*(?=\d)/gi, ', ').replace(/\s+\b(?:n[úu]mero)\b\s*/gi, ', ');
    s = s.replace(/\s+bairro\s+/gi, ', ').replace(/\s*,(\s*,)+/g, ',').replace(/\s+,/g, ',').replace(/[.\s]+$/, '').replace(/^[\s,]+/, '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  const ERROS_VOZ = {
    'not-allowed': 'O microfone foi negado. Permita o acesso ao microfone no navegador (ícone de cadeado, ao lado do endereço).',
    'service-not-allowed': 'O navegador não liberou o reconhecimento de voz. Permita o microfone ou digite o endereço.',
    'no-speech': 'Não ouvi nada. Toque no microfone e fale o endereço de novo.',
    'audio-capture': 'Não encontrei um microfone neste aparelho.',
    'network': 'O reconhecimento de voz precisa de internet. Confira a conexão ou digite o endereço.',
    'language-not-supported': 'Este navegador não reconhece português por voz. Digite o endereço.'
  };

  function ligarVoz(btn, input, aoTerminar) {
    if (!btn || !input) return;
    if (!Reconhecimento) { btn.classList.add('hidden'); return; }   // ex.: Firefox: só digitando
    let rec = null, ativo = false;
    btn.addEventListener('click', () => {
      if (ativo && rec) { try { rec.stop(); } catch (e) { /* já parou */ } return; }
      let final = '', erro = '';
      try {
        rec = new Reconhecimento();
        rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      } catch (e) { status('Não consegui iniciar o microfone. Digite o endereço.', 'erro'); return; }
      rec.onstart = () => { ativo = true; btn.setAttribute('aria-pressed', 'true'); btn.classList.add('is-ouvindo'); status('Ouvindo… diga o endereço (ex.: "Rua Santo Agostinho, 193, Centenário").'); };
      rec.onresult = (e) => {
        let txt = '', ok = false;
        for (let i = 0; i < e.results.length; i++) { txt += e.results[i][0].transcript; if (e.results[i].isFinal) ok = true; }
        input.value = txt;
        if (ok) final = limparFala(txt) || txt.trim();
      };
      rec.onerror = (e) => { erro = ERROS_VOZ[e && e.error] || (e && e.error === 'aborted' ? '' : 'Não consegui entender. Tente de novo ou digite o endereço.'); };
      rec.onend = () => {
        ativo = false; btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('is-ouvindo');
        if (erro) { status(erro, 'erro'); return; }
        if (final) { input.value = final; status(''); if (aoTerminar) aoTerminar(final); }
        else status('Não ouvi nenhum endereço. Toque no microfone e tente de novo.', 'erro');
      };
      try { rec.start(); } catch (e) { status('Não consegui iniciar o microfone agora. Tente de novo.', 'erro'); }
    });
  }
  ligarVoz($('mapaVoz'), $('mapaBusca'), () => { const f = $('mapaForm'); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true })); });
  ligarVoz($('mapaVozOrigem'), $('mapaOrigemTexto'), () => { if (destino) tracarRota(); });

  $('mapaForm').addEventListener('submit', buscar);
  $('mapaMinhaPos').addEventListener('click', async () => {
    try { await garantirMapa(); await usarMinhaPosicao(true); selOrigem.value = 'pos'; ajustarOrigem(); gravarPref('anonaMapaOrigem', 'pos'); if (destino) await tracarRota(); }
    catch (e) { mostrarErro(e); }
  });
  $('mapaLimpar').addEventListener('click', limparTudo);

  // carrega o mapa só quando a seção chega perto da tela
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some(x => x.isIntersecting)) { io.disconnect(); garantirMapa().catch(() => {}); } }, { rootMargin: '300px' });
    io.observe(sec);
  } else garantirMapa().catch(() => {});
  iconesRefresh();

  window.AnonaMapa = { _teste: { instrucao, fmtDist, fmtTempo, rotuloCurto, limparFala } };
})();
