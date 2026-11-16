// Testes de anona-seguranca.js (funções puras). Rodar: node tests/seguranca.test.js
const assert = require('assert');
global.window = undefined;
const S = require('../anona-seguranca.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// chaves de dados reconhecidas (com e sem sufixo :uid)
ok(S.ehChaveDeDados('pbf_notes_local'), 'notas sem uid');
ok(S.ehChaveDeDados('pbf_notes_local:abc123'), 'notas com uid');
ok(S.ehChaveDeDados('pbf_repercussao_local:abc123'), 'planilhas');
ok(S.ehChaveDeDados('pbf_legado_adotado'), 'marca de migração');
ok(S.ehChaveDeDados('anona_email_lembrado'), 'e-mail lembrado');
ok(!S.ehChaveDeDados('pbf_notes_localizacao'), 'prefixo parecido não conta');
ok(!S.ehChaveDeDados('anonaVolantePdfsAuto'), 'preferência de tela não é dado');
ok(!S.ehChaveDeDados(null), 'null');

// só as chaves de dados são listadas
const fake = { _d: { 'pbf_notes_local:u': '1', 'pbf_repercussao_local:u': '2', 'outra': '3' }, get length() { return Object.keys(this._d).length; }, key(i) { return Object.keys(this._d)[i]; } };
assert.deepStrictEqual(S.chavesParaApagar(fake).sort(), ['pbf_notes_local:u', 'pbf_repercussao_local:u']); n++;

// prazo de 30 min: 29 min continua, 30 min expira
const t0 = 1000000;
ok(!S.expirou(t0, t0 + 29 * 60000), '29 min');
ok(S.expirou(t0, t0 + 30 * 60000), '30 min');
ok(S.expirou(t0, t0 + 31 * 60000), '31 min');
ok(S.LIMITE_MS === 1800000, 'limite');
console.log('seguranca.test.js: ' + n + ' verificações OK');
