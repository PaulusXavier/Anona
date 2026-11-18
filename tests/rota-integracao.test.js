/* Integração Anona × Paulus na rota de visita: roda o código REAL do index.html (as funções de rota), com o Paulus de verdade e um Gemini de mentira.
 * Confere: ordem das famílias, integrantes juntos, o que sai para o Gemini (nunca número de casa, nome, NIS), IA inválida ou pior é descartada.
 * Uso: node tests/rota-integracao.test.js   (rode na pasta do app) */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const ini = html.indexOf("const ROTA_PARTIDA");
const fim = html.indexOf("async function relatorioIndividualGerarPDF");
assert(ini > 0 && fim > ini, 'trecho da rota não encontrado no index.html');
const normIni = html.indexOf("function normalizeText(value)");
const norm = html.slice(normIni, html.indexOf('\n  }\n', normIni) + 4);
const trecho = html.slice(ini, fim);

const paulus = require(path.join(raiz, 'paulus.v1.js'));
const enviados = [];          // o que "foi para o Gemini"
let respostaGemini = null;    // função (indices) -> array, escolhida pelo teste

function novoContexto(geo) {
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    window: { Paulus: paulus }, document: { addEventListener() {}, getElementById() { return null; } }, setTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    AbortController, clearTimeout, encodeURIComponent, Intl, JSON, Math, Set, Map, Number, String, Array, Object, Error, parseInt, isNaN,
    safeStorageGet: (k, f) => f, safeStorageSet: () => true,
    fetch: async (url, init) => {
      if (/geografia\.json/.test(url)) return { ok: false };
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      enviados.push(prompt);
      const linhas = prompt.split('\n').filter(l => /^\d+: /.test(l));
      const ordem = respostaGemini(linhas.map((_, i) => i));
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(ordem) }] } }] }) };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(norm + '\n' + trecho + '\n;this.calcular = relatorioIndividualCalcularRota; this.setGeo = (g) => { ROTA_GEO = g; };', ctx);
  if (geo) ctx.setGeo(geo);
  return ctx;
}

const headers = ['Família', 'Responsável', 'NIS', 'Endereço', 'Bairro', 'Efeito'];
const L = (fam, nome, nis, end, bairro) => [String(fam), nome, nis, end, bairro, 'Alerta'];
const dados = [
  L(1, 'MARIA SOUZA', '12345678901', 'Rua Zeta, 10', '13 de Setembro'),
  L(2, 'JOSE LIMA', '10987654321', 'Rua Alfa, 193', '13 de Setembro'),
  L(2, 'ANA LIMA', '10987654322', 'Rua Alfa, 193', '13 de Setembro'),     // mesma família, 2 integrantes
  L(3, 'PEDRO ROCHA', '11122233344', 'Rua Beta, 77', '13 de Setembro'),
  L(4, 'LUCIA COSTA', '55566677788', 'Rua Gama, 5', '13 de Setembro'),
  L(5, 'ELZA NUNES', '99988877766', 'Rua Delta, 8', 'Araceli')
];
const familias = (r) => Array.from(r.linhasRota, l => String(l.row[0]));   // Array.from: cria o array neste contexto (o do vm tem outro protótipo e deepStrictEqual recusa)

(async () => {
  // 1) sem IA, sem geografia: o Paulus ordena pelo texto (rua A-Z, casas em serpentina); integrantes ficam juntos; o bloco Araceli vem depois
  let c = novoContexto();
  let r = await c.calcular(headers, dados);
  assert.deepStrictEqual(familias(r), ['2', '2', '3', '4', '1', '5']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.avisos)), []);

  // 2) com geografia, sem IA: a ordem das ruas segue a menor distância (Zeta e Alfa são vizinhas; Beta e Gama também)
  const geo = { ruas: [
    { rua: 'Rua Zeta', bairro: '13 de Setembro', lat: 2.8000, lng: -60.7000 }, { rua: 'Rua Alfa', bairro: '13 de Setembro', lat: 2.8010, lng: -60.7000 },
    { rua: 'Rua Beta', bairro: '13 de Setembro', lat: 2.8200, lng: -60.7000 }, { rua: 'Rua Gama', bairro: '13 de Setembro', lat: 2.8210, lng: -60.7000 },
    { rua: 'Rua Delta', bairro: 'Araceli', lat: 2.9, lng: -60.6 } ] };
  c = novoContexto(geo);
  r = await c.calcular(headers, dados);
  const comGeo = familias(r);
  // alfabética (Alfa, Beta, Gama, Zeta) vai e volta entre as pontas; pela distância é uma ponta à outra, em linha
  assert(['1,2,2,3,4,5', '4,3,2,2,1,5'].includes(comGeo.join(',')), 'ordem por distância: ' + comGeo.join(','));

  // 3) nada sai do aparelho: a rota é sempre calculada pelo Paulus, sem chamar serviço externo
  enviados.length = 0;
  c = novoContexto(geo);
  r = await c.calcular(headers, dados);
  assert.strictEqual(enviados.length, 0, 'nenhuma chamada de rede para ordenar a rota');
  assert.strictEqual(r.linhasRota.length, 6, 'nenhuma linha some');
  assert.deepStrictEqual(familias(r), comGeo, 'mesma ordem por distância');

  // 6) sem o Paulus carregado: volta ao caminho antigo, sem quebrar
  c = novoContexto(); c.window.Paulus = undefined;
  r = await c.calcular(headers, dados);
  assert.strictEqual(r.linhasRota.length, 6);
  console.log('rota-integracao.test.js: tudo certo');
})().catch(e => { console.error(e); process.exit(1); });
