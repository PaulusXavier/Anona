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

console.log('mapa-util.test.js: tudo certo');
