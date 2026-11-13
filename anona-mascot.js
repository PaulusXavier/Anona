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
// O MASCOTE COMO ROSTO DA IA (paulus-anona.js liga tudo; sem o Paulus o mascote continua funcionando sozinho):
//   AnonaMascot.estado("pensando"|"falando"|"ouvindo"|"alerta"|"feliz"|"triste"|"neutro", ms?)
//                                                      -> muda a expressão do rosto (olhos, boca, sobrancelhas); ms = volta ao normal depois
//   AnonaMascot.aoPerguntar(fn)                        -> mostra o campo de pergunta no balão; fn(texto) roda no envio
//   AnonaMascot.conversar(opc)                         -> abre o balão em modo conversa (campo + sugestões); opc = { texto, sugestoes }
//   AnonaMascot.dizer(texto, { parcial, nota })        -> escreve no balão enquanto a resposta chega (parcial = não some sozinho)
//   AnonaMascot.acoes([{ rotulo, aria, fn }])          -> botões sob a resposta;  AnonaMascot.sugestoes([texto | { rotulo, fn }])
//   AnonaMascot.ouvir(texto) / pararVoz() / vozAuto(bool) -> voz do mascote (síntese de voz do navegador, no aparelho)
//   AnonaMascot.ditar(campo, botao)                    -> ditado por voz no campo (reconhecimento do navegador; pede aceite antes)
//   AnonaMascot.aoSoltar(fn)                           -> arrastar PDF/foto sobre o mascote: fn(arquivos)
//   AnonaMascot.fecharBalao() / balaoAberto() / bomDia()
//   Puras (testáveis em Node): sugestoesDoCartao(titulo), saudacaoDoDia(hojeISO, hora), textoParaFala(texto)
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


  // Perguntas sugeridas conforme o cartão que está na tela (só o TÍTULO do cartão é usado; nunca o conteúdo).
  // k = pedaços do título (sem acento, minúsculos); o primeiro que combina vale, então os específicos vêm antes dos genéricos.
  var CONTEXTOS = [
    { k: ["calculadora de faltas"], q: ["Como a frequência escolar é calculada?", "Quantas faltas ainda posso ter no mês?", "Calcular: 3 faltas em março, 22 dias letivos"] },
    { k: ["cronograma de repercussao"], q: ["O que é a repercussão?", "Qual a data limite do recurso do mês?"] },
    { k: ["recurso on line", "recurso on-line"], q: ["Como funciona o recurso on-line?", "Quais documentos podem ser anexados ao recurso?"] },
    { k: ["legenda de motivos"], q: ["O que significam os motivos de baixa frequência?", "Quando o efeito não se aplica?"] },
    { k: ["condicionalidades"], q: ["Quais são as condicionalidades de educação e saúde?", "O que acontece quando a família descumpre?"] },
    { k: ["cadastro unico"], q: ["Quando o Cadastro Único precisa ser atualizado?", "O que levar ao CRAS para o cadastro?"] },
    { k: ["como sacar"], q: ["Onde a família pode sacar o benefício?", "Por quanto tempo a parcela fica disponível?"] },
    { k: ["devolucao voluntaria"], q: ["Como devolver um valor recebido a mais?", "Depois de devolver, o que a família precisa fazer?"] },
    { k: ["como participar"], q: ["Quem tem direito ao Bolsa Família?", "Como funciona a regra de proteção?"] },
    { k: ["consulta ao sicon", "sicon"], q: ["Para que serve o Sicon?", "Como registrar a interrupção temporária dos efeitos?"] },
    { k: ["territorio volante", "planilhas do"], q: ["Para que serve a divisão por técnico?", "Como comparar famílias recorrentes entre dois meses?", "Como organizar a rota de visita?"] },
    { k: ["destaques do mes"], q: ["O que está valendo este mês?", "Quais são os próximos prazos?"] },
    { k: ["seu nis"], q: ["Como o calendário usa o final do NIS?", "Quando cai o pagamento deste mês?"] },
    { k: ["exportar"], q: ["Como exportar as anotações em PDF?"] },
    { k: ["legenda"], q: ["O que significam as cores do calendário?"] }
  ];

  function sugestoesDoCartao(titulo) {
    var t = normalizar(titulo);
    if (!t) return null;
    for (var i = 0; i < CONTEXTOS.length; i++) {
      for (var j = 0; j < CONTEXTOS[i].k.length; j++) {
        if (t.indexOf(normalizar(CONTEXTOS[i].k[j])) !== -1) return { titulo: String(titulo).replace(/\s+/g, " ").trim(), perguntas: CONTEXTOS[i].q.slice() };
      }
    }
    return { titulo: String(titulo).replace(/\s+/g, " ").trim(), perguntas: [] };
  }

  // Boas-vindas do dia: cumprimento pela hora + o que está valendo hoje (só dos MOMENTOS, nada de dado de família).
  function saudacaoDoDia(hoje, hora) {
    var h = typeof hora === "number" ? hora : new Date().getHours();
    var cump = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    var ms = momentosAtivos(hoje);
    var txt = cump + "! Eu sou o Anona.";
    if (ms.length) txt += " Hoje vale lembrar: " + ms[0].txt;
    txt += ms.length > 1 ? " (Tenho mais " + (ms.length - 1) + " aviso" + (ms.length - 1 > 1 ? "s" : "") + " do período.)" : "";
    return { texto: txt, avisos: ms.length };
  }

  // Prepara o texto para a voz: tira marcação e símbolos, diz "reais" e "por cento", limita o tamanho.
  function textoParaFala(t) {
    var s = String(t == null ? "" : t);
    s = s.replace(/https?:\/\/\S+/g, " ")
      .replace(/R\$\s*([\d.]+(?:,\d+)?)/g, function (m, n) { return n.replace(/\./g, "") + " reais"; })
      .replace(/(\d)\s*%/g, "$1 por cento")
      .replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, function (m, d, mes, a) {
        var nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        return (nomes[+mes - 1] ? d + " de " + nomes[+mes - 1] + " de " + a : m);
      })
      .replace(/[*_#`>~|]+/g, " ")
      .replace(/^[\s]*[•\-–—]\s+/gm, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/\.\s*\./g, ".")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length > 1500) {
      var corte = s.slice(0, 1500), p = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
      s = (p > 600 ? corte.slice(0, p + 1) : corte).trim();
    }
    return s;
  }

  // Divide em pedaços curtos: o Chrome corta falas longas (~15 s) se forem uma só.
  function pedacosDeFala(t) {
    var frases = String(t).match(/[^.!?]+[.!?]*\s*/g) || [String(t)];
    var out = [], atual = "";
    frases.forEach(function (f) {
      if ((atual + f).length > 180 && atual) { out.push(atual.trim()); atual = ""; }
      atual += f;
    });
    if (atual.trim()) out.push(atual.trim());
    return out;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { responder: responder, dicaDoMomento: dicaDoMomento, momentosAtivos: momentosAtivos, proxima: proxima,
      BASE: BASE, TOPICOS: TOPICOS, MOMENTOS: MOMENTOS, DICAS_APP: DICAS_APP, normalizar: normalizar,
      CONTEXTOS: CONTEXTOS, sugestoesDoCartao: sugestoesDoCartao, saudacaoDoDia: saudacaoDoDia, textoParaFala: textoParaFala, pedacosDeFala: pedacosDeFala };
  }
  if (typeof document === "undefined") return; // Node (testes): só a lógica acima

  var LS_KEY = "anonaMascotVisto", LS_VOZ = "anonaMascotVoz", LS_MIC = "anonaMascotMicOk", LS_DIA = "anonaMascotBomDia";
  var gancho = null, tratadorPergunta = null, tratadorSoltar = null;
  var raiz, balao, cartao, textoBalao, notaEl, acoesEl, chipsEl, formEl, campoEl, micBtn, vozBtn, fecharBtn, escondeTimer;
  var estadoAtual = "neutro", estadoTimer = null, piscaTimer = null;
  var vozLigada = false, falandoVoz = false, reconhecedor = null;

  function ls(chave, valor) {
    try {
      if (valor === undefined) return localStorage.getItem(chave);
      if (valor === null) localStorage.removeItem(chave); else localStorage.setItem(chave, valor);
    } catch (e) {}
    return null;
  }
  var semMovimento = function () { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

  function css() {
    return (
      "#anonaMascotWrap{position:fixed;left:14px;bottom:14px;z-index:60;" +
      "display:flex;flex-direction:column;align-items:flex-start;gap:.5rem;" +
      "font-family:inherit;}" +
      "#anonaMascotWrap.anona-escondido{display:none;}" +
      "#anonaMascotBotao{width:58px;height:58px;border:none;padding:0;cursor:pointer;position:relative;" +
      "background:transparent;border-radius:16px;line-height:0;" +
      "filter:drop-shadow(0 6px 14px rgba(7,26,61,.35));transition:transform .15s ease;}" +
      "#anonaMascotBotao:hover{transform:translateY(-2px);}" +
      "#anonaMascotBotao:focus-visible{outline:2px solid var(--amarelo,#D89B32);outline-offset:3px;}" +
      "#anonaMascotBotao svg{display:block;width:58px;height:58px;overflow:visible;}" +
      ".anona-braco{transform-origin:96px 46px;}" +
      "#anonaMascotWrap.anona-acenando .anona-braco{animation:anonaAceno .6s ease-in-out 2;}" +
      "@keyframes anonaAceno{0%,100%{transform:rotate(0deg);}50%{transform:rotate(-18deg);}}" +
      /* rosto: olhos, pupilas, bocas, sobrancelhas, pensamento e anel de escuta; cada estado liga um conjunto */
      ".anona-olho{transform-box:fill-box;transform-origin:center;transition:transform .08s ease;}" +
      ".anona-pupila{transition:transform .2s ease;}" +
      "#anonaMascotWrap.anona-piscando .anona-olho{transform:scaleY(.12);}" +
      ".anona-boca{display:none;}.anona-boca.m-sorriso{display:inline;}" +
      ".anona-sobr,.anona-pensa,.anona-anel{opacity:0;transition:opacity .15s ease;}" +
      ".anona-pensa circle{opacity:.25;}" +
      "#anonaMascotWrap.anona-st-pensando .m-sorriso,#anonaMascotWrap.anona-st-falando .m-sorriso,#anonaMascotWrap.anona-st-feliz .m-sorriso," +
      "#anonaMascotWrap.anona-st-alerta .m-sorriso,#anonaMascotWrap.anona-st-triste .m-sorriso,#anonaMascotWrap.anona-st-ouvindo .m-sorriso{display:none;}" +
      "#anonaMascotWrap.anona-st-pensando .m-reta,#anonaMascotWrap.anona-st-alerta .m-reta{display:inline;}" +
      "#anonaMascotWrap.anona-st-falando .m-fala,#anonaMascotWrap.anona-st-ouvindo .m-fala{display:inline;}" +
      "#anonaMascotWrap.anona-st-feliz .m-feliz{display:inline;}" +
      "#anonaMascotWrap.anona-st-triste .m-triste{display:inline;}" +
      "#anonaMascotWrap.anona-st-pensando .anona-pupila{transform:translate(-3px,-4px);}" +
      "#anonaMascotWrap.anona-st-pensando .anona-pensa{opacity:1;}" +
      "#anonaMascotWrap.anona-st-alerta .anona-sobr,#anonaMascotWrap.anona-st-triste .anona-sobr{opacity:1;}" +
      "#anonaMascotWrap.anona-st-alerta .anona-olho{transform:scale(1.12);}" +
      "#anonaMascotWrap.anona-st-ouvindo .anona-olho{transform:scale(1.12);}" +
      "#anonaMascotWrap.anona-st-ouvindo .anona-anel{opacity:1;}" +
      "#anonaMascotWrap.anona-st-triste .anona-pupila{transform:translate(0,3px);}" +
      "@media (prefers-reduced-motion: no-preference){" +
      "#anonaMascotWrap.anona-st-falando .m-fala ellipse{animation:anonaFala .32s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center;}" +
      "#anonaMascotWrap.anona-st-ouvindo .m-fala ellipse{transform-box:fill-box;transform-origin:center;transform:scale(.55);}" +
      "#anonaMascotWrap.anona-st-pensando .anona-pensa circle{animation:anonaPensa 1.1s ease-in-out infinite;}" +
      "#anonaMascotWrap.anona-st-pensando .anona-pensa circle:nth-child(2){animation-delay:.18s;}" +
      "#anonaMascotWrap.anona-st-pensando .anona-pensa circle:nth-child(3){animation-delay:.36s;}" +
      "#anonaMascotWrap.anona-st-ouvindo .anona-anel{animation:anonaAnel 1.2s ease-in-out infinite;}" +
      "#anonaMascotWrap.anona-st-feliz #anonaMascotBotao{animation:anonaPulo .45s ease-out 2;}" +
      "#anonaMascotWrap.anona-st-alerta #anonaMascotBotao{animation:anonaTrem .4s ease-in-out 2;}}" +
      "@keyframes anonaFala{from{transform:scaleY(.3);}to{transform:scaleY(1);}}" +
      "@keyframes anonaPensa{0%,100%{opacity:.25;}50%{opacity:1;}}" +
      "@keyframes anonaAnel{0%,100%{opacity:.35;}50%{opacity:1;}}" +
      "@keyframes anonaPulo{0%,100%{transform:translateY(0);}50%{transform:translateY(-8px);}}" +
      "@keyframes anonaTrem{0%,100%{transform:translateX(0);}25%{transform:translateX(-3px);}75%{transform:translateX(3px);}}" +
      "#anonaMascotWrap.anona-solta #anonaMascotBotao{outline:3px dashed var(--amarelo,#D89B32);outline-offset:4px;transform:scale(1.12);}" +
      /* balão */
      "#anonaMascotBalao{position:relative;width:max-content;max-width:min(320px,calc(100vw - 28px));max-height:min(62vh,420px);overflow-y:auto;" +
      "background:var(--card,#FFFDF8);color:var(--ink,#1D2333);" +
      "border:1px solid var(--line,rgba(13,46,99,.16));border-radius:1rem;padding:.65rem .85rem;" +
      "font-size:.82rem;line-height:1.38;box-shadow:0 10px 24px -14px rgba(13,46,99,.4);" +
      "opacity:0;transform:translateY(6px);transition:opacity .15s ease,transform .15s ease;" +
      "pointer-events:none;visibility:hidden;}" +
      "#anonaMascotBalao.anona-visivel{opacity:1;transform:translateY(0);pointer-events:auto;visibility:visible;}" +
      "#anonaMascotBalao .anona-fechar{position:absolute;top:.2rem;right:.25rem;width:26px;height:26px;border:0;border-radius:.5rem;" +
      "background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:.85rem;line-height:1;}" +
      "#anonaMascotBalao .anona-fechar:hover{opacity:1;background:var(--azul-soft,#E3E9F5);}" +
      "#anonaMascotTexto{display:block;white-space:pre-wrap;word-wrap:break-word;padding-right:1.1rem;}" +
      "#anonaMascotNota{display:block;font-size:.7rem;opacity:.72;margin-top:.35rem;white-space:pre-wrap;}" +
      "#anonaMascotNota:empty{display:none;}" +
      "#anonaMascotAcoes,#anonaMascotChips{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.5rem;}" +
      "#anonaMascotAcoes:empty,#anonaMascotChips:empty{display:none;}" +
      "#anonaMascotAcoes button,#anonaMascotChips button{border:1px solid var(--line,rgba(13,46,99,.25));background:#fff;color:inherit;border-radius:999px;" +
      "padding:.2rem .6rem;font:inherit;font-size:.74rem;cursor:pointer;min-height:30px;text-align:left;}" +
      "#anonaMascotAcoes button:hover,#anonaMascotChips button:hover{background:var(--azul-soft,#E3E9F5);}" +
      "#anonaMascotAcoes button:disabled{opacity:.55;cursor:default;}" +
      "#anonaMascotForm{display:flex;gap:.3rem;margin-top:.55rem;align-items:center;}" +
      "#anonaMascotForm[hidden]{display:none;}" +
      "#anonaMascotCampo{flex:1;min-width:0;border:1px solid var(--line,rgba(13,46,99,.25));border-radius:.7rem;padding:.4rem .6rem;" +
      "font:inherit;font-size:16px;min-height:38px;background:#fff;color:inherit;}" +
      "#anonaMascotForm button{border:0;border-radius:.7rem;min-width:36px;min-height:38px;cursor:pointer;background:var(--azul-soft,#E3E9F5);color:inherit;font-size:.95rem;}" +
      "#anonaMascotForm button.anona-ativo{background:var(--amarelo,#FFCC29);}" +
      "#anonaMascotForm button.anona-env{background:var(--verde,#159947);color:#fff;font-weight:700;}" +
      "@media (prefers-reduced-motion: reduce){" +
      "#anonaMascotWrap.anona-acenando .anona-braco{animation:none;}" +
      "#anonaMascotBotao,#anonaMascotBalao,.anona-olho,.anona-pupila{transition:none;}}"
    );
  }

  // Rosto. Olhos = branco + pupila (piscam e olham); bocas: sorriso, reta, fala, feliz, triste; sobrancelhas só em alerta/triste.
  var SVG_CARTAO =
    '<svg viewBox="0 0 120 130" aria-hidden="true">' +
    '<path class="anona-braco" d="M96,46 Q118,32 112,14" stroke="#0D2E63" stroke-width="14" fill="none" stroke-linecap="round"/>' +
    '<circle cx="112" cy="14" r="9" fill="#0D2E63"/>' +
    '<rect x="8" y="8" width="96" height="106" rx="20" fill="#123A78"/>' +
    '<rect class="anona-anel" x="4" y="4" width="104" height="114" rx="23" fill="none" stroke="#FFCC29" stroke-width="3"/>' +
    '<rect x="20" y="22" width="26" height="18" rx="4" fill="#D89B32"/>' +
    '<g class="anona-pensa" fill="#FFFDF8"><circle cx="62" cy="31" r="3.4"/><circle cx="73" cy="31" r="3.4"/><circle cx="84" cy="31" r="3.4"/></g>' +
    '<g class="anona-olho"><circle cx="38" cy="62" r="9" fill="#FFFDF8"/><g class="anona-pupila"><circle cx="40" cy="64" r="4.2" fill="#071A3D"/></g></g>' +
    '<g class="anona-olho"><circle cx="74" cy="62" r="9" fill="#FFFDF8"/><g class="anona-pupila"><circle cx="72" cy="64" r="4.2" fill="#071A3D"/></g></g>' +
    '<g class="anona-sobr" stroke="#FFFDF8" stroke-width="3" stroke-linecap="round" fill="none"><path d="M28,50 L46,44"/><path d="M84,50 L66,44"/></g>' +
    '<path class="anona-boca m-sorriso" d="M35,80 Q56,94 79,80" stroke="#FFFDF8" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path class="anona-boca m-reta" d="M44,84 L68,84" stroke="#FFFDF8" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<g class="anona-boca m-fala"><ellipse cx="56" cy="85" rx="10" ry="7" fill="#071A3D" stroke="#FFFDF8" stroke-width="2.5"/></g>' +
    '<path class="anona-boca m-feliz" d="M31,78 Q56,104 81,78 Z" fill="#FFFDF8" stroke="#FFFDF8" stroke-width="2" stroke-linejoin="round"/>' +
    '<path class="anona-boca m-triste" d="M40,90 Q56,78 74,90" stroke="#FFFDF8" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<rect x="8" y="98" width="32" height="7" fill="#159947"/>' +
    '<rect x="40" y="98" width="32" height="7" fill="#FFCC29"/>' +
    '<rect x="72" y="98" width="32" height="7" fill="#0B2F7A"/>' +
    "</svg>";

  var ESTADOS = ["neutro", "pensando", "falando", "ouvindo", "alerta", "feliz", "triste"];

  // ---------------------------------------------------------------- expressão do rosto
  function estado(nome, ms) {
    if (ESTADOS.indexOf(nome) === -1) nome = "neutro";
    if (!raiz) montar();
    clearTimeout(estadoTimer);
    ESTADOS.forEach(function (e) { raiz.classList.remove("anona-st-" + e); });
    if (nome !== "neutro") raiz.classList.add("anona-st-" + nome);
    estadoAtual = nome;
    if (typeof ms === "number" && ms > 0 && nome !== "neutro") {
      estadoTimer = setTimeout(function () { if (estadoAtual === nome) estado("neutro"); }, ms);
    }
    return nome;
  }

  // Piscadinha de tempos em tempos (só com movimento permitido e rosto parado).
  function agendarPisca() {
    clearTimeout(piscaTimer);
    if (semMovimento()) return;
    piscaTimer = setTimeout(function () {
      if (raiz && estadoAtual === "neutro" && !document.hidden) {
        raiz.classList.add("anona-piscando");
        setTimeout(function () { if (raiz) raiz.classList.remove("anona-piscando"); }, 140);
      }
      agendarPisca();
    }, 2600 + Math.random() * 3400);
  }

  function montar() {
    if (raiz) return;

    var style = document.createElement("style");
    style.textContent = css();
    document.head.appendChild(style);

    raiz = document.createElement("div");
    raiz.id = "anonaMascotWrap";

    balao = document.createElement("div");
    balao.id = "anonaMascotBalao";
    balao.setAttribute("role", "region");
    balao.setAttribute("aria-label", "Conversa com o Anona");
    fecharBtn = document.createElement("button");
    fecharBtn.type = "button";
    fecharBtn.className = "anona-fechar";
    fecharBtn.setAttribute("aria-label", "Fechar o balão");
    fecharBtn.textContent = "✕";
    fecharBtn.addEventListener("click", function (ev) { ev.stopPropagation(); fecharBalao(); });
    textoBalao = document.createElement("span");
    textoBalao.id = "anonaMascotTexto";
    textoBalao.setAttribute("aria-live", "polite");
    notaEl = document.createElement("span");
    notaEl.id = "anonaMascotNota";
    acoesEl = document.createElement("div");
    acoesEl.id = "anonaMascotAcoes";
    chipsEl = document.createElement("div");
    chipsEl.id = "anonaMascotChips";

    formEl = document.createElement("form");
    formEl.id = "anonaMascotForm";
    formEl.hidden = true;
    campoEl = document.createElement("input");
    campoEl.id = "anonaMascotCampo";
    campoEl.type = "text";
    campoEl.maxLength = 1200;
    campoEl.autocomplete = "off";
    campoEl.placeholder = "Pergunte ao Anona…";
    campoEl.setAttribute("aria-label", "Pergunte ao Anona");
    micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.textContent = "🎤";
    micBtn.title = "Falar a pergunta";
    micBtn.setAttribute("aria-label", "Falar a pergunta (ditado por voz)");
    micBtn.addEventListener("click", function () { ditar(campoEl, micBtn); });
    vozBtn = document.createElement("button");
    vozBtn.type = "button";
    vozBtn.title = "Ler as respostas em voz alta";
    vozBtn.addEventListener("click", function () { vozAuto(!vozLigada); });
    var env = document.createElement("button");
    env.type = "submit";
    env.className = "anona-env";
    env.textContent = "➤";
    env.setAttribute("aria-label", "Enviar pergunta");
    formEl.appendChild(campoEl);
    formEl.appendChild(micBtn);
    formEl.appendChild(vozBtn);
    formEl.appendChild(env);
    formEl.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = campoEl.value.trim();
      if (!t || !tratadorPergunta) return;
      campoEl.value = "";
      try { tratadorPergunta(t); } catch (e) {}
    });

    balao.appendChild(fecharBtn);
    balao.appendChild(textoBalao);
    balao.appendChild(notaEl);
    balao.appendChild(acoesEl);
    balao.appendChild(chipsEl);
    balao.appendChild(formEl);
    balao.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { fecharBalao(); try { cartao.focus(); } catch (e) {} } });

    cartao = document.createElement("button");
    cartao.type = "button";
    cartao.id = "anonaMascotBotao";
    cartao.setAttribute("aria-label", "Anona, o mascote do app — toque para conversar ou ver uma dica");
    cartao.innerHTML = SVG_CARTAO;
    cartao.addEventListener("click", function () {
      if (gancho) {
        var tratou = false;
        try { tratou = gancho() === true; } catch (e) {}
        if (tratou) return;
      }
      dica();
    });

    // Arrastar PDF/foto para cima do mascote (só quando o Paulus registrou quem recebe).
    ["dragenter", "dragover"].forEach(function (nome) {
      raiz.addEventListener(nome, function (ev) {
        if (!tratadorSoltar || !ev.dataTransfer || Array.prototype.indexOf.call(ev.dataTransfer.types || [], "Files") === -1) return;
        ev.preventDefault();
        raiz.classList.add("anona-solta");
      });
    });
    raiz.addEventListener("dragleave", function (ev) { if (!raiz.contains(ev.relatedTarget)) raiz.classList.remove("anona-solta"); });
    raiz.addEventListener("drop", function (ev) {
      raiz.classList.remove("anona-solta");
      if (!tratadorSoltar || !ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
      ev.preventDefault();
      try { tratadorSoltar(Array.prototype.slice.call(ev.dataTransfer.files)); } catch (e) {}
    });

    raiz.appendChild(balao);
    raiz.appendChild(cartao);
    document.body.appendChild(raiz);
    vozLigada = ls(LS_VOZ) === "1" && vozSuportada();
    atualizarBotoes();
    agendarPisca();
  }

  function acenar() {
    if (!raiz) montar();
    raiz.classList.remove("anona-acenando");
    // força reflow para poder reiniciar a animação mesmo se já tiver rodado
    void raiz.offsetWidth;
    raiz.classList.add("anona-acenando");
  }

  // ---------------------------------------------------------------- balão
  function limparBalao() {
    chipsEl.textContent = "";
    acoesEl.textContent = "";
    notaEl.textContent = "";
  }

  function armar(ms) {
    clearTimeout(escondeTimer);
    if (!(ms > 0)) return;
    escondeTimer = setTimeout(function tic() {
      // não some enquanto a pessoa digita/fala nele
      if (balao.contains(document.activeElement) && document.activeElement !== fecharBtn) { escondeTimer = setTimeout(tic, 8000); return; }
      balao.classList.remove("anona-visivel");
    }, ms);
  }

  function criarBotao(destino, rotulo, fn, aria) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = rotulo;
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", function (ev) { ev.stopPropagation(); try { fn(b); } catch (e) {} });
    destino.appendChild(b);
    return b;
  }

  function acoes(lista) {
    if (!raiz) montar();
    acoesEl.textContent = "";
    (lista || []).forEach(function (a) { if (a && a.rotulo) criarBotao(acoesEl, a.rotulo, a.fn || function () {}, a.aria); });
  }

  function sugestoes(lista) {
    if (!raiz) montar();
    chipsEl.textContent = "";
    (lista || []).slice(0, 5).forEach(function (s) {
      if (typeof s === "string") {
        criarBotao(chipsEl, s, function () { if (tratadorPergunta) tratadorPergunta(s); else dica(); });
      } else if (s && s.rotulo) criarBotao(chipsEl, s.rotulo, s.fn || function () {});
    });
  }

  function chipsDeTopicos() {
    chipsEl.textContent = "";
    TOPICOS.forEach(function (tp) { criarBotao(chipsEl, tp[1], function () { dica(tp[0]); }); });
  }

  function mostrarForm() { formEl.hidden = !tratadorPergunta; }

  // Escreve no balão sem mexer nos botões (resposta chegando aos poucos). parcial = não some sozinho.
  function dizer(msg, opcoes) {
    if (!raiz) montar();
    opcoes = opcoes || {};
    textoBalao.textContent = String(msg == null ? "" : msg);
    textoBalao.setAttribute("aria-busy", opcoes.parcial ? "true" : "false");
    if (opcoes.nota != null) notaEl.textContent = opcoes.nota;
    if (opcoes.limpar) limparBalao();
    mostrarForm();
    balao.classList.add("anona-visivel");
    if (opcoes.parcial) { clearTimeout(escondeTimer); balao.scrollTop = balao.scrollHeight; }
    else armar(typeof opcoes.duracao === "number" ? opcoes.duracao : 60000);
  }

  function falar(mensagem, opcoes) {
    if (!raiz) montar();
    opcoes = opcoes || {};
    var msg = String(mensagem == null ? "" : mensagem);
    // balões longos ficam mais tempo na tela
    var duracao = typeof opcoes.duracao === "number" ? opcoes.duracao : Math.min(22000, Math.max(6000, 3500 + msg.length * 55));
    textoBalao.textContent = msg;
    textoBalao.setAttribute("aria-busy", "false");
    limparBalao();
    if (opcoes.nota) notaEl.textContent = opcoes.nota;
    if (opcoes.acoes) acoes(opcoes.acoes);
    if (opcoes.sugestoes) sugestoes(opcoes.sugestoes);
    else if (opcoes.chips) chipsDeTopicos();
    mostrarForm();
    balao.scrollTop = 0;
    balao.classList.add("anona-visivel");
    acenar();
    // abre falando um instante (a menos que o rosto esteja ocupado pensando/ouvindo)
    if (estadoAtual === "neutro" && !semMovimento()) estado("falando", Math.min(3500, 500 + msg.length * 28));
    armar(duracao);
  }

  function fecharBalao() {
    if (balao) balao.classList.remove("anona-visivel");
    clearTimeout(escondeTimer);
    pararVoz();
  }

  function balaoAberto() { return !!(balao && balao.classList.contains("anona-visivel")); }

  function conversaAberta() { return balaoAberto() && !!formEl && !formEl.hidden; }

  function focarCampo() { try { if (campoEl && !formEl.hidden) campoEl.focus(); } catch (e) {} }

  // Abre o balão em modo conversa: texto de abertura, perguntas sugeridas e o campo para escrever.
  function conversar(opc) {
    opc = opc || {};
    falar(opc.texto || "Oi! Em que posso ajudar?", { sugestoes: opc.sugestoes, chips: !opc.sugestoes, duracao: 60000, nota: opc.nota });
    setTimeout(focarCampo, 40);
  }

  // ---------------------------------------------------------------- voz do mascote (síntese: no aparelho)
  function vozSuportada() {
    return typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  }

  function atualizarBotoes() {
    if (!vozBtn) return;
    var ok = vozSuportada();
    vozBtn.hidden = !ok;
    vozBtn.textContent = vozLigada ? "🔊" : "🔈";
    vozBtn.classList.toggle("anona-ativo", vozLigada);
    vozBtn.setAttribute("aria-pressed", vozLigada ? "true" : "false");
    vozBtn.setAttribute("aria-label", vozLigada ? "Desligar a leitura das respostas em voz alta" : "Ligar a leitura das respostas em voz alta");
    var temSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    micBtn.hidden = !temSR;
  }

  function vozAuto(ligar) {
    vozLigada = !!ligar && vozSuportada();
    ls(LS_VOZ, vozLigada ? "1" : "0");
    if (!vozLigada) pararVoz();
    atualizarBotoes();
    if (typeof window.dispatchEvent === "function") { try { window.dispatchEvent(new CustomEvent("anona:voz", { detail: { ligada: vozLigada } })); } catch (e) {} }
    return vozLigada;
  }

  function pararVoz() {
    if (!falandoVoz) return;
    falandoVoz = false;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    if (estadoAtual === "falando") estado("neutro");
  }

  function ouvir(texto) {
    if (!vozSuportada()) return false;
    var t = textoParaFala(texto);
    if (!t) return false;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var vozes = [];
    try { vozes = window.speechSynthesis.getVoices() || []; } catch (e) {}
    var v = vozes.filter(function (x) { return /^pt[-_]BR/i.test(x.lang); })[0] || vozes.filter(function (x) { return /^pt/i.test(x.lang); })[0];
    var partes = pedacosDeFala(t);
    falandoVoz = true;
    estado("falando");
    partes.forEach(function (p, i) {
      var u = new window.SpeechSynthesisUtterance(p);
      u.lang = "pt-BR";
      if (v) u.voice = v;
      var fim = function () { if (i === partes.length - 1 && falandoVoz) { falandoVoz = false; if (estadoAtual === "falando") estado("neutro"); } };
      u.onend = fim;
      u.onerror = fim;
      window.speechSynthesis.speak(u);
    });
    return true;
  }

  // ---------------------------------------------------------------- ditado (reconhecimento de voz do navegador)
  function ditar(campo, botao) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { falar("Este navegador não tem ditado por voz. Pode digitar a pergunta."); return; }
    if (reconhecedor) { try { reconhecedor.stop(); } catch (e) {} return; }
    if (ls(LS_MIC) !== "1") {
      falar("Para ditar, o navegador usa o reconhecimento de voz dele, e em alguns (como o Chrome) o áudio passa pelo servidor do fabricante. Por isso, não fale nome, NIS, CPF nem endereço de ninguém.", {
        duracao: 0,
        acoes: [{ rotulo: "Entendi, usar o microfone", fn: function () { ls(LS_MIC, "1"); fecharBalao(); ditar(campo, botao); } }, { rotulo: "Agora não", fn: fecharBalao }]
      });
      return;
    }
    var r = new SR();
    reconhecedor = r;
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    estado("ouvindo");
    if (botao) botao.classList.add("anona-ativo");
    var base = campo ? campo.value : "";
    r.onresult = function (ev) {
      var t = "";
      for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      if (campo) campo.value = (base ? base + " " : "") + t.trim();
    };
    r.onerror = function (ev) {
      var e = ev && ev.error;
      if (e === "not-allowed" || e === "service-not-allowed") { ls(LS_MIC, null); falar("Não consegui usar o microfone: a permissão foi negada. Libere o microfone nas configurações do navegador ou digite a pergunta."); }
      else if (e === "no-speech") falar("Não ouvi nada. Toque no 🎤 e fale de novo, ou digite.");
    };
    r.onend = function () {
      reconhecedor = null;
      if (botao) botao.classList.remove("anona-ativo");
      if (estadoAtual === "ouvindo") estado("neutro");
      try { if (campo) campo.focus(); } catch (e) {}
    };
    try { r.start(); } catch (e) { reconhecedor = null; if (botao) botao.classList.remove("anona-ativo"); estado("neutro"); }
  }

  // ---------------------------------------------------------------- dicas e boas-vindas
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

  // Uma vez por dia (por aparelho): cumprimento + o que está valendo hoje.
  function bomDia() {
    var hoje = hojeISO();
    if (ls(LS_DIA) === hoje) return false;
    ls(LS_DIA, hoje);
    var s = saudacaoDoDia(hoje);
    falar(s.texto + " Toque em mim se quiser conversar.", { duracao: 14000, chips: false });
    return true;
  }

  function esconder() {
    if (raiz) raiz.classList.add("anona-escondido");
  }

  function mostrar() {
    if (!raiz) montar();
    raiz.classList.remove("anona-escondido");
  }

  function aoClicar(fn) { gancho = typeof fn === "function" ? fn : null; }
  function aoPerguntar(fn) {
    tratadorPergunta = typeof fn === "function" ? fn : null;
    if (raiz) mostrarForm();
  }
  function aoSoltar(fn) { tratadorSoltar = typeof fn === "function" ? fn : null; }

  window.AnonaMascot = { falar: falar, acenar: acenar, esconder: esconder, mostrar: mostrar, aoClicar: aoClicar,
    dica: dica, responder: responder, dicaDoMomento: dicaDoMomento,
    estado: estado, estadoAtual: function () { return estadoAtual; }, aoPerguntar: aoPerguntar, aoSoltar: aoSoltar, conversar: conversar,
    dizer: dizer, acoes: acoes, sugestoes: sugestoes, ouvir: ouvir, pararVoz: pararVoz, vozAuto: vozAuto,
    vozLigada: function () { return vozLigada; }, vozSuportada: vozSuportada, ditar: ditar,
    fecharBalao: fecharBalao, balaoAberto: balaoAberto, conversaAberta: conversaAberta, focarCampo: focarCampo, bomDia: bomDia,
    sugestoesDoCartao: sugestoesDoCartao, textoParaFala: textoParaFala };

  function iniciar() {
    montar();
    var visto = false;
    try { visto = !!localStorage.getItem(LS_KEY); } catch (e) {}
    if (!visto) {
      setTimeout(function () {
        falar("Oi, eu sou o Anona! Toque em mim para conversar ou ver uma dica sobre o Bolsa Família, ou escolha um assunto.", { chips: true, duracao: 12000 });
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
