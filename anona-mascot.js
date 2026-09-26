// anona-mascot.js — mascote do app Anona: um "cartãozinho" com rosto e braço
// acenando, que vive num canto da tela e fala dicas rápidas quando é tocado.
//
// Não depende de nada além do próprio navegador (sem bibliotecas externas).
// Basta incluir este arquivo com <script src="anona-mascot.js" defer></script>
// em algum ponto do <body> do index.html (depois do styles.css).
//
// API pública (window.AnonaMascot):
//   AnonaMascot.falar("mensagem", { duracao: 6000 })  -> mostra um balão de fala
//   AnonaMascot.acenar()                               -> só faz o aceno, sem falar
//   AnonaMascot.esconder() / AnonaMascot.mostrar()      -> some/aparece de vez
//
// O mascote nunca aparece por cima de modais (confirmModalOverlay etc.) nem
// atrapalha cliques no resto da página — só a área do próprio cartãozinho
// responde a toque.

(function () {
  "use strict";

  if (window.AnonaMascot) return; // evita duplicar se o script for incluído 2x

  var DICAS = [
    "Toque num dia do calendário para ver os prazos de saúde, educação e SICON daquele mês.",
    "Digite o final do seu NIS na barra lateral: eu destaco seu dia de pagamento sozinho.",
    "Suas anotações ficam salvas na nuvem — pode entrar com a mesma conta em outro aparelho.",
    "Sem internet? Sem problema: suas notas continuam sendo guardadas no aparelho e sincronizam depois.",
    "Esqueceu a senha? Tem um link de 'Esqueci minha senha' bem na tela de entrada.",
    "No fim do ano eu não mudo nada — só o pessoal atualiza o calendário do ano seguinte."
  ];

  var LS_KEY = "anonaMascotVisto";
  var estaAcordado = false;
  var raiz, balao, cartao, textoBalao, escondeTimer;

  function css() {
    return (
      "#anonaMascotWrap{position:fixed;left:14px;bottom:14px;z-index:60;" +
      "display:flex;flex-direction:column;align-items:flex-start;gap:.5rem;" +
      "font-family:inherit;}" +
      "#anonaMascotWrap.anona-escondido{display:none;}" +
      "#anonaMascotBotao{width:58px;height:58px;border:none;padding:0;cursor:pointer;" +
      "background:transparent;border-radius:16px;line-height:0;" +
      "filter:drop-shadow(0 6px 14px rgba(7,26,61,.35));transition:transform .15s ease;}" +
      "#anonaMascotBotao:hover{transform:translateY(-2px);}" +
      "#anonaMascotBotao:focus-visible{outline:2px solid var(--amarelo,#D89B32);outline-offset:3px;}" +
      "#anonaMascotBotao svg{display:block;width:58px;height:58px;}" +
      ".anona-braco{transform-origin:96px 46px;}" +
      "#anonaMascotWrap.anona-acenando .anona-braco{animation:anonaAceno .6s ease-in-out 2;}" +
      "@keyframes anonaAceno{0%,100%{transform:rotate(0deg);}50%{transform:rotate(-18deg);}}" +
      "#anonaMascotBalao{max-width:230px;background:var(--card,#FFFDF8);color:var(--ink,#1D2333);" +
      "border:1px solid var(--line,rgba(13,46,99,.16));border-radius:1rem;padding:.65rem .85rem;" +
      "font-size:.82rem;line-height:1.35;box-shadow:0 10px 24px -14px rgba(13,46,99,.4);" +
      "opacity:0;transform:translateY(6px);transition:opacity .15s ease,transform .15s ease;" +
      "pointer-events:none;}" +
      "#anonaMascotBalao.anona-visivel{opacity:1;transform:translateY(0);pointer-events:auto;}" +
      "@media (prefers-reduced-motion: reduce){" +
      "#anonaMascotWrap.anona-acenando .anona-braco{animation:none;}" +
      "#anonaMascotBotao,#anonaMascotBalao{transition:none;}}"
    );
  }

  var SVG_CARTAO =
    '<svg viewBox="0 0 120 130" aria-hidden="true">' +
    '<path class="anona-braco" d="M96,46 Q118,32 112,14" stroke="#0D2E63" stroke-width="14" fill="none" stroke-linecap="round"/>' +
    '<circle cx="112" cy="14" r="9" fill="#0D2E63"/>' +
    '<rect x="8" y="8" width="96" height="106" rx="20" fill="#123A78"/>' +
    '<rect x="20" y="22" width="26" height="18" rx="4" fill="#D89B32"/>' +
    '<circle cx="38" cy="62" r="9" fill="#FFFDF8"/>' +
    '<circle cx="74" cy="62" r="9" fill="#FFFDF8"/>' +
    '<circle cx="40" cy="64" r="4.2" fill="#071A3D"/>' +
    '<circle cx="72" cy="64" r="4.2" fill="#071A3D"/>' +
    '<path d="M35,80 Q56,94 79,80" stroke="#FFFDF8" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<rect x="8" y="98" width="32" height="7" fill="#159947"/>' +
    '<rect x="40" y="98" width="32" height="7" fill="#FFCC29"/>' +
    '<rect x="72" y="98" width="32" height="7" fill="#0B2F7A"/>' +
    "</svg>";

  function montar() {
    if (raiz) return;

    var style = document.createElement("style");
    style.textContent = css();
    document.head.appendChild(style);

    raiz = document.createElement("div");
    raiz.id = "anonaMascotWrap";

    balao = document.createElement("div");
    balao.id = "anonaMascotBalao";
    balao.setAttribute("role", "status");
    balao.setAttribute("aria-live", "polite");
    textoBalao = document.createElement("span");
    balao.appendChild(textoBalao);

    cartao = document.createElement("button");
    cartao.type = "button";
    cartao.id = "anonaMascotBotao";
    cartao.setAttribute("aria-label", "Anona, o mascote do app — toque para uma dica");
    cartao.innerHTML = SVG_CARTAO;
    cartao.addEventListener("click", function () {
      var dica = DICAS[Math.floor(Math.random() * DICAS.length)];
      falar(dica);
    });

    raiz.appendChild(balao);
    raiz.appendChild(cartao);
    document.body.appendChild(raiz);
  }

  function acenar() {
    if (!raiz) montar();
    raiz.classList.remove("anona-acenando");
    // força reflow para poder reiniciar a animação mesmo se já tiver rodado
    void raiz.offsetWidth;
    raiz.classList.add("anona-acenando");
  }

  function falar(mensagem, opcoes) {
    if (!raiz) montar();
    opcoes = opcoes || {};
    var duracao = typeof opcoes.duracao === "number" ? opcoes.duracao : 6000;
    textoBalao.textContent = String(mensagem == null ? "" : mensagem);
    balao.classList.add("anona-visivel");
    acenar();
    clearTimeout(escondeTimer);
    if (duracao > 0) {
      escondeTimer = setTimeout(function () {
        balao.classList.remove("anona-visivel");
      }, duracao);
    }
  }

  function esconder() {
    if (raiz) raiz.classList.add("anona-escondido");
  }

  function mostrar() {
    if (!raiz) montar();
    raiz.classList.remove("anona-escondido");
  }

  window.AnonaMascot = { falar: falar, acenar: acenar, esconder: esconder, mostrar: mostrar };

  function iniciar() {
    montar();
    if (!localStorage.getItem(LS_KEY)) {
      setTimeout(function () {
        falar("Oi, eu sou o Anona! Toque em mim quando quiser uma dica rápida.");
        try { localStorage.setItem(LS_KEY, "1"); } catch (e) {}
      }, 1200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
