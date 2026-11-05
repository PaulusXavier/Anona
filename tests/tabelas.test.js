// Rodar: node tests/tabelas.test.js   (precisa de xlsx-js-style só para o teste da planilha: npm i xlsx-js-style)
const assert = require('assert');
const T = require('../anona-tabelas.js');

// leitura de números
assert.strictEqual(T.lerInteiro('3'), 3);
assert.strictEqual(T.lerInteiro(' 3,0 '), 3);
assert.ok(Number.isNaN(T.lerInteiro('2,5')));
assert.ok(Number.isNaN(T.lerInteiro('abc')));
assert.ok(Number.isNaN(T.lerInteiro('')));
assert.ok(Number.isNaN(T.lerInteiro('-1')));

// mínimo em inteiros: 75% de 22 = 16,5 → 17 presenças → máx. 5 faltas; 60% de 5 = 3 exato
assert.strictEqual(T.minPresencas(22, 75), 17);
assert.strictEqual(T.minPresencas(20, 75), 15);
assert.strictEqual(T.minPresencas(5, 60), 3);
let r = T.avaliar(22, 5, 75);
assert.strictEqual(r.cumpriu, true); assert.strictEqual(r.faltasMax, 5); assert.strictEqual(r.folga, 0);
r = T.avaliar(22, 6, 75);
assert.strictEqual(r.cumpriu, false); assert.strictEqual(r.folga, -1);
assert.strictEqual(T.avaliar(22, 23, 75).estado, 'erro');
assert.strictEqual(T.avaliar(0, 1, 75).estado, 'sem-dias');
assert.strictEqual(T.avaliar(22, NaN, 75).estado, 'vazio');

// panorama
const PER = [{ nome: 'p1', meses: [2, 3] }, { nome: 'p2', meses: [4, 5] }];
let p = T.panorama([{ mes: 2, dias: 18, faltas: 2 }, { mes: 3, dias: 22, faltas: 8 }, { mes: 4, dias: 20, faltas: '' }, { mes: 5, dias: 21, faltas: 1 }], PER, 75);
assert.deepStrictEqual(p.totais.mesesBaixa, [3]);
assert.deepStrictEqual(p.totais.periodosBaixa, [0]);
assert.strictEqual(p.totais.dias, 61);          // abril sem faltas não entra
assert.strictEqual(p.totais.faltas, 11);
assert.strictEqual(p.porPeriodo[1].situacao, 'parcial');
assert.strictEqual(p.porPeriodo[0].situacao, 'baixa');
p = T.panorama([{ mes: 2, dias: 10, faltas: 11 }], PER, 75);
assert.deepStrictEqual(p.erros, [2]);

// CSV: separador ;, BOM, aspas e proteção contra fórmula
const c = T.csv([['a;b', 'x"y', '=1+1', 1.5]]);
assert.ok(c.startsWith('﻿'));
assert.strictEqual(c.slice(1), '"a;b";"x""y";\'=1+1;1,5');
assert.ok(T.tabelaHTML([['<b>']]).includes('&lt;b&gt;'));

// planilha com fórmulas (se a biblioteca estiver disponível)
let X; try { X = require('xlsx-js-style'); } catch (e) { try { X = require(process.env.XLSX_PATH); } catch (e2) {} }
if (X) {
  globalThis.XLSX = X;
  const wb = T.panoramaWorkbook({ nome: 'Teste', rede: 'Municipal', ano: 2026, faixaTxt: '6 a 15 anos', lim: 75, unidade: 'dias', repercussao: { 2: 'Maio/2026' },
    linhas: [{ mes: 2, mesNome: 'Fevereiro', dias: 18, faltas: 2 }, { mes: 3, mesNome: 'Março', dias: 22, faltas: 8 }, { mes: 4, mesNome: 'Abril', dias: 20, faltas: '' }] });
  const ws = wb.Sheets['Panorama do ano'];
  assert.strictEqual(ws.D2.f, 'IF(ISBLANK(C2),"",B2-C2)');
  assert.strictEqual(ws.I3.v, 'Baixa frequência');
  assert.strictEqual(ws.B5.v, 40);                  // total só dos meses lançados
  assert.ok(ws.B5.f.startsWith('SUMIF'));
  const bytes = T.escrever(wb, () => '159947');
  assert.ok(bytes.length > 1000);
  require('fs').writeFileSync(process.env.SAIDA_XLSX || require('os').tmpdir() + '/panorama-teste.xlsx', Buffer.from(bytes));
  // resumo com fórmulas
  const wr = T.abaResumoComFormulas(['Técnico', 'Famílias'], [{ rotulo: 'Ana', aba: "Ana's", linhas: 3 }, { rotulo: 'Bia', aba: 'Bia', linhas: 4 }]);
  assert.strictEqual(wr.B2.f, "COUNTA('Ana''s'!A:A)-1");
  assert.strictEqual(wr.B4.v, 7);
  console.log('ok planilha');
}
console.log('ok tabelas');
