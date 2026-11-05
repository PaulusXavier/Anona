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
//   AnonaMascot.aoClicar(fn)                           -> fn() roda no toque; se devolver true, a dica
//                                                          aleatória não aparece (usado pelo Paulus)
//   AnonaMascot.dica(topico?)                          -> mostra uma dica de Bolsa Família (sem repetir até acabar).
//                                                          topico: valores | entrada | pagamento | escola | efeitos | recurso
//   AnonaMascot.responder("pergunta")                  -> responde sozinho, no aparelho, com o que sabe do programa
//                                                          (devolve o texto, ou null se não souber)
//   AnonaMascot.dicaDoMomento()                        -> o que está valendo hoje (ou null)
//
// CONHECIMENTO DO MASCOTE: a lista BASE abaixo resume o Bolsa Família (valores, entrada, pagamento, escola/saúde,
// descumprimento, recurso). Vem da mesma base do Paulus (conhecimento.json: Lei 14.601/2023, Decreto 12.064/2024 e
// 13.120/2026, Portaria MDS 1.058/2025). Os valores em R$ NÃO ficam escritos aqui: vêm de window.AnonaValoresBeneficio
// (o index.html publica ali o ano mais recente de VALORES_BENEFICIO_POR_ANO), então um reajuste só se edita no index.html.
// Prazos de um ano novo: ADICIONE linhas em MOMENTOS (não apague as antigas; elas expiram sozinhas pela data).
// Testes: node tests/mascot.test.js
//
// O mascote nunca aparece por cima de modais (confirmModalOverlay etc.) nem
// atrapalha cliques no resto da página — só a área do próprio cartãozinho
// responde a toque.

(function () {
  "use strict";

  if (typeof window !== "undefined" && window.AnonaMascot) return; // evita duplicar se o script for incluído 2x

  // Dicas do app (não são do Bolsa Família).
  var DICAS_APP = [
    "Toque num dia do calendário para ver os prazos de saúde, educação e SICON daquele mês.",
    "Digite o final do seu NIS na barra lateral: eu destaco seu dia de pagamento sozinho.",
    "Suas anotações ficam salvas na nuvem — pode entrar com a mesma conta em outro aparelho.",
    "Sem internet? Sem problema: suas notas continuam sendo guardadas no aparelho e sincronizam depois.",
    "Esqueceu a senha? Tem um link de 'Esqueci minha senha' bem na tela de entrada.",
    "Na calculadora, você pode escrever 'faltou 3 dias em março, 22 dias letivos' que eu preencho para você."
  ];

  // ---------------------------------------------------------------- conhecimento (Bolsa Família)
  var TOPICOS = [
    ["valores", "Valores"], ["entrada", "Como entrar"], ["pagamento", "Pagamento"],
    ["escola", "Escola e saúde"], ["efeitos", "Descumprimento"], ["recurso", "Recurso"]
  ];

  var VALORES_PADRAO = { brc: 164, bco: 691, bpi: 173, bvf: 58 }; // Decreto 13.120/2026 (a partir de out/2026)
  function valores() {
    var v = (typeof window !== "undefined" && window.AnonaValoresBeneficio) || null;
    return {
      brc: (v && v.brc) || VALORES_PADRAO.brc, bco: (v && v.bco) || VALORES_PADRAO.bco,
      bpi: (v && v.bpi) || VALORES_PADRAO.bpi, bvf: (v && v.bvf) || VALORES_PADRAO.bvf
    };
  }
  function brl(n) { return "R$ " + Number(n).toLocaleString("pt-BR"); }

  // t = tópico, k = palavras-chave (sem acento, minúsculas; as de até 3 letras valem só como palavra inteira),
  // r = texto (string, ou função que recebe os valores vigentes).
  var BASE = [
    // ---- valores
    { t: "valores", k: ["valor", "quanto", "quanto recebe", "piso", "brc", "bco", "benefício de renda", "beneficio de renda", "por pessoa", "bolsa familia"],
      r: function (v) { return "Hoje o Bolsa Família paga " + brl(v.brc) + " por pessoa da família, com piso de " + brl(v.bco) + " por família: se a soma não chega ao piso, vem um complemento."; } },
    { t: "valores", k: ["crianca pequena", "primeira infancia", "bpi", "bebe", "ate 7 anos", "crianca"],
      r: function (v) { return "Criança de 0 a 7 anos incompletos acrescenta " + brl(v.bpi) + " por criança (Benefício Primeira Infância), por cima do piso."; } },
    { t: "valores", k: ["variavel", "bvf", "gestante", "gravida", "nutriz", "amamentando", "adolescente", "jovem", "bva"],
      r: function (v) { return "O Benefício Variável Familiar é de " + brl(v.bvf) + " por gestante, nutriz, criança de 7 a 12 anos incompletos ou adolescente de 12 a 18 anos incompletos. O adolescente de 16 a 18 tem o Variável Jovem."; } },
    { t: "valores", k: ["exemplo", "calculo", "calcular", "simular", "conta"],
      r: function (v) {
        var tres = 3 * v.brc;
        return "Exemplo: família de 3 pessoas soma 3 × " + brl(v.brc) + " = " + brl(tres) + ". Faltam " + brl(v.bco - tres) +
          " para o piso de " + brl(v.bco) + ", e o Benefício Complementar cobre essa diferença. Crianças e gestantes entram por cima.";
      } },
    { t: "valores", k: ["reajuste", "aumentou", "aumento", "novo valor", "outubro", "inpc", "decreto 13"],
      r: "Em outubro de 2026 houve reajuste de 15,04% (INPC acumulado, Decreto 13.120/2026), o primeiro pela inflação desde 2023. A lei impede reduzir o valor nominal, e a linha de renda para entrar continua em R$ 218 por pessoa." },
    { t: "valores", k: ["sigla", "significa", "o que e brc", "rf ", "nloc", "sicon"],
      r: "BRC: renda de cidadania (por pessoa). BCO: complementar (completa o piso). BPI: primeira infância. BVF: variável familiar. RF: responsável familiar, quem recebe. Sicon: sistema de condicionalidades. NIS: número de identificação social." },

    // ---- entrada
    { t: "entrada", k: ["entrar", "participar", "inscrever", "inscricao", "cadastrar", "cadastro unico", "cadunico", "como faco", "quem pode", "elegivel", "direito"],
      r: "Para entrar: 1) inscrição no Cadastro Único no CRAS, com o CPF de todas as pessoas da família; 2) renda de até R$ 218 por pessoa; 3) a seleção é automática, todo mês. Estar no CadÚnico não garante entrada no programa." },
    { t: "entrada", k: ["renda", "218", "salario", "limite"],
      r: "A renda máxima para entrar é R$ 218 por pessoa da família (soma da renda da casa dividida pelo número de moradores). Esse limite não mudou no reajuste de outubro." },
    { t: "entrada", k: ["emprego", "arrumei", "trabalho", "aumentou a renda", "renda subiu", "protecao", "50%", "passou da renda", "subiu"],
      r: "Regra de proteção: se a renda passar de R$ 218 mas ficar abaixo do limite da regra, a família continua recebendo 50% do valor por um tempo (até 24 meses para quem já estava na regra; para novos, 12 meses sem renda estável ou 2 meses com aposentadoria, pensão ou BPC-Idoso). Se a renda voltar a R$ 218 ou menos, volta a 100%. Confirme os limites no CRAS." },
    { t: "entrada", k: ["atualizar", "atualizacao", "desatualizado", "24 meses", "convocad", "qualificacao"],
      r: "O Cadastro Único deve ser atualizado a cada 24 meses e sempre que mudar endereço, renda, trabalho, composição da família ou escola. Cadastro antigo sozinho não bloqueia: o bloqueio vale para quem foi convocado e perdeu o prazo. Cancelado por isso, dá para reverter em até 180 dias." },
    { t: "entrada", k: ["sozinho", "unipessoal", "uma pessoa", "moro so", "entrevista"],
      r: "Família de uma só pessoa precisa de inscrição ou atualização por entrevista no domicílio para entrar no Bolsa Família, e pode passar por verificação mais rigorosa." },
    { t: "entrada", k: ["cpf", "documento", "levar", "titulo"],
      r: "No CRAS, o responsável familiar leva o CPF de todas as pessoas da família (obrigatório), um documento de identificação e, se tiver, comprovante de residência. O cadastro é gratuito." },

    // ---- pagamento
    { t: "pagamento", k: ["quando", "data", "calendario", "dia de pagamento", "final do nis", "pagamento", "paga", "cai"],
      r: "O pagamento acontece nos últimos 10 dias úteis do mês, escalonado pelo final do NIS. Novembro: de 16 a 30. Dezembro: de 10 a 23, antecipado por causa do fim do ano. Digite o final do seu NIS na barra lateral que eu destaco o seu dia." },
    { t: "pagamento", k: ["sacar", "saque", "caixa tem", "cartao", "loterica", "agencia", "pix", "conta", "onde saco"],
      r: "O valor cai em conta na Caixa. Sem conta, a Caixa abre uma Poupança Social Digital gratuita. Dá para sacar em agência, lotérica, terminal de autoatendimento ou correspondente Caixa Aqui, e movimentar pelo app Caixa Tem (pagar contas, Pix). O cartão sai no nome do responsável familiar." },
    { t: "pagamento", k: ["180 dias", "nao saquei", "esqueci de sacar", "perde", "acumula"],
      r: "A parcela fica disponível para saque por até 180 dias." },
    { t: "pagamento", k: ["calamidade", "emergencia", "enchente", "unificado"],
      r: "Em município com emergência ou calamidade reconhecida, o pagamento é unificado no primeiro dia do calendário do mês." },
    { t: "pagamento", k: ["telefone", "contato", "atendimento", "ligar", "0800", "disque", "duvida"],
      r: "Disque Social (MDS): 121. Caixa: 111. E o CRAS do seu bairro atende presencialmente." },

    // ---- escola e saúde
    { t: "escola", k: ["frequencia", "minima", "escola", "falta", "faltas", "aula", "presenca"],
      r: "A frequência mínima é de 60% para crianças de 4 a 6 anos incompletos e de 75% para 6 a 18 anos incompletos. Uma falta isolada não gera efeito: conta a frequência do período. Use a calculadora do app para conferir." },
    { t: "escola", k: ["vacina", "saude", "pre natal", "prenatal", "peso", "altura", "pesagem", "posto de saude", "ubs"],
      r: "Na saúde: gestantes fazem o pré-natal; crianças menores de 7 anos mantêm as vacinas em dia e são pesadas e medidas (peso e altura). O acompanhamento é feito duas vezes por ano, em vigências semestrais." },
    { t: "escola", k: ["como e acompanhado", "sistema presenca", "bimestre", "periodo", "quem registra", "repercussao"],
      r: "A escola registra a frequência no Sistema Presença (MEC) em cinco períodos por ano. Depois o MDS identifica os descumprimentos e lança no Sicon. Avise a escola de que a família recebe o Bolsa Família e mantenha a escola atualizada no Cadastro Único." },
    { t: "escola", k: ["nao matriculad", "fora da escola", "sem escola", "matricula", "nloc", "nao localizad"],
      r: "Criança ou adolescente fora da escola deve ser matriculado logo. Quem não é localizado pelo acompanhamento da educação (NLOC) entra em busca ativa pelo município." },

    // ---- efeitos / descumprimento
    { t: "efeitos", k: ["descumpr", "efeito", "cancel", "suspen", "alerta", "advertencia", "gradual", "perder o bolsa", "corta"],
      r: "Descumprimento não é cancelamento direto. Os efeitos são graduais: 1º alerta, sem mexer no valor; 2º bloqueio de 1 mês; depois suspensão de 2 meses; e só por último o cancelamento. Se passar mais de 6 meses entre os descumprimentos, os anteriores deixam de contar." },
    { t: "efeitos", k: ["bloquead", "bloqueio", "bloqueou", "parcela", "perco"],
      r: "Benefício bloqueado por condicionalidade não perde a parcela: ela pode ser sacada no mês seguinte. Veja o motivo no histórico do Sicon; se for erro ou houve dificuldade da família, cabe recurso." },
    { t: "efeitos", k: ["nao se aplica", "forca maior", "doenca", "sem oferta", "justificativ", "motivo", "prioridade", "suas"],
      r: "O efeito não é aplicado em caso de força maior, falta de oferta do serviço, questões de saúde, étnicas ou culturais e outros motivos sociais. Família em descumprimento tem prioridade no atendimento do SUAS, e o município não pode usar comunicação vexatória sobre isso." },
    { t: "efeitos", k: ["golpe", "fraude", "pagar para", "cobr", "desbloquear", "whatsapp", "falso"],
      r: "Cuidado com golpe: ninguém pode cobrar para desbloquear, liberar ou incluir no Bolsa Família. O atendimento é gratuito, no CRAS, no 121 ou no app oficial. Não passe senha nem código por mensagem." },
    { t: "efeitos", k: ["interrupcao", "interromper", "passou o prazo", "perdi o prazo", "prazo do recurso", "acompanhamento familiar", "paif"],
      r: "Se o prazo do recurso passou, ainda dá para pedir a interrupção temporária dos efeitos: a família precisa estar em acompanhamento no SUAS (PAIF) e o CRAS registrar isso no Sicon até a data-limite do mês para valer no mês seguinte." },

    // ---- recurso
    { t: "recurso", k: ["recurso", "contestar", "recorrer", "discordo", "erro no registro", "sicon"],
      r: "O recurso on-line é o direito da família de contestar, no Sicon, um efeito por descumprimento (erro de registro ou vulnerabilidade que dificultou o acesso à escola ou à saúde). É a coordenação municipal que cadastra: NIS, justificativa de até 400 caracteres e a documentação." },
    { t: "recurso", k: ["documentos do recurso", "anexar", "comprovante", "declaracao", "laudo", "relatorio tecnico"],
      r: "Documentos aceitos no recurso: declaração da escola, da unidade de saúde, da família ou do CRAS, laudo ou relatório técnico da assistência social, entre outros. Os originais ficam arquivados no município." },
    { t: "recurso", k: ["prazo", "ate quando", "data limite", "limite do recurso"],
      r: "A data limite do recurso depende do mês de repercussão. Para a repercussão de novembro (educação de agosto e setembro), o recurso vai até 31/01/2027. Confira o cartão do cronograma no app." },
    { t: "recurso", k: ["devol", "indevido", "recebi errado", "errado", "gru", "pagtesouro", "restituir"],
      r: "Recebeu valor a mais? A devolução voluntária é feita pela GRU no PagTesouro (Pix, cartão ou boleto) ou em qualquer agência da Caixa. Guarde o comprovante. Depois, atualize o Cadastro Único no CRAS; quem ainda atende aos critérios pode ter o Retorno Garantido por 36 meses." }
  ];

  // Momentos: o que está valendo em cada período (de/ate em AAAA-MM-DD, inclusive). Expiram sozinhos.
  var MOMENTOS = [
    { de: "2026-11-01", ate: "2026-11-30", txt: "Novembro: o Bolsa Família é pago de 16 a 30/11, escalonado pelo final do NIS." },
    { de: "2026-11-01", ate: "2026-11-30", txt: "Até 30/11 dá para registrar no Sicon a interrupção temporária dos efeitos para valer em dezembro." },
    { de: "2026-11-23", ate: "2026-12-18", txt: "O registro da frequência escolar de outubro/novembro no Sistema Presença vai de 30/11 a 18/12." },
    { de: "2026-12-01", ate: "2026-12-23", txt: "Dezembro: pagamentos de 10 a 23/12, calendário antecipado por causa do fim do ano." },
    { de: "2026-11-01", ate: "2027-01-31", txt: "O recurso da repercussão de novembro (educação de agosto e setembro) vai até 31/01/2027." },
    { de: "2026-12-01", ate: "2027-01-16", txt: "A 2ª vigência de saúde de 2026 fecha em 16/01/2027: veja se as vacinas e a pesagem estão em dia." }
  ];

  // ---------------------------------------------------------------- lógica de resposta
  function normalizar(t) {
    return String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function temPalavra(q, kw) {
    if (kw.length > 3) return q.indexOf(kw) !== -1;
    return new RegExp("(^| )" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([ ,.?%!]|$)").test(q);
  }

  function texto(fato) { return typeof fato.r === "function" ? fato.r(valores()) : fato.r; }

  // Pontua cada fato pelas palavras-chave achadas na pergunta; devolve o melhor ou null.
  function responder(pergunta) {
    var q = normalizar(pergunta);
    if (q.length < 3) return null;
    var melhor = null, nm = 0;
    BASE.forEach(function (f) {
      var n = 0;
      f.k.forEach(function (kw) {
        kw = normalizar(kw);
        if (kw && temPalavra(q, kw)) n += 1 + Math.min(kw.length, 10) / 10;
      });
      if (n > nm) { nm = n; melhor = f; }
    });
    return melhor ? texto(melhor) : null;
  }

  function hojeISO(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function momentosAtivos(hoje) {
    var h = hoje || hojeISO();
    return MOMENTOS.filter(function (m) { return m.de <= h && h <= m.ate; });
  }

  function dicaDoMomento(hoje) {
    var a = momentosAtivos(hoje);
    return a.length ? a[Math.floor(Math.random() * a.length)].txt : null;
  }

  // Sorteio sem repetir até acabar (por tópico).
  var sacolas = {};
  function proxima(topico) {
    var chave = topico || "*";
    var idx = [];
    BASE.forEach(function (f, i) { if (!topico || f.t === topico) idx.push(i); });
    if (!idx.length) return null;
    if (!sacolas[chave] || !sacolas[chave].length) {
      sacolas[chave] = idx.slice();
      for (var i = sacolas[chave].length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = sacolas[chave][i]; sacolas[chave][i] = sacolas[chave][j]; sacolas[chave][j] = tmp;
      }
    }
    return texto(BASE[sacolas[chave].pop()]);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { responder: responder, dicaDoMomento: dicaDoMomento, momentosAtivos: momentosAtivos, proxima: proxima,
      BASE: BASE, TOPICOS: TOPICOS, MOMENTOS: MOMENTOS, DICAS_APP: DICAS_APP, normalizar: normalizar };
  }
  if (typeof document === "undefined") return; // Node (testes): só a lógica acima

  var LS_KEY = "anonaMascotVisto";
  var gancho = null;
  var estaAcordado = false;
  var raiz, balao, cartao, textoBalao, chipsEl, escondeTimer;

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
      "#anonaMascotBalao{max-width:270px;max-height:min(60vh,340px);overflow-y:auto;background:var(--card,#FFFDF8);color:var(--ink,#1D2333);" +
      "border:1px solid var(--line,rgba(13,46,99,.16));border-radius:1rem;padding:.65rem .85rem;" +
      "font-size:.82rem;line-height:1.35;box-shadow:0 10px 24px -14px rgba(13,46,99,.4);" +
      "opacity:0;transform:translateY(6px);transition:opacity .15s ease,transform .15s ease;" +
      "pointer-events:none;}" +
      "#anonaMascotBalao.anona-visivel{opacity:1;transform:translateY(0);pointer-events:auto;}" +
      "#anonaMascotChips{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.5rem;}" +
      "#anonaMascotChips:empty{display:none;}" +
      "#anonaMascotChips button{border:1px solid var(--line,rgba(13,46,99,.25));background:#fff;color:inherit;border-radius:999px;" +
      "padding:.2rem .6rem;font:inherit;font-size:.74rem;cursor:pointer;min-height:30px;}" +
      "#anonaMascotChips button:hover{background:var(--azul-soft,#E3E9F5);}" +
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
    chipsEl = document.createElement("div");
    chipsEl.id = "anonaMascotChips";
    balao.appendChild(chipsEl);

    cartao = document.createElement("button");
    cartao.type = "button";
    cartao.id = "anonaMascotBotao";
    cartao.setAttribute("aria-label", "Anona, o mascote do app — toque para uma dica");
    cartao.innerHTML = SVG_CARTAO;
    cartao.addEventListener("click", function () {
      if (gancho) {
        var tratou = false;
        try { tratou = gancho() === true; } catch (e) {}
        if (tratou) return;
      }
      dica();
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
    var msg = String(mensagem == null ? "" : mensagem);
    // balões longos ficam mais tempo na tela
    var duracao = typeof opcoes.duracao === "number" ? opcoes.duracao : Math.min(22000, Math.max(6000, 3500 + msg.length * 55));
    textoBalao.textContent = msg;
    chipsEl.textContent = "";
    if (opcoes.chips) {
      TOPICOS.forEach(function (tp) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = tp[1];
        b.addEventListener("click", function (ev) { ev.stopPropagation(); dica(tp[0]); });
        chipsEl.appendChild(b);
      });
    }
    balao.scrollTop = 0;
    balao.classList.add("anona-visivel");
    acenar();
    clearTimeout(escondeTimer);
    if (duracao > 0) {
      escondeTimer = setTimeout(function () {
        balao.classList.remove("anona-visivel");
      }, duracao);
    }
  }

  // Dica de Bolsa Família (sem repetir até acabar). Sem tópico: de vez em quando uma dica do app ou do momento.
  var contaToques = 0;
  function dica(topico) {
    var t = null;
    if (!topico) {
      contaToques++;
      var r = Math.random();
      if (contaToques === 1) t = dicaDoMomento();
      if (!t && r < 0.15) t = DICAS_APP[Math.floor(Math.random() * DICAS_APP.length)];
      if (!t && r < 0.35) t = dicaDoMomento();
    }
    if (!t) t = proxima(topico || null);
    if (t) falar(t, { chips: true });
    return t;
  }

  function esconder() {
    if (raiz) raiz.classList.add("anona-escondido");
  }

  function mostrar() {
    if (!raiz) montar();
    raiz.classList.remove("anona-escondido");
  }

  function aoClicar(fn) { gancho = typeof fn === "function" ? fn : null; }

  window.AnonaMascot = { falar: falar, acenar: acenar, esconder: esconder, mostrar: mostrar, aoClicar: aoClicar,
    dica: dica, responder: responder, dicaDoMomento: dicaDoMomento };

  function iniciar() {
    montar();
    var visto = false;
    try { visto = !!localStorage.getItem(LS_KEY); } catch (e) {}
    if (!visto) {
      setTimeout(function () {
        falar("Oi, eu sou o Anona! Toque em mim para uma dica sobre o Bolsa Família, ou escolha um assunto.", { chips: true, duracao: 12000 });
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
