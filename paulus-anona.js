// paulus-anona.js — liga o Paulus (copiloto de IA) ao Anona. O Anona continua sendo o rosto: o mascote É a IA.
//
// COMO O MASCOTE E A IA SE ENCONTRAM
//  - Tocar no mascote abre o BALÃO em modo conversa (campo de pergunta + sugestões do cartão que está na tela).
//    A resposta chega aos poucos no próprio balão, com o rosto mudando: pensando → falando → feliz/alerta/triste.
//  - O painel de conversa (histórico, memória 🧠, 📎 PDF, 🎤 ditado) continua existindo: é o mesmo histórico, o balão só espelha.
//    Toda pergunta, venha do balão, do painel ou do campo da calculadora, passa pelo mesmo caminho (função perguntar).
//  - Sem internet ou com a IA fora do ar, o mascote responde sozinho com o que sabe do Bolsa Família (anona-mascot.js, no aparelho).
//  - Voz: o mascote lê a resposta em voz alta (🔈) e aceita ditado (🎤). Arrastar um PDF/foto sobre o mascote edita o arquivo
//    NO APARELHO (Paulus.pdf): o arquivo nunca vai ao Worker nem à IA.
//  - O contexto que vai à IA é só o TÍTULO do cartão que está na tela (ex.: "Cronograma de Repercussão"), nunca o conteúdo.
//
// REGRAS (não mude sem pensar):
//  - O Paulus NUNCA lê notas, planilhas, NIS, PDFs de família ou qualquer dado do Firestore/aparelho.
//    Por isso aqui não há `fichas` nem `registrarBusca`. Só vai ao Worker a pergunta digitada (já filtrada
//    contra dado pessoal) e as últimas mensagens da conversa.
//  - A resposta é sempre inserida com textContent (nunca innerHTML).
//  - Ao sair da conta, a conversa é apagada, o painel e o balão somem, anexos e voz são descartados.
//
// Carregue DEPOIS de paulus.v1.js, anona-mascot.js e anona-presenca.js (todos com defer, nesta ordem).
//
// Cálculo de presença: frases sobre faltas/dias letivos são resolvidas localmente por anona-presenca.js (nada vai
// ao Worker). Só o botão "Explicar com a IA" envia ao Paulus um texto montado pelo app com NÚMEROS (sem nome).
(function () {
  "use strict";

  // ENDEREÇO DO WORKER (o mesmo que o Argo usa). Termina em .workers.dev. Vazio = só base de normas offline.
  var ENDPOINT = "https://paulus-ia.paulo-ae18.workers.dev";
  var CONHECIMENTO = "conhecimento.json"; // pacote "geral" (leve), cópia local do Paulus

  var SAUDACAO = "Oi! Eu sou o Paulus, aqui como Anona. Posso explicar o app, abrir cartões, tirar dúvidas sobre condicionalidades e editar PDF aqui no aparelho (anexe com o 📎). Não tenho acesso às suas notas nem às planilhas das famílias.";
  var TIPOS_ARQUIVO = /\.(pdf|jpe?g|png)$/i;
  var MAX_ARQUIVOS = 10;
  var MAX_BYTES = 60 * 1024 * 1024;

  var painel = null, lista = null, campo = null, enviar = null, status = null, sugestoesEl = null, anexosEl = null, arquivoEl = null, vozPainelBt = null;
  var conversando = false, aborto = null, iniciado = false, ultimaPergunta = "", ultimasOpcoes = null;
  var perfilId = ""; // id opaco da conta (hash do uid; nunca e-mail nem nome): a memória do Paulus fica separada por pessoa
  var anexos = [];           // arquivos anexados (File ou { nome, bytes }); ficam só na memória do navegador
  var pendente = null;       // { texto, origem }: pedido de PDF esperando a pessoa escolher o arquivo
  var jaSaudou = false;      // o balão se apresenta uma vez por sessão

  function hashId(t) {
    var h = 5381;
    for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
    return "u" + h.toString(36);
  }

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }

  // chamada segura ao mascote (ele pode não ter carregado)
  function masc(nome) {
    var m = window.AnonaMascot;
    if (!m || typeof m[nome] !== "function") return undefined;
    try { return m[nome].apply(m, Array.prototype.slice.call(arguments, 1)); } catch (e) { return undefined; }
  }

  function logado() {
    var a = document.getElementById("appContent");
    return !!(a && a.style.display !== "none");
  }

  // ---------------------------------------------------------------- contexto: o cartão que está na tela (só o título)
  function tituloDoCartao() {
    var raiz = document.getElementById("appContent");
    if (!raiz) return "";
    var hs = raiz.querySelectorAll("h2.eyebrow, h3.passbook-label");
    var linha = window.innerHeight * 0.55, acima = null, abaixo = null;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (h.offsetParent === null) continue; // cartão escondido
      if (h.getBoundingClientRect().top <= linha) acima = h; else if (!abaixo) abaixo = h;
    }
    var alvo = acima || abaixo;
    return alvo ? (alvo.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70) : "";
  }

  function abaAtual() { return tituloDoCartao() || "anona"; }

  // ---------------------------------------------------------------- ações (só navegação, nada que mexa em dados)
  function irParaCard(trecho) {
    var alvo = String(trecho).toLowerCase();
    var hs = document.querySelectorAll("#appContent h2, #appContent h3");
    for (var i = 0; i < hs.length; i++) {
      if ((hs[i].textContent || "").toLowerCase().indexOf(alvo) !== -1) {
        fechar();
        masc("fecharBalao");
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
      ["motivos", ["legenda de motivos", "motivos", "motivos de frequência"], "legenda de motivos"],
      ["calculadora", ["calculadora", "calculadora de faltas", "faltas"], "calculadora de faltas"],
      ["rota", ["rota de visita", "organizar rota", "ordem de visita", "unificar folhas", "rota"], "rota de visita"]
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
      "#paulusAnonaAnexos{display:flex;flex-wrap:wrap;gap:.3rem;padding:0 .7rem .4rem;}" +
      "#paulusAnonaAnexos:empty{display:none;}" +
      "#paulusAnonaAnexos span{display:inline-flex;align-items:center;gap:.25rem;border:1px solid var(--line,rgba(13,46,99,.25));background:var(--amarelo-soft,#FBF0D6);" +
      "border-radius:999px;padding:.1rem .2rem .1rem .55rem;font-size:.72rem;max-width:100%;}" +
      "#paulusAnonaAnexos span b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;}" +
      "#paulusAnonaAnexos button{border:0;background:transparent;cursor:pointer;min-width:24px;min-height:24px;border-radius:999px;color:inherit;}" +
      "#paulusAnonaForm{display:flex;gap:.4rem;padding:.6rem;border-top:1px solid var(--line,rgba(13,46,99,.16));}" +
      "#paulusAnonaForm .pa-ic{border:1px solid var(--line,rgba(13,46,99,.25));background:#fff;border-radius:.7rem;min-width:38px;min-height:40px;cursor:pointer;font-size:.95rem;}" +
      "#paulusAnonaForm .pa-ic.anona-ativo{background:var(--amarelo,#FFCC29);}" +
      "#paulusAnonaCampo{flex:1;min-width:0;border:1px solid var(--line,rgba(13,46,99,.25));border-radius:.7rem;padding:.5rem .65rem;" +
      "font:inherit;font-size:16px;min-height:40px;background:#fff;color:inherit;}" +
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
    var dicaBt = el("button", null, "💡");
    dicaBt.type = "button";
    dicaBt.setAttribute("aria-label", "Dica rápida sobre o Bolsa Família");
    dicaBt.title = "Dica rápida sobre o Bolsa Família";
    dicaBt.addEventListener("click", function () { fechar(); if (window.AnonaMascot && window.AnonaMascot.dica) window.AnonaMascot.dica(); });
    vozPainelBt = el("button", null, "🔈");
    vozPainelBt.type = "button";
    vozPainelBt.addEventListener("click", function () { masc("vozAuto", !masc("vozLigada")); });
    var mem = el("button", null, "🧠");
    mem.type = "button";
    mem.setAttribute("aria-label", "O que o Paulus aprendeu sobre mim");
    mem.title = "O que o Paulus aprendeu sobre mim";
    mem.addEventListener("click", mostrarMemoria);
    var fecha = el("button", null, "✕");
    fecha.type = "button";
    fecha.setAttribute("aria-label", "Fechar conversa");
    fecha.addEventListener("click", fechar);
    var botoes = el("div");
    botoes.appendChild(dicaBt);
    botoes.appendChild(vozPainelBt);
    botoes.appendChild(mem);
    botoes.appendChild(novo);
    botoes.appendChild(fecha);
    topo.appendChild(tit);
    topo.appendChild(botoes);
    atualizarVozPainel();

    lista = el("div");
    lista.id = "paulusAnonaLista";
    lista.setAttribute("aria-live", "polite");

    sugestoesEl = el("div");
    sugestoesEl.id = "paulusAnonaSug";

    anexosEl = el("div");
    anexosEl.id = "paulusAnonaAnexos";

    status = el("div");
    status.id = "paulusAnonaStatus";

    var form = el("form");
    form.id = "paulusAnonaForm";
    var clipe = el("button", "pa-ic", "📎");
    clipe.type = "button";
    clipe.title = "Anexar PDF ou foto para editar aqui no aparelho";
    clipe.setAttribute("aria-label", "Anexar PDF ou foto (editado só neste aparelho)");
    clipe.addEventListener("click", function () { abrirSeletor(); });
    campo = el("input");
    campo.id = "paulusAnonaCampo";
    campo.type = "text";
    campo.maxLength = 1200;
    campo.autocomplete = "off";
    campo.placeholder = "Pergunte ou diga as faltas: 3 faltas em março…";
    campo.setAttribute("aria-label", "Sua pergunta");
    var mic = el("button", "pa-ic", "🎤");
    mic.type = "button";
    mic.title = "Falar a pergunta";
    mic.setAttribute("aria-label", "Falar a pergunta (ditado por voz)");
    mic.hidden = !(window.SpeechRecognition || window.webkitSpeechRecognition);
    mic.addEventListener("click", function () { masc("ditar", campo, mic); });
    enviar = el("button", null, "Enviar");
    enviar.id = "paulusAnonaEnviar";
    enviar.type = "submit";
    form.appendChild(clipe);
    form.appendChild(campo);
    form.appendChild(mic);
    form.appendChild(enviar);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = campo.value.trim();
      if (!t || conversando) return;
      campo.value = "";
      enviarTexto(t, "painel");
    });

    arquivoEl = el("input");
    arquivoEl.type = "file";
    arquivoEl.multiple = true;
    arquivoEl.accept = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
    arquivoEl.hidden = true;
    arquivoEl.setAttribute("aria-hidden", "true");
    arquivoEl.tabIndex = -1;
    arquivoEl.addEventListener("change", function () {
      var fs = Array.prototype.slice.call(arquivoEl.files || []);
      arquivoEl.value = "";
      receberArquivos(fs);
    });

    painel.appendChild(topo);
    painel.appendChild(lista);
    painel.appendChild(sugestoesEl);
    painel.appendChild(anexosEl);
    painel.appendChild(status);
    painel.appendChild(form);
    painel.appendChild(arquivoEl);
    painel.addEventListener("keydown", function (ev) { if (ev.key === "Escape") fechar(); });
    document.body.appendChild(painel);
  }

  function atualizarVozPainel() {
    if (!vozPainelBt) return;
    var on = !!masc("vozLigada"), ok = !!masc("vozSuportada");
    vozPainelBt.hidden = !ok;
    vozPainelBt.textContent = on ? "🔊" : "🔈";
    vozPainelBt.title = on ? "Desligar a leitura das respostas em voz alta" : "Ler as respostas em voz alta";
    vozPainelBt.setAttribute("aria-pressed", on ? "true" : "false");
    vozPainelBt.setAttribute("aria-label", vozPainelBt.title);
  }
  window.addEventListener("anona:voz", atualizarVozPainel);

  function mensagem(classe, texto) {
    var m = el("div", "pa-msg " + classe, texto);
    lista.appendChild(m);
    lista.scrollTop = lista.scrollHeight;
    return m;
  }

  function mostrarSugestoes(arr) {
    if (!sugestoesEl) return;
    sugestoesEl.textContent = "";
    (arr || []).slice(0, 3).forEach(function (s) {
      var b = el("button", null, s);
      b.type = "button";
      b.addEventListener("click", function () { if (!conversando) enviarTexto(s, "painel"); });
      sugestoesEl.appendChild(b);
    });
  }

  function reiniciar() {
    try { if (aborto) aborto.abort(); } catch (e) {}
    masc("pararVoz");
    masc("estado", "neutro");
    if (window.Paulus) window.Paulus.limpar();
    if (!lista) return;
    lista.textContent = "";
    mensagem("ele", SAUDACAO);
    var sau = window.AnonaPresenca && window.AnonaPresenca.saudacaoCalculo();
    if (sau) {
      var bs = mensagem("ele", sau.texto);
      barraLocal(bs, sau.acoes);
      sugestoesEl.textContent = "";
    } else {
      var pessoais = [];
      try { pessoais = window.Paulus.sugestoesPessoais(3); } catch (e) { pessoais = []; }
      mostrarSugestoes(["Calcular frequência: 3 faltas em março, 22 dias letivos"].concat(pessoais));
    }
    status.textContent = "";
    conversando = false;
    enviar.disabled = false;
  }

  // prepara (sem mostrar) o painel: o histórico vive nele, mesmo quando a conversa acontece no balão
  function preparar() {
    if (!window.Paulus) return false;
    if (!iniciado) iniciar();
    montar();
    if (!lista.childNodes.length) reiniciar();
    return true;
  }

  function abrir() {
    if (!window.Paulus) { falarMascote("O assistente não carregou. Recarregue a página."); return; }
    preparar();
    masc("fecharBalao");
    painel.hidden = false;
    setTimeout(function () { try { campo.focus(); } catch (e) {} }, 30);
  }

  function fechar() { if (painel) painel.hidden = true; }

  function encerrar() {
    try { if (aborto) aborto.abort(); } catch (e) {}
    masc("pararVoz");
    masc("fecharBalao");
    masc("estado", "neutro");
    masc("aoPerguntar", null);
    masc("aoSoltar", null);
    if (window.Paulus) window.Paulus.limpar();
    if (painel && painel.parentNode) painel.parentNode.removeChild(painel);
    painel = lista = campo = enviar = status = sugestoesEl = anexosEl = arquivoEl = vozPainelBt = null;
    conversando = false;
    anexos = [];
    pendente = null;
    jaSaudou = false;
  }

  function falarMascote(t) {
    if (window.AnonaMascot) window.AnonaMascot.falar(t);
  }

  // ---------------------------------------------------------------- anexos (PDF/foto editados no aparelho)
  function nomeDoAnexo(a) { return (a && (a.name || a.nome)) || "arquivo"; }

  function desenharAnexos() {
    if (!anexosEl) return;
    anexosEl.textContent = "";
    anexos.forEach(function (a, i) {
      var s = el("span");
      s.appendChild(el("b", null, "📎 " + nomeDoAnexo(a)));
      var x = el("button", null, "✕");
      x.type = "button";
      x.setAttribute("aria-label", "Tirar " + nomeDoAnexo(a));
      x.addEventListener("click", function () { anexos.splice(i, 1); desenharAnexos(); });
      s.appendChild(x);
      anexosEl.appendChild(s);
    });
  }

  function abrirSeletor() {
    if (!preparar()) return;
    try { arquivoEl.click(); } catch (e) {}
  }

  // Só PDF, JPG e PNG. O arquivo fica na memória do navegador até o pedido ser feito (ou até sair da conta).
  function receberArquivos(fs) {
    if (!preparar()) return;
    var bons = [], recusados = 0;
    fs.forEach(function (f) {
      var ok = f && (TIPOS_ARQUIVO.test(f.name || "") || /^(application\/pdf|image\/(jpeg|png))$/.test(f.type || ""));
      if (ok && f.size <= MAX_BYTES && anexos.length + bons.length < MAX_ARQUIVOS) bons.push(f); else recusados++;
    });
    var origem = pendente ? pendente.origem : (painel && !painel.hidden ? "painel" : "balao");
    anexos = anexos.concat(bons);
    desenharAnexos();
    var aviso = recusados ? " (" + recusados + " não entrou: só PDF, JPG ou PNG, até " + MAX_ARQUIVOS + " arquivos e 60 MB cada)" : "";
    if (!bons.length) {
      if (recusados) tell(origem, "Não consegui anexar." + aviso);
      return;
    }
    if (pendente) {
      var p = pendente;
      pendente = null;
      perguntar(p.texto, { origem: p.origem });
      return;
    }
    var nomes = bons.map(nomeDoAnexo).join(", ");
    var ops = ["Numerar as páginas no rodapé", "Listar os campos do formulário", "Informações do arquivo"];
    if (anexos.length > 1) ops.unshift("Juntar os arquivos");
    var msg = "Recebi " + nomes + ". Ele fica só neste aparelho e eu edito aqui mesmo, sem enviar a ninguém. O que faço?" + aviso;
    if (origem === "balao") {
      masc("falar", msg, { duracao: 0, sugestoes: ops.slice(0, 4).map(function (o) { return { rotulo: o, fn: function () { enviarTexto(o, "balao"); } }; }) });
    } else if (lista) {
      mensagem("ele", msg);
      mostrarSugestoes(ops.slice(0, 3));
    }
  }

  function tell(origem, texto) {
    if (origem === "balao") masc("falar", texto, { duracao: 0 });
    else if (lista) mensagem("aviso", texto);
  }

  // pedido de edição de PDF (ex.: "numerar as páginas")? Com arquivo anexado basta o verbo; sem arquivo, a mensagem precisa falar em PDF.
  function ehPedidoDePdf(texto) {
    try { return !!(window.Paulus && window.Paulus.pdf && window.Paulus.pdf.ler(texto, { temArquivo: anexos.length > 0 })); } catch (e) { return false; }
  }

  // Ponto de entrada de TUDO que a pessoa escreve (balão ou painel). Pedido de PDF sem arquivo abre o seletor na hora do toque.
  function enviarTexto(texto, origem) {
    if (conversando) return;
    if (!anexos.length && ehPedidoDePdf(texto)) {
      pendente = { texto: texto, origem: origem };
      tell(origem, "Para isso preciso do arquivo. Escolha o PDF: ele fica só neste aparelho e eu edito aqui mesmo.");
      abrirSeletor();
      return;
    }
    perguntar(texto, { origem: origem });
  }

  // ---------------------------------------------------------------- balão (o mascote conversando)
  function abrirConversa() {
    if (!preparar()) { falarMascote("O assistente não carregou. Recarregue a página."); return; }
    var titulo = tituloDoCartao();
    var ctx = titulo ? masc("sugestoesDoCartao", titulo) : null;
    var chips = [];
    if (ctx) {
      var curto = ctx.titulo.length > 34 ? ctx.titulo.slice(0, 33) + "…" : ctx.titulo;
      chips.push({ rotulo: "O que é “" + curto + "”?", fn: function () { enviarTexto("Explique para que serve o cartão “" + ctx.titulo + "” do app e como usar.", "balao"); } });
      ctx.perguntas.slice(0, 2).forEach(function (q) { chips.push(q); });
    }
    chips.push({ rotulo: "💡 Uma dica", fn: function () { masc("dica"); } });
    chips.push({ rotulo: "Assuntos", fn: function () { masc("falar", "Escolha um assunto:", { chips: true, duracao: 0 }); } });
    var texto = !jaSaudou
      ? "Oi! Eu sou o Anona. Pergunte sobre o Bolsa Família e as condicionalidades, ou peça para eu abrir um cartão. Não vejo famílias nem notas."
      : ctx ? "Você está em “" + ctx.titulo + "”. Quer que eu explique ou tem outra dúvida?" : "Em que posso ajudar?";
    jaSaudou = true;
    masc("conversar", { texto: texto, sugestoes: chips });
  }

  // Cada cartão de resposta do balão: ouvir, copiar, avaliar e abrir a conversa completa.
  function acoesDoBalao(r, resp, extras) {
    var P = window.Paulus;
    var as = (extras || []).slice();
    function sinal(s) { try { if (r && P) P.avaliar(r, s); } catch (e) {} }
    var textoOk = r && (r.tipo === "ia" || r.tipo === "norma" || r.tipo === "sem_resposta" || r.tipo === "calculo" || r.tipo === "local");
    if (resp && masc("vozSuportada")) as.push({ rotulo: "🔊 Ouvir", aria: "Ouvir a resposta", fn: function () { masc("ouvir", resp); } });
    if (textoOk && resp) {
      as.push({ rotulo: "Copiar", aria: "Copiar a resposta", fn: function (b) {
        try { navigator.clipboard.writeText(resp).then(function () { b.textContent = "Copiado ✓"; sinal("copiou"); }, function () { b.textContent = "Não deu"; }); } catch (e) { b.textContent = "Não deu"; }
      } });
      if (r.tipo !== "local") {
        as.push({ rotulo: "👍", aria: "Resposta boa", fn: function (b) { sinal("bom"); b.disabled = true; masc("estado", "feliz", 2200); } });
        as.push({ rotulo: "👎", aria: "Resposta ruim", fn: function (b) {
          sinal("ruim"); b.disabled = true;
          masc("sugestoes", [
            { rotulo: "Explicar de outro jeito", fn: function () { sinal("outro_jeito"); enviarTexto("Explique a resposta anterior de outro jeito, mais simples.", "balao"); } },
            { rotulo: "Mais curto", fn: function () { sinal("mais_curto"); enviarTexto("Responda a pergunta anterior de forma mais curta.", "balao"); } }
          ]);
        } });
      }
    }
    as.push({ rotulo: "💬 Conversa completa", aria: "Abrir a conversa completa", fn: function () { abrir(); } });
    return as;
  }

  // ---------------------------------------------------------------- pergunta
  // Barra de ações das respostas locais do cálculo de presença (chips: simular, copiar, explicar com a IA, limpar).
  function barraLocal(bolha, acoes) {
    if (!acoes || !acoes.length) return;
    var barra = el("div", "pa-barra");
    acoes.forEach(function (a) {
      var b = el("button", null, a.rotulo);
      b.type = "button";
      b.addEventListener("click", function () {
        if (conversando) return;
        if (a.tipo === "pergunta") enviarTexto(a.texto, "painel");
        else if (a.tipo === "ia") perguntar(a.prompt, { ia: true, mostrar: a.mostrar, origem: "painel" });
        else if (window.AnonaPresenca) window.AnonaPresenca.executar(a);
      });
      barra.appendChild(b);
    });
    bolha.parentNode.insertBefore(barra, bolha.nextSibling);
    lista.scrollTop = lista.scrollHeight;
  }

  function acoesLocaisParaBalao(acoes) {
    return (acoes || []).map(function (a) {
      return { rotulo: a.rotulo, fn: function () {
        if (conversando) return;
        if (a.tipo === "pergunta") enviarTexto(a.texto, "balao");
        else if (a.tipo === "ia") perguntar(a.prompt, { ia: true, mostrar: a.mostrar, origem: "balao" });
        else if (window.AnonaPresenca) window.AnonaPresenca.executar(a);
      } };
    });
  }

  // opcoes.ia = true: pergunta montada pelo app só com números (vai ao Paulus); opcoes.mostrar = o que aparece na bolha.
  // opcoes.origem = "balao" (o mascote responde no balão, e o painel guarda o histórico) ou "painel".
  function perguntar(texto, opcoes) {
    var P = window.Paulus;
    opcoes = opcoes || {};
    if (!preparar()) { falarMascote("O assistente não carregou. Recarregue a página."); return; }
    var doBalao = opcoes.origem === "balao";
    // Conta de presença: resolvida AQUI, no aparelho, sem IA e sem enviar nada (o painel só mostra).
    if (!opcoes.ia && window.AnonaPresenca) {
      var local = null;
      try { local = window.AnonaPresenca.tratar(texto); } catch (e) { local = null; }
      if (local) {
        mensagem("eu", texto);
        sugestoesEl.textContent = "";
        var bl = mensagem("ele", local.texto);
        barraLocal(bl, local.acoes);
        if (local.copiarAgora && typeof window.cfCopiarResumo === "function") window.cfCopiarResumo();
        if (doBalao) masc("falar", local.texto, { duracao: 60000, acoes: acoesLocaisParaBalao(local.acoes) });
        masc("estado", "feliz", 1500);
        return;
      }
    }
    ultimaPergunta = texto;
    ultimasOpcoes = opcoes;
    mensagem("eu", opcoes.mostrar || texto);
    sugestoesEl.textContent = "";
    var bolha = mensagem("ele", "…");
    conversando = true;
    enviar.disabled = true;
    status.textContent = "pensando…";
    aborto = typeof AbortController === "function" ? new AbortController() : null;
    masc("pararVoz");
    masc("estado", "pensando");
    if (doBalao) masc("dizer", "Pensando…", { parcial: true, limpar: true });

    var chamada = { aba: abaAtual(), sinal: aborto ? aborto.signal : undefined };
    if (anexos.length && !opcoes.ia && ehPedidoDePdf(texto)) chamada.arquivos = anexos.slice();
    chamada.onToken = function (pedaco, tudo) {
      bolha.textContent = tudo; // textContent, nunca innerHTML
      status.textContent = "escrevendo…";
      lista.scrollTop = lista.scrollHeight;
      if (masc("estadoAtual") !== "falando") masc("estado", "falando");
      if (doBalao) masc("dizer", tudo, { parcial: true });
    };

    P.perguntar(texto, chamada).then(function (r) {
      if (!painel) return; // saiu da conta no meio
      var extrasBalao = [], sugBalao = null, nota = [];
      var resp = "";
      var humor = "neutro", humorMs = 0;
      var tipoBalao = r.tipo;

      if (r.tipo === "bloqueio") {
        bolha.parentNode && bolha.parentNode.removeChild(bolha);
        // some a pergunta com dado pessoal da tela
        var ultimaEu = lista.querySelectorAll(".pa-msg.eu");
        if (ultimaEu.length) ultimaEu[ultimaEu.length - 1].textContent = "(mensagem oculta: continha dado pessoal)";
        mensagem("aviso", r.texto);
        resp = r.texto;
        humor = "alerta"; humorMs = 4000;
      } else if (r.tipo === "crise") {
        bolha.textContent = r.texto;
        var tels = [];
        (r.telefones || []).forEach(function (t) { mensagem("aviso", t.numero + " — " + t.nome); tels.push("• " + t.numero + " — " + t.nome); });
        resp = r.texto + (tels.length ? "\n\n" + tels.join("\n") : "");
        humor = "alerta"; humorMs = 9000;
      } else if (r.tipo === "busca" && r.itens) {
        bolha.textContent = r.texto || "Encontrei:";
        var linhas = [];
        r.itens.forEach(function (i) { var t = i.titulo + (i.detalhe ? " — " + i.detalhe : ""); mensagem("ele", t); linhas.push("• " + t); });
        resp = (r.texto || "Encontrei:") + (linhas.length ? "\n" + linhas.slice(0, 6).join("\n") : "");
      } else if (r.tipo === "acao") {
        if (r.pedeConfirmacao) {
          bolha.textContent = r.texto;
          var b = el("button", null, "Confirmar");
          b.type = "button";
          b.addEventListener("click", function () { b.disabled = true; r.confirmar(); });
          bolha.appendChild(document.createElement("br"));
          bolha.appendChild(b);
          extrasBalao.push({ rotulo: "Confirmar", fn: function (bb) { bb.disabled = true; try { r.confirmar(); } catch (e) {} } });
          resp = r.texto;
        } else {
          bolha.textContent = r.texto === "Pronto." ? "Pronto, levei você até lá." : r.texto;
          resp = bolha.textContent;
          humor = "feliz"; humorMs = 1800;
        }
      } else if (r.tipo === "acao_desconhecida") {
        bolha.textContent = r.texto || "Não achei essa tela.";
        resp = bolha.textContent;
        if (r.opcoesAcoes && r.opcoesAcoes.length) {
          var ob = el("div", "pa-barra");
          ob.appendChild(el("span", "pa-ok", "Era esta?"));
          sugBalao = [];
          r.opcoesAcoes.slice(0, 4).forEach(function (o) {
            var b2 = el("button", null, o.rotulo);
            b2.type = "button";
            b2.addEventListener("click", function () { try { r.aprender(o.id); } catch (e) {} ob.textContent = ""; ob.appendChild(el("span", "pa-ok", "Anotado! Da próxima vez eu abro direto.")); });
            ob.appendChild(b2);
            sugBalao.push({ rotulo: "Era: " + o.rotulo, fn: function () { try { r.aprender(o.id); } catch (e) {} masc("falar", "Anotado! Da próxima vez eu abro direto.", { duracao: 4000 }); } });
          });
          bolha.parentNode.insertBefore(ob, bolha.nextSibling);
        }
      } else if (r.tipo === "pdf") {
        bolha.textContent = r.texto || "Pronto.";
        resp = bolha.textContent;
        var pb = el("div", "pa-barra");
        (r.arquivos || []).forEach(function (a) {
          var rot = "⬇ " + (a.nome || "arquivo.pdf") + (a.paginas ? " (" + a.paginas + " pág.)" : "");
          var bb = el("button", null, rot);
          bb.type = "button";
          bb.addEventListener("click", function () { try { P.pdf.baixar(a); } catch (e) {} });
          pb.appendChild(bb);
          extrasBalao.push({ rotulo: rot, fn: function () { try { P.pdf.baixar(a); } catch (e) {} } });
        });
        if (r.ok && r.arquivos && r.arquivos.length) {
          var mais = function () {
            anexos = r.arquivos.map(function (a) { return { nome: a.nome, name: a.nome, bytes: a.bytes, size: a.tamanho }; });
            desenharAnexos();
            return "Usando " + anexos.map(nomeDoAnexo).join(", ") + ". Diga o que mais quer fazer.";
          };
          var bm = el("button", null, "✎ Editar mais este arquivo");
          bm.type = "button";
          bm.addEventListener("click", function () { mensagem("ele", mais()); });
          pb.appendChild(bm);
          extrasBalao.push({ rotulo: "✎ Editar mais", fn: function () { masc("falar", mais(), { duracao: 0 }); } });
          anexos = []; // o pedido foi atendido; o resultado fica nos botões de baixar
          desenharAnexos();
          humor = "feliz"; humorMs = 1800;
        }
        if (r.precisaArquivo) {
          pendente = { texto: texto, origem: opcoes.origem || "painel" };
          var ba = el("button", null, "📎 Anexar PDF");
          ba.type = "button";
          ba.addEventListener("click", function () { abrirSeletor(); });
          pb.appendChild(ba);
          extrasBalao.push({ rotulo: "📎 Anexar PDF", fn: function () { abrirSeletor(); } });
        }
        if (pb.childNodes.length) bolha.parentNode.insertBefore(pb, bolha.nextSibling);
      } else if (r.tipo !== "ia") {
        bolha.textContent = r.texto || "Não consegui responder agora.";
        resp = bolha.textContent;
        if (r.tipo === "erro" || r.tipo === "sem_resposta") { humor = "triste"; humorMs = 4000; }
      } else {
        resp = bolha.firstChild ? bolha.firstChild.textContent : bolha.textContent;
      }

      // Sem internet ou IA fora do ar: o mascote responde sozinho com o que sabe do Bolsa Família (no aparelho).
      var usouLocal = false;
      if (!opcoes.ia && (r.tipo === "erro" || r.tipo === "sem_resposta")) {
        var sabe = null;
        try { sabe = masc("responder", texto) || null; } catch (e) { sabe = null; }
        if (sabe) {
          usouLocal = true;
          bolha.textContent = (navigator.onLine === false ? "Estou sem internet, mas sobre isso eu tenho guardado:\n" : "A IA não respondeu agora, mas sobre isso eu tenho guardado:\n") + sabe;
          resp = bolha.textContent;
          nota.push("Resposta do conhecimento guardado no aparelho (pode estar desatualizada: confira o normativo vigente).");
          humor = "neutro"; humorMs = 0;
          tipoBalao = "local";
        }
      }

      // Ações que a IA propôs (só navegação): a IA não executa nada, quem toca é a pessoa.
      if (r.tipo === "ia" && r.acoes && r.acoes.length) {
        var ab = el("div", "pa-barra");
        r.acoes.slice(0, 2).forEach(function (a) {
          var b3 = el("button", null, "Abrir: " + a.rotulo);
          b3.type = "button";
          b3.addEventListener("click", function () { try { a.executar(); } catch (e) {} });
          ab.appendChild(b3);
          extrasBalao.push({ rotulo: "Abrir: " + a.rotulo, fn: function () { try { a.executar(); } catch (e) {} } });
        });
        bolha.parentNode.insertBefore(ab, bolha.nextSibling);
      }
      if (r.deMemoria) { bolha.appendChild(el("div", "pa-fontes", "Resposta que você aprovou antes (a IA não respondeu agora).")); nota.push("Resposta que você aprovou antes (a IA não respondeu agora)."); }
      // Pedido da calculadora (só números): confere a resposta da IA ou, se ela falhou, mostra o resumo local.
      if (opcoes.ia && window.AnonaPresenca) {
        if (r.tipo === "ia") {
          var fora = window.AnonaPresenca.percentuaisForaDoCalculo(texto, bolha.firstChild ? bolha.firstChild.textContent : "");
          if (fora.length) {
            var av = "Atenção: a IA citou " + fora.map(function (v) { return String(v).replace(".", ",") + "%"; }).join(", ") + ", que não veio do cálculo. Confie nos números da calculadora e confira a regra no normativo vigente.";
            mensagem("aviso", av);
            nota.push(av);
          }
        } else if (r.tipo === "erro" || r.tipo === "sem_resposta") {
          var local2 = window.AnonaPresenca.explicacaoLocal();
          if (local2) { bolha.textContent = "A IA não respondeu agora. Este é o resumo feito aqui no aparelho:\n" + local2; resp = bolha.textContent; }
        }
      }
      if (r.fontes && r.fontes.length) {
        var ft = "Fontes: " + r.fontes.map(function (x) {
          return typeof x === "string" ? x : [x.documento || x.norma || "", x.referencia || ""].filter(Boolean).join(", ");
        }).filter(Boolean).slice(0, 4).join("; ");
        bolha.appendChild(el("div", "pa-fontes", ft));
        nota.push(ft);
      }
      if (r.tipo === "ia" || r.tipo === "norma" || r.tipo === "sem_resposta" || usouLocal) barraResposta(bolha, resp, "ok", r.deMemoria || usouLocal ? null : r);
      else if (r.tipo === "erro" && !r.limite) barraResposta(bolha, "", "erro");
      (r.avisos || []).forEach(function (a) { mensagem("aviso", a); nota.push(a); });
      mostrarSugestoes(r.sugestoes);

      // ---- espelha no balão do mascote
      masc("estado", humor, humorMs || undefined);
      if (doBalao) {
        var rr = usouLocal ? { tipo: "local" } : r;
        var botoes = acoesDoBalao(rr, resp, extrasBalao);
        masc("dizer", resp, { nota: nota.join("\n"), duracao: 90000 });
        masc("acoes", botoes);
        masc("sugestoes", sugBalao || (r.sugestoes || []).slice(0, 3));
      }
      // voz automática (🔊): lê só respostas de texto, nunca telefones de crise sozinho no meio do susto
      if (masc("vozLigada") && resp && r.tipo !== "pdf" && r.tipo !== "bloqueio" && r.tipo !== "erro") masc("ouvir", resp);
    }).catch(function () {
      masc("estado", "triste", 4000);
      if (bolha) { bolha.textContent = "Não consegui responder agora. Tente de novo em instantes."; if (bolha.parentNode) barraResposta(bolha, "", "erro"); }
      if (doBalao) { masc("dizer", "Não consegui responder agora. Tente de novo em instantes.", { limpar: true }); }
    }).then(function () {
      conversando = false;
      if (enviar) enviar.disabled = false;
      if (status) status.textContent = "";
    });
  }

  // Barra de ações sob a resposta: ouvir, copiar, 👍/👎 (só no aparelho, nada é enviado) e tentar de novo.
  function barraResposta(bolha, texto, tipo, r) {
    function sinal(s) { try { if (r && window.Paulus) window.Paulus.avaliar(r, s); } catch (e) {} }
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
        perguntar(ultimaPergunta, ultimasOpcoes);
      });
    } else {
      if (masc("vozSuportada")) botao("🔊 Ouvir", "Ouvir a resposta", function () { masc("ouvir", texto); });
      botao("Copiar", "Copiar resposta", function (b) {
        var alvo = texto;
        try {
          navigator.clipboard.writeText(alvo).then(function () { b.textContent = "Copiado ✓"; sinal("copiou"); }, function () { b.textContent = "Não deu"; });
        } catch (e) { b.textContent = "Não deu"; }
      });
      botao("👍", "Resposta boa", function () { sinal("bom"); masc("estado", "feliz", 2200); trocarPor("Obrigado! 😊 Guardei no seu aparelho."); });
      botao("👎", "Resposta ruim", function () {
        sinal("ruim");
        barra.textContent = "";
        barra.appendChild(el("span", "pa-ok", "Quer que eu tente de outro jeito?"));
        [["Explicar de outro jeito", "Explique a resposta anterior de outro jeito, mais simples.", "outro_jeito"],
         ["Mais curto", "Responda a pergunta anterior de forma mais curta.", "mais_curto"]].forEach(function (o) {
          var b = el("button", null, o[0]);
          b.type = "button";
          b.addEventListener("click", function () { sinal(o[2]); if (!conversando) enviarTexto(o[1], "painel"); });
          barra.appendChild(b);
        });
      });
    }
    bolha.parentNode.insertBefore(barra, bolha.nextSibling);
    lista.scrollTop = lista.scrollHeight;
  }

  // O que o Paulus aprendeu (só neste aparelho): estilo de resposta, temas e perguntas frequentes. Nunca vai ao Worker.
  function mostrarMemoria() {
    var P = window.Paulus;
    if (!P || !lista) return;
    var res;
    try { res = P.memoria.resumo(); } catch (e) { res = null; }
    var corpo = res && !res.vazia ? "O que aprendi com o seu uso (fica só neste aparelho):\n• " + res.linhas.join("\n• ") : "Ainda não aprendi nada sobre o seu jeito de usar. Use 👍/👎 nas respostas e eu vou me ajustando.";
    if (res && !res.ativa) corpo += "\n(Aprendizado desligado.)";
    var m = mensagem("aviso", corpo);
    var barra = el("div", "pa-barra");
    var lig = el("button", null, res && res.ativa === false ? "Ligar aprendizado" : "Desligar aprendizado");
    lig.type = "button";
    lig.addEventListener("click", function () { try { P.memoria.ligar(!(res && res.ativa === false)); } catch (e) {} barra.textContent = ""; barra.appendChild(el("span", "pa-ok", "Pronto.")); });
    var esq = el("button", null, "Esquecer tudo");
    esq.type = "button";
    esq.addEventListener("click", function () { try { P.memoria.esquecer(); } catch (e) {} barra.textContent = ""; barra.appendChild(el("span", "pa-ok", "Esqueci o que tinha aprendido.")); });
    barra.appendChild(lig);
    barra.appendChild(esq);
    m.parentNode.insertBefore(barra, m.nextSibling);
    lista.scrollTop = lista.scrollHeight;
  }

  // ---------------------------------------------------------------- início
  function iniciar() {
    if (iniciado || !window.Paulus) return;
    window.Paulus.init({ app: "anona", endpoint: ENDPOINT, conhecimentoUrl: CONHECIMENTO, perfil: perfilId });
    registrarAcoes();
    iniciado = true;
  }

  // Toque no mascote (já logado): abre/fecha o balão de conversa. Sem login o mascote segue dando dicas normais.
  function aoToque() {
    if (!logado()) return false;
    if (!window.Paulus) { falarMascote("O assistente não carregou. Recarregue a página."); return true; }
    if (painel && !painel.hidden) { fechar(); return true; }
    if (masc("conversaAberta")) { masc("fecharBalao"); masc("estado", "neutro"); return true; }
    abrirConversa();
    return true;
  }

  function ligarMascote() {
    if (window.AnonaMascot && window.AnonaMascot.aoClicar) window.AnonaMascot.aoClicar(aoToque);
    sincronizar();
  }

  // Liga (ou desliga) o campo de pergunta do balão e o "soltar arquivo" do mascote conforme o login.
  function sincronizar(forcar) {
    if ((forcar || logado()) && window.Paulus) {
      masc("aoPerguntar", function (t) { enviarTexto(t, "balao"); });
      masc("aoSoltar", function (fs) { if (preparar()) receberArquivos(fs); });
    }
  }

  // o index.html avisa quando entra/sai da conta (evento anona:auth)
  window.addEventListener("anona:auth", function (ev) {
    if (!ev.detail || !ev.detail.logado) { encerrar(); iniciado = false; perfilId = ""; return; }
    var novo = ev.detail.uid ? hashId(String(ev.detail.uid)) : "";
    if (novo !== perfilId) { perfilId = novo; iniciado = false; } // outra conta no mesmo navegador: memória separada
    sincronizar(true);
    // o evento chega antes de o app aparecer: espera um instante para dar o bom-dia
    setTimeout(function () {
      if (!masc("balaoAberto") && !(painel && !painel.hidden)) masc("bomDia");
    }, 2500);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarMascote);
  else ligarMascote();

  // Pergunta feita de fora (campo "Preencher falando com o Anona" da calculadora): o mascote responde no balão.
  function perguntarDeFora(texto, opcoes) {
    if (!preparar() || conversando) return;
    var o = {};
    for (var k in (opcoes || {})) if (Object.prototype.hasOwnProperty.call(opcoes, k)) o[k] = opcoes[k];
    o.origem = o.origem || "balao";
    if (o.ia) perguntar(texto, o); else enviarTexto(texto, o.origem);
  }

  window.PaulusAnona = { abrir: abrir, fechar: fechar, perguntar: perguntarDeFora, conversar: abrirConversa, tituloDoCartao: tituloDoCartao };
})();
