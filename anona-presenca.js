// anona-presenca.js — assistente de presença do Anona: liga o mascote, o Paulus (IA) e a Calculadora de Faltas.
//
// O QUE FAZ
//  1. Entende frases em português ("3 faltas em março, 22 dias letivos", "quantas faltas ainda posso ter?",
//     "e se faltar mais 2 dias?", "tenho 16 anos", "limpar") e preenche a calculadora sozinho.
//  2. Responde com os números (% de frequência, máximo de faltas, margem, simulação) — tudo calculado AQUI,
//     com a mesma regra da calculadora. A conta nunca é feita pela IA (modelo de linguagem erra aritmética).
//  3. Faz o mascote comentar o resultado quando a pessoa mexe na calculadora.
//  4. Deixa a IA do Paulus EXPLICAR o resultado (o que significa para o benefício, próximos passos), mas só
//     quando a pessoa pede, e enviando apenas números — nunca nome do estudante, nunca notas, nunca NIS.
//
// REGRAS (não mude sem pensar):
//  - Este arquivo não lê o campo "Estudante" (cfNome), notas, planilhas nem Firestore.
//  - Nada que a pessoa digita aqui sai do aparelho. Só o texto montado por promptIA() (números) pode ir ao
//    Paulus, e só quando a pessoa toca em "Explicar com a IA".
//  - Respostas são inseridas com textContent (nunca innerHTML).
//
// Carregue com defer, ANTES de paulus-anona.js. Em Node (testes), exporta as funções puras.
(function (raiz) {
  "use strict";

  // ------------------------------------------------------------------ texto → intenção (função pura)
  var MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
                jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  var RE_MES = "(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)";
  var NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
                  treze: 13, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30 };

  function sem(t) {
    var s = String(t == null ? "" : t).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s;
  }

  // "vinte e dois" → 22, "tres" → 3. "um/uma" só vira número quando vem antes de falta/dia (senão é artigo).
  function numerosPorExtenso(t) {
    t = t.replace(/\b(vinte|trinta)\s+e\s+(um|dois|tres|quatro|cinco|seis|sete|oito|nove)\b/g, function (m, d, u) { return String(NUMEROS[d] + NUMEROS[u]); });
    t = t.replace(/\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)\b/g, function (m) { return String(NUMEROS[m]); });
    t = t.replace(/\b(um|uma)\s+(?=falta|dia|ausencia|vez)/g, "1 ");
    return t;
  }

  function mesNoTrecho(c) {
    var m = new RegExp("\\b" + RE_MES + "\\b").exec(c);
    return m ? MESES[m[1]] : null;
  }

  // Devolve o que a frase quer. Não mexe em nada; quem executa é tratar().
  //  { fatos:[{kind:'faltas'|'dias', n, mes|null}], faixa, periodo, intent, simula:{n, mes}, limpar, avisos:[] }
  function interpretar(texto) {
    var t = numerosPorExtenso(sem(texto)).replace(/\s+/g, " ").trim();
    var r = { fatos: [], faixa: null, periodo: null, margem: false, simula: null, limpar: false, desfazer: false, copiar: false, situacao: false, explicar: false, avisos: [], meses: [] };
    if (!t) return r;

    // limpar / outro estudante
    if (/\b(limpar|zerar|recomecar|novo estudante|outro estudante|outra crianca|outro aluno|nova conta)\b/.test(t)) r.limpar = true;
    if (/\b(desfazer|desfaz|desfaca|voltar|volta atras|errei|cancela isso)\b/.test(t)) r.desfazer = true;
    if (/\bcopi(ar|e|a)\b/.test(t) && /(resumo|resultado|calculo)/.test(t)) r.copiar = true;

    // simulação: "e se faltar mais 2 dias em abril?" — o número daqui NÃO é fato, é hipótese
    var sim = /\b(?:e\s+)?se\s+(?:(?:eu|ele|ela|o aluno|a aluna|a crianca|o estudante|a estudante|o filho|a filha)\s+)?(?:faltar|faltasse|falto|faltou|perder|tiver|ter)\s*(?:mais\s*)?(\d+)?\s*(?:dias?|faltas?|aulas?|vezes)?(?:\s*(?:a mais|mais))?/.exec(t);
    if (sim) {
      var tail = t.slice(sim.index + sim[0].length);
      r.simula = { n: sim[1] ? parseInt(sim[1], 10) : 1, mes: mesNoTrecho(sim[0] + " " + tail.split(/[,;.?]/)[0]) };
      t = (t.slice(0, sim.index) + " " + tail.replace(new RegExp("^\\s*(?:em|no mes de|no|de)?\\s*" + RE_MES + "\\b"), " ")).replace(/\s+/g, " ").trim();
    }

    // faixa etária / percentual mínimo
    var idade = /\b(\d{1,2})\s*(?:a|e|ate)?\s*(\d{1,2})?\s*anos?\b/.exec(t);
    if (idade) {
      var ida = parseInt(idade[1], 10);
      if (ida >= 4 && ida <= 5) r.faixa = "60";
      else if (ida >= 6 && ida <= 15) r.faixa = "75";
      else if (ida >= 16 && ida <= 17) r.faixa = "75j";
      else r.avisos.push("A calculadora cobre de 4 a 17 anos; " + ida + " anos fica fora da faixa.");
      t = t.replace(idade[0], " ");
    }
    var pct = /\b(\d{1,3})\s*%/.exec(t);
    if (pct) {
      if (pct[1] === "60" && !r.faixa) r.faixa = "60";
      else if (pct[1] === "75" && !r.faixa) r.faixa = "75";
      t = t.replace(pct[0], " ");
    }
    t = t.replace(/\b(19|20)\d{2}\b/g, " "); // ano (2026) não é quantidade

    // período: "abr/mai", "fev e mar", "periodo jun/jul"
    var per = new RegExp("\\b(fev|abr|jun|ago|out)[a-z]*\\s*(?:/|e|-|a)\\s*(mar|mai|jul|set|nov)[a-z]*\\b").exec(t);
    if (per) { r.periodo = { fev: 0, abr: 1, jun: 2, ago: 3, out: 4 }[per[1]]; t = t.replace(per[0], " "); }

    // intenções
    if (/(quantas?|quanto)\s+(?:mais\s+)?(?:faltas?|dias?)?\s*(?:ainda\s+|mais\s+)?(?:eu\s+|ele\s+|ela\s+)?(?:posso|pode|podem|podemos|restam|resta|sobram|sobra|da pra|tenho|tem)|\bmargem\b|limite de faltas|maximo de faltas|quanto (?:posso|pode|da pra) faltar|ainda posso faltar|ainda pode faltar/.test(t)) r.margem = true;
    var perguntaGeral = /(minim[oa]|exigid|obrigatori|necessari|regra|por que|porque|o que (e|eh|significa)|como funciona|norma|portaria|prazo|quando)/.test(t);
    if (!perguntaGeral && /(calcul\w*|qual (?:e |eh |foi |ficou |esta )?(?:a )?(?:minha |nossa |sua )?(?:frequencia|porcentagem|percentual|situacao)|como (?:esta|ficou|anda)|quanto (?:deu|ficou)|resultado|\bfrequencia (?:esta|ficou|deu|atual))/.test(t)) r.situacao = true;
    if (/\b(explic\w*|o que significa|e grave|o que acontece|consequencia\w*|o que (?:eu )?faco|proximos passos|e agora)\b/.test(t)) r.explicar = true;

    // fatos: quantidades com "dias letivos" ou "faltas", por trecho (separado por , ; . e "e")
    var trechos = t.split(/\s*(?:[,;.?!]|\be\b|\bmas\b|\bdepois\b)\s*/);
    var ultimoTipo = null, mesesDeclarados = {};
    var achados = [];
    for (var i = 0; i < trechos.length; i++) {
      var c = trechos[i], mes = mesNoTrecho(c), reNum = /\d+/g, m;
      if (mes) mesesDeclarados[mes] = true;
      // "faltou 5 de 22 dias" / "compareceu 18 de 22": duas quantidades de uma vez
      var par = /(\d+)\s+de\s+(\d+)(?:\s+dias?(?:\s+letivos?)?)?/.exec(c);
      if (par && parseInt(par[2], 10) >= parseInt(par[1], 10)) {
        var antesPar = c.slice(0, par.index), presente = /(compareceu|compareci|foi|fui|veio|vim|presen\w*|assistiu|assisti)\W*$/.test(antesPar);
        var a = parseInt(par[1], 10), bb = parseInt(par[2], 10);
        achados.push({ kind: "faltas", n: presente ? bb - a : a, mes: mes });
        achados.push({ kind: "dias", n: bb, mes: mes });
        ultimoTipo = "faltas";
        c = c.slice(0, par.index) + " " + c.slice(par.index + par[0].length);
      }
      while ((m = reNum.exec(c))) {
        var n = parseInt(m[0], 10), antes = c.slice(0, m.index), depois = c.slice(m.index + m[0].length), tipo = null;
        if (/^\s*(?:presencas?|dias?\s+presentes?|dias?\s+de\s+presenca|dias?\s+(?:que\s+)?(?:foi|veio|compareceu))/.test(depois) || /(?:compareceu|compareci|presencas?)\W*(?:de|:|foram)?\W*$/.test(antes)) tipo = "presencas";
        else if (/^\s*(?:dias?\s+)?letivos?\b|^\s*dias?\s+de\s+aula|^\s*aulas?\b/.test(depois)) tipo = "dias";
        else if (/^\s*(?:faltas?|ausencias?|dias?\s+de\s+falta|vez(?:es)?|dias?\s+(?:sem\s+ir|ausente))/.test(depois)) tipo = "faltas";
        else if (/letivos?\W*(?:foram|sao|de|total|totalizam)?\W*$/.test(antes)) tipo = "dias";
        else if (/(?:falt\w*|ausen\w*)\W*(?:foram|foi|de|total)?\W*$/.test(antes)) tipo = "faltas";
        else if (/^\s*dias?\b/.test(depois)) tipo = /letiv/.test(c) || /\b(mes|periodo|bimestre)\b.*\b(teve|tem|tinha|foram)\b/.test(c) ? "dias" : "faltas";
        else tipo = ultimoTipo;
        if (!tipo) continue;
        ultimoTipo = tipo;
        achados.push({ kind: tipo, n: n, mes: mes });
      }
    }
    var distintos = Object.keys(mesesDeclarados);
    achados.forEach(function (f) { if (f.mes == null && distintos.length === 1) f.mes = parseInt(distintos[0], 10); });
    r.fatos = achados;
    if (r.simula && r.simula.mes) mesesDeclarados[r.simula.mes] = true;
    r.meses = Object.keys(mesesDeclarados).map(Number);
    return r;
  }

  // ------------------------------------------------------------------ contas (mesma regra de cfAvaliar)
  function fmt(n) { return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function plural(n, s, p) { return n + " " + (n === 1 ? s : p); }
  function minPresencas(lim, dias) { return Math.ceil(lim * dias / 100); }
  function faltasMaximas(lim, dias) { return dias - minPresencas(lim, dias); }

  // ------------------------------------------------------------------ ponte com a calculadora
  var pilha = []; // estados anteriores da calculadora (para "desfazer")
  var ultimoMes = null; // último mês mexido (para "22 dias letivos" soltos)
  var faixaConfirmada = false, faixaAvisada = false; // a calculadora abre em "4 a 5 anos, 60%"; avisamos UMA vez se a pessoa não escolheu
  var silencioAte = 0;  // enquanto o assistente mexe na calculadora, o mascote não comenta por conta própria

  function calc() { return raiz.AnonaFrequencia || null; }

  function itemPronto(it) { return it.r && it.r.estado === "ok"; }

  function descreverItem(it, lim) {
    var r = it.r;
    if (!r || r.estado === "sem-dias") return it.rotulo + ": informe os dias letivos.";
    if (r.estado === "vazio") {
      var d = it.dias != null ? it.dias : null;
      return it.rotulo + ": faltas ainda não informadas.";
    }
    if (r.estado === "erro") return it.rotulo + ": as faltas (" + r.faltas + ") passam dos dias letivos (" + r.dias + "). Confira os números.";
    var margem = r.cumpriu
      ? (r.faltasMax - r.faltas === 0 ? "sem margem: mais 1 falta já é baixa frequência" : "ainda pode faltar " + plural(r.faltasMax - r.faltas, "dia", "dias"))
      : plural(r.faltas - r.faltasMax, "falta", "faltas") + " além do limite";
    return it.rotulo + ": " + r.presencas + " presenças em " + r.dias + " dias letivos = " + fmt(r.pctFreq) + "% de frequência (" +
      fmt(r.pctFaltas) + "% de faltas, " + plural(r.faltas, "falta", "faltas") + "). " + (r.cumpriu ? "Regular" : "Baixa frequência") +
      " — mínimo " + lim + "%, máximo de " + plural(r.faltasMax, "falta", "faltas") + "; " + margem + ".";
  }

  function descreverMargem(it, lim) {
    var r = it.r || {};
    var dias = r.dias || (r.estado === "erro" ? r.dias : null);
    if (!dias) {
      var c = calc(), per = null;
      return it.rotulo + ": informe os dias letivos para eu calcular o limite.";
    }
    var max = faltasMaximas(lim, dias);
    var base = it.rotulo + ": " + dias + " dias letivos, mínimo " + lim + "% → no máximo " + plural(max, "falta", "faltas") + " (precisa de " + minPresencas(lim, dias) + " presenças)";
    if (r.estado === "ok") {
      base += r.cumpriu ? (r.faltasMax - r.faltas === 0 ? "; já tem " + r.faltas + ": sem margem." : "; já tem " + r.faltas + ", ainda pode faltar " + plural(r.faltasMax - r.faltas, "dia", "dias") + ".")
                         : "; já tem " + r.faltas + ", " + plural(r.faltas - r.faltasMax, "falta", "faltas") + " além do limite.";
    } else base += ".";
    return base;
  }

  function descreverSimulacao(it, lim, n) {
    var r = it.r;
    if (!r || r.estado !== "ok") {
      if (r && r.estado === "vazio") r = calc().avaliar(r.dias || parseInt((it.dias), 10), "0", lim);
      if (!r || r.estado !== "ok") return it.rotulo + ": preciso dos dias letivos e das faltas atuais para simular.";
    }
    var nova = calc().avaliar(r.dias, String(r.faltas + n), lim);
    if (nova.estado !== "ok") return it.rotulo + ": com " + plural(n, "falta a mais", "faltas a mais") + " passaria dos dias letivos.";
    return it.rotulo + ": com mais " + plural(n, "falta", "faltas") + " (" + nova.faltas + " no total) a frequência iria de " + fmt(r.pctFreq) + "% para " + fmt(nova.pctFreq) + "% — " +
      (nova.cumpriu ? "continua regular" + (nova.faltasMax - nova.faltas === 0 ? ", mas sem margem." : ", ainda sobra margem de " + plural(nova.faltasMax - nova.faltas, "dia", "dias") + ".")
                    : (r.cumpriu ? "cairia para baixa frequência (mínimo " + lim + "%)." : "continua em baixa frequência (mínimo " + lim + "%)."));
  }

  function proximoPasso(est) {
    var baixos = est.itens.filter(function (it) { return itemPronto(it) && !it.r.cumpriu; });
    if (!baixos.length) return "";
    var rp = est.modo === "presenca" ? calc().repercussao(est.periodoIdx) : null;
    var t = "Próximo passo: no Presença, registre o percentual do mês e o código de motivo (veja a Legenda de Motivos abaixo). Greve, falta de professor e calamidade são situações coletivas e não contam como baixa frequência.";
    if (rp) t += " Este período entra na repercussão de " + rp.mes + "/" + rp.ano + (rp.dataLimite ? " (recurso até " + rp.dataLimite + ")" : "") + ".";
    if (est.faixa === "75j") t += " Aos 16 e 17 anos o efeito é só no BVA do adolescente.";
    return t;
  }

  // Texto para a IA: só NÚMEROS e regras do programa. Nenhum nome, nenhuma nota, nenhum NIS.
  // tipo: "explicar" (padrão) | "lembrete" (texto pronto para a equipe) | "recurso" (se houver baixa frequência)
  function promptIA(est, tipo) {
    if (!est) return "";
    var itens = est.itens.filter(itemPronto);
    if (!itens.length) return "";
    var baixos = itens.filter(function (x) { return !x.r.cumpriu; });
    var rp = null;
    try { rp = est.modo === "presenca" ? calc().repercussao(est.periodoIdx) : null; } catch (e) { rp = null; }
    var linhas = itens.map(function (it) {
      var r = it.r;
      return it.rotulo + ": " + r.presencas + " presenças em " + r.dias + " dias letivos = " + fmt(r.pctFreq) + "% (" + (r.cumpriu ? "regular" : "baixa frequência") +
        "; máximo de " + r.faltasMax + " faltas, tem " + r.faltas + (r.cumpriu ? ", margem de " + (r.faltasMax - r.faltas) : ", " + (r.faltas - r.faltasMax) + " além do limite") + ")";
    });
    var base = "Resultado de um cálculo de frequência escolar do Bolsa Família, já feito pelo app (não recalcule): " +
      (est.modo === "presenca" ? "período " + est.periodoNome + " de " + est.ano : est.periodoNome + " de " + est.ano + " (visão geral, não é o registro do Presença)") +
      "; faixa de " + est.faixaNome + ", mínimo de " + est.minimo + "%. " + linhas.join(". ") + ". " +
      (baixos.length && rp ? "Este período entra na repercussão de " + rp.mes + "/" + rp.ano + (rp.dataLimite ? ", com recurso no Sicon até " + rp.dataLimite : "") + ". " : "") +
      (baixos.length && est.faixa === "75j" ? "O estudante tem 16 ou 17 anos (efeito só no BVA). " : "");
    var fim = " Não informe nem peça nome ou dados da família.";
    if (tipo === "lembrete") {
      return base + "Escreva um lembrete curto para a equipe do CRAS (até 6 linhas) com a situação, a prioridade e o que fazer primeiro, usando [ESTUDANTE], [ESCOLA] e [DATA] no lugar de dados reais." + fim;
    }
    if (tipo === "recurso") {
      return base + "Me ajude a avaliar se cabe recurso: que motivos e documentos costumam valer, quem pede, o prazo e como montar o relato com fatos, sem expor a criança." + fim;
    }
    return base + "Explique em poucas linhas o que isso significa para o benefício da família e quais são os próximos passos do(a) profissional do CRAS." + fim;
  }

  // Resumo feito no aparelho, para quando a IA não responde (sem internet, cota esgotada, erro).
  function explicacaoLocal() {
    var C = calc(), est = C && C.ler();
    if (!est || !est.itens.some(itemPronto)) return "";
    var linhas = est.itens.filter(itemPronto).map(function (x) { return descreverItem(x, est.minimo); });
    var passo = proximoPasso(est);
    if (!passo) passo = "Frequência regular: nada a registrar como descumprimento. Se a margem de faltas estiver curta, vale avisar a escola e a família cedo. Uma falta isolada não gera efeito: conta a frequência do período.";
    return linhas.join("\n") + "\n" + passo + "\nA análise do caso é da equipe; vale o registro oficial do Sistema Presença e do Sicon.";
  }

  // A IA não deve inventar percentual. Compara os "NN%" da resposta com os do pedido (+ regras fixas do programa).
  function percentuaisForaDoCalculo(prompt, resposta) {
    function lista(t) { var o = [], re = /(\d{1,3}(?:[.,]\d+)?)\s*%/g, m; while ((m = re.exec(String(t)))) o.push(parseFloat(m[1].replace(",", "."))); return o; }
    var ok = lista(prompt).concat([60, 75, 99, 100, 50]);
    return lista(resposta).filter(function (v) { return !ok.some(function (a) { return Math.abs(a - v) < 0.051; }); })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
  }

  function acoesPadrao(est, temDados) {
    var a = [];
    if (temDados) {
      a.push({ rotulo: "Quantas faltas ainda posso ter?", tipo: "pergunta", texto: "Quantas faltas ainda posso ter?" });
      a.push({ rotulo: "E se faltar mais 1 dia?", tipo: "pergunta", texto: "E se faltar mais 1 dia?" });
      var ia = promptIA(est);
      if (ia) {
        a.push({ rotulo: "Explicar com a IA (envia só números)", tipo: "ia", prompt: ia, mostrar: "Explicar o resultado (enviando só os números, sem nome)" });
        a.push({ rotulo: "Lembrete para a equipe", tipo: "ia", prompt: promptIA(est, "lembrete"), mostrar: "Escrever um lembrete para a equipe (só números, sem nome)" });
        if (est.itens.some(function (x) { return itemPronto(x) && !x.r.cumpriu; }))
          a.push({ rotulo: "Cabe recurso?", tipo: "ia", prompt: promptIA(est, "recurso"), mostrar: "Avaliar se cabe recurso (só números, sem nome)" });
      }
      a.push({ rotulo: "Copiar resumo", tipo: "copiar" });
    }
    if (pilha.length) a.push({ rotulo: "↩ Desfazer", tipo: "pergunta", texto: "desfazer" });
    a.push({ rotulo: "Limpar", tipo: "limpar" });
    return a;
  }

  // ------------------------------------------------------------------ tratar: o ponto de entrada
  // Devolve null se a frase não é sobre o cálculo (aí quem chamou manda para o Paulus).
  function tratar(texto) {
    var C = calc();
    if (!C || !C.ler()) return null;
    if (/^resultado de um calculo de frequencia escolar/.test(sem(texto))) return null; // prompt montado pelo app para a IA, nunca é lançamento
    var it = interpretar(texto);
    var temFato = it.fatos.length > 0 || !!it.faixa || it.periodo != null;
    var quer = it.desfazer || it.limpar || it.copiar || it.margem || it.situacao || !!it.simula || temFato;
    if (!quer) return null;
    // "explique" sozinho, sem número e sem pedido de cálculo: deixa o Paulus (e ele pega o contexto se houver)
    var linhas = [];
    silencioAte = Date.now() + 2600;

    if (it.desfazer) {
      var antes = pilha.pop();
      if (!antes) return { texto: "Não tenho nada para desfazer.", acoes: [] };
      C.restaurar(antes); ultimoMes = null;
      return { texto: "Desfeito: voltei a calculadora ao que estava antes do último lançamento.", acoes: acoesPadrao(C.ler(), C.ler().itens.some(itemPronto)) };
    }
    if (temFato || it.faixa || it.periodo != null) { pilha.push(C.snapshot()); if (pilha.length > 15) pilha.shift(); }
    if (it.limpar) {
      pilha.push(C.snapshot());
      C.limpar(); ultimoMes = null;
      return { texto: "Pronto, calculadora limpa. Pode informar o próximo estudante — por exemplo: \"3 faltas em março, 22 dias letivos\".", acoes: [] };
    }
    if (it.copiar) {
      var est0 = C.ler();
      if (!C.resumo()) return { texto: "Ainda não há resultado para copiar. Informe as faltas primeiro.", acoes: acoesPadrao(est0, false) };
      return { texto: "Vou copiar o resumo (sem nome do estudante, a menos que você tenha digitado no campo Estudante).", acoes: [{ rotulo: "Copiar resumo", tipo: "copiar" }], copiarAgora: true };
    }

    var est = C.ler();
    var cmd = { itens: [] };
    // 1) meses citados → forma de cálculo e período
    var mesesFora = it.meses.filter(function (m) { return m < 2 || m > 11; });
    var meses = it.meses.filter(function (m) { return m >= 2 && m <= 11; });
    if (mesesFora.length) linhas.push((mesesFora[0] === 1 ? "Janeiro" : "Dezembro") + " não entra nos períodos do Sistema Presença (que vão de fevereiro a novembro), então ignorei.");
    if (meses.length) {
      cmd.modo = "presenca";
      var pIdx = C.periodoDoMes(meses[0]);
      var dentro = meses.filter(function (m) { return C.periodoDoMes(m) === pIdx; });
      if (dentro.length < meses.length) linhas.push("Os meses citados são de períodos diferentes; usei só " + dentro.map(function (m) { return C.meses[m]; }).join(" e ") + ". Peça o outro separadamente.");
      cmd.periodo = pIdx;
      meses = dentro;
    } else if (it.periodo != null) { cmd.modo = "presenca"; cmd.periodo = it.periodo; }
    if (it.faixa) { cmd.faixa = it.faixa; faixaConfirmada = true; }

    // 2) aplica a mudança de modo/período antes de decidir o "mês padrão"
    if (cmd.modo || cmd.periodo != null || cmd.faixa) { C.aplicar({ modo: cmd.modo, periodo: cmd.periodo, faixa: cmd.faixa, itens: [] }); est = C.ler(); }
    var pres = est.modo === "presenca";
    var mesesDoPeriodo = est.itens.map(function (x) { return x.mes; });

    // 3) fatos → itens
    var ok = true, aplicados = [];
    // presenças → faltas (precisa dos dias letivos: da frase ou da calculadora)
    it.fatos = it.fatos.map(function (f) {
      if (f.kind !== "presencas") return f;
      var d = null;
      it.fatos.forEach(function (g) { if (g.kind === "dias" && (g.mes === f.mes || g.mes == null || f.mes == null)) d = g.n; });
      if (d == null) {
        var cand = est.itens.filter(function (x) { return (f.mes == null || x.mes === f.mes) && x.r && x.r.dias; })[0];
        if (cand) d = cand.r.dias;
      }
      if (d == null || f.n > d) { linhas.push(d == null ? "Para usar as presenças preciso dos dias letivos. Diga: \"" + f.n + " presenças em 22 dias letivos\"." : "As presenças (" + f.n + ") passam dos dias letivos (" + d + ")."); return null; }
      return { kind: "faltas", n: d - f.n, mes: f.mes, deP: f.n };
    }).filter(Boolean);
    it.fatos.forEach(function (f) {
      var alvo = null;
      if (pres) {
        if (f.mes != null) alvo = f.mes;
        else if (f.kind === "dias" && ultimoMes != null && mesesDoPeriodo.indexOf(ultimoMes) >= 0) alvo = ultimoMes;
        else {
          var vazio = est.itens.filter(function (x) { return !x.r || x.r.estado === "vazio" || x.r.estado === "sem-dias"; })[0];
          alvo = vazio ? vazio.mes : null;
          if (alvo == null && est.itens.length === 1) alvo = est.itens[0].mes;
        }
        if (alvo == null) { linhas.push("Não sei de qual mês são os " + f.n + " " + (f.kind === "dias" ? "dias letivos" : "dias de falta") + ". Diga assim: \"" + f.n + (f.kind === "dias" ? " dias letivos em " : " faltas em ") + est.itens.map(function (x) { return x.rotulo.toLowerCase(); }).join(" ou ") + "\"."); ok = false; return; }
        if (mesesDoPeriodo.indexOf(alvo) < 0) return; // mês de outro período já avisado
        if (f.kind === "dias" && f.n > 31) { linhas.push("Um mês não tem " + f.n + " dias letivos (máximo 31); ignorei esse valor."); return; }
        ultimoMes = alvo;
      }
      var item = { mes: alvo };
      item[f.kind] = f.n;
      cmd.itens.push(item);
      aplicados.push((pres ? C.meses[alvo] + ": " : "") + f.n + (f.kind === "dias" ? " dias letivos" : (f.n === 1 ? " falta" : " faltas")));
    });
    if (cmd.itens.length) C.aplicar({ itens: cmd.itens });
    est = C.ler();
    if (aplicados.length) linhas.unshift("Lancei na calculadora → " + aplicados.join(" · ") + ".");
    if (cmd.faixa) linhas.push("Faixa: " + est.faixaNome + " (mínimo " + est.minimo + "%).");
    if (cmd.modo === "presenca" && it.meses.length && est.modo === "presenca") linhas.push("Período: " + est.periodoNome + ".");
    it.avisos.forEach(function (a) { linhas.push(a); });

    // 4) o que a pessoa quis saber
    var lim = est.minimo, qualquer = false;
    function alvoSim() {
      var itens = est.itens;
      if (it.simula && it.simula.mes != null && pres) itens = itens.filter(function (x) { return x.mes === it.simula.mes; });
      else if (it.simula) { var preenchidos = itens.filter(function (x) { return x.r && (x.r.estado === "ok"); }); if (preenchidos.length) itens = [preenchidos[preenchidos.length - 1]]; }
      return itens;
    }
    if (it.simula) {
      alvoSim().forEach(function (x) { linhas.push(descreverSimulacao(x, lim, it.simula.n)); });
      qualquer = true;
    }
    if (it.margem) {
      est.itens.forEach(function (x) { linhas.push(descreverMargem(x, lim)); });
      qualquer = true;
    }
    var prontos = est.itens.filter(itemPronto);
    if ((temFato || it.situacao) && !it.margem && !it.simula) {
      est.itens.forEach(function (x) { if (itemPronto(x) || x.r.estado === "erro") linhas.push(descreverItem(x, lim)); });
      var faltando = est.itens.filter(function (x) { return !itemPronto(x) && x.r.estado !== "erro"; });
      if (!prontos.length) linhas.push(faltando.length && faltando[0].r.estado === "sem-dias" ? "Faltam os dias letivos." : "Falta informar as faltas" + (pres ? " de " + faltando.map(function (x) { return x.rotulo.toLowerCase(); }).join(" e ") : "") + ". Ex.: \"3 faltas em " + (pres ? faltando[0].rotulo.toLowerCase() : "março") + "\".");
      else if (faltando.length) linhas.push("Ainda falta " + faltando.map(function (x) { return x.rotulo.toLowerCase(); }).join(" e ") + " para fechar o período.");
      qualquer = true;
    } else if (it.margem && temFato) {
      // margem pedida junto com fatos: já mostrou a margem
    }
    if (!faixaConfirmada && !faixaAvisada && est.itens.some(function (x) { return x.r && x.r.dias; })) {
      faixaAvisada = true;
      linhas.push("Usei o mínimo de " + est.minimo + "% (" + est.faixaNome + "), que é o padrão da calculadora. Se o estudante tiver outra idade, diga: \"tem 8 anos\".");
    }
    var passo = (!it.simula && !it.margem) ? proximoPasso(est) : "";
    if (passo) linhas.push(passo);
    if (!qualquer && !linhas.length) linhas.push("Pronto.");
    var acoes = acoesPadrao(est, est.itens.some(itemPronto));
    return { texto: linhas.join("\n"), acoes: acoes, estado: est };
  }

  // ------------------------------------------------------------------ executar uma ação (chip)
  function executar(a, aoIA) {
    var C = calc();
    if (!a || !C) return;
    if (a.tipo === "limpar") { silencioAte = Date.now() + 2600; C.limpar(); ultimoMes = null; }
    else if (a.tipo === "copiar") { if (typeof raiz.cfCopiarResumo === "function") raiz.cfCopiarResumo(); }
    else if (a.tipo === "ia" && aoIA) aoIA(a.prompt, a.mostrar);
  }

  // ------------------------------------------------------------------ mascote comenta o resultado
  var ultimaAssinatura = "", temporizador = null;

  function assinatura(est) {
    return est.itens.map(function (x) { return itemPronto(x) ? (x.r.cumpriu ? "o" : "b") + (x.r.faltasMax - x.r.faltas) : "-"; }).join("|") + "@" + est.periodoIdx + est.faixa;
  }

  function falaDoMascote(est) {
    var prontos = est.itens.filter(itemPronto);
    if (!prontos.length) return "";
    var baixos = prontos.filter(function (x) { return !x.r.cumpriu; });
    if (baixos.length) {
      var x = baixos[0];
      return x.rotulo + ": " + fmt(x.r.pctFreq) + "% — abaixo do mínimo de " + est.minimo + "%. Me toque que eu explico o que fazer.";
    }
    var menor = prontos.reduce(function (a, b) { return (b.r.faltasMax - b.r.faltas) < (a.r.faltasMax - a.r.faltas) ? b : a; });
    var margem = menor.r.faltasMax - menor.r.faltas;
    return menor.rotulo + ": " + fmt(menor.r.pctFreq) + "% ✔ " + (margem === 0 ? "Sem margem: mais 1 falta já é baixa frequência." : "Ainda pode faltar " + plural(margem, "dia", "dias") + ".");
  }

  function reagir() {
    var C = calc();
    if (!C || Date.now() < silencioAte) return;
    var painel = document.getElementById("paulusAnonaPainel");
    if (painel && !painel.hidden) return; // conversa aberta: não interrompe
    var est = C.ler();
    if (!est) return;
    var ass = assinatura(est);
    if (ass === ultimaAssinatura) return;
    ultimaAssinatura = ass;
    var fala = falaDoMascote(est);
    if (fala && raiz.AnonaMascot) raiz.AnonaMascot.falar(fala, { duracao: 7000 });
  }

  // ------------------------------------------------------------------ campo "Preencher falando com o Anona"
  function mostrarInline(res) {
    var resp = document.getElementById("cfAssistResp");
    if (!resp) return;
    resp.classList.remove("hidden");
    resp.textContent = res.texto;
    var antigo = document.getElementById("cfAssistAcoes");
    if (antigo && antigo.parentNode) antigo.parentNode.removeChild(antigo);
    if (res.acoes && res.acoes.length) {
      var box = document.createElement("div");
      box.id = "cfAssistAcoes";
      box.className = "flex flex-wrap gap-2 mb-3";
      res.acoes.forEach(function (a) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = a.rotulo;
        b.className = "px-3 py-1.5 rounded-full text-[11px] font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
        b.addEventListener("click", function () {
          if (a.tipo === "pergunta") { var r2 = tratar(a.texto); if (r2) mostrarInline(r2); }
          else if (a.tipo === "ia") { if (raiz.PaulusAnona && raiz.PaulusAnona.perguntar) raiz.PaulusAnona.perguntar(a.prompt, { ia: true, mostrar: a.mostrar }); }
          else { executar(a); if (a.tipo === "limpar") mostrarInline({ texto: "Pronto, calculadora limpa.", acoes: [] }); }
        });
        box.appendChild(b);
      });
      resp.parentNode.insertBefore(box, resp.nextSibling);
    }
    if (res.copiarAgora) { raiz.cfCopiarResumo && raiz.cfCopiarResumo(); }
    if (raiz.AnonaMascot && raiz.AnonaMascot.acenar) raiz.AnonaMascot.acenar();
  }

  function ligarFormulario() {
    var form = document.getElementById("cfAssistForm"), campo = document.getElementById("cfAssistCampo");
    if (!form || !campo) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = campo.value.trim();
      if (!t) return;
      var res = tratar(t);
      if (res) { mostrarInline(res); campo.value = ""; return; }
      // não é conta: é dúvida → vai para o Paulus (que filtra dado pessoal antes de enviar)
      if (raiz.PaulusAnona && raiz.PaulusAnona.perguntar) { raiz.PaulusAnona.perguntar(t); campo.value = ""; }
      else mostrarInline({ texto: "Não entendi como cálculo e o assistente não carregou. Tente: \"3 faltas em março, 22 dias letivos\".", acoes: [] });
    });
  }

  // Cumprimento do painel quando a calculadora já tem dados
  function saudacaoCalculo() {
    var C = calc();
    if (!C) return null;
    var est = C.ler();
    if (!est || !est.itens.some(itemPronto)) return null;
    var resumo = est.itens.filter(itemPronto).map(function (x) { return x.rotulo + " " + fmt(x.r.pctFreq) + "% (" + (x.r.cumpriu ? "regular" : "baixa frequência") + ")"; }).join(" · ");
    return { texto: "Vi que você está calculando " + est.periodoNome + " (mínimo " + est.minimo + "%): " + resumo + ". Quer saber a margem de faltas, simular ou ter uma explicação?", acoes: acoesPadrao(est, true) };
  }

  function ligarExemplosEVoz() {
    var campo = document.getElementById("cfAssistCampo"), ex = document.getElementById("cfAssistExemplos");
    if (ex && campo) {
      ["3 faltas em março, 22 dias letivos", "faltou 5 de 22 dias", "quantas faltas ainda posso ter?", "e se faltar mais 2 dias?", "desfazer"].forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = t;
        b.className = "px-3 py-1 rounded-full text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
        b.addEventListener("click", function () { campo.value = t; campo.focus(); });
        ex.appendChild(b);
      });
    }
    var mic = document.getElementById("cfAssistMic"), SR = raiz.SpeechRecognition || raiz.webkitSpeechRecognition;
    if (mic && campo && SR) {
      mic.hidden = false;
      var rec = null, ouvindo = false;
      mic.addEventListener("click", function () {
        if (ouvindo && rec) { try { rec.stop(); } catch (e) {} return; }
        try {
          rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = false; rec.maxAlternatives = 1;
          rec.onresult = function (ev) { var t = ev.results[0][0].transcript; campo.value = t; var f = document.getElementById("cfAssistForm"); if (f.requestSubmit) f.requestSubmit(); };
          rec.onend = function () { ouvindo = false; mic.textContent = "🎤 Falar"; };
          rec.onerror = function () { ouvindo = false; mic.textContent = "🎤 Falar"; };
          rec.start(); ouvindo = true; mic.textContent = "● Ouvindo… toque para parar";
        } catch (e) { ouvindo = false; mic.textContent = "🎤 Falar"; }
      });
    }
  }

  function iniciar() {
    ligarFormulario();
    ligarExemplosEVoz();
    var sel = document.getElementById("cfFaixa");
    if (sel) sel.addEventListener("change", function () { faixaConfirmada = true; });
    document.addEventListener("anona:frequencia", function () {
      clearTimeout(temporizador);
      temporizador = setTimeout(reagir, 1400);
    });
  }

  var API = { explicacaoLocal: explicacaoLocal, percentuaisForaDoCalculo: percentuaisForaDoCalculo, interpretar: interpretar, tratar: tratar, executar: executar, saudacaoCalculo: saudacaoCalculo, promptIA: promptIA };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (raiz && raiz.document) {
    raiz.AnonaPresenca = API;
    if (raiz.document.readyState === "loading") raiz.document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
  }
})(typeof window !== "undefined" ? window : this);
