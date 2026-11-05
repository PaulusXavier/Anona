// Rodar: node tests/mascot.test.js  (sem dependências)
const assert = require('assert');
const { responder, dicaDoMomento, momentosAtivos, proxima, BASE, TOPICOS, MOMENTOS } = require('../anona-mascot.js');

const casos = [
  ['quanto é o valor do bolsa família?', /R\$ 164 por pessoa.*R\$ 691/],
  ['quanto recebe quem tem criança pequena?', /R\$ 173 por criança/],
  ['como faço para entrar no programa?', /Cadastro Único no CRAS/],
  ['qual a frequência mínima da escola?', /60%.*75%/],
  ['meu bolsa foi bloqueado, perco a parcela?', /pode ser sacada no mês seguinte/],
  ['como faço um recurso no sicon?', /recurso on-line/],
  ['preciso de vacina para receber?', /vacinas em dia/],
  ['onde saco o benefício? tem caixa tem?', /Caixa Tem/],
  ['arrumei emprego e a renda subiu', /Regra de proteção/],
  ['alguém cobrou para desbloquear, é golpe?', /ninguém pode cobrar/],
  ['recebi valor errado, como devolvo?', /GRU/],
  ['passou o prazo do recurso', /interrupção temporária/],
  ['quando sai o pagamento?', /últimos 10 dias úteis/],
  ['me dá um exemplo de cálculo', /3 × R\$ 164 = R\$ 492.*R\$ 199 para o piso/],
];
for (const [q, re] of casos) { const r = responder(q); assert.ok(r && re.test(r), q + ' -> ' + r); }

// o que não é do assunto não é inventado
for (const q of ['qual a capital da França?', 'oi', '', 'receita de bolo']) assert.strictEqual(responder(q), null, q);

// valores em R$ vêm de window.AnonaValoresBeneficio quando existir
global.window = { AnonaValoresBeneficio: { brc: 200, bco: 800, bpi: 190, bvf: 70 } };
assert.ok(/R\$ 200 por pessoa.*R\$ 800/.test(responder('quanto é o valor do bolsa família?')));
assert.ok(/3 × R\$ 200 = R\$ 600.*R\$ 200 para o piso/.test(responder('me dá um exemplo de cálculo')));
delete global.window;

// valores padrão batem com a base do Paulus (Decreto 13.120/2026)
const conhecimento = require('fs').readFileSync(__dirname + '/../conhecimento.json', 'utf8');
for (const n of ['R$ 164', 'R$ 691', 'R$ 173', 'R$ 58']) assert.ok(conhecimento.includes(n), n);

// estrutura: todo fato tem tópico válido e palavras-chave; tópicos têm fatos
const tops = TOPICOS.map(t => t[0]);
for (const f of BASE) { assert.ok(tops.includes(f.t), f.t); assert.ok(f.k.length && f.r); }
for (const t of tops) assert.ok(BASE.some(f => f.t === t), t);

// "sem repetir até acabar"
const n = BASE.filter(f => f.t === 'recurso').length, vistos = new Set();
for (let i = 0; i < n; i++) vistos.add(proxima('recurso'));
assert.strictEqual(vistos.size, n);

// momentos expiram pela data
assert.ok(momentosAtivos('2026-11-05').length >= 1);
assert.strictEqual(momentosAtivos('2030-01-01').length, 0);
assert.strictEqual(dicaDoMomento('2030-01-01'), null);
for (const m of MOMENTOS) assert.ok(m.de <= m.ate);
console.log('ok mascote');
