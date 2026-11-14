// node tests/ia.test.js — comandos locais da IA no Anona, com um app de mentira (sem DOM, sem rede).
const assert = require('assert');
const { criar } = require('../anona-ia.js');
let tela = { ano: 2026, mes: 10 }, nis = '', nota = null, dia = null;
const app = {
  hoje: () => new Date(2026, 10, 13), anos: () => [2026, 2026], mes: () => tela, selecionado: () => new Date(2026, 10, 13),
  destaques: (a, m) => m === 10 ? [{ type: 'sicon', title: 'Mês de Repercussão', desc: 'Efeitos (Ref: Ago/Set-26).' }] : [],
  eventos: () => ({ '2026-11-16': [{ type: 'edu', title: 'Edu: Impressão (Out/Nov)' }], '2026-10-29': [{ type: 'sicon', title: 'SICON: Recurso Set/26' }], '2026-11-30': [{ type: 'edu', title: 'Edu: Registro (Out/Nov)' }] }),
  pagamentos: () => ({ 10: [16, 17, 18, 19, 23, 24, 25, 26, 27, 30], 11: [10, 11, 14, 15, 16, 17, 18, 21, 22, 23] }),
  nis: () => nis, setNis: d => { nis = d; }, irHoje() { tela = { ano: 2026, mes: 10 }; },
  mudarMes: n => { tela = { ano: 2026, mes: tela.mes + n }; }, irMes: (a, m) => { tela = { ano: a, mes: m }; },
  irDia: d => { dia = d; }, preencherNota: t => { nota = t; }, imprimirMes() { app.imp = true; }, valores: () => ({ brc: 164, bco: 691, bpi: 173, bvf: 58 }),
  motivos: () => [{ cat: 'X', items: [['3.2', 'Doença do estudante']] }], irCartao: () => true
};
const ia = criar(app);
let r = ia.tratar('próximos prazos'); assert(/16\/11/.test(r.texto) && /30\/11/.test(r.texto));
r = ia.tratar('quando é o recurso de setembro?'); assert(/29\/10/.test(r.texto) && /já passou/.test(r.texto));
r = ia.tratar('quando recebo? final 7'); assert(/25\/11/.test(r.texto), r.texto);
r = ia.tratar('meu nis final 4'); assert(nis === '4');
r = ia.tratar('quando recebo o pagamento?'); assert(/seu próximo pagamento/i.test(r.texto) && !/final 4/.test(r.texto));
r = ia.tratar('ir para dezembro'); assert(tela.mes === 11 && /Prazos|Sem destaques/.test(r.texto));
r = ia.tratar('anotar no dia 20: ligar para a escola'); assert(nota === 'ligar para a escola' && dia.getDate() === 20);
r = ia.tratar('imprimir o mês'); assert(app.imp);
r = ia.tratar('o que é o motivo 3.2?'); assert(/Doença/.test(r.texto));
assert.strictEqual(ia.tratar('o que é o recurso on-line?'), null);
const b = ia.baseParaIA('quando é o pagamento?');
assert(b.length >= 2 && b.length <= 4 && !JSON.stringify(b).includes('final 4 é'));
assert(/Hoje é sexta-feira, 13\/11\/2026/.test(ia.panorama()));
console.log('ok ia');
