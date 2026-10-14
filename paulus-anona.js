// paulus-anona.js — liga o Paulus (copiloto de IA) ao Anona. O Anona continua sendo o rosto: o painel abre
// ao tocar no mascote e a conversa aparece com a cara dele.
//
// REGRAS (não mude sem pensar):
//  - O Paulus NUNCA lê notas, planilhas, NIS, PDFs de família ou qualquer dado do Firestore/aparelho.
//    Por isso aqui não há `fichas` nem `registrarBusca`. Só vai ao Worker a pergunta digitada (já filtrada
//    contra dado pessoal) e as últimas mensagens da conversa.
//  - A resposta é sempre inserida com textContent (nunca innerHTML).
//  - Ao sair da conta, a conversa é apagada e o painel some.
//
// Carregue DEPOIS de paulus.v1.js e anona-mascot.js (os dois com defer, nesta ordem).
(function () {
  "use strict";

  // ENDEREÇO DO WORKER (o mesmo que o Argo usa). Termina em .workers.dev. Vazio = só base de normas offline.
  var ENDPOINT = "https://paulus-ia.paulo-ae18.workers.dev";
  var CONHECIMENTO = "conhecimento.json"; // pacote "geral" (leve), cópia local do Paulus

  var painel = null, lista = null, campo = null, enviar = null, status = null, sugestoesEl = null;
  var conversando = false, aborto = null, iniciado = false, ultimaPergunta = "";

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }

  // ---------------------------------------------------------------- ações (só navegação, nada que mexa em dados)
  function irParaCard(trecho) {
    var alvo = String(trecho).toLowerCase();
    var hs = document.querySelectorAll("#appContent h2, #appContent h3");
    for (var i = 0; i < hs.length; i++) {
      if ((hs[i].textContent || "").toLowerCase().indexOf(alvo) !== -1) {
        fechar();
        hs[i].scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        return true;
      }
    }
    return false;
  }

  function registrarAcoes() {
    var P = window.Paulus;
    var itens = [
      ["calendario", ["calendário", "calendario", "pagamentos", "calendário de pagamentos"], "calendário"],
      ["nis", ["meu nis", "seu nis", "final do nis"], "seu nis"],
      ["sicon", ["sicon", "consulta ao sicon"], "consulta ao sicon"],
      ["destaques", ["destaques", "destaques do mês", "destaques do mes"], "destaques do mês"],
      ["territorio", ["território volante", "territorio volante", "planilhas", "repercussão", "repercussao"], "planilhas do território volante"],
      ["exportar", ["exportar", "baixar pdf", "pdf das notas"], "exportar"],
      ["sacar", ["sacar", "como sacar", "saque"], "como sacar o benefício"],
      ["devolucao", ["devolução", "devolucao", "devolver"], "devolução voluntária"],
      ["participar", ["como participar", "participar do programa"], "como participar do programa"],
      ["condicionalidades", ["condicionalidades", "condicionalidade"], "condicionalidades do programa"],
      ["cadunico", ["cadastro único", "cadastro unico", "cadunico"], "cadastro único"],
      ["cronograma", ["cronograma", "cronograma de repercussão", "cronograma de repercussao"], "cronograma de repercuss"],
      ["recurso", ["recurso", "recurso on-line", "recurso online"], "recurso on-line"],
      ["motivos", ["legenda de motivos", "motivos", "motivos de frequência"], "legenda de motivos"]
    ];
    itens.forEach(function (it) {
      P.registrarAcao({ id: it[0], rotulos: it[1], executar: function () { irParaCard(it[2]); } });
    });
  }

  // ---------------------------------------------------------------- painel
  function css() {
    if (document.getElementById("paulusAnonaCss")) return;
    var s = document.createElement("style");
    s.id = "paulusAnonaCss";
    s.textContent =
      "#paulusAnonaPainel{position:fixed;left:14px;bottom:84px;z-index:70;width:min(380px,calc(100vw - 28px));" +
      "max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--card,#FFFDF8);color:var(--ink,#1D2333);" +
      "border:1px solid var(--line,rgba(13,46,99,.16));border-radius:1.1rem;overflow:hidden;" +
      "box-shadow:0 18px 40px -16px rgba(7,26,61,.55);font-size:.86rem;}" +
      "#paulusAnonaPainel[hidden]{display:none;}" +
      "#paulusAnonaPainel .pa-topo{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.6rem .8rem;" +
      "background:var(--azul,#0D2E63);color:#fff;font-weight:700;}" +
      "#paulusAnonaPainel .pa-topo small{display:block;font-weight:400;opacity:.8;font-size:.7rem;}" +
      "#paulusAnonaPainel .pa-topo button{background:transparent;border:0;color:#fff;cursor:pointer;min-width:36px;min-height:36px;" +
      "border-radius:.6rem;font-size:1rem;}" +
      "#paulusAnonaPainel .pa-topo button:hover{background:rgba(255,255,255,.15);}" +
      "#paulusAnonaLista{flex:1;overflow-y:auto;padding:.7rem;display:flex;flex-direction:column;gap:.5rem;}" +
      ".pa-msg{max-width:92%;padding:.5rem .7rem;border-radius:.9rem;white-space:pre-wrap;word-wrap:break-word;line-height:1.4;}" +
      ".pa-msg.eu{align-self:flex-end;background:var(--azul-soft,#E3E9F5);}" +
      ".pa-msg.ele{align-self:flex-start;background:#fff;border:1px solid var(--line,rgba(13,46,99,.16));}" +
      ".pa-msg.aviso{align-self:stretch;max-width:100%;background:var(--amarelo-soft,#FBF0D6);font-size:.78rem;}" +
      ".pa-fontes{font-size:.72rem;opacity:.8;margin-top:.35rem;}" +
      ".pa-barra{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem;}" +
      ".pa-barra button{border:1px solid var(--line,rgba(13,46,99,.25));background:#fff;border-radius:999px;padding:.15rem .55rem;" +
      "font-size:.74rem;cursor:pointer;min-height:30px;color:inherit;}" +
      ".pa-barra button:hover{background:var(--azul-soft,#E3E9F5);}" +
      ".pa-barra .pa-ok{font-size:.74rem;opacity:.8;align-self:center;}" +
      "#paulusAnonaSug{display:flex;flex-wrap:wrap;gap:.35rem;padding:0 .7rem .5rem;}" +
      "#paulusAnonaSug button{border:1px solid var(--line,rgba(13,46,99,.25));background:#fff;border-radius:999px;" +
      "padding:.3rem .65rem;font-size:.76rem;cursor:pointer;min-height:32px;}" +
      "#paulusAnonaSug button:hover{background:var(--azul-soft,#E3E9F5);}" +
      "#paulusAnonaForm{display:flex;gap:.4rem;padding:.6rem;border-top:1px solid var(--line,rgba(13,46,99,.16));}" +
      "#paulusAnonaCampo{flex:1;border:1px solid var(--line,rgba(13,46,99,.25));border-radius:.7rem;padding:.5rem .65rem;" +
      "font:inherit;min-height:40px;background:#fff;color:inherit;}" +
      "#paulusAnonaEnviar{border:0;border-radius:.7rem;padding:0 .9rem;background:var(--verde,#159947);color:#fff;" +
      "font-weight:700;cursor:pointer;min-height:40px;}" +
      "#paulusAnonaEnviar:disabled{opacity:.55;cursor:default;}" +
      "#paulusAnonaStatus{padding:0 .8rem .4rem;font-size:.72rem;opacity:.75;min-height:1rem;}" +
      "@media (prefers-reduced-motion: no-preference){#paulusAnonaPainel{animation:paEntra .15s ease-out;}}" +
      "@keyframes paEntra{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}";
    document.head.appendChild(s);
  }

  function montar() {
    if (painel) return;
    css();
    painel = el("div");
    painel.id = "paulusAnonaPainel";
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-label", "Conversa com o Anona");
    painel.hidden = true;

    var topo = el("div", "pa-topo");
    var tit = el("div", null, "Anona");
    tit.appendChild(el("small", null, "IA do Paulus · não vê famílias nem notas"));
    var novo = el("button", null, "↺");
    novo.type = "button";
    novo.setAttribute("aria-label", "Nova conversa");
    novo.title = "Nova conversa";
    novo.addEventListener("click", reiniciar);
    var fecha = el("button", null, "✕");
    fecha.type = "button";
    fecha.setAttribute("aria-label", "Fechar conversa");
    fecha.addEventListener("click", fechar);
    var botoes = el("div");
    botoes.appendChild(novo);
    botoes.appendChild(fecha);
    topo.appendChild(tit);
    topo.appendChild(botoes);

    lista = el("div");
    lista.id = "paulusAnonaLista";
    lista.setAttribute("aria-live", "polite");

    sugestoesEl = el("div");
    sugestoesEl.id = "paulusAnonaSug";

    status = el("div");
    status.id = "paulusAnonaStatus";

    var form = el("form");
    form.id = "paulusAnonaForm";
    campo = el("input");
    campo.id = "paulusAnonaCampo";
    campo.type = "text";
    campo.maxLength = 1200;
    campo.autocomplete = "off";
    campo.placeholder = "Pergunte sobre o app ou o programa…";
    campo.setAttribute("aria-label", "Sua pergunta");
    enviar = el("button", null, "Enviar");
    enviar.id = "paulusAnonaEnviar";
    enviar.type = "submit";
    form.appendChild(campo);
    form.appendChild(enviar);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = campo.value.trim();
      if (!t || conversando) return;
      campo.value = "";
      perguntar(t);
    });

    painel.appendChild(topo);
    painel.appendChild(lista);
    painel.appendChild(sugestoesEl);
    painel.appendChild(status);
    painel.appendChild(form);
    painel.addEventListener("keydown", function (ev) { if (ev.key === "Escape") fechar(); });
    document.body.appendChild(painel);
  }

  function mensagem(classe, texto) {
    var m = el("div", "pa-msg " + classe, texto);
    lista.appendChild(m);
    lista.scrollTop = lista.scrollHeight;
    return m;
  }

  function mostrarSugestoes(arr) {
    sugestoesEl.textContent = "";
    (arr || []).slice(0, 3).forEach(function (s) {
      var b = el("button", null, s);
      b.type = "button";
      b.addEventListener("click", function () { if (!conversando) perguntar(s); });
      sugestoesEl.appendChild(b);
    });
  }

  function reiniciar() {
    try { if (aborto) aborto.abort(); } catch (e) {}
    if (window.Paulus) window.Paulus.limpar();
    if (!lista) return;
    lista.textContent = "";
    var sk = window.Paulus && window.Paulus.skin("anona");
    mensagem("ele", sk ? sk.saudacao : "Oi! Eu sou o Anona.");
    mostrarSugestoes(sk ? sk.sugestoes : []);
    status.textContent = "";
    conversando = false;
    enviar.disabled = false;
  }

  function abrir() {
    if (!window.Paulus) { falarMascote("O assistente não carregou. Recarregue a página."); return; }
    if (!iniciado) iniciar();
    montar();
    if (!lista.childNodes.length) reiniciar();
    painel.hidden = false;
    setTimeout(function () { try { campo.focus(); } catch (e) {} }, 30);
  }

  function fechar() { if (painel) painel.hidden = true; }

  function encerrar() {
    try { if (aborto) aborto.abort(); } catch (e) {}
    if (window.Paulus) window.Paulus.limpar();
    if (painel && painel.parentNode) painel.parentNode.removeChild(painel);
    painel = lista = campo = enviar = status = sugestoesEl = null;
    conversando = false;
  }

  function falarMascote(t) {
    if (window.AnonaMascot) window.AnonaMascot.falar(t);
  }

  // Barra de ações sob a resposta: copiar, 👍/👎 (só no aparelho, nada é enviado) e tentar de novo.
  function barraResposta(bolha, texto, tipo) {
    var barra = el("div", "pa-barra");
    function botao(rotulo, aria, fn) {
      var b = el("button", null, rotulo);
      b.type = "button";
      b.setAttribute("aria-label", aria);
      b.addEventListener("click", function () { fn(b); });
      barra.appendChild(b);
      return b;
    }
    function trocarPor(msg) {
      barra.textContent = "";
      barra.appendChild(el("span", "pa-ok", msg));
    }
    if (tipo === "erro") {
      botao("↻ Tentar de novo", "Tentar de novo", function () {
        if (conversando || !ultimaPergunta) return;
        // tira a tentativa que falhou (pergunta + resposta) e repete
        var msgs = lista.querySelectorAll(".pa-msg");
        if (msgs.length >= 2) { lista.removeChild(msgs[msgs.length - 1]); lista.removeChild(msgs[msgs.length - 2]); }
        perguntar(ultimaPergunta);
      });
    } else {
      botao("Copiar", "Copiar resposta", function (b) {
        var alvo = texto;
        try {
          navigator.clipboard.writeText(alvo).then(function () { b.textContent = "Copiado ✓"; }, function () { b.textContent = "Não deu"; });
        } catch (e) { b.textContent = "Não deu"; }
      });
      botao("👍", "Resposta boa", function () { trocarPor("Obrigado! 😊"); });
      botao("👎", "Resposta ruim", function () {
        barra.textContent = "";
        barra.appendChild(el("span", "pa-ok", "Quer que eu tente de outro jeito?"));
        [["Explicar de outro jeito", "Explique a resposta anterior de outro jeito, mais simples."],
         ["Mais curto", "Responda a pergunta anterior de forma mais curta."]].forEach(function (o) {
          var b = el("button", null, o[0]);
          b.type = "button";
          b.addEventListener("click", function () { if (!conversando) perguntar(o[1]); });
          barra.appendChild(b);
        });
      });
    }
    bolha.parentNode.insertBefore(barra, bolha.nextSibling);
    lista.scrollTop = lista.scrollHeight;
  }

  // ---------------------------------------------------------------- pergunta
  function perguntar(texto) {
    var P = window.Paulus;
    ultimaPergunta = texto;
    mensagem("eu", texto);
    sugestoesEl.textContent = "";
    var bolha = mensagem("ele", "…");
    conversando = true;
    enviar.disabled = true;
    status.textContent = "pensando…";
    aborto = typeof AbortController === "function" ? new AbortController() : null;

    P.perguntar(texto, {
      aba: "anona",
      sinal: aborto ? aborto.signal : undefined,
      onToken: function (pedaco, tudo) {
        bolha.textContent = tudo; // textContent, nunca innerHTML
        status.textContent = "escrevendo…";
        lista.scrollTop = lista.scrollHeight;
      }
    }).then(function (r) {
      if (!painel) return; // saiu da conta no meio
      if (r.tipo === "bloqueio") {
        bolha.parentNode && bolha.parentNode.removeChild(bolha);
        // some a pergunta com dado pessoal da tela
        var ultimaEu = lista.querySelectorAll(".pa-msg.eu");
        if (ultimaEu.length) ultimaEu[ultimaEu.length - 1].textContent = "(mensagem oculta: continha dado pessoal)";
        mensagem("aviso", r.texto);
      } else if (r.tipo === "crise") {
        bolha.textContent = r.texto;
        (r.telefones || []).forEach(function (t) { mensagem("aviso", t.numero + " — " + t.nome); });
      } else if (r.tipo === "busca" && r.itens) {
        bolha.textContent = r.texto || "Encontrei:";
        r.itens.forEach(function (i) { mensagem("ele", i.titulo + (i.detalhe ? " — " + i.detalhe : "")); });
      } else if (r.tipo === "acao") {
        if (r.pedeConfirmacao) {
          bolha.textContent = r.texto;
          var b = el("button", null, "Confirmar");
          b.type = "button";
          b.addEventListener("click", function () { b.disabled = true; r.confirmar(); });
          bolha.appendChild(document.createElement("br"));
          bolha.appendChild(b);
        } else {
          bolha.textContent = r.texto === "Pronto." ? "Pronto, levei você até lá." : r.texto;
        }
      } else if (r.tipo !== "ia") {
        bolha.textContent = r.texto || "Não consegui responder agora.";
      }
      if (r.fontes && r.fontes.length) {
        var f = el("div", "pa-fontes", "Fontes: " + r.fontes.map(function (x) {
          return typeof x === "string" ? x : [x.documento || x.norma || "", x.referencia || ""].filter(Boolean).join(", ");
        }).filter(Boolean).slice(0, 4).join("; "));
        bolha.appendChild(f);
      }
      if (r.tipo === "ia" || r.tipo === "norma" || r.tipo === "sem_resposta") barraResposta(bolha, bolha.firstChild ? bolha.firstChild.textContent : "", "ok");
      else if (r.tipo === "erro" && !r.limite) barraResposta(bolha, "", "erro");
      (r.avisos || []).forEach(function (a) { mensagem("aviso", a); });
      mostrarSugestoes(r.sugestoes);
    }).catch(function () {
      if (bolha) { bolha.textContent = "Não consegui responder agora. Tente de novo em instantes."; if (bolha.parentNode) barraResposta(bolha, "", "erro"); }
    }).then(function () {
      conversando = false;
      if (enviar) enviar.disabled = false;
      if (status) status.textContent = "";
    });
  }

  // ---------------------------------------------------------------- início
  function iniciar() {
    if (iniciado || !window.Paulus) return;
    window.Paulus.init({ app: "anona", endpoint: ENDPOINT, conhecimentoUrl: CONHECIMENTO });
    registrarAcoes();
    iniciado = true;
  }

  function ligarMascote() {
    if (window.AnonaMascot && window.AnonaMascot.aoClicar) {
      window.AnonaMascot.aoClicar(function () {
        var logado = document.getElementById("appContent") && document.getElementById("appContent").style.display !== "none";
        if (!logado) return false; // sem login: o mascote segue dando dicas normais
        abrir();
        return true;
      });
    }
  }

  // o index.html avisa quando entra/sai da conta (evento anona:auth)
  window.addEventListener("anona:auth", function (ev) {
    if (!ev.detail || !ev.detail.logado) encerrar();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarMascote);
  else ligarMascote();

  window.PaulusAnona = { abrir: abrir, fechar: fechar };
})();
