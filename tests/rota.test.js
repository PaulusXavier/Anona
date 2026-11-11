// Rodar: node tests/rota.test.js
const assert = require('assert');
const R = require('../anona-rota.js');
const eq = assert.strictEqual;

eq(R.tituloCaso('RUA SANTO AGOSTINHO'), 'Rua Santo Agostinho');
eq(R.tituloCaso('RUA 7 DE SETEMBRO'), 'Rua 7 de Setembro');

const it = (s, x, y) => ({ str: s, transform: [1, 0, 0, 1, x, y] });
assert.deepStrictEqual(R.linhasDeItens([it('193', 300, 500), it('Número:', 250, 501), it('Endereço: RUA SANTO AGOSTINHO', 20, 500), it('Nome', 20, 700)]),
  ['Nome', 'Endereço: RUA SANTO AGOSTINHO Número: 193']);

let e = R.extrairEndereco(['Tipo de logradouro: RUA Nome do logradouro: SANTO AGOSTINHO Número: 193 Complemento: CASA Bairro: CENTENARIO CEP: 69312-000']);
eq(e.rua, 'Rua Santo Agostinho'); eq(e.numero, '193'); eq(e.bairro, 'Centenario');

e = R.extrairEndereco(['Nome: FULANO DE TAL', 'Tipo de logradouro: RUA Nome: SANTO AGOSTINHO Número: 193 Bairro: CENTENARIO']);
eq(e.rua, 'Rua Santo Agostinho'); eq(e.numero, '193');

e = R.extrairEndereco(['3. ENDEREÇO', 'Tipo de logradouro: AVENIDA', 'Logradouro: CAPITAO ENE GARCEZ', 'Número: S/N', 'Bairro: 13 DE SETEMBRO']);
eq(e.rua, 'Avenida Capitao Ene Garcez'); eq(e.numero, 'S/N'); eq(e.bairro, '13 de Setembro');

e = R.extrairEndereco(['Logradouro: RUA 7 DE SETEMBRO Número: 245 Bairro: 13 DE SETEMBRO']);
eq(e.rua, 'Rua 7 de Setembro'); eq(e.numero, '245');

e = R.extrairEndereco(['Responsável: FULANO DE TAL', 'Endereço: Rua Sete, 245 - 13 de Setembro']);
eq(e.rua, 'Rua Sete'); eq(e.numero, '245'); eq(e.bairro, '13 de Setembro');

e = R.extrairEndereco(['Visita ao domicílio na AV. CAPITAO ENE GARCEZ nº 1500, Centro']);
eq(e.rua, 'Avenida Capitao Ene Garcez'); eq(e.numero, '1500');

// Folha Resumo do Cadastro Único: campos numerados, vários por linha, número com zeros à esquerda
e = R.extrairEndereco(['II - ENDEREÇO DA FAMÍLIA', '1.11 - Localidade: 13 DE SETEMBRO', '1.12 - Tipo: AVENIDA 1.13 - Título:',
  '1.14 - Nome: ELDORADO', '1.15 - Número: 0000000000000046 1.16 - Complemento do Número:', '1.17 - Complemento Adicional: CASA',
  '1.18 - Cep: 69308000 1.20 - Referência para Localização:', 'III - COMPONENTES DA FAMÍLIA', '4.02 - Nome Completo: FULANA DE TAL']);
eq(e.rua, 'Avenida Eldorado'); eq(e.numero, '46'); eq(e.bairro, '13 de Setembro');

eq(R.extrairEndereco(['Folha sem endereço nenhum']), null);

// ordem: rua de partida primeiro, depois alfabética, por número; S/N e sem número no fim da rua
const itens = ['Rua Zeca, 10', 'Rua Santo Agostinho, nº 200', 'Rua Alfa, 50', 'Rua Santo Agostinho, 193', 'Rua Alfa, S/N', 'Av. Alfa, 7', 'Rua Alfa, 8']
  .map(endereco => ({ endereco }));
const o = R.ordenarPorRota(itens, 'Rua Santo Agostinho, nº 193 — Centenário, Boa Vista/RR').map(x => x.endereco);
assert.deepStrictEqual(o, ['Rua Santo Agostinho, 193', 'Rua Santo Agostinho, nº 200', 'Av. Alfa, 7', 'Rua Alfa, 8', 'Rua Alfa, 50', 'Rua Alfa, S/N', 'Rua Zeca, 10']);
eq(R.textoSeguroPdf('Ação — ǿ'), 'Ação — ');
console.log('rota.test.js: tudo certo');
