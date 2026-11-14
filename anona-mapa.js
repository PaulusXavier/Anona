/* Anona — "Mapa e rotas": procura de endereços (como no Google Maps) e rota a partir da posição do aparelho.
 * Mapa: Leaflet (vendor/leaflet, carregado só quando a seção aparece) + OpenStreetMap.
 * Busca de endereço: Nominatim. Rota: routing.openstreetmap.de (OSRM). Não precisa de chave.
 * Com internet, só o texto do endereço digitado e as coordenadas (posição/destino) saem do aparelho; nada é guardado.
 * OFFLINE: depois de "Baixar mapa offline" (anona-mapa-offline.js: ruas de Boa Vista guardadas no aparelho), a busca, o
 * toque no mapa, a rota com passo a passo e o desenho das ruas funcionam sem internet — automaticamente quando a rede
 * falha, ou sempre, se o usuário marcar "Usar sempre o mapa offline". */
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
  const AMO = window.AnonaMapaOffline || null;
  let motor = null;              // mapa offline carregado (ou null)
  let camadaTiles = null, vetor = null, ClasseVetor = null, vetorAuto = false, errosTile = 0, baixando = null;
  let sempreOffline = lerPref('anonaMapaSempreOffline', '0') === '1';
  let avisoDestino = '';         // ex.: "o número 193 não está no mapa offline"
  const PARTIDA_CHAVE = 'anonaMapaPartida';
  const usarOffline = () => !!motor && (sempreOffline || navigator.onLine === false);
  const DICA_OFFLINE = ' Dica: baixe o mapa offline (em "Partida, posição e mapa offline") para usar sem internet.';

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
    mapa.createPane('vetor').style.zIndex = 150;     // abaixo dos blocos do mapa: aparece quando os blocos não carregam (sem internet)
    camadaTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · rotas: OSRM'
    }).addTo(mapa);
    camadaTiles.on('tileload', (e) => { if (e.tile) e.tile.style.visibility = ''; });
    camadaTiles.on('tileerror', (e) => {
      if (e.tile) e.tile.style.visibility = 'hidden';          // bloco que falhou fica transparente: as ruas offline aparecem por baixo
      if (!motor || vetorAuto) return;
      if (++errosTile === 1) setTimeout(() => { errosTile = 0; }, 8000);
      if (errosTile >= 3) { vetorAuto = true; aplicarModoMapa(); ofertaUI(); }
    });
    aplicarModoMapa();
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
      let er = e;
      if (e && e.name === 'AbortError') er = new Error('A busca demorou demais. Tente de novo.');
      else if (e instanceof TypeError) er = new Error('Sem conexão com o serviço de busca. Confira a internet.');
      if (er && typeof er === 'object') er.rede = true;     // qualquer falha aqui = serviço fora do ar/sem rede → vale tentar o mapa offline
      throw er;
    } finally { clearTimeout(t); }
  }
  // Resultados do mapa offline têm o mesmo formato dos do Nominatim (lat/lon/display_name) + _rotulo (já pronto) e _aviso.
  const buscarOffline = (q) => motor.buscar(q, 6).map(x => ({ lat: x.lat, lon: x.lng, display_name: x.rotulo, _rotulo: x.rotulo, _aviso: x.aviso || '' }));
  async function buscarEndereco(q) {
    if (usarOffline()) return buscarOffline(q);
    try { return await nominatim('/search', { q, limit: 6, countrycodes: 'br', viewbox: VIEWBOX, addressdetails: 1 }); }
    catch (e) { if (motor && e && e.rede) return buscarOffline(q); throw e; }
  }
  async function buscarCoordenada(lat, lng) {
    const offline = () => { const r = motor.reverso(lat, lng); return r ? { display_name: r.rotulo, _rotulo: r.rotulo } : null; };
    if (usarOffline()) return offline();
    try { return await nominatim('/reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: 18 }); }
    catch (e) { if (motor && e && e.rede) return offline(); throw e; }
  }

  function rotuloCurto(r) {
    if (r && r._rotulo) return r._rotulo;
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
      if (!partidaCache) {   // coordenadas achadas uma vez com internet ficam guardadas: a partida padrão passa a funcionar offline
        try { const g = JSON.parse(lerPref(PARTIDA_CHAVE, 'null')); if (g && isFinite(g.lat) && isFinite(g.lng)) partidaCache = { lat: +g.lat, lng: +g.lng, rotulo: PARTIDA.rotulo }; } catch (e) { /* guardado inválido: busca de novo */ }
      }
      if (!partidaCache) {
        const r = await buscarEndereco(PARTIDA.consulta);
        if (!r.length) throw new Error('Não consegui localizar o endereço de partida no mapa. Use "Outro endereço".');
        const achada = { lat: +r[0].lat, lng: +r[0].lon, rotulo: PARTIDA.rotulo };
        if (r[0]._rotulo) return achada;     // vindo do mapa offline (meio da rua, aproximado): não fixa nem guarda
        partidaCache = achada; gravarPref(PARTIDA_CHAVE, JSON.stringify({ lat: achada.lat, lng: achada.lng }));
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
    const minha = ++senha; avisoDestino = '';
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
      b.addEventListener('click', () => { senha++; avisoDestino = r._aviso || ''; ul.classList.add('hidden'); escolherDestino({ lat: +r.lat, lng: +r.lon, rotulo: b.textContent }).catch(mostrarErro); });
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
      listarResultados(rs); avisoDestino = rs[0]._aviso || '';
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

  async function rotaOnline(o) {
    const perfil = PERFIS[modo];
    const url = `${ROTAS}/${perfil.caminho}/route/v1/driving/${o.lng},${o.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&steps=true`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const dados = await r.json().catch(() => null);
      if (!r.ok && !(dados && dados.code)) throw new Error('O serviço de rotas respondeu com erro (' + r.status + ').');
      return dados;
    } catch (e) {
      let er = e;
      if (e && e.name === 'AbortError') er = new Error('O cálculo da rota demorou demais. Tente de novo.');
      else if (e instanceof TypeError) er = new Error('Sem conexão com o serviço de rotas. Confira a internet.');
      if (er && typeof er === 'object') er.rede = true;
      throw er;
    } finally { clearTimeout(t); }
  }
  function rotaOffline(o) {
    const r = motor.rotear(modo, { lat: o.lat, lng: o.lng }, { lat: destino.lat, lng: destino.lng });
    if (r.erro === 'longe') throw new Error('A partida ou o destino está fora da área do mapa offline (Boa Vista e entorno), ou longe de qualquer rua para esse meio de transporte.');
    if (r.erro) throw new Error('Não achei caminho entre os dois pontos para esse meio de transporte (mapa offline).');
    return { code: 'Ok', routes: [r] };
  }

  async function tracarRota() {
    if (!destino) return;
    const minha = ++senha;
    status('Traçando a rota…'); ocupado(true);
    try {
      const o = await obterOrigem();
      if (minha !== senha) return;
      await garantirMapa();
      let dados, offline = false;
      if (usarOffline()) { dados = rotaOffline(o); offline = true; }
      else {
        try { dados = await rotaOnline(o); }
        catch (e) { if (motor && e && e.rede) { dados = rotaOffline(o); offline = true; } else throw e; }
      }
      if (minha !== senha) return;
      if (!dados || dados.code !== 'Ok' || !dados.routes || !dados.routes.length) {
        limparRota();
        throw new Error(dados && dados.code === 'NoRoute' ? 'Não achei caminho entre os dois pontos para esse meio de transporte.' : 'Não consegui traçar a rota agora.');
      }
      desenharRota(o, dados.routes[0]);
      const msg = [offline ? 'Rota calculada pelo mapa offline (sem internet): sem trânsito e sem obras.' : '', avisoDestino].filter(Boolean).join(' ');
      status(msg, offline ? 'ok' : '');
      avisoDestino = '';
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

  function mostrarErro(e) { status(((e && e.message) || 'Algo deu errado.') + (e && e.rede && !motor && AMO ? DICA_OFFLINE : ''), 'erro'); ocupado(false); }

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

  // ---------- mapa offline: camada de ruas (canvas), download e painel ----------
  const MINZ = [0, 0, 12, 13, 14, 15, 16];                                  // zoom mínimo para desenhar cada classe de via
  const COR = ['#e892a2', '#f9c58f', '#f4e48a', '#ffffff', '#ffffff', '#ffffff'];
  const LARG = [7, 6, 5.5, 4.5, 3.5, 2.5];
  const FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const ATRIB_OFF = 'Ruas offline: dados © OpenStreetMap';

  function criarClasseVetor() {
    return L.Layer.extend({
      onAdd(map) {
        this._map = map; this._med = new Map();
        this._c = L.DomUtil.create('canvas', 'mp-vetor'); this._c.setAttribute('aria-hidden', 'true');
        map.getPane('vetor').appendChild(this._c);
        map.on('moveend zoomend resize viewreset', this._desenhar, this);
        if (map.attributionControl) map.attributionControl.addAttribution(ATRIB_OFF);
        this._desenhar();
      },
      onRemove(map) {
        map.off('moveend zoomend resize viewreset', this._desenhar, this);
        if (map.attributionControl) map.attributionControl.removeAttribution(ATRIB_OFF);
        L.DomUtil.remove(this._c); this._map = null;
      },
      _desenhar() {
        const map = this._map; if (!map || !motor) return;
        const tam = map.getSize(), pad = 0.4, w = Math.ceil(tam.x * (1 + 2 * pad)), h = Math.ceil(tam.y * (1 + 2 * pad));
        const dpr = Math.min(window.devicePixelRatio || 1, 2), c = this._c;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; }
        const canto = map.containerPointToLayerPoint([-tam.x * pad, -tam.y * pad]).round();
        L.DomUtil.setPosition(c, canto);
        const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        const z = map.getZoom(), esc = 256 * Math.pow(2, z), po = map.getPixelOrigin(), ox = po.x + canto.x, oy = po.y + canto.y;
        const X = (lng) => (lng + 180) / 360 * esc - ox;
        const Y = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * esc - oy; };
        const b = map.getBounds().pad(pad), D = motor.dados;
        const ids = motor.segsNaCaixa(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
        const porRank = [[], [], [], [], [], [], []];
        for (let i = 0; i < ids.length; i++) { const s = ids[i], r = D.rank(D.sw[s]); if (r !== undefined && z >= MINZ[r]) porRank[r].push(s); }
        const caminhos = porRank.map((l) => {
          if (!l.length) return null; const p = new Path2D();
          for (const s of l) { p.moveTo(X(D.nlng[D.sa[s]]), Y(D.nlat[D.sa[s]])); p.lineTo(X(D.nlng[D.sb[s]]), Y(D.nlat[D.sb[s]])); }
          return p;
        });
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const k = Math.pow(1.38, z - 15);
        if (caminhos[6]) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#9c8f7a'; ctx.lineWidth = Math.max(1, Math.min(2.2, 1.4 * k)); ctx.stroke(caminhos[6]); ctx.setLineDash([]); }
        const larg = (r) => Math.max(1.4, Math.min(24, LARG[r] * k));
        for (let r = 5; r >= 0; r--) if (caminhos[r]) { ctx.strokeStyle = '#a89f91'; ctx.lineWidth = larg(r) + 2; ctx.stroke(caminhos[r]); }   // contornos
        for (let r = 5; r >= 0; r--) if (caminhos[r]) { ctx.strokeStyle = COR[r]; ctx.lineWidth = larg(r); ctx.stroke(caminhos[r]); }               // miolo

        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (z >= 15) {                      // nomes das ruas, na direção da rua, sem se sobrepor
          const cand = [];
          for (let r = 0; r <= 5; r++) {
            if (z < (r <= 3 ? 15 : 16)) continue;
            for (const s of porRank[r]) {
              const nome = D.ways[D.sw[s]].n; if (!nome) continue;
              const x1 = X(D.nlng[D.sa[s]]), y1 = Y(D.nlat[D.sa[s]]), x2 = X(D.nlng[D.sb[s]]), y2 = Y(D.nlat[D.sb[s]]), len = Math.hypot(x2 - x1, y2 - y1);
              if (len >= 40) cand.push({ nome, x1, y1, x2, y2, len });
            }
          }
          cand.sort((a, d) => d.len - a.len);
          ctx.font = '600 11px ' + FONTE;
          const ocupadas = [], contagem = new Map(); let feitos = 0;
          for (let i = 0; i < cand.length && i < 700 && feitos < 160; i++) {
            const cd = cand[i]; if ((contagem.get(cd.nome) || 0) >= 2) continue;
            let tw = this._med.get(cd.nome); if (tw === undefined) { tw = ctx.measureText(cd.nome).width; this._med.set(cd.nome, tw); }
            if (cd.len < tw + 12) continue;
            const mx = (cd.x1 + cd.x2) / 2, my = (cd.y1 + cd.y2) / 2; if (mx < -20 || my < -20 || mx > w + 20 || my > h + 20) continue;
            let ang = Math.atan2(cd.y2 - cd.y1, cd.x2 - cd.x1); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
            const hw = Math.abs(Math.cos(ang)) * tw / 2 + Math.abs(Math.sin(ang)) * 7 + 3, hh = Math.abs(Math.sin(ang)) * tw / 2 + Math.abs(Math.cos(ang)) * 7 + 3;
            if (ocupadas.some(o => Math.abs(o.x - mx) < o.hw + hw && Math.abs(o.y - my) < o.hh + hh)) continue;
            ocupadas.push({ x: mx, y: my, hw, hh }); contagem.set(cd.nome, (contagem.get(cd.nome) || 0) + 1); feitos++;
            ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(cd.nome, 0, 0); ctx.fillStyle = '#3b3b3b'; ctx.fillText(cd.nome, 0, 0);
            ctx.restore();
          }
        }
        if (z >= 12 && z <= 15) {           // nomes dos bairros
          ctx.font = '700 ' + (z <= 13 ? 11 : 12) + 'px ' + FONTE;
          for (const q of D.lugares) {
            if (!b.contains([q.lat, q.lng])) continue;
            const x = X(q.lng), y = Y(q.lat), t = String(q.n).toUpperCase();
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(242,239,233,.95)'; ctx.strokeText(t, x, y); ctx.fillStyle = 'rgba(95,84,62,.85)'; ctx.fillText(t, x, y);
          }
        }
      }
    });
  }

  function ligarVetor(sim) {
    if (!mapa || !L) return;
    const cont = mapa.getContainer();
    if (sim) {
      if (!ClasseVetor) ClasseVetor = criarClasseVetor();
      if (!vetor) vetor = new ClasseVetor();
      if (!mapa.hasLayer(vetor)) vetor.addTo(mapa);
      cont.style.background = '#f2efe9';
    } else if (vetor && mapa.hasLayer(vetor)) { mapa.removeLayer(vetor); cont.style.background = ''; }
  }
  // Com internet: blocos do OpenStreetMap. Sem internet (ou "usar sempre offline"): ruas desenhadas a partir do mapa baixado.
  function aplicarModoMapa() {
    if (!mapa || !camadaTiles) return;
    const soVetor = !!motor && sempreOffline;
    if (soVetor) { if (mapa.hasLayer(camadaTiles)) mapa.removeLayer(camadaTiles); }
    else if (!mapa.hasLayer(camadaTiles)) camadaTiles.addTo(mapa);
    ligarVetor(!!motor && (soVetor || vetorAuto));
  }

  const offBox = $('mapaOffBox');
  function ofertaUI() {
    if (!offBox) return;
    const info = motor ? motor.info() : null, ocup = !!baixando;
    let t;
    if (ocup) t = baixando.texto || 'Baixando…';
    else if (info) {
      const d = new Date(info.quando), data = isNaN(d) ? '' : d.toLocaleDateString('pt-BR');
      t = 'Mapa offline pronto' + (data ? ' (baixado em ' + data + ')' : '') + ' · ' + info.ruas.toLocaleString('pt-BR') + ' ruas, ' + info.bairros + ' bairros.' + (vetorAuto && !sempreOffline ? ' Sem internet agora: usando o mapa offline.' : '');
    } else t = 'Mapa offline: ainda não baixado. Baixe uma vez (de preferência no Wi-Fi) para buscar endereços, ver o mapa e traçar rotas sem internet.';
    $('mapaOffTexto').textContent = t;
    $('mapaOffBaixar').textContent = info ? 'Atualizar mapa offline' : 'Baixar mapa offline';
    $('mapaOffBaixar').classList.toggle('hidden', ocup);
    $('mapaOffCancelar').classList.toggle('hidden', !ocup);
    $('mapaOffApagar').classList.toggle('hidden', ocup || !info);
    $('mapaOffSempreBox').classList.toggle('hidden', !info);
    const pr = $('mapaOffProg'); pr.classList.toggle('hidden', !ocup); if (ocup) pr.value = baixando.pct || 0;
    $('mapaOffSempre').checked = sempreOffline;
  }

  async function baixarOffline() {
    if (!AMO || baixando) return;
    if (!window.confirm('Baixar o mapa de Boa Vista para usar sem internet?\n\nDemora alguns minutos e usa algumas dezenas de MB de internet — de preferência no Wi-Fi. Depois fica guardado no aparelho.')) return;
    const ctl = new AbortController(); baixando = { ctl, texto: 'Iniciando o download…', pct: 0 }; ofertaUI(); status('');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* o navegador decide sozinho */ }
    try {
      const r = await AMO.baixar({ sinal: ctl.signal, onProgresso: (p) => { baixando.texto = p.texto; baixando.pct = Math.round(p.feito / p.total * 100); ofertaUI(); } });
      motor = AMO.criarMotor(r.pacote); vetorAuto = false; errosTile = 0;
      if (r.erroGuardar) status('O mapa foi baixado e já funciona agora, mas NÃO ficou guardado no aparelho (vale só até fechar o app). ' + r.erroGuardar.message, 'erro');
      else status('Mapa offline pronto: a busca, o mapa e as rotas já funcionam sem internet.', 'ok');
      aplicarModoMapa();
    } catch (e) { status((e && e.message) || 'Não consegui baixar o mapa offline.', 'erro'); }
    finally { baixando = null; ofertaUI(); }
  }

  if (offBox && !AMO) offBox.classList.add('hidden');
  if (offBox && AMO) {
    $('mapaOffBaixar').addEventListener('click', baixarOffline);
    $('mapaOffCancelar').addEventListener('click', () => { if (baixando) baixando.ctl.abort(); });
    $('mapaOffApagar').addEventListener('click', async () => {
      if (!window.confirm('Apagar o mapa offline deste aparelho? Você poderá baixar de novo quando quiser.')) return;
      try { await AMO.apagar(); motor = null; vetorAuto = false; aplicarModoMapa(); status('Mapa offline apagado deste aparelho.', 'ok'); }
      catch (e) { status((e && e.message) || 'Não consegui apagar o mapa offline.', 'erro'); }
      ofertaUI();
    });
    $('mapaOffSempre').addEventListener('change', (ev) => {
      sempreOffline = !!ev.target.checked; gravarPref('anonaMapaSempreOffline', sempreOffline ? '1' : '0');
      aplicarModoMapa(); ofertaUI(); if (destino) tracarRota();
    });
    window.addEventListener('online', () => { vetorAuto = false; errosTile = 0; aplicarModoMapa(); ofertaUI(); });
    window.addEventListener('offline', () => { if (motor) { vetorAuto = true; aplicarModoMapa(); } ofertaUI(); });
    // carrega o mapa guardado quando o navegador estiver livre (montar o índice leva uma fração de segundo)
    const iniciar = () => AMO.carregar()
      .then((p) => { if (p) { try { motor = AMO.criarMotor(p); } catch (e) { motor = null; } } aplicarModoMapa(); ofertaUI(); })
      .catch(() => ofertaUI());
    (window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 3000 }) : (f) => setTimeout(f, 600))(iniciar);
  }

  // carrega o mapa só quando a seção chega perto da tela
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some(x => x.isIntersecting)) { io.disconnect(); garantirMapa().catch(() => {}); } }, { rootMargin: '300px' });
    io.observe(sec);
  } else garantirMapa().catch(() => {});
  iconesRefresh();

  window.AnonaMapa = { _teste: { instrucao, fmtDist, fmtTempo, rotuloCurto, limparFala } };
})();
