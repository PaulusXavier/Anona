const assert = require('assert');
const U = require('../anona-mapa-util.js');

// coordenadas e links
assert.deepStrictEqual(U.lerCoordenadas('2.8235, -60.6758'), { lat: 2.8235, lng: -60.6758 });
assert.deepStrictEqual(U.lerCoordenadas('2,8235 -60,6758'), { lat: 2.8235, lng: -60.6758 });
assert.deepStrictEqual(U.lerCoordenadas('(2.82350; -60.67580)'), { lat: 2.8235, lng: -60.6758 });
assert.deepStrictEqual(U.lerCoordenadas('https://www.google.com/maps/place/X/@2.8235,-60.6758,17z'), { lat: 2.8235, lng: -60.6758 });
assert.deepStrictEqual(U.lerCoordenadas('https://maps.google.com/?q=2.8235,-60.6758'), { lat: 2.8235, lng: -60.6758 });
assert.strictEqual(U.lerCoordenadas('Rua 7 de Setembro, 245'), null);
assert.strictEqual(U.lerCoordenadas('Rua Santo Agostinho 193'), null);
assert.strictEqual(U.lerCoordenadas('95.1234, -60.1234'), null, 'latitude fora do intervalo');
assert.strictEqual(U.lerCoordenadas(''), null);

// tirar o número da casa só quando ele é mesmo o número
assert.deepStrictEqual(U.semNumero('Rua Santo Agostinho, 193, Centenário'), { texto: 'Rua Santo Agostinho, Centenário', numero: '193' });
assert.deepStrictEqual(U.semNumero('Rua Santo Agostinho 193'), { texto: 'Rua Santo Agostinho', numero: '193' });
assert.deepStrictEqual(U.semNumero('Av. Ville Roy, nº 1000'), { texto: 'Av. Ville Roy', numero: '1000' });
assert.strictEqual(U.semNumero('Rua 7 de Setembro'), null, 'o 7 faz parte do nome da rua');
assert.deepStrictEqual(U.semNumero('Rua 7 de Setembro, 245'), { texto: 'Rua 7 de Setembro', numero: '245' });
assert.strictEqual(U.semNumero('Centenário'), null);

// distância ao traçado e progresso
const pontos = [[2.80, -60.70], [2.80, -60.69], [2.81, -60.69]];       // vai para leste e depois para norte
const cum = U.acumulado(pontos);
assert(Math.abs(cum[1] - 1111) < 15 && Math.abs(cum[2] - 2222) < 30, 'acumulado: ' + cum.join(','));
let p = U.projetar({ lat: 2.80, lng: -60.695 }, pontos, cum);            // em cima do primeiro trecho, na metade
assert(p.dist < 2 && Math.abs(p.ao_longo - 555) < 15, JSON.stringify(p));
p = U.projetar({ lat: 2.805, lng: -60.6891 }, pontos, cum);              // ~110 m a oeste do segundo trecho
assert(p.dist > 90 && p.dist < 130 && Math.abs(p.ao_longo - (cum[1] + 555)) < 20, JSON.stringify(p));
assert.deepStrictEqual(U.pontoNoTraco(pontos, cum, 0), pontos[0]);
assert.deepStrictEqual(U.pontoNoTraco(pontos, cum, 1e9), pontos[2]);
const meio = U.pontoNoTraco(pontos, cum, cum[1] / 2); assert(Math.abs(meio[1] - -60.695) < 1e-4 && meio[0] === 2.80);

// posição dos passos: sem maneuver.location (mapa offline) e com (OSRM)
const passos = [{ maneuver: { type: 'depart' }, distance: cum[1] }, { maneuver: { type: 'turn', modifier: 'left' }, distance: cum[2] - cum[1] }, { maneuver: { type: 'arrive' }, distance: 0 }];
let loc = U.localizarPassos(passos, pontos, cum);
assert(Math.abs(loc[0].inicio) < 1 && Math.abs(loc[1].inicio - cum[1]) < 5 && Math.abs(loc[2].inicio - cum[2]) < 5, JSON.stringify(loc));
assert(Math.abs(loc[1].lat - 2.80) < 1e-3 && Math.abs(loc[1].lng - -60.69) < 1e-3);
passos[1].maneuver.location = [-60.69, 2.80];
loc = U.localizarPassos(passos, pontos, cum);
assert(Math.abs(loc[1].inicio - cum[1]) < 5);
assert.strictEqual(U.passoAtual(loc, 100), 0);
assert.strictEqual(U.passoAtual(loc, cum[1] + 50), 1);
assert.strictEqual(U.passoAtual(loc, cum[2] + 50), 2);

// textos
assert.strictEqual(U.fmtDist(95), '100 m'); assert.strictEqual(U.fmtDist(1500), '1,5 km'); assert.strictEqual(U.fmtDist(12400), '12 km');
assert.strictEqual(U.fmtTempo(20), '1 min'); assert.strictEqual(U.fmtTempo(3600), '1 h'); assert.strictEqual(U.fmtTempo(4500), '1 h 15 min');
assert.strictEqual(U.horaChegada(600, new Date(2026, 10, 15, 13, 55).getTime()), '14:05');
assert.strictEqual(U.seta({ maneuver: { type: 'turn', modifier: 'right' } }), '↱');
assert.strictEqual(U.seta({ maneuver: { type: 'arrive' } }), '⚑');
assert.strictEqual(U.seta({ maneuver: { type: 'roundabout' } }), '⟳');

// ordem das paradas: pontos em linha, embaralhados, saindo do início e terminando no fim
const org = { lat: 2.80, lng: -60.70 }, fim = { lat: 2.80, lng: -60.60 };
const emb = [60.66, 60.62, 60.68, 60.64].map((x) => ({ lat: 2.80, lng: -x }));
const ord = U.ordenarParadas(org, emb, fim).map((q) => -q.lng);
assert.deepStrictEqual(ord, [60.68, 60.66, 60.64, 60.62], 'ordem: ' + ord.join(','));
assert.strictEqual(emb[0].lng, -60.66, 'não altera a lista original');
assert.deepStrictEqual(U.ordenarParadas(org, [emb[0]], fim), [emb[0]]);


// horários: saída planejada, tempo de visita nas paradas do meio (não no destino)
const base = new Date(2026, 10, 16, 7, 0, 0).getTime();                       // 16/11/2026 07:00
assert.strictEqual(U.inicioDe('08:30', base), new Date(2026, 10, 16, 8, 30, 0).getTime());
assert.strictEqual(U.inicioDe('', base), base); assert.strictEqual(U.inicioDe('25:00', base), base); assert.strictEqual(U.inicioDe('abc', base), base);
assert.strictEqual(U.fmtHora(new Date(2026, 10, 16, 8, 5).getTime()), '08:05');
const pernas3 = [{ distance: 2000, duration: 600 }, { distance: 1000, duration: 300 }, { distance: 500, duration: 120 }];
let cr = U.cronograma(pernas3, { inicio: base, visitaMin: 30 });
assert.deepStrictEqual(cr.etapas.map(e => U.fmtHora(e.chegada)), ['07:10', '07:45', '08:17'], 'chegadas: ' + cr.etapas.map(e => U.fmtHora(e.chegada)));
assert.strictEqual(U.fmtHora(cr.fim), '08:17'); assert.strictEqual(cr.parado, 3600); assert.strictEqual(cr.dist, 3500); assert.strictEqual(cr.dur, 1020);
cr = U.cronograma(pernas3, { inicio: base });                                   // sem tempo de visita
assert.deepStrictEqual(cr.etapas.map(e => U.fmtHora(e.chegada)), ['07:10', '07:15', '07:17']); assert.strictEqual(cr.parado, 0);
cr = U.cronograma([{ distance: 900, duration: 300 }], { inicio: base, visitaMin: 45 });   // sem paradas: visita não conta
assert.strictEqual(U.fmtHora(cr.fim), '07:05'); assert.strictEqual(cr.parado, 0);
assert.deepStrictEqual(U.cronograma([], { inicio: base }).etapas, []);

// chegou na parada? raio acompanha a precisão do GPS (35 a 80 m)
const par = { lat: 2.8235, lng: -60.6758 };
assert.strictEqual(U.alcancouParada({ lat: 2.82365, lng: -60.6758 }, par, 10), true, '~17 m, GPS bom');
assert.strictEqual(U.alcancouParada({ lat: 2.8245, lng: -60.6758 }, par, 10), false, '~110 m está longe');
assert.strictEqual(U.alcancouParada({ lat: 2.8240, lng: -60.6758 }, par, 70), true, '~55 m com GPS impreciso (70 m)');
assert.strictEqual(U.alcancouParada({ lat: 2.8240, lng: -60.6758 }, par, 5), false, '~55 m com GPS bom ainda não chegou');
assert.strictEqual(U.alcancouParada(null, par, 5), false);

// texto do roteiro
cr = U.cronograma(pernas3, { inicio: base, visitaMin: 30 });
const txt = U.roteiroTexto({ modo: 'carro/moto', origem: 'Rua Santo Agostinho, 193 — Centenário', paradas: [{ rotulo: 'Rua A' }, { rotulo: 'Rua B' }], destino: { rotulo: 'Rua C' }, cron: cr, inicio: base, planejado: true });
assert(/^Roteiro \(carro\/moto\) — saída às 07:00$/m.test(txt), txt);
assert(/^Parada 1: Rua A — chegada 07:10 \(2,0 km, 10 min\) · visita 30 min$/m.test(txt), txt);
assert(/^Parada 2: Rua B — chegada 07:45 \(1,0 km, 5 min\) · visita 30 min$/m.test(txt), txt);
assert(/^Destino: Rua C — chegada 08:17 \(500 m, 2 min\)$/m.test(txt), txt);
assert(/^Deslocamento: 3,5 km · 17 min \+ 1 h de visitas$/m.test(txt), txt);
assert(/^Fim previsto: 08:17$/m.test(txt), txt);


// ---- voz, faltam, lista colada, horário limite, atalhos ----
assert.strictEqual(U.distFala(380), '400 metros'); assert.strictEqual(U.distFala(1000), '1 quilômetro'); assert.strictEqual(U.distFala(2540), '2,5 quilômetros'); assert.strictEqual(U.distFala(5), '10 metros');
assert.strictEqual(U.estagioAviso(30), 3); assert.strictEqual(U.estagioAviso(100), 2); assert.strictEqual(U.estagioAviso(300, 900), 1); assert.strictEqual(U.estagioAviso(300, 300), 0); assert.strictEqual(U.estagioAviso(900, 2000), 0); assert.strictEqual(U.estagioAviso(NaN), 0);
assert.deepStrictEqual(U.restante(1000, 250, 600), { dist: 750, dur: 450 }); assert.deepStrictEqual(U.restante(1000, 5000, 600), { dist: 0, dur: 0 }); assert.deepStrictEqual(U.restante(0, 0, 600), { dist: 0, dur: 0 });
assert.deepStrictEqual(U.listaDeEnderecos('1) Rua A, 10\n- Rua B, 20; Rua C 30\n\nrua a, 10\n12. Av D'), { itens: ['Rua A, 10', 'Rua B, 20', 'Rua C 30', 'Av D'], cortados: 0 });
assert.strictEqual(U.listaDeEnderecos('13 de Setembro, Rua X\nRua 7 de Setembro, 5').itens[0], '13 de Setembro, Rua X');   // "13 de" não é numeração
const dez = Array.from({ length: 12 }, (_, i) => 'Rua ' + (i + 1) + ', 1').join('\n'); assert.deepStrictEqual([U.listaDeEnderecos(dez, 9).itens.length, U.listaDeEnderecos(dez, 9).cortados], [9, 3]);
const t1630 = new Date(2026, 0, 1, 16, 30).getTime(), t1740 = new Date(2026, 0, 1, 17, 40).getTime();
assert.strictEqual(U.folga(t1630, '17:00'), 30); assert.strictEqual(U.folga(t1740, '17:00'), -40); assert.strictEqual(U.folga(t1630, ''), null); assert.strictEqual(U.folga(t1630, '25:00'), null);
assert.strictEqual(U.linkWaze({ lat: 2.8235, lng: -60.6758 }), 'https://waze.com/ul?ll=2.823500,-60.675800&navigate=yes');
assert.strictEqual(decodeURIComponent(U.linkWhats('Rota\nDestino: Rua A, 1')), 'https://wa.me/?text=Rota\nDestino: Rua A, 1'.replace('https://wa.me/?text=', 'https://wa.me/?text='));
// visita individual por parada (null = padrão); o destino não tem visita
const c3 = U.cronograma([{ distance: 1000, duration: 300 }, { distance: 1000, duration: 300 }, { distance: 1000, duration: 300 }], { inicio: 0, visitaMin: 30, visitas: [10, null] });
assert.strictEqual(c3.parado, (10 + 30) * 60); assert.strictEqual(c3.fim, (900 + 2400) * 1000); assert.strictEqual(c3.etapas[1].chegada, (300 + 600 + 300) * 1000);
assert(Math.abs(U.comprimento({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0.01 }], { lat: 0, lng: 0.02 }) - U.distM({ lat: 0, lng: 0 }, { lat: 0, lng: 0.02 })) < 1);
assert(/Parada 1: Rua A — chegada 07:10 \(2,0 km, 10 min\) · visita 30 min$/m.test(U.roteiroTexto({ modo: 'x', origem: 'P', paradas: [{ rotulo: 'Rua A' }], destino: { rotulo: 'Rua C' }, cron: U.cronograma(pernas3.slice(0, 2), { inicio: base, visitaMin: 30 }), inicio: base, planejado: true })));
console.log('mapa-util.test.js: tudo certo');
