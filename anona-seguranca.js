/* Anona — segurança no aparelho (ver SEGURANCA.md).
 *  1. Sessão com prazo: sai da conta após 30 min sem uso (toque, tecla, rolagem, mouse).
 *  2. "Limpar aparelho": sai da conta e apaga o que ficou guardado neste navegador (notas, planilhas, cache do Firestore).
 * Funções puras ficam em window.AnonaSeguranca para poderem ser testadas.
 */
(function (raiz) {
  'use strict';

  var LIMITE_MS = 30 * 60 * 1000;      // 30 minutos sem uso
  var AVISO_CHAVE = 'anona_sessao_expirada';

  // Chaves do localStorage que contêm dados de famílias/profissional (ou ligam a eles).
  var PREFIXOS_DADOS = ['pbf_notes_local', 'pbf_repercussao_local', 'pbf_legado_adotado', 'anona_email_lembrado', 'anona.cf.prefs'];

  function ehChaveDeDados(chave) {
    chave = String(chave || '');
    return PREFIXOS_DADOS.some(function (p) { return chave === p || chave.indexOf(p + ':') === 0; });
  }

  function chavesParaApagar(storage) {
    var out = [];
    try { for (var i = 0; i < storage.length; i++) { var k = storage.key(i); if (ehChaveDeDados(k)) out.push(k); } } catch (e) {}
    return out;
  }

  // Marca de tempo da última atividade; passou do limite → expirou.
  function expirou(ultimaAtividade, agora, limite) {
    return (agora - ultimaAtividade) >= (limite || LIMITE_MS);
  }

  function apagarDadosLocais() {
    try { chavesParaApagar(raiz.localStorage).forEach(function (k) { raiz.localStorage.removeItem(k); }); } catch (e) {}
    try { raiz.sessionStorage.clear(); } catch (e) {}
  }

  // ---- sessão com prazo ----
  var ultima = Date.now(), timer = null, ativo = false;

  function sairPorInatividade() {
    if (!ativo) return;
    ativo = false;
    try { raiz.sessionStorage.setItem(AVISO_CHAVE, '1'); } catch (e) {}
    var sair = raiz.doLogout ? raiz.doLogout() : Promise.resolve();
    var aviso = function () { raiz.setTimeout(mostrarAvisoExpirou, 400); };   // depois que a tela de acesso é redesenhada
    Promise.resolve(sair).then(aviso, aviso);
  }

  function mostrarAvisoExpirou() {
    try { raiz.sessionStorage.removeItem(AVISO_CHAVE); } catch (e) {}
    var el = raiz.document.getElementById('authError');
    if (el) { el.textContent = 'Por segurança, você foi desconectado após 30 minutos sem usar o Anona. Entre de novo para continuar.'; el.classList.remove('hidden'); }
  }

  function verificar() {
    if (!ativo) return;
    if (expirou(ultima, Date.now())) sairPorInatividade();
  }

  function marcarAtividade() { ultima = Date.now(); }

  function iniciarSessao() {
    if (ativo) { marcarAtividade(); return; }
    ativo = true; marcarAtividade();
    if (!timer) timer = raiz.setInterval(verificar, 15000);
  }
  function pararSessao() { ativo = false; }

  if (raiz.document && raiz.addEventListener) {
    ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(function (ev) {
      raiz.addEventListener(ev, marcarAtividade, { passive: true, capture: true });
    });
    // Aparelho que "dormiu" com a aba aberta: ao voltar, confere na hora.
    raiz.document.addEventListener('visibilitychange', function () { if (raiz.document.visibilityState === 'visible') verificar(); });
    // O app avisa quando entra/sai alguém (evento já existente: anona:auth).
    raiz.addEventListener('anona:auth', function (e) {
      var logado = !!(e && e.detail && e.detail.logado);
      if (logado) iniciarSessao(); else pararSessao();
    });
  }

  // ---- limpar aparelho ----
  var limpando = false;
  async function limparAparelho() {
    if (limpando) return;
    if (!raiz.confirm('Limpar este aparelho?\n\nVocê será desconectado(a) e as anotações e planilhas guardadas AQUI serão apagadas. As anotações já sincronizadas na nuvem continuam na sua conta. Planilhas de Repercussão existem só neste aparelho: baixe o backup antes se precisar delas.')) return;
    limpando = true;
    try { if (raiz.doLogout) await raiz.doLogout(); } catch (e) {}
    apagarDadosLocais();
    try { if (raiz.__anonaLimparCacheNuvem) await raiz.__anonaLimparCacheNuvem(); } catch (e) {}
    apagarDadosLocais();     // de novo: nada pode ter sido regravado durante a saída
    raiz.location.reload();
  }

  raiz.AnonaSeguranca = { LIMITE_MS: LIMITE_MS, ehChaveDeDados: ehChaveDeDados, chavesParaApagar: chavesParaApagar, expirou: expirou, limparAparelho: limparAparelho };
  raiz.limparAparelho = limparAparelho;
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.AnonaSeguranca;
})(typeof window !== 'undefined' ? window : globalThis);
