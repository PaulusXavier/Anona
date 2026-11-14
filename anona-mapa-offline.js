/* Anona — "Mapa e rotas" OFFLINE.
 *
 * Uma vez, com internet, o app baixa do OpenStreetMap (Overpass API) as RUAS de Boa Vista, os bairros, os endereços
 * com número e alguns locais (escolas, UBS, CRAS...) e guarda tudo no aparelho (IndexedDB). Depois, SEM internet:
 *   - busca endereço / bairro / local (sem acento, com abreviações "av", "r", "pres"..., tolera erro de digitação/voz);
 *   - acha o endereço de um ponto tocado no mapa (geocodificação reversa);
 *   - traça a rota (carro/moto, a pé, bicicleta) com passo a passo, mão única e rotatórias (A* no grafo das ruas);
 *   - entrega os traçados das ruas para anona-mapa.js desenhar o mapa em canvas.
 * Este arquivo só tem lógica (sem DOM): dá para testar no Node: node tests/mapa-offline.test.js
 * Limites: sem trânsito/obras; proibições de conversão não são consideradas (só mão única).
 */
(function (raiz) {
  'use strict';

  const BBOX = { sul: 2.74, oeste: -60.76, norte: 2.90, leste: -60.58 };      // Boa Vista e entorno
  const CIDADE = 'Boa Vista';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const PERFIS = { carro: { bit: 1, vmax: 22.2 }, pe: { bit: 2, vmax: 1.4 }, bike: { bit: 4, vmax: 4.8 } };
  const KY = 111320, RAD = Math.PI / 180, CEL = 0.002;                        // metros por grau de latitude; célula da grade (graus)

  // ---------- geometria ----------
  const kx = (lat) => KY * Math.cos(lat * RAD);
  const dist = (la1, lo1, la2, lo2) => Math.hypot((la2 - la1) * KY, (lo2 - lo1) * kx((la1 + la2) / 2));
  const rumo = (la1, lo1, la2, lo2) => (Math.atan2((lo2 - lo1) * Math.cos((la1 + la2) / 2 * RAD), la2 - la1) / RAD + 360) % 360;
  const angulo = (b1, b2) => (b2 - b1 + 540) % 360 - 180;                      // -180..180; positivo = direita
  function modDe(a) {
    const m = Math.abs(a);
    if (m < 30) return 'straight';
    const lado = a < 0 ? 'left' : 'right';
    return m < 60 ? 'slight ' + lado : m < 120 ? lado : m < 170 ? 'sharp ' + lado : 'uturn';
  }

  // ---------- regras das vias ----------
  // highway → [meios permitidos (1 carro, 2 a pé, 4 bicicleta), classe de desenho 0..6, velocidade do carro m/s]
  const HW = {
    motorway: [1, 0, 22], motorway_link: [1, 0, 15], trunk: [7, 0, 19], trunk_link: [7, 0, 14],
    primary: [7, 1, 15], primary_link: [7, 1, 12], secondary: [7, 2, 12], secondary_link: [7, 2, 10],
    tertiary: [7, 3, 10], tertiary_link: [7, 3, 9], unclassified: [7, 4, 9], residential: [7, 4, 8],
    living_street: [7, 4, 4], road: [7, 4, 8], service: [7, 5, 5], track: [7, 5, 4],
    footway: [2, 6, 0], pedestrian: [2, 6, 0], path: [6, 6, 0], steps: [2, 6, 0], cycleway: [4, 6, 0]
  };
  const SIM = ['yes', 'designated', 'permissive'], NAO = ['no', 'private'];
  function acessoVia(t) {
    const h = HW[t.highway]; if (!h) return 0;
    let ac = h[0];
    if (['no', 'private', 'customers', 'delivery', 'permit'].includes(t.access)) ac = 0;
    const modos = [[1, ['motorcar', 'motor_vehicle', 'vehicle']], [2, ['foot']], [4, ['bicycle']]];
    for (const [bit, chaves] of modos) for (const k of chaves) {
      const v = t[k]; if (!v) continue;
      if (NAO.includes(v)) ac &= ~bit; else if (SIM.includes(v) && bit !== 1) ac |= bit; else if (SIM.includes(v) && (h[0] & 1)) ac |= bit;
    }
    return ac;
  }
  function oneway(t) {
    if (t.junction === 'roundabout' || t.junction === 'circular') return 1;
    const o = t.oneway;
    if (o === 'yes' || o === 'true' || o === '1') return 1;
    if (o === '-1' || o === 'reverse') return -1;
    if (!o && (t.highway === 'motorway' || t.highway === 'motorway_link')) return 1;
    return 0;
  }
  function velCarro(t) {
    let v = HW[t.highway][2];
    const m = /^(\d{2,3})(?:\s*km\/h)?$/.exec(String(t.maxspeed || '').trim());
    if (m && v) v = Math.max(3, Math.min(22, +m[1] * 0.75 / 3.6));
    return v;
  }

  // ---------- texto ----------
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const ABREV = { av: 'avenida', avd: 'avenida', r: 'rua', tv: 'travessa', trav: 'travessa', pc: 'praca', pca: 'praca', al: 'alameda', rod: 'rodovia', est: 'estrada',
    pres: 'presidente', dr: 'doutor', dra: 'doutora', prof: 'professor', profa: 'professora', cel: 'coronel', gal: 'general', cap: 'capitao', ten: 'tenente',
    sen: 'senador', dep: 'deputado', eng: 'engenheiro', sta: 'santa', sto: 'santo', gov: 'governador', vereador: 'vereador', ver: 'vereador' };
  const IGNORAR = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ir', 'vou', 'para', 'pra', 'ate', 'numero', 'n', 'bairro', 'cep', 'levar', 'leve', 'me', 'navegar', 'destino', 'endereco', 'rota', 'roraima', 'rr', 'brasil', 'no', 'na', 'em']);
  const SOFT = new Set(['boa', 'vista']);
  const GENERICAS = new Set(['rua', 'avenida', 'travessa', 'alameda', 'praca', 'estrada', 'rodovia', 'beco', 'vila', 'via', 'largo', 'passagem']);
  const tokens = (s) => { const t = norm(s).split(' ').filter(Boolean).map(x => ABREV[x] || x); const u = t.filter(x => !IGNORAR.has(x)); return u.length ? u : t; };
  const ehNum = (t) => /^\d+$/.test(t);
  const requerido = (t) => !GENERICAS.has(t) && !SOFT.has(t);
  function lev(a, b) {
    const m = a.length, n = b.length; let p = new Array(n + 1), q = new Array(n + 1);
    for (let j = 0; j <= n; j++) p[j] = j;
    for (let i = 1; i <= m; i++) { q[0] = i; for (let j = 1; j <= n; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [p, q] = [q, p]; }
    return p[n];
  }
  function casaToken(q, s) {
    if (q === s) return true;
    if (ehNum(q) || ehNum(s)) return false;
    if (q.length >= 3 && s.startsWith(q)) return true;
    const lim = q.length >= 9 ? 2 : q.length >= 5 ? 1 : 0;
    return lim > 0 && Math.abs(q.length - s.length) <= lim && lev(q, s) <= lim;
  }

  // ---------- construtor do pacote (a partir de respostas da Overpass) ----------
  function novoConstrutor() {
    const idx = new Map(), nlat = [], nlng = [], ruas = [], ids = new Set(), sa = [], sb = [], sw = [];
    const bairros = [], enderecos = [], locais = [], vistos = new Set(), nomesBairro = new Set();
    const no = (id, la, lo) => { let i = idx.get(id); if (i === undefined) { i = nlat.length; idx.set(id, i); nlat.push(la); nlng.push(lo); } return i; };
    function addVias(els) {
      let n = 0;
      for (const e of els || []) {
        if (!e || e.type !== 'way' || !e.tags || !e.geometry || !e.nodes || ids.has(e.id) || e.nodes.length !== e.geometry.length) continue;
        const ac = acessoVia(e.tags); if (!ac) continue;
        ids.add(e.id);
        const wi = ruas.length, h = HW[e.tags.highway];
        ruas.push({ n: e.tags.name || e.tags.ref || '', h: e.tags.highway, ac, ow: oneway(e.tags), rt: (e.tags.junction === 'roundabout' || e.tags.junction === 'circular') ? 1 : 0, k: h[1], v: velCarro(e.tags) });
        for (let i = 0; i + 1 < e.nodes.length; i++) {
          const p = e.geometry[i], q = e.geometry[i + 1]; if (!p || !q) continue;
          const a = no(e.nodes[i], p.lat, p.lon), b = no(e.nodes[i + 1], q.lat, q.lon);
          if (a !== b) { sa.push(a); sb.push(b); sw.push(wi); }
        }
        n++;
      }
      return n;
    }
    function addExtras(els) {
      for (const e of els || []) {
        if (!e || !e.tags) continue;
        const k = e.type + e.id; if (vistos.has(k)) continue; vistos.add(k);
        const la = e.lat !== undefined ? e.lat : e.center && e.center.lat, lo = e.lon !== undefined ? e.lon : e.center && e.center.lon;
        if (!isFinite(la) || !isFinite(lo)) continue;
        const t = e.tags;
        if (/^(suburb|neighbourhood|quarter|city_district)$/.test(t.place || '') && t.name) {
          const nk = norm(t.name); if (!nomesBairro.has(nk)) { nomesBairro.add(nk); bairros.push({ n: t.name, lat: la, lng: lo }); }
        }
        if (t['addr:street'] && t['addr:housenumber']) enderecos.push({ r: t['addr:street'], n: String(t['addr:housenumber']), lat: la, lng: lo });
        if (t.name && (t.amenity || t.healthcare) && !t.place) locais.push({ n: t.name, lat: la, lng: lo });
      }
    }
    function finalizar() {
      return { v: 1, quando: Date.now(), nlat: Float64Array.from(nlat), nlng: Float64Array.from(nlng),
        segs: { a: Int32Array.from(sa), b: Int32Array.from(sb), w: Int32Array.from(sw) }, ruas, bairros, enderecos, locais };
    }
    return { addVias, addExtras, finalizar };
  }

  // ---------- motor ----------
  function criarMotor(p) {
    const nlat = p.nlat, nlng = p.nlng, sa = p.segs.a, sb = p.segs.b, sw = p.segs.w, ways = p.ruas, S = sa.length, N = nlat.length;
    const lugares = p.bairros || [], ends = p.enderecos || [], locs = p.locais || [];
    const slen = new Float32Array(S);
    for (let s = 0; s < S; s++) slen[s] = dist(nlat[sa[s]], nlng[sa[s]], nlat[sb[s]], nlng[sb[s]]);

    // grade espacial de segmentos
    const grade = new Map(), cy = (la) => Math.floor((la + 90) / CEL), cx = (lo) => Math.floor((lo + 180) / CEL), chave = (y, x) => y * 400000 + x;
    for (let s = 0; s < S; s++) {
      const la1 = nlat[sa[s]], la2 = nlat[sb[s]], lo1 = nlng[sa[s]], lo2 = nlng[sb[s]];
      for (let y = cy(Math.min(la1, la2)), y2 = cy(Math.max(la1, la2)); y <= y2; y++)
        for (let x = cx(Math.min(lo1, lo2)), x2 = cx(Math.max(lo1, lo2)); x <= x2; x++) { const k = chave(y, x); let l = grade.get(k); if (!l) grade.set(k, l = []); l.push(s); }
    }
    const carimbo = new Int32Array(S); let ciclo = 0;
    function segsNaCaixa(s0, w0, n0, e0) {
      ciclo++; const out = [];
      for (let y = cy(s0); y <= cy(n0); y++) for (let x = cx(w0); x <= cx(e0); x++) {
        const l = grade.get(chave(y, x)); if (!l) continue;
        for (const s of l) if (carimbo[s] !== ciclo) { carimbo[s] = ciclo; out.push(s); }
      }
      return out;
    }
    // ponto mais próximo de uma via que aceite algum dos meios em "bits"
    function encaixar(bits, lat, lng, maxM) {
      const k = kx(lat); let melhor = null; const y0 = cy(lat), x0 = cx(lng);
      for (let r = 0; r <= 4; r++) {
        for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
          if (Math.max(Math.abs(y - y0), Math.abs(x - x0)) !== r) continue;
          const l = grade.get(chave(y, x)); if (!l) continue;
          for (const s of l) {
            if (!(ways[sw[s]].ac & bits)) continue;
            const ax = (nlng[sa[s]] - lng) * k, ay = (nlat[sa[s]] - lat) * KY, bx = (nlng[sb[s]] - lng) * k - ax, by = (nlat[sb[s]] - lat) * KY - ay;
            const q = bx * bx + by * by; let t = q > 0 ? -(ax * bx + ay * by) / q : 0; t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(ax + t * bx, ay + t * by);
            if (!melhor || d < melhor.d) melhor = { s, t, d, lat: nlat[sa[s]] + t * (nlat[sb[s]] - nlat[sa[s]]), lng: nlng[sa[s]] + t * (nlng[sb[s]] - nlng[sa[s]]) };
          }
        }
        if (melhor && melhor.d <= r * CEL * KY * 0.9) break;
      }
      return melhor && melhor.d <= maxM ? melhor : null;
    }
    const dentro = (la, lo) => la >= BBOX.sul - 0.01 && la <= BBOX.norte + 0.01 && lo >= BBOX.oeste - 0.01 && lo <= BBOX.leste + 0.01;

    // ---------- grafo por meio de transporte ----------
    const G = {};
    const velSeg = (perfil, w) => perfil === 'carro' ? (w.v || 5) : PERFIS[perfil].vmax;
    const dirOk = (perfil, s, frente) => { const w = ways[sw[s]]; if (!(w.ac & PERFIS[perfil].bit)) return false; if (perfil === 'pe') return true; return frente ? w.ow !== -1 : w.ow !== 1; };
    function grafo(perfil) {
      if (G[perfil]) return G[perfil];
      const grau = new Int32Array(N + 1);
      for (let s = 0; s < S; s++) { if (dirOk(perfil, s, true)) grau[sa[s]]++; if (dirOk(perfil, s, false)) grau[sb[s]]++; }
      const off = new Int32Array(N + 1); for (let i = 0; i < N; i++) off[i + 1] = off[i] + grau[i];
      const M = off[N], eTo = new Int32Array(M), eSeg = new Int32Array(M), eFrom = new Int32Array(M), eFr = new Uint8Array(M), eCusto = new Float64Array(M), pos = off.slice(0, N);
      const poe = (de, para, s, fr) => { const e = pos[de]++; eTo[e] = para; eSeg[e] = s; eFrom[e] = de; eFr[e] = fr; eCusto[e] = slen[s] / velSeg(perfil, ways[sw[s]]); };
      for (let s = 0; s < S; s++) { if (dirOk(perfil, s, true)) poe(sa[s], sb[s], s, 1); if (dirOk(perfil, s, false)) poe(sb[s], sa[s], s, 0); }
      return (G[perfil] = { off, eTo, eSeg, eFrom, eFr, eCusto });
    }

    function rotear(perfil, o, d) {
      if (!PERFIS[perfil]) perfil = 'carro';
      if (!dentro(o.lat, o.lng) || !dentro(d.lat, d.lng)) return { erro: 'longe' };
      const bit = PERFIS[perfil].bit, so = encaixar(bit, o.lat, o.lng, 600), sd = encaixar(bit, d.lat, d.lng, 600);
      if (!so || !sd) return { erro: 'longe' };
      const g = grafo(perfil), vmax = PERFIS[perfil].vmax;
      const sec = (s, m) => m / velSeg(perfil, ways[sw[s]]);
      const peca = (s, la1, lo1, la2, lo2, de, para) => {
        const len = dist(la1, lo1, la2, lo2), w = ways[sw[s]];
        return { s, w: sw[s], nome: w.n, rt: w.rt, len, tempo: sec(s, len), b: rumo(la1, lo1, la2, lo2), de, para, la1, lo1, la2, lo2 };
      };
      let pecas = null;
      if (so.s === sd.s) {                                   // mesma via: direto, se o sentido permitir
        const frente = sd.t >= so.t;
        if (dirOk(perfil, so.s, frente)) pecas = [peca(so.s, so.lat, so.lng, sd.lat, sd.lng, -1, -1)];
      }
      if (!pecas) {
        const dist0 = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
        const hk = [], hv = [];
        const push = (k, v) => { let i = hk.length; hk.push(k); hv.push(v); while (i > 0) { const pa = (i - 1) >> 1; if (hk[pa] <= k) break; hk[i] = hk[pa]; hv[i] = hv[pa]; i = pa; } hk[i] = k; hv[i] = v; };
        const pop = () => {
          const k0 = hk[0], v0 = hv[0], k = hk.pop(), v = hv.pop();
          if (hk.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hk.length) break; if (c + 1 < hk.length && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = k; hv[i] = v; }
          return [k0, v0];
        };
        const h = (n) => dist(nlat[n], nlng[n], d.lat, d.lng) / vmax;
        const A = sa[so.s], B = sb[so.s], L0 = slen[so.s];
        if (dirOk(perfil, so.s, true)) { dist0[B] = sec(so.s, (1 - so.t) * L0); prev[B] = -2; push(dist0[B] + h(B), B); }
        if (dirOk(perfil, so.s, false)) { const c = sec(so.s, so.t * L0); if (c < dist0[A]) { dist0[A] = c; prev[A] = -3; push(c + h(A), A); } }
        const Ad = sa[sd.s], Bd = sb[sd.s], L1 = slen[sd.s];
        const extraA = dirOk(perfil, sd.s, true) ? sec(sd.s, sd.t * L1) : Infinity;           // chega em Ad e segue até o destino
        const extraB = dirOk(perfil, sd.s, false) ? sec(sd.s, (1 - sd.t) * L1) : Infinity;    // chega em Bd e volta até o destino
        let melhor = Infinity, fim = -1, fimA = true;
        while (hk.length) {
          const [f, u] = pop();
          if (f >= melhor) break;
          if (f > dist0[u] + h(u) + 1e-6) continue;
          if (u === Ad && dist0[u] + extraA < melhor) { melhor = dist0[u] + extraA; fim = u; fimA = true; }
          if (u === Bd && dist0[u] + extraB < melhor) { melhor = dist0[u] + extraB; fim = u; fimA = false; }
          for (let e = g.off[u]; e < g.off[u + 1]; e++) {
            const v = g.eTo[e], ng = dist0[u] + g.eCusto[e];
            if (ng < dist0[v]) { dist0[v] = ng; prev[v] = e; push(ng + h(v), v); }
          }
        }
        if (fim < 0) return { erro: 'semrota' };
        const arestas = []; let n = fim;
        while (prev[n] >= 0) { arestas.push(prev[n]); n = g.eFrom[prev[n]]; }
        arestas.reverse();
        const marca = prev[n];                                // -2: saiu para B; -3: saiu para A
        pecas = [];
        pecas.push(marca === -2 ? peca(so.s, so.lat, so.lng, nlat[B], nlng[B], -1, B) : peca(so.s, so.lat, so.lng, nlat[A], nlng[A], -1, A));
        for (const e of arestas) { const de = g.eFrom[e], pa = g.eTo[e]; pecas.push(peca(g.eSeg[e], nlat[de], nlng[de], nlat[pa], nlng[pa], de, pa)); }
        pecas.push(fimA ? peca(sd.s, nlat[Ad], nlng[Ad], sd.lat, sd.lng, Ad, -1) : peca(sd.s, nlat[Bd], nlng[Bd], sd.lat, sd.lng, Bd, -1));
      }
      // ponto exatamente num cruzamento: pedaços de comprimento ~0 não viram passo
      const uteis = pecas.filter(x => x.len >= 0.5); if (uteis.length) pecas = uteis;

      const coords = [[pecas[0].lo1, pecas[0].la1]];
      let distancia = 0, duracao = 0;
      for (const x of pecas) { coords.push([x.lo2, x.la2]); distancia += x.len; duracao += x.tempo; }

      // ---------- passo a passo ----------
      const saidas = (v, exceto) => { let c = 0; for (let e = g.off[v]; e < g.off[v + 1]; e++) if (g.eSeg[e] !== exceto) c++; return c; };
      const temSaida = (v) => { for (let e = g.off[v]; e < g.off[v + 1]; e++) if (!ways[sw[g.eSeg[e]]].rt) return true; return false; };
      const passos = [{ maneuver: { type: 'depart' }, name: pecas[0].nome, distance: pecas[0].len }];
      for (let i = 1; i < pecas.length; i++) {
        const a = pecas[i - 1], b = pecas[i], atual = passos[passos.length - 1], v = a.para;
        if (b.rt && !a.rt) {                                  // entrou na rotatória: conta as saídas até sair
          let saida = 0;
          for (let j = i; j < pecas.length && pecas[j].rt; j++) if (pecas[j].para >= 0 && temSaida(pecas[j].para)) saida++;
          passos.push({ maneuver: { type: 'roundabout', exit: Math.max(1, saida) }, name: '', distance: b.len }); continue;
        }
        if (b.rt && a.rt) { atual.distance += b.len; continue; }
        if (a.rt && !b.rt) {                                  // saiu da rotatória
          for (let j = passos.length - 1; j >= 0; j--) if (passos[j].maneuver.type === 'roundabout') { passos[j].name = b.nome; break; }
          passos.push({ maneuver: { type: 'exit roundabout' }, name: b.nome, distance: b.len }); continue;
        }
        const ang = angulo(a.b, b.b), mesmo = a.w === b.w || (a.nome && a.nome === b.nome);
        const decisao = v >= 0 && saidas(v, a.s) >= 2;
        if (mesmo && (Math.abs(ang) < 45 || !decisao)) { atual.distance += b.len; continue; }
        if (!mesmo && Math.abs(ang) < 30) {
          if (!a.nome && !b.nome) { atual.distance += b.len; continue; }
          passos.push({ maneuver: { type: 'new name', modifier: 'straight' }, name: b.nome, distance: b.len }); continue;
        }
        if (Math.abs(ang) < 30) { atual.distance += b.len; continue; }
        let tipo = 'turn';
        if (decisao && Math.abs(ang) >= 60 && Math.abs(ang) < 170) {   // "fim da via": nenhuma saída seguindo em frente
          let frente = false;
          for (let e = g.off[v]; e < g.off[v + 1]; e++) { if (g.eSeg[e] === a.s) continue; const t = g.eTo[e]; if (Math.abs(angulo(a.b, rumo(nlat[v], nlng[v], nlat[t], nlng[t]))) < 30) frente = true; }
          if (!frente) tipo = 'end of road';
        }
        passos.push({ maneuver: { type: tipo, modifier: modDe(ang) }, name: b.nome, distance: b.len });
      }
      passos.push({ maneuver: { type: 'arrive' }, name: '', distance: 0 });
      return { distance: distancia, duration: duracao, geometry: { type: 'LineString', coordinates: coords }, legs: [{ steps: passos }] };
    }

    // ---------- busca ----------
    const ruasPorNome = new Map();
    for (let s = 0; s < S; s++) {
      const w = ways[sw[s]]; if (!w.n) continue;
      const toks = tokens(w.n), k = toks.join(' '); let r = ruasPorNome.get(k);
      if (!r) ruasPorNome.set(k, r = { nome: w.n, toks, segs: [], k });
      r.segs.push(s);
    }
    const listaRuas = [...ruasPorNome.values()];
    const bairrosIdx = lugares.map(b => ({ b, toks: tokens(b.n) }));
    const locaisIdx = locs.map(l => ({ l, toks: tokens(l.n) }));
    const endsPorRua = new Map();
    for (const a of ends) { const k = tokens(a.r).join(' '); let l = endsPorRua.get(k); if (!l) endsPorRua.set(k, l = []); l.push({ num: parseInt(a.n, 10), lat: a.lat, lng: a.lng }); }

    function bairroPerto(lat, lng) {
      let m = null, dm = Infinity;
      for (const b of lugares) { const d = dist(lat, lng, b.lat, b.lng); if (d < dm) { dm = d; m = b; } }
      return m;
    }
    const rot = (nome, lat, lng) => { const b = bairroPerto(lat, lng); return nome + (b ? ' — ' + b.n : '') + ' — ' + CIDADE; };
    function centro(r) {
      if (!r.c) { let la = 0, lo = 0; for (const s of r.segs) { la += nlat[sa[s]]; lo += nlng[sa[s]]; } r.c = { lat: la / r.segs.length, lng: lo / r.segs.length }; }
      return r.c;
    }
    function pontoNaRua(r, alvo) {
      const c = alvo || centro(r); let m = r.segs[0], dm = Infinity;
      for (const s of r.segs) { const d = dist((nlat[sa[s]] + nlat[sb[s]]) / 2, (nlng[sa[s]] + nlng[sb[s]]) / 2, c.lat, c.lng); if (d < dm) { dm = d; m = s; } }
      return { lat: (nlat[sa[m]] + nlat[sb[m]]) / 2, lng: (nlng[sa[m]] + nlng[sb[m]]) / 2 };
    }
    function avaliarRua(qt, st) {
      let acertos = 0, tipoOk = true, req = 0;
      for (const q of qt) {
        const hit = st.some(s => casaToken(q, s));
        if (GENERICAS.has(q)) { if (!hit) tipoOk = false; continue; }
        if (SOFT.has(q)) continue;
        req++; if (!hit) return null; acertos++;
      }
      if (!req) return null;
      const ncg = st.filter(s => !GENERICAS.has(s)).length || 1;
      const perfeito = st.every(s => GENERICAS.has(s) || qt.some(q => casaToken(q, s)));
      return { score: 1 + Math.min(1, acertos / ncg) + (tipoOk ? 0.3 : 0), perfeito };
    }
    function ruasQue(qt) {
      const m = [];
      for (const r of listaRuas) { const a = avaliarRua(qt, r.toks); if (a) m.push({ r, score: a.score, perfeito: a.perfeito }); }
      m.sort((x, y) => y.score - x.score || x.r.nome.length - y.r.nome.length);
      return m.slice(0, 8);
    }
    function achaBairro(toks) {
      let m = null;
      for (const bi of bairrosIdx) {
        if (!bi.toks.length || (bi.toks.length === 1 && bi.toks[0].length < 4)) continue;
        const usados = new Set();
        const todos = bi.toks.every(t => { const i = toks.findIndex((q, k) => !usados.has(k) && casaToken(q, t)); if (i < 0) return false; usados.add(i); return true; });
        if (todos && (!m || bi.toks.length > m.bi.toks.length)) m = { bi, usados };
      }
      return m;
    }
    function itemDeRua(r, numero, bpt) {
      const ref = bpt || null;
      if (numero) {
        const lista = (endsPorRua.get(r.k) || []).filter(a => isFinite(a.num));
        const exatos = lista.filter(a => a.num === +numero);
        if (exatos.length) {
          const a = exatos.reduce((x, y) => ref && dist(y.lat, y.lng, ref.lat, ref.lng) < dist(x.lat, x.lng, ref.lat, ref.lng) ? y : x);
          return { lat: a.lat, lng: a.lng, rotulo: rot(r.nome + ', ' + numero, a.lat, a.lng), tipo: 'endereco', exato: true, aviso: '' };
        }
        const par = (a) => a.num % 2 === +numero % 2;
        const abaixo = lista.filter(a => par(a) && a.num < +numero).sort((x, y) => y.num - x.num)[0];
        const acima = lista.filter(a => par(a) && a.num > +numero).sort((x, y) => x.num - y.num)[0];
        if (abaixo && acima && dist(abaixo.lat, abaixo.lng, acima.lat, acima.lng) < 600) {
          const f = (+numero - abaixo.num) / (acima.num - abaixo.num), la = abaixo.lat + f * (acima.lat - abaixo.lat), lo = abaixo.lng + f * (acima.lng - abaixo.lng);
          return { lat: la, lng: lo, rotulo: rot(r.nome + ', ' + numero, la, lo), tipo: 'rua', exato: false, aviso: 'O número ' + numero + ' não está no mapa offline: o ponto é aproximado (pela numeração vizinha).' };
        }
        const pt = pontoNaRua(r, ref);
        return { lat: pt.lat, lng: pt.lng, rotulo: rot(r.nome + ', ' + numero, pt.lat, pt.lng), tipo: 'rua', exato: false, aviso: 'O número ' + numero + ' não está no mapa offline: o ponto marcado é o meio da rua.' };
      }
      const pt = pontoNaRua(r, ref);
      return { lat: pt.lat, lng: pt.lng, rotulo: rot(r.nome, pt.lat, pt.lng), tipo: 'rua', exato: false, aviso: '' };
    }
    function buscar(texto, max) {
      max = max || 6;
      const toks = tokens(texto); if (!toks.length) return [];
      let b = achaBairro(toks), rest = toks;
      if (b) { rest = toks.filter((t, i) => !b.usados.has(i)); if (!rest.some(requerido)) { rest = toks; b = null; } }
      const bpt = b ? b.bi.b : null, itens = [];
      if (rest.some(requerido)) {
        const dig = rest.map((t, i) => ehNum(t) && t.length <= 5 ? i : -1).filter(i => i >= 0);
        let feito = false;
        if (dig.length) {
          const cheio = ruasQue(rest);
          if (cheio.length && cheio[0].perfeito) { cheio.forEach(m => itens.push(Object.assign(itemDeRua(m.r, '', bpt), { _s: m.score }))); feito = true; }
          if (!feito) {
            const i = dig[dig.length - 1], qt = rest.filter((t, k) => k !== i);
            if (qt.some(requerido)) { const m = ruasQue(qt); if (m.length) { m.forEach(x => itens.push(Object.assign(itemDeRua(x.r, rest[i], bpt), { _s: x.score }))); feito = true; } }
          }
        }
        if (!feito) ruasQue(rest).forEach(m => itens.push(Object.assign(itemDeRua(m.r, '', bpt), { _s: m.score })));
        const req = rest.filter(requerido);
        for (const li of locaisIdx) if (req.every(q => li.toks.some(t => casaToken(q, t)))) itens.push({ lat: li.l.lat, lng: li.l.lng, rotulo: rot(li.l.n, li.l.lat, li.l.lng), tipo: 'local', exato: false, aviso: '', _s: 0.5 + 0.5 * Math.min(1, req.length / li.toks.length) });
      }
      const reqT = toks.filter(requerido);
      if (reqT.length) for (const bi of bairrosIdx) if (reqT.every(q => bi.toks.some(t => casaToken(q, t)))) itens.push({ lat: bi.b.lat, lng: bi.b.lng, rotulo: bi.b.n + ' — ' + CIDADE, tipo: 'bairro', exato: false, aviso: '', _s: bi.toks.length === reqT.length ? 1.5 : 0.6 });
      itens.sort((x, y) => y._s - x._s);
      const out = [], vistosR = new Set();
      for (const it of itens) { if (vistosR.has(it.rotulo)) continue; vistosR.add(it.rotulo); delete it._s; out.push(it); if (out.length >= max) break; }
      return out;
    }

    // ---------- reverso ----------
    function reverso(lat, lng) {
      if (!dentro(lat, lng)) return null;
      let m = null, dm = Infinity;
      for (const a of ends) { const d = dist(lat, lng, a.lat, a.lng); if (d < dm) { dm = d; m = a; } }
      if (m && dm <= 25) return { rotulo: rot(m.r + ', ' + m.n, lat, lng), lat, lng };
      const sn = encaixar(7, lat, lng, 80);
      if (sn) { const nome = ways[sw[sn.s]].n; if (nome) return { rotulo: rot(nome, lat, lng), lat, lng }; }
      const bp = bairroPerto(lat, lng);
      return bp && dist(lat, lng, bp.lat, bp.lng) < 1500 ? { rotulo: bp.n + ' — ' + CIDADE, lat, lng } : null;
    }

    const info = () => ({ quando: p.quando, ruas: listaRuas.length, segmentos: S, bairros: lugares.length, enderecos: ends.length, locais: locs.length });
    const dados = { nlat, nlng, sa, sb, sw, ways, lugares, rank: (wi) => ways[wi] ? ways[wi].k : undefined };
    return { rotear, buscar, reverso, dentro, info, segsNaCaixa, dados };
  }

  // ---------- download (Overpass) ----------
  const FILTRO_VIAS = '["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|road|service|track|footway|pedestrian|path|cycleway|steps)$"]["service"!~"^(parking_aisle|driveway|drive-through)$"]';
  const caixa = (s, w, n, e) => '(' + s + ',' + w + ',' + n + ',' + e + ')';
  const consultaVias = (c) => '[out:json][timeout:120];way' + FILTRO_VIAS + caixa(c[0], c[1], c[2], c[3]) + ';out geom;';
  const consultaExtras = () => '[out:json][timeout:120];(nwr["place"~"^(suburb|neighbourhood|quarter|city_district)$"]["name"]' + caixa(BBOX.sul, BBOX.oeste, BBOX.norte, BBOX.leste) +
    ';nwr["addr:housenumber"]["addr:street"]' + caixa(BBOX.sul, BBOX.oeste, BBOX.norte, BBOX.leste) +
    ';nwr["name"]["amenity"~"^(school|kindergarten|college|university|clinic|hospital|doctors|pharmacy|social_facility|townhall|police|fire_station|community_centre|bank|marketplace|place_of_worship)$"]' + caixa(BBOX.sul, BBOX.oeste, BBOX.norte, BBOX.leste) + ';);out center;';
  function pedacos() {
    const lats = [2.74, 2.82, 2.90], lngs = [-60.76, -60.70, -60.64, -60.58], out = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) out.push([lats[i], lngs[j], lats[i + 1], lngs[j + 1]]);
    return out;
  }
  const dorme = (ms) => new Promise(r => setTimeout(r, ms));

  async function baixar(op) {
    op = op || {};
    const buscarFn = op.buscar || ((u, o) => fetch(u, o)), pausa = op.pausa === undefined ? 1000 : op.pausa;
    const partes = pedacos(), total = partes.length + 1, c = novoConstrutor();
    let feito = 0;
    const avisa = (texto) => { if (op.onProgresso) op.onProgresso({ feito, total, texto }); };
    const cancelado = () => { if (op.sinal && op.sinal.aborted) throw new Error('Download cancelado.'); };
    async function pedir(consulta) {
      let ultimo = null;
      for (let tentativa = 0; tentativa < 2; tentativa++) for (const url of OVERPASS) {
        cancelado();
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 150000);
        const fora = () => ctl.abort(); if (op.sinal) op.sinal.addEventListener('abort', fora, { once: true });
        try {
          const r = await buscarFn(url, { method: 'POST', body: 'data=' + encodeURIComponent(consulta), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json(); if (!j || !Array.isArray(j.elements)) throw new Error('resposta inválida');
          return j.elements;
        } catch (e) { cancelado(); ultimo = e; await dorme(pausa * 2); }
        finally { clearTimeout(t); if (op.sinal) op.sinal.removeEventListener('abort', fora); }
      }
      throw new Error('Não consegui baixar o mapa agora (o servidor do OpenStreetMap está ocupado ou sem conexão). Tente de novo em alguns minutos.' + (ultimo && ultimo.message ? ' [' + ultimo.message + ']' : ''));
    }
    for (let i = 0; i < partes.length; i++) {
      avisa('Baixando as ruas (parte ' + (i + 1) + ' de ' + partes.length + ')…');
      c.addVias(await pedir(consultaVias(partes[i]))); feito++;
      if (pausa) await dorme(pausa);
    }
    avisa('Baixando bairros, endereços e locais…');
    c.addExtras(await pedir(consultaExtras())); feito++;
    avisa('Organizando o mapa…');
    const pacote = c.finalizar();
    if (pacote.segs.a.length < (op.minSegmentos || 200)) throw new Error('O mapa baixado veio quase vazio. Tente de novo mais tarde.');
    let meta = null, erroGuardar = null;
    if (!op.semGuardar) { try { meta = await guardar(pacote); } catch (e) { erroGuardar = e; } }   // sem espaço: ainda dá para usar nesta sessão
    return { pacote, meta, erroGuardar };
  }

  // ---------- armazenamento (IndexedDB) ----------
  function abrirBanco() {
    return new Promise((ok, falha) => {
      if (typeof indexedDB === 'undefined') return falha(new Error('Este navegador não guarda dados offline (IndexedDB indisponível).'));
      const rq = indexedDB.open('anona-mapa-offline', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('dados');
      rq.onsuccess = () => ok(rq.result);
      rq.onerror = () => falha(rq.error || new Error('Não consegui abrir o armazenamento do aparelho.'));
    });
  }
  async function ide(modo, fn) {
    const db = await abrirBanco();
    try {
      return await new Promise((ok, falha) => {
        const tx = db.transaction('dados', modo), st = tx.objectStore('dados'); let res;
        res = fn(st);
        tx.oncomplete = () => ok(res && typeof res === 'object' && 'result' in res ? res.result : undefined);
        tx.onerror = () => falha(tx.error || new Error('Falha ao gravar/ler no aparelho.'));
        tx.onabort = () => falha(tx.error || new Error('Sem espaço no aparelho para guardar o mapa.'));
      });
    } finally { db.close(); }
  }
  async function guardar(pacote) {
    const meta = { quando: pacote.quando, ruas: pacote.ruas.length, bairros: pacote.bairros.length, enderecos: pacote.enderecos.length, locais: pacote.locais.length,
      bytes: pacote.nlat.byteLength * 2 + pacote.segs.a.byteLength * 3 };
    await ide('readwrite', (st) => { st.put(pacote, 'pacote'); st.put(meta, 'meta'); });
    return meta;
  }
  const carregar = async () => (await ide('readonly', (st) => st.get('pacote'))) || null;
  const lerMeta = async () => (await ide('readonly', (st) => st.get('meta'))) || null;
  const apagar = () => ide('readwrite', (st) => { st.delete('pacote'); st.delete('meta'); });

  const api = { BBOX, baixar, criarMotor, novoConstrutor, carregar, apagar, lerMeta, guardar,
    _teste: { rumo, angulo, modDe, acessoVia, oneway, tokens, casaToken } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.AnonaMapaOffline = api;
})(typeof window !== 'undefined' ? window : this);
