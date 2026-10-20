// Rodar: node tests/presenca.test.js  (sem dependências)
const assert = require('assert');
const { interpretar } = require('../anona-presenca.js');
const f = (t) => interpretar(t);
let r = f('3 faltas em março, 22 dias letivos');
assert.deepStrictEqual(r.fatos, [{ kind: 'faltas', n: 3, mes: 3 }, { kind: 'dias', n: 22, mes: 3 }]);
r = f('João faltou 4 dias em abril e 2 em maio');
assert.deepStrictEqual(r.fatos, [{ kind: 'faltas', n: 4, mes: 4 }, { kind: 'faltas', n: 2, mes: 5 }]);
r = f('três faltas e vinte e dois dias letivos em março');
assert.deepStrictEqual(r.fatos.map(x => [x.kind, x.n]), [['faltas', 3], ['dias', 22]]);
r = f('e se faltar mais 2 dias?'); assert.deepStrictEqual(r.simula, { n: 2, mes: null }); assert.strictEqual(r.fatos.length, 0);
r = f('e se ele faltar 3 dias em abril?'); assert.deepStrictEqual(r.simula, { n: 3, mes: 4 });
assert.ok(f('quantas faltas ainda posso ter?').margem);
assert.strictEqual(f('tenho 16 anos').faixa, '75j');
assert.strictEqual(f('aluno de 5 anos').faixa, '60');
assert.strictEqual(f('tem 8 anos, 2 faltas').faixa, '75');
assert.strictEqual(f('período abr/mai').periodo, 1);
assert.ok(f('limpar').limpar);
// perguntas gerais NÃO podem ser sequestradas (vão para o Paulus)
for (const q of ['qual a frequência mínima do bolsa família?', 'o que é recurso on-line?', 'como funciona o bloqueio?', 'quando sai o pagamento?']) {
  const x = f(q); assert.ok(!x.fatos.length && !x.margem && !x.simula && !x.situacao && !x.limpar, q);
}
console.log('ok');
