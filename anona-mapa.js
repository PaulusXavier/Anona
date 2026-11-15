/* Anona — "Mapa e rotas": procura de endereços (como no Google Maps) e rota a partir da posição do aparelho.
 * Mapa: Leaflet (vendor/leaflet, carregado só quando a seção aparece) + OpenStreetMap.
 * Busca de endereço: Nominatim. Rota: routing.openstreetmap.de (OSRM). Não precisa de chave.
 * Com internet, só o texto do endereço digitado e as coordenadas (posição/destino) saem do aparelho; nada é guardado.
 * OFFLINE: depois de "Baixar mapa offline" (anona-mapa-offline.js: ruas de Boa Vista guardadas no aparelho), a busca, o
 * toque no mapa, a rota com passo a passo e o desenho das ruas funcionam sem internet — automaticamente quando a rede
 * falha, ou sempre, se o usuário marcar "Usar sempre o mapa offline".
 * Funções puras (coordenadas coladas, distância ao traçado, posição dos passos…) ficam em anona-mapa-util.js (testes: tests/mapa-util.test.js). */
(function () {
  'use strict';
  const sec = document.getElementById('mapaRotas');
  if (!sec) return;
  const $ = (id) => document.getElementById(id);
  const U = window.AnonaMapaUtil;
  const FOCO = window.AnonaMapaFoco || null;   // bairros de foco (13 de Setembro e Araceli): anona-mapa-foco.js
  let escopo = (FOCO && FOCO.porId(lerPref('anonaMapaEscopo', ''))) ? lerPref('anonaMapaEscopo', '') : '';   // bairro fixado nos chips de busca
  if (!U) { const st = $('mapaStatus'); if (st) { st.textContent = 'Não consegui carregar o mapa (arquivo anona-mapa-util.js ausente).'; st.className = 'mp-status is-erro'; } return; }

  const PARTIDA = { rotulo: 'Rua Santo Agostinho, 193 — Centenário, Boa Vista/RR', consulta: 'Rua Santo Agostinho 193, Centenário, Boa Vista, Roraima' };
  const CENTRO = [2.8235, -60.6758];                 // Boa Vista/RR
  const VIEWBOX = '-60.85,2.95,-60.55,2.70';         // esquerda,topo,direita,base: Boa Vista e entorno
const LIMITE_ROTA_FORA = 120;                       // metros: acima disso, no modo Acompanhar, a rota é recalculada
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
  let ampliadaPref = lerPref('anonaMapaAmpliada', '0') === '1';   // baixar também estradas/povoados do entorno
  let parciaisN = 0;             // pedaços de um download interrompido que ainda dá para retomar
  let avisoDestino = '';         // ex.: "o número 193 não está no mapa offline"
  let rotas = [], rotaSel = 0, origemAtual = null, trilha = null;   // rotas: alternativas; trilha: pontos/acumulado/passos da escolhida
  let paradas = [], grupoParadas = null;   // paradas no meio do caminho: [{ lat, lng, rotulo }] (o destino fica sempre por último)
  let origemOutro = null;        // partida escolhida por "Inverter": { lat, lng, rotulo }
  let mPasso = null, ultimoRecalculo = 0, seguindo = false, vigia = null, travaTela = null;
  const cacheBusca = new Map();  // só na memória desta sessão: repete a mesma busca sem gastar internet
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
      if (vetorAuto) return;
      if (++errosTile === 1) setTimeout(() => { errosTile = 0; }, 8000);
      if (motor && errosTile >= 3) { vetorAuto = true; aplicarModoMapa(); ofertaUI(); }
    });
    aplicarModoMapa();
    mapa.on('click', (e) => escolherNoMapa(e.latlng.lat, e.latlng.lng));
    setTimeout(() => mapa.invalidateSize(), 150);
    return mapa;
  }

  // ---------- Nominatim (máx. 1 pedido por segundo) ----------
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  async function nominatim(caminho, params, tentativa) {
    const espera = ultimoNominatim + 1100 - Date.now();
    if (espera > 0) await esperar(espera);
    ultimoNominatim = Date.now();
    const url = NOMINATIM + caminho + '?' + new URLSearchParams(Object.assign({ format: 'jsonv2', 'accept-language': 'pt-BR' }, params));
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if ((r.status === 429 || r.status === 503) && !tentativa) { clearTimeout(t); await esperar(2500); return await nominatim(caminho, params, true); }
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
  // repete a mesma busca sem gastar internet (só na memória desta sessão; nada vai para o armazenamento do aparelho)
  async function comCache(chave, buscarDeVerdade) {
    if (cacheBusca.has(chave)) return cacheBusca.get(chave);
    const v = await buscarDeVerdade();
    if (cacheBusca.size >= 60) cacheBusca.delete(cacheBusca.keys().next().value);
    cacheBusca.set(chave, v);
    return v;
  }
  // Resultados do mapa offline têm o mesmo formato dos do Nominatim (lat/lon/display_name) + _rotulo (já pronto) e _aviso.
  const referencia = () => { const r = posicao || origemAtual || partidaCache; return r && isFinite(r.lat) && isFinite(r.lng) ? { lat: r.lat, lng: r.lng } : null; };   // desempata ruas de mesmo nome pela que está mais perto
  const paraItem = (x) => ({ lat: x.lat, lon: x.lng, display_name: x.rotulo, _rotulo: x.rotulo, _aviso: x.aviso || '' });
  // bairro de foco: o citado no texto ("…, 13 de setembro", "treze de setembro", "aracelis") ou o fixado nos chips
  function focoDaBusca(q) {
    if (!FOCO) return null;
    const d = FOCO.detectar(q);
    return d ? { foco: d.foco, resto: d.resto, citado: true } : (escopo ? { foco: FOCO.porId(escopo), resto: q, citado: false } : null);
  }
  const avisoBairro = (rs, f) => { if (f && rs.length && !FOCO.doBairro(rs[0], f.foco)) rs[0]._aviso = (rs[0]._aviso ? rs[0]._aviso + ' ' : '') + 'Não confirmei que fica no bairro ' + f.foco.rotulo + ': confira o ponto no mapa.'; return rs; };
  const buscarOffline = (q) => {
    const f = focoDaBusca(q), perto = referencia();
    let itens = [];
    if (f) for (const v of f.foco.variantes.slice(0, 3)) { itens = motor.buscar((f.resto ? f.resto + ', ' : '') + v, 6, { perto }); if (itens.length) break; }
    if (!itens.length) itens = motor.buscar(q, 6, { perto });
    const rs = itens.map(paraItem);
    return f ? avisoBairro(FOCO.priorizar(rs, f.foco), f) : (FOCO ? FOCO.priorizar(rs) : rs);
  };
  // 1º só em Boa Vista e entorno; 2º Brasil inteiro (Boa Vista tem preferência); 3º sem o número da casa, avisando.
  function buscarOnline(q) {
    const f = focoDaBusca(q);
    return comCache('b:' + (f ? f.foco.id + ':' : '') + q.toLowerCase(), async () => {
      const base = { q, limit: 6, countrycodes: 'br', viewbox: VIEWBOX, addressdetails: 1 };
      let rs = [];
      if (f) {   // rua + bairro de foco: tenta as grafias do bairro (no máx. 2 pedidos) antes de buscar na cidade toda
        for (const c of FOCO.consultas(f.foco, f.resto).slice(0, 2)) {
          rs = await nominatim('/search', Object.assign({}, base, { q: c, bounded: 1 }));
          if (rs.length) break;
        }
      }
      if (!rs.length && !(f && f.citado)) rs = await nominatim('/search', Object.assign({ bounded: 1 }, base));
      if (!rs.length) rs = await nominatim('/search', base);
      if (!rs.length) {
        const sn = U.semNumero(f ? (f.resto || q) : q);
        if (sn) {
          const b2 = Object.assign({}, base, { q: sn.texto + (f ? ', ' + f.foco.variantes[0] : '') });
          rs = await nominatim('/search', Object.assign({ bounded: 1 }, b2));
          if (!rs.length && f) rs = await nominatim('/search', Object.assign({ bounded: 1 }, base, { q: sn.texto }));
          rs.forEach((r) => { r._aviso = 'Não achei o número ' + sn.numero + ' no mapa: mostrei a rua. Arraste o pino ou toque no mapa para ajustar.'; });
        }
      }
      return f ? avisoBairro(FOCO.priorizar(rs, f.foco), f) : (FOCO ? FOCO.priorizar(rs) : rs);
    });
  }
  async function buscarEndereco(q) {
    if (usarOffline()) return buscarOffline(q);
    try { return await buscarOnline(q); }
    catch (e) { if (motor && e && e.rede) return buscarOffline(q); throw e; }
  }
  async function buscarCoordenada(lat, lng) {
    const offline = () => { const r = motor.reverso(lat, lng); return r ? { display_name: r.rotulo, _rotulo: r.rotulo } : null; };
    if (usarOffline()) return offline();
    try { return await comCache('r:' + lat.toFixed(5) + ',' + lng.toFixed(5), () => nominatim('/reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: 18 })); }
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
  function msgGeo(e) {
    return e && e.code === 1 ? 'A localização foi negada. Permita o acesso à localização no navegador (ícone de cadeado, ao lado do endereço) ou escolha outro ponto de partida.'
      : e && e.code === 3 ? 'Não consegui obter sua posição a tempo. Vá para um local aberto e tente de novo.'
      : 'Não consegui obter sua posição agora.';
  }
  function lerPosicao() {
    return new Promise((ok, falha) => {
      if (!navigator.geolocation) return falha(new Error('Este aparelho/navegador não informa a localização.'));
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy || 0, quando: Date.now() }),
        (e) => falha(new Error(msgGeo(e))),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
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
      let p = posicao;
      // posição com mais de 90 s (e sem "Acompanhar" ligado) é lida de novo: quem andou não pode sair da rota errada
      if (!p || (!vigia && Date.now() - (p.quando || 0) > 90000)) {
        try { p = await usarMinhaPosicao(false); } catch (e) { if (!p) throw e; }   // posição antiga é melhor que nenhuma
      }
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
    if (origemOutro && origemOutro.rotulo === txt) return origemOutro;           // veio de "Inverter": já tem coordenadas exatas
    const c = U.lerCoordenadas(txt);
    if (c) return { lat: c.lat, lng: c.lng, rotulo: txt };
    const r = await buscarEndereco(txt);
    if (!r.length) throw new Error('Não encontrei o endereço de partida "' + txt + '".');
    return { lat: +r[0].lat, lng: +r[0].lon, rotulo: rotuloCurto(r[0]) || txt };
  }

  // ---------- destino ----------
  async function marcarDestino(d) {
    destino = d;
    await garantirMapa();
    if (mDestino) mapa.removeLayer(mDestino);
    mDestino = L.marker([d.lat, d.lng], { icon: icone('mp-pino-dest', 26), title: d.rotulo + ' — arraste para ajustar', draggable: true, keyboard: false }).addTo(mapa);
    mDestino.on('dragend', () => { const ll = mDestino.getLatLng(); escolherNoMapa(ll.lat, ll.lng); });
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
  const fecharResultados = () => $('mapaResultados').classList.add('hidden');
  function listarResultados(rs, opc) {
    opc = opc || {};
    const ul = $('mapaResultados'); ul.textContent = '';
    const lista = opc.todos ? rs : rs.slice(1);
    if (!lista.length) { ul.classList.add('hidden'); return; }
    lista.forEach((r) => {
      const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button';
      b.textContent = rotuloCurto(r) || r.display_name;
      b.addEventListener('click', () => { senha++; avisoDestino = r._aviso || ''; ul.classList.add('hidden'); $('mapaBusca').value = b.textContent; escolherDestino({ lat: +r.lat, lng: +r.lon, rotulo: b.textContent }).catch(mostrarErro); });
      li.appendChild(b); ul.appendChild(li);
    });
    const t = document.createElement('li'); t.className = 'mp-res-titulo'; t.textContent = opc.titulo || 'Outros resultados'; ul.insertBefore(t, ul.firstChild);
    ul.classList.remove('hidden');
  }

  async function buscar(ev) {
    ev.preventDefault();
    clearTimeout(tSug);
    const q = ($('mapaBusca').value || '').trim();
    if (q.length < 3) { status('Digite o endereço (rua, número, bairro) para buscar.', 'erro'); return; }
    const c = U.lerCoordenadas(q);                  // coordenadas ou link do Google Maps colados no campo
    if (c) {
      fecharResultados(); ocupado(true);
      try { await garantirMapa(); mapa.setView([c.lat, c.lng], 17); await escolherNoMapa(c.lat, c.lng); } catch (e) { mostrarErro(e); }
      return;
    }
    const minha = ++senha;
    status('Procurando o endereço…'); ocupado(true);
    try {
      await garantirMapa();
      const rs = await buscarEndereco(q);
      if (minha !== senha) return;
      if (!rs.length) { listarResultados([]); status('Não encontrei esse endereço. Tente só a rua e o bairro (ex.: "Rua Santo Agostinho, Centenário"), cole as coordenadas, ou toque no mapa para marcar o ponto.', 'erro'); return; }
      listarResultados(rs); avisoDestino = rs[0]._aviso || '';
      await escolherDestino({ lat: +rs[0].lat, lng: +rs[0].lon, rotulo: rotuloCurto(rs[0]) || q });
    } catch (e) { mostrarErro(e); }
    finally { ocupado(false); }
  }

  // ---------- rota ----------
  const MOD = { left: 'à esquerda', right: 'à direita', 'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita',
    'sharp left': 'fechando à esquerda', 'sharp right': 'fechando à direita', straight: 'em frente', uturn: 'e faça o retorno' };
  function instrucao(s) {
    if (s._parada) return 'Parada ' + s._parada + ' alcançada';
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
  const fmtDist = U.fmtDist, fmtTempo = U.fmtTempo;

  async function rotaOnline(o) {
    const perfil = PERFIS[modo];
    const coords = pontosRota(o).map(q => q.lng + ',' + q.lat).join(';');
    const url = `${ROTAS}/${perfil.caminho}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=${paradas.length ? 'false' : 'true'}`;
    for (let tent = 0; ; tent++) {      // uma nova tentativa se o servidor público engasgar
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        if (r.status >= 500 && tent < 1) { await esperar(1500); continue; }
        const dados = await r.json().catch(() => null);
        if (!r.ok && !(dados && dados.code)) throw new Error('O serviço de rotas respondeu com erro (' + r.status + ').');
        return dados;
      } catch (e) {
        const rede = e && (e.name === 'AbortError' || e instanceof TypeError);
        if (rede && tent < 1) { await esperar(1200); continue; }
        let er = e;
        if (e && e.name === 'AbortError') er = new Error('O cálculo da rota demorou demais. Tente de novo.');
        else if (e instanceof TypeError) er = new Error('Sem conexão com o serviço de rotas. Confira a internet.');
        if (er && typeof er === 'object') er.rede = true;
        throw er;
      } finally { clearTimeout(t); }
    }
  }
  const pontosRota = (o) => [o].concat(paradas, [destino]);
  function rotaOffline(o) {
    const pts = pontosRota(o), pernas = [], coords = []; let dist = 0, dur = 0, alternativas = [];
    const unica = pts.length === 2;       // alternativas só quando é um trecho só (com paradas, a rota fica como está)
    for (let k = 0; k < pts.length - 1; k++) {
      const r = motor.rotear(modo, { lat: pts[k].lat, lng: pts[k].lng }, { lat: pts[k + 1].lat, lng: pts[k + 1].lng }, unica ? { alternativas: 2 } : undefined);
      const onde = pts.length > 2 ? ' (trecho ' + (k + 1) + ' de ' + (pts.length - 1) + ')' : '';
      if (r.erro === 'longe') throw new Error('A partida, uma parada ou o destino está fora da área do mapa offline (' + (motor.info().ampliada ? 'Boa Vista e região' : 'Boa Vista e entorno') + '), ou longe de qualquer rua para esse meio de transporte' + onde + '.' + (motor.info().ampliada ? '' : ' Para a zona rural, atualize o mapa offline marcando a opção das estradas do entorno.'));
      if (r.erro) throw new Error('Não achei caminho entre os pontos para esse meio de transporte (mapa offline)' + onde + '.');
      pernas.push(Object.assign({}, r.legs[0], { distance: r.distance, duration: r.duration })); dist += r.distance; dur += r.duration;
      r.geometry.coordinates.forEach((c, n) => { if (k === 0 || n > 0) coords.push(c); });
      if (unica && r.alternativas) alternativas = r.alternativas;
    }
    const principal = { distance: dist, duration: dur, geometry: { type: 'LineString', coordinates: coords }, legs: pernas };
    const alts = alternativas.map(x => ({ distance: x.distance, duration: x.duration, geometry: x.geometry, legs: x.legs }));
    return { code: 'Ok', routes: [principal].concat(alts) };
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
        limparRota(); seguir(false);
        throw new Error(dados && dados.code === 'NoRoute' ? 'Não achei caminho entre os dois pontos para esse meio de transporte.' : 'Não consegui traçar a rota agora.');
      }
      mostrarRotas(o, dados.routes.slice(0, 3));
      const msg = [offline ? 'Rota calculada pelo mapa offline (sem internet): sem trânsito e sem obras.' + (dados.routes.length > 1 ? ' Há ' + (dados.routes.length - 1) + ' caminho(s) alternativo(s) — toque no que preferir.' : '') : '', avisoDestino].filter(Boolean).join(' ');
      status(msg, offline ? 'ok' : '');
      avisoDestino = '';
    } catch (e) { mostrarErro(e); }
    finally { if (minha === senha) ocupado(false); }
  }

  function apagarCamadas() {
    if (camadaRota) { mapa.removeLayer(camadaRota); camadaRota = null; }
    if (mOrigem) { mapa.removeLayer(mOrigem); mOrigem = null; }
    if (mPasso) { mapa.removeLayer(mPasso); mPasso = null; }
  }
  function limparRota() {
    if (mapa) apagarCamadas();
    rotas = []; trilha = null; origemAtual = null;
    $('mapaResumo').classList.add('hidden'); $('mapaPassos').textContent = ''; $('mapaAlternativas').textContent = ''; $('mapaProximo').classList.add('hidden');
  }

  const coordsDe = (r) => r.geometry.coordinates.map(c => [c[1], c[0]]);
  const passosDe = (r) => {          // junta os trechos; a chegada de cada trecho intermediário vira "Parada n alcançada"
    const L = r.legs || [], out = [];
    L.forEach((leg, li) => (leg.steps || []).forEach((st) => { out.push(li < L.length - 1 && st.maneuver && st.maneuver.type === 'arrive' ? Object.assign({}, st, { _parada: li + 1 }) : st); }));
    return out;
  };

  function pintarRotas() {
    apagarCamadas();
    const estilo = (cor, larg, op) => ({ color: cor, weight: larg, opacity: op, lineCap: 'round', lineJoin: 'round' });
    camadaRota = L.layerGroup().addTo(mapa);
    rotas.forEach((r, i) => {                      // alternativas (cinza) por baixo; tocar numa delas a escolhe
      if (i === rotaSel) return;
      const pts = coordsDe(r), dica = 'Rota alternativa: ' + fmtTempo(r.duration) + ' · ' + fmtDist(r.distance) + ' (toque para escolher)';
      [L.polyline(pts, estilo('#ffffff', 9, 0.85)), L.polyline(pts, estilo('#7b8aa0', 5, 0.95))].forEach((l) => {
        l.on('click', (ev) => { L.DomEvent.stopPropagation(ev); selecionarRota(i); });
        l.bindTooltip(dica, { sticky: true });
        camadaRota.addLayer(l);
      });
    });
    const pts = coordsDe(rotas[rotaSel]);
    camadaRota.addLayer(L.polyline(pts, estilo('#ffffff', 9, 0.9)));
    camadaRota.addLayer(L.polyline(pts, estilo('#146B47', 5, 0.95)));
    const cum = U.acumulado(pts), steps = passosDe(rotas[rotaSel]);
    trilha = { pontos: pts, cum, steps, passos: U.localizarPassos(steps, pts, cum), atual: -1 };
    if (origemAtual && origemAtual.rotulo !== 'Minha posição') mOrigem = L.marker([origemAtual.lat, origemAtual.lng], { icon: icone('mp-pino-orig', 16), title: origemAtual.rotulo, keyboard: false }).addTo(mapa);
  }

  function linkGoogle(o) {
    const base = 'https://www.google.com/maps/dir/?api=1&destination=' + destino.lat + ',' + destino.lng + '&travelmode=' + PERFIS[modo].google;
    const via = paradas.length ? '&waypoints=' + paradas.map(q => q.lat + ',' + q.lng).join('%7C') : '';
    return (o.rotulo === 'Minha posição' ? base : base + '&origin=' + o.lat + ',' + o.lng) + via;   // sem origem, o Google usa a posição em tempo real
  }

  // ---------- horários: saída (agora ou planejada) + tempo de visita em cada parada ----------
  function cronogramaAtual() {
    const r = rotas[rotaSel]; if (!r) return null;
    const pernas = (r.legs || []).map((l) => ({ distance: l.distance, duration: l.duration }));
    if (!pernas.length || pernas.some((p) => !isFinite(p.duration) || !isFinite(p.distance))) return null;
    return U.cronograma(pernas, { inicio: U.inicioDe($('mapaSaida').value), visitaMin: paradas.length ? +$('mapaVisita').value || 0 : 0 });
  }
  function atualizarCronograma() {
    const r = rotas[rotaSel]; if (!r || !destino) return;
    const cr = cronogramaAtual(), plan = /^\d{1,2}:\d{2}$/.test($('mapaSaida').value);
    $('mapaVisitaBox').classList.toggle('hidden', !paradas.length);
    $('mapaCopiar').classList.toggle('hidden', !paradas.length);
    const dica = $('mapaDestinoEta'), infos = sec.querySelectorAll('#mapaParadas .mp-parada-info');
    if (!cr) {        // sem duração por trecho: só o total, como antes
      $('mapaChegada').textContent = 'Chegada por volta de ' + U.horaChegada(r.duration) + ' (saindo agora)';
      dica.classList.add('hidden'); infos.forEach((el) => { el.textContent = ''; });
      return;
    }
    const saindo = plan ? 'saindo às ' + $('mapaSaida').value : 'saindo agora';
    $('mapaChegada').textContent = cr.parado
      ? 'Deslocamento ' + fmtTempo(cr.dur) + ' + ' + fmtTempo(cr.parado) + ' de visitas · fim por volta de ' + U.fmtHora(cr.fim) + ' (' + saindo + ')'
      : 'Chegada por volta de ' + U.fmtHora(cr.fim) + ' (' + saindo + ')';
    infos.forEach((el, i) => { const e = cr.etapas[i]; el.textContent = e ? 'chegada ' + U.fmtHora(e.chegada) + ' · ' + fmtDist(e.dist) + ' · ' + fmtTempo(e.dur) : ''; });
    const ult = cr.etapas[cr.etapas.length - 1];
    dica.textContent = paradas.length && ult ? 'Chegada ao destino: ' + U.fmtHora(ult.chegada) + ' · último trecho ' + fmtDist(ult.dist) : '';
    dica.classList.toggle('hidden', !dica.textContent);
  }

  function preencherResumo() {
    const r = rotas[rotaSel], o = origemAtual;
    $('mapaDist').textContent = fmtDist(r.distance);
    $('mapaTempo').textContent = fmtTempo(r.duration);
    $('mapaDeAte').textContent = o.rotulo + (paradas.length ? ' → ' + paradas.length + (paradas.length === 1 ? ' parada' : ' paradas') : '') + ' → ' + destino.rotulo;
    $('mapaGoogle').href = linkGoogle(o);
    $('mapaSeguir').classList.toggle('hidden', o.rotulo !== 'Minha posição' || !navigator.geolocation);
    atualizarCronograma();
    const alt = $('mapaAlternativas'); alt.textContent = '';
    if (rotas.length > 1) {
      const rapida = rotas.reduce((m, x, i) => x.duration < rotas[m].duration ? i : m, 0);
      rotas.forEach((x, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'mp-alt'; b.setAttribute('aria-pressed', i === rotaSel ? 'true' : 'false');
        b.textContent = fmtTempo(x.duration) + ' · ' + fmtDist(x.distance) + (i === rapida ? ' · mais rápida' : '');
        b.addEventListener('click', () => selecionarRota(i));
        alt.appendChild(b);
      });
      alt.classList.remove('hidden');
    } else alt.classList.add('hidden');
    const ol = $('mapaPassos'); ol.textContent = '';
    trilha.steps.forEach((s, i) => {
      const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'mp-passo';
      const ic = document.createElement('span'); ic.className = 'mp-seta-passo'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = U.seta(s);
      const tx = document.createElement('span'); tx.className = 'mp-passo-txt'; tx.textContent = instrucao(s);
      if (s.distance && s.maneuver && s.maneuver.type !== 'arrive') { const d = document.createElement('small'); d.textContent = fmtDist(s.distance); tx.appendChild(d); }
      b.append(ic, tx); b.addEventListener('click', () => irParaPasso(i)); li.appendChild(b); ol.appendChild(li);
    });
    $('mapaResumo').classList.remove('hidden');
  }

  function mostrarRotas(o, lista) {
    origemAtual = o; rotas = lista; rotaSel = 0;
    pintarRotas(); preencherResumo();
    if (cheia && MOBILE()) recolherMais(true);
    if (!seguindo) mapa.fitBounds(L.latLngBounds(trilha.pontos), margens());
  }
  function selecionarRota(i) {
    if (!rotas[i] || i === rotaSel) return;
    rotaSel = i; pintarRotas(); preencherResumo();
    if (!seguindo) mapa.fitBounds(L.latLngBounds(trilha.pontos), margens());
  }

  function marcarPassoAtual(i) {
    if (!trilha || trilha.atual === i) return;
    trilha.atual = i;
    sec.querySelectorAll('#mapaPassos li').forEach((li, k) => li.classList.toggle('is-atual', k === i));
    const li = sec.querySelectorAll('#mapaPassos li')[i];
    if (li && li.scrollIntoView) { try { li.scrollIntoView({ block: 'nearest' }); } catch (e) { /* sem rolagem */ } }
  }
  function irParaPasso(i) {
    const l = trilha && trilha.passos[i]; if (!l) return;
    if (mPasso) mapa.removeLayer(mPasso);
    mPasso = L.circleMarker([l.lat, l.lng], { radius: 11, color: '#146B47', weight: 3, fillColor: '#ffffff', fillOpacity: 0.9, interactive: false }).addTo(mapa);
    mapa.setView([l.lat, l.lng], Math.max(mapa.getZoom(), 17));
    sec.querySelectorAll('#mapaPassos li').forEach((li, k) => li.classList.toggle('is-sel', k === i));
    if (cheia && MOBILE()) { $('mapaResumo').classList.add('is-passos-fechados'); $('mapaPassosBtn').setAttribute('aria-expanded', 'false'); }   // abre espaço para ver o ponto no mapa
  }

  // ---------- acompanhar (GPS ligado): destaca o passo atual e recalcula se sair da rota ----------
  async function pedirTelaLigada() { try { if (navigator.wakeLock) travaTela = await navigator.wakeLock.request('screen'); } catch (e) { /* a tela pode apagar: o app continua */ } }
  function soltarTela() { try { if (travaTela) travaTela.release(); } catch (e) { /* já solta */ } travaTela = null; }
  function aoMoverPosicao(p) {
    posicao = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy || 0, quando: Date.now() };
    mostrarPosicao(posicao).catch(() => {});
    if (!trilha || !destino) return;
    if (paradas.length && Date.now() - ultimoRecalculo > 4000 && U.alcancouParada(posicao, paradas[0], posicao.precisao)) {
      const q = paradas.shift();       // parada cumprida: sai da lista e a rota é refeita daqui até a próxima
      ultimoRecalculo = Date.now(); renderParadas();
      avisoDestino = 'Parada alcançada: ' + q.rotulo + '. ' + (paradas.length ? 'Seguindo para a próxima.' : 'Seguindo para o destino final.');   // aparece quando a rota nova ficar pronta
      tracarRota(); return;
    }
    if (U.distM(posicao, destino) < 30) { status('Você chegou ao destino.', 'ok'); $('mapaProximo').classList.add('hidden'); seguir(false); return; }
    const pr = U.projetar(posicao, trilha.pontos, trilha.cum);
    if (pr && pr.dist > Math.max(LIMITE_ROTA_FORA, (posicao.precisao || 0) * 1.5)) {
      if (Date.now() - ultimoRecalculo > 20000) { ultimoRecalculo = Date.now(); status('Você saiu da rota. Recalculando…'); tracarRota(); }
      return;
    }
    if (pr) {
      const i = U.passoAtual(trilha.passos, pr.ao_longo); marcarPassoAtual(i);
      const prox = trilha.steps[i + 1], loc = trilha.passos[i + 1];
      const el = $('mapaProximo');
      if (prox && loc) { el.textContent = 'Em ' + fmtDist(Math.max(0, loc.inicio - pr.ao_longo)) + ': ' + instrucao(prox); el.classList.remove('hidden'); }
      else el.classList.add('hidden');
    }
    if (mapa) mapa.panTo([posicao.lat, posicao.lng], { animate: true });
  }
  function seguir(sim) {
    sim = !!sim;
    if (sim === seguindo) return;
    const btn = $('mapaSeguir');
    if (sim) {
      if (!navigator.geolocation) { status('Este aparelho/navegador não informa a localização.', 'erro'); return; }
      seguindo = true;
      vigia = navigator.geolocation.watchPosition(aoMoverPosicao,
        (e) => { if (e && e.code === 1) { status(msgGeo(e), 'erro'); seguir(false); } else status('Sinal de GPS fraco. Vá para um local aberto.'); },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
      pedirTelaLigada();
      if (posicao && mapa) mapa.setView([posicao.lat, posicao.lng], Math.max(mapa.getZoom(), 17));
      status('Acompanhando a sua posição. A tela fica acesa enquanto estiver ligado.', 'ok');
    } else {
      seguindo = false;
      if (vigia !== null && navigator.geolocation) navigator.geolocation.clearWatch(vigia);
      vigia = null; soltarTela(); $('mapaProximo').classList.add('hidden');
      sec.querySelectorAll('#mapaPassos li.is-atual').forEach(li => li.classList.remove('is-atual')); if (trilha) trilha.atual = -1;
    }
    btn.setAttribute('aria-pressed', seguindo ? 'true' : 'false');
    btn.querySelector('span').textContent = seguindo ? 'Parar de acompanhar' : 'Acompanhar';
  }

  // ---------- paradas (rota com vários endereços) ----------
  function desenharParadas() {
    if (!mapa) return;
    if (grupoParadas) { mapa.removeLayer(grupoParadas); grupoParadas = null; }
    if (!paradas.length) return;
    grupoParadas = L.layerGroup().addTo(mapa);
    paradas.forEach((q, i) => {
      const mk = L.marker([q.lat, q.lng], { icon: L.divIcon({ className: 'mp-pino mp-pino-parada', iconSize: [24, 24], iconAnchor: [12, 12], html: '<span>' + (i + 1) + '</span>' }), title: 'Parada ' + (i + 1) + ': ' + q.rotulo, keyboard: false });
      const pop = document.createElement('div'); pop.className = 'mp-pop';
      const tit = document.createElement('b'); tit.textContent = 'Parada ' + (i + 1);
      const end = document.createElement('p'); end.textContent = q.rotulo;
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'mp-btn mp-btn-sec mp-btn-peq'; rm.textContent = 'Remover esta parada';
      rm.addEventListener('click', () => { mapa.closePopup(); removerParada(i); });
      pop.append(tit, end, rm); mk.bindPopup(pop);
      grupoParadas.addLayer(mk);
    });
  }
  function renderParadas() {
    const box = $('mapaParadasBox'), ol = $('mapaParadas'); ol.textContent = '';
    box.classList.toggle('hidden', !paradas.length);
    paradas.forEach((q, i) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'mp-parada-n'; n.textContent = String(i + 1);
      const t = document.createElement('span'); t.className = 'mp-parada-t'; t.appendChild(document.createTextNode(q.rotulo));
      const inf = document.createElement('small'); inf.className = 'mp-parada-info'; t.appendChild(inf);
      li.append(n, t);
      const mk = (txt, rot, fn, off) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mp-mini mp-mini-peq'; b.textContent = txt; b.setAttribute('aria-label', rot); b.title = rot; b.disabled = !!off; b.addEventListener('click', fn); li.appendChild(b); };
      mk('↑', 'Subir a parada ' + (i + 1), () => moverParada(i, -1), i === 0);
      mk('↓', 'Descer a parada ' + (i + 1), () => moverParada(i, 1), i === paradas.length - 1);
      mk('✕', 'Remover a parada ' + (i + 1), () => removerParada(i));
      ol.appendChild(li);
    });
    $('mapaOtimizar').classList.toggle('hidden', paradas.length < 2);
    $('mapaVisitaBox').classList.toggle('hidden', !paradas.length); $('mapaCopiar').classList.toggle('hidden', !paradas.length);
    desenharParadas();
  }
  function aposMudarParadas() { renderParadas(); if (destino) tracarRota(); }
  function moverParada(i, d) { const j = i + d; if (j < 0 || j >= paradas.length) return; const t = paradas[i]; paradas[i] = paradas[j]; paradas[j] = t; aposMudarParadas(); }
  function removerParada(i) { paradas.splice(i, 1); aposMudarParadas(); }
  async function adicionarParada() {
    if (!destino) { status('Escolha primeiro um destino; ele vira a parada e você busca o próximo.', 'erro'); return; }
    if (paradas.length >= 8) { status('Limite de 8 paradas (mais o destino final).', 'erro'); return; }
    seguir(false);
    paradas.push({ lat: destino.lat, lng: destino.lng, rotulo: destino.rotulo });
    senha++; destino = null;
    if (mDestino) { mapa.removeLayer(mDestino); mDestino = null; }
    limparRota();
    $('mapaBusca').value = ''; fecharResultados(); $('mapaDestinoBox').classList.add('hidden');
    renderParadas();
    status('Parada ' + paradas.length + ' adicionada. Busque o próximo endereço (ou toque no mapa): ele será o próximo ponto da rota.', 'ok');
    $('mapaBusca').focus();
  }
  async function otimizarParadas() {
    if (paradas.length < 2) return;
    try {
      const o = origemAtual || await obterOrigem();
      // Com o mapa offline: ordem pelo TEMPO real de viagem (mão única e curvas). Sem ele (ou fora da área): linha reta.
      let ordem = null;
      if (motor && motor.ordenar && paradas.length <= 9 && [o].concat(paradas, destino ? [destino] : []).every(q => motor.dentro(q.lat, q.lng))) {
        status('Calculando a melhor ordem pelo tempo de viagem…'); await new Promise((r) => setTimeout(r, 30));
        const res = motor.ordenar(modo, o, paradas, destino || null);
        if (!res.erro) ordem = res.ordem;
      }
      if (ordem) { const ant = paradas; paradas = ordem.map(i => ant[i]); status('Paradas reordenadas pelo menor tempo de viagem (mapa offline, respeitando mão única). Confira a ordem e ajuste se precisar.', 'ok'); }
      else { paradas = U.ordenarParadas(o, paradas, destino || null); status('Paradas reordenadas pela menor distância em linha reta. Confira a ordem e ajuste se precisar.', 'ok'); }
      aposMudarParadas();
    } catch (e) { mostrarErro(e); }
  }

  // ---------- inverter e compartilhar ----------
  async function inverter() {
    if (!destino) return;
    let o = origemAtual;
    if (!o) { try { o = await obterOrigem(); } catch (e) { mostrarErro(e); return; } }
    seguir(false);
    const d = destino;
    origemOutro = { lat: d.lat, lng: d.lng, rotulo: d.rotulo };      // o antigo destino vira a partida
    if (paradas.length) { paradas.reverse(); renderParadas(); }
    selOrigem.value = 'outro'; ajustarOrigem(); $('mapaOrigemTexto').value = d.rotulo;
    $('mapaBusca').value = o.rotulo === 'Minha posição' ? '' : o.rotulo;
    senha++; avisoDestino = '';
    try { await marcarDestino({ lat: o.lat, lng: o.lng, rotulo: o.rotulo }); await tracarRota(); } catch (e) { mostrarErro(e); }
  }
  async function compartilhar() {
    if (!destino) return;
    const url = $('mapaGoogle').href, texto = 'Destino: ' + destino.rotulo;
    try { if (navigator.share) { await navigator.share({ title: 'Rota até o destino', text: texto, url }); return; } }
    catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(texto + '\n' + url); status('Link da rota copiado.', 'ok'); }
    catch (e) { status('Não consegui copiar. Use "Abrir no Google Maps" e compartilhe de lá.', 'erro'); }
  }

  async function copiarRoteiro() {
    if (!destino || !rotas.length || !origemAtual) return;
    const cr = cronogramaAtual(), nomes = { carro: 'carro/moto', pe: 'a pé', bike: 'bicicleta' };
    const txt = U.roteiroTexto({ modo: nomes[modo] || modo, origem: origemAtual.rotulo, paradas, destino, cron: cr, inicio: U.inicioDe($('mapaSaida').value), planejado: /^\d{1,2}:\d{2}$/.test($('mapaSaida').value) });
    try { await navigator.clipboard.writeText(txt); status('Roteiro copiado. Cole onde precisar (WhatsApp, ficha de visita…).', 'ok'); }
    catch (e) { status('Não consegui copiar automaticamente. Use \"Compartilhar\" ou \"Abrir no Google Maps\".', 'erro'); }
  }

  function mostrarErro(e) { status(((e && e.message) || 'Algo deu errado.') + (e && e.rede && !motor && AMO ? DICA_OFFLINE : ''), 'erro'); ocupado(false); }

  function limparTudo() {
    senha++;
    seguir(false);
    destino = null; origemOutro = null; paradas = [];
    if (mapa) { if (mDestino) { mapa.removeLayer(mDestino); mDestino = null; } limparRota(); }
    $('mapaBusca').value = ''; $('mapaResultados').classList.add('hidden'); $('mapaDestinoBox').classList.add('hidden');
    renderParadas(); status(''); ocupado(false);
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
    if (document.activeElement && document.activeElement.blur && sec.contains(document.activeElement)) document.activeElement.blur();   // fecha o teclado ao voltar
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
  // celular, fora da tela cheia: o mapa pequeno prendia a rolagem da página — tocar nele (ou na busca) abre a tela cheia
  $('mapaToqueAbrir').addEventListener('click', () => { if (!cheia) entrarCheia(); });
  const abrirPelaBusca = () => { if (!cheia && MOBILE()) { entrarCheia(); setTimeout(() => $('mapaBusca').focus(), 0); } };
  $('mapaBusca').addEventListener('focus', abrirPelaBusca);
  $('mapaBusca').addEventListener('click', abrirPelaBusca);   // o campo pode já estar focado ao voltar da tela cheia
  const ajuda = $('mapaAjuda'); if (ajuda && !MOBILE()) ajuda.open = true;   // no computador a ajuda já vem aberta
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
  $('mapaInverter').addEventListener('click', inverter);
  $('mapaAddParada').addEventListener('click', adicionarParada);
  $('mapaOtimizar').addEventListener('click', otimizarParadas);
  $('mapaSeguir').addEventListener('click', () => seguir(!seguindo));
  $('mapaCompartilhar').addEventListener('click', compartilhar);
  $('mapaCopiar').addEventListener('click', copiarRoteiro);
  const visitaSalva = lerPref('anonaMapaVisita', '0');
  if (Array.from($('mapaVisita').options).some((o) => o.value === visitaSalva)) $('mapaVisita').value = visitaSalva;
  $('mapaVisita').addEventListener('change', () => { gravarPref('anonaMapaVisita', $('mapaVisita').value); atualizarCronograma(); });
  $('mapaSaida').addEventListener('input', atualizarCronograma);
  document.addEventListener('visibilitychange', () => { if (seguindo && document.visibilityState === 'visible' && !travaTela) pedirTelaLigada(); });

  // sugestões enquanto digita: só com o mapa offline em uso (a busca online não pode ser disparada a cada letra)
  // chips "Buscar em": fixa a busca num dos bairros de foco (13 de Setembro / Araceli); tocar de novo solta
  function marcarEscopo() {
    sec.querySelectorAll('[data-foco]').forEach(b => b.setAttribute('aria-pressed', b.dataset.foco === escopo ? 'true' : 'false'));
    const f = FOCO && FOCO.porId(escopo);
    $('mapaBusca').placeholder = f ? 'Rua e número' : 'Destino: digite ou fale o endereço';
  }
  sec.querySelectorAll('[data-foco]').forEach(b => b.addEventListener('click', () => {
    escopo = escopo === b.dataset.foco ? '' : b.dataset.foco; gravarPref('anonaMapaEscopo', escopo); marcarEscopo(); $('mapaBusca').focus();
  }));
  marcarEscopo();
  let tSug = null;
  $('mapaBusca').addEventListener('input', () => {
    clearTimeout(tSug);
    const q = $('mapaBusca').value.trim();
    if (q.length < 3) { fecharResultados(); return; }
    if (!motor || !usarOffline()) return;
    tSug = setTimeout(() => { try { listarResultados(buscarOffline(q), { todos: true, titulo: 'Sugestões (mapa offline)' }); } catch (e) { /* sem sugestões */ } }, 250);
  });
  // teclado: ↓ vai para a lista, ↑/↓ percorrem, Esc fecha
  $('mapaBusca').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharResultados();
    if (e.key === 'ArrowDown') { const b = $('mapaResultados').querySelector('button'); if (b) { e.preventDefault(); b.focus(); } }
  });
  $('mapaResultados').addEventListener('keydown', (e) => {
    const bs = Array.from($('mapaResultados').querySelectorAll('button')), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < bs.length - 1) { e.preventDefault(); bs[i + 1].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) bs[i - 1].focus(); else $('mapaBusca').focus(); }
    else if (e.key === 'Escape') { fecharResultados(); $('mapaBusca').focus(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('#mapaForm, #mapaResultados')) fecharResultados(); });

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
        if (z >= 16 && motor.locaisNaCaixa) {          // locais (escola, UBS, CRAS, mercado...) e, mais perto, números das casas
          const COR_LOCAL = { s: '#d9534f', e: '#3a7bd5', g: '#8e5bd0', c: '#d98a1c', o: '#6b7a86' }, SIGLA = { s: '+', e: 'E', g: 'G', c: '$', o: '•' };
          const ls = motor.locaisNaCaixa(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), 70);
          ctx.font = '600 10px ' + FONTE;
          for (const l of ls) {
            const x = X(l.lng), y = Y(l.lat), cor = COR_LOCAL[l.k] || COR_LOCAL.o;
            ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = cor; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.fillText(SIGLA[l.k] || SIGLA.o, x, y + 0.5);
            if (z >= 17) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(l.n, x, y + 16); ctx.fillStyle = '#2d2d2d'; ctx.fillText(l.n, x, y + 16); }
          }
          if (z >= 18) {
            ctx.font = '600 10px ' + FONTE;
            for (const a of motor.enderecosNaCaixa(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), 150)) {
              const x = X(a.lng), y = Y(a.lat); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(a.n, x, y); ctx.fillStyle = '#7a5c2e'; ctx.fillText(a.n, x, y);
            }
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
      t = 'Mapa offline pronto' + (data ? ' (baixado em ' + data + ')' : '') + ' · ' + info.ruas.toLocaleString('pt-BR') + ' ruas, ' + info.bairros + ' bairros, ' + info.locais.toLocaleString('pt-BR') + ' locais' + (info.ampliada ? ', com a zona rural do entorno' : '') + ' (' + Math.max(1, Math.round((info.bytes || 0) / 1048576)) + ' MB no aparelho).' + (Date.now() - info.quando > 90 * 86400000 ? ' O mapa tem mais de 3 meses: vale atualizar para incluir ruas novas.' : '') + (vetorAuto && !sempreOffline ? ' Sem internet agora: usando o mapa offline.' : '');
    } else t = parciaisN ? 'Um download do mapa offline foi interrompido: ' + parciaisN + ' pedaço(s) já estão guardados. Toque em "Continuar download" para terminar sem baixar tudo de novo.' : 'Mapa offline: ainda não baixado. Baixe uma vez (de preferência no Wi-Fi) para buscar endereços, ver o mapa e traçar rotas sem internet.';
    if (!ocup && parciaisN && info) t += ' Há também um download interrompido: toque em "Continuar download".';
    $('mapaOffTexto').textContent = t;
    $('mapaOffBaixar').textContent = parciaisN ? 'Continuar download' : info ? 'Atualizar mapa offline' : 'Baixar mapa offline';
    const ab = $('mapaOffAmpBox'); if (ab) { ab.classList.toggle('hidden', ocup); $('mapaOffAmp').checked = ampliadaPref; }
    $('mapaOffBaixar').classList.toggle('hidden', ocup);
    $('mapaOffCancelar').classList.toggle('hidden', !ocup);
    $('mapaOffApagar').classList.toggle('hidden', ocup || !info);
    $('mapaOffSempreBox').classList.toggle('hidden', !info);
    const pr = $('mapaOffProg'); pr.classList.toggle('hidden', !ocup); if (ocup) pr.value = baixando.pct || 0;
    $('mapaOffSempre').checked = sempreOffline;
  }

  async function baixarOffline() {
    if (!AMO || baixando) return;
    const amp = ampliadaPref;
    if (!parciaisN && !window.confirm('Baixar o mapa de Boa Vista' + (amp ? ' e das estradas do entorno (zona rural)' : '') + ' para usar sem internet?\n\nDemora alguns minutos e usa ' + (amp ? 'cerca de cem MB' : 'algumas dezenas de MB') + ' de internet — de preferência no Wi-Fi. Se a conexão cair, o download continua de onde parou. Depois fica guardado no aparelho.')) return;
    const ctl = new AbortController(); baixando = { ctl, texto: 'Iniciando o download…', pct: 0 }; ofertaUI(); status('');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* o navegador decide sozinho */ }
    try {
      const r = await AMO.baixar({ sinal: ctl.signal, ampliada: amp, onProgresso: (p) => { baixando.texto = p.texto; baixando.pct = Math.round(p.feito / p.total * 100); ofertaUI(); } });
      parciaisN = 0;
      motor = AMO.criarMotor(r.pacote); vetorAuto = false; errosTile = 0;
      if (r.erroGuardar) status('O mapa foi baixado e já funciona agora, mas NÃO ficou guardado no aparelho (vale só até fechar o app). ' + r.erroGuardar.message, 'erro');
      else status('Mapa offline pronto: a busca, o mapa e as rotas já funcionam sem internet.', 'ok');
      aplicarModoMapa();
    } catch (e) { status((e && e.message) || 'Não consegui baixar o mapa offline.', 'erro'); }
    finally { baixando = null; if (AMO.parciais) { try { parciaisN = await AMO.parciais(); } catch (e) { parciaisN = 0; } } ofertaUI(); }
  }

  if (offBox && !AMO) offBox.classList.add('hidden');
  if (offBox && AMO) {
    $('mapaOffBaixar').addEventListener('click', baixarOffline);
    $('mapaOffCancelar').addEventListener('click', () => { if (baixando) baixando.ctl.abort(); });
    $('mapaOffApagar').addEventListener('click', async () => {
      if (!window.confirm('Apagar o mapa offline deste aparelho? Você poderá baixar de novo quando quiser.')) return;
      try { await AMO.apagar(); motor = null; parciaisN = 0; vetorAuto = false; aplicarModoMapa(); status('Mapa offline apagado deste aparelho.', 'ok'); }
      catch (e) { status((e && e.message) || 'Não consegui apagar o mapa offline.', 'erro'); }
      ofertaUI();
    });
    const ampEl = $('mapaOffAmp'); if (ampEl) ampEl.addEventListener('change', (ev) => { ampliadaPref = !!ev.target.checked; gravarPref('anonaMapaAmpliada', ampliadaPref ? '1' : '0'); });
    $('mapaOffSempre').addEventListener('change', (ev) => {
      sempreOffline = !!ev.target.checked; gravarPref('anonaMapaSempreOffline', sempreOffline ? '1' : '0');
      aplicarModoMapa(); ofertaUI(); if (destino) tracarRota();
    });
    window.addEventListener('online', () => { vetorAuto = false; errosTile = 0; aplicarModoMapa(); ofertaUI(); });
    window.addEventListener('offline', () => { if (motor) { vetorAuto = true; aplicarModoMapa(); } ofertaUI(); });
    // carrega o mapa guardado quando o navegador estiver livre (montar o índice leva uma fração de segundo)
    const iniciar = () => AMO.carregar()
      .then((p) => {
        if (p) { try { motor = AMO.criarMotor(p); } catch (e) { motor = null; } }
        // app aberto já sem internet: os blocos falharam antes de o mapa guardado carregar → usa as ruas offline desde já
        if (motor && (navigator.onLine === false || errosTile >= 3)) vetorAuto = true;
        aplicarModoMapa(); ofertaUI();
      })
      .catch(() => ofertaUI())
      .then(() => AMO.parciais ? AMO.parciais() : 0).then((n) => { parciaisN = n || 0; if (parciaisN) ofertaUI(); }, () => {});
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
