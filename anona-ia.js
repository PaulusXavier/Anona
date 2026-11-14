// anona-ia.js — a IA (Paulus) DENTRO do Anona: comandos em linguagem natural que agem no app e a base pública
// do calendário que acompanha cada pergunta enviada à IA.
//
// O QUE FAZ
//  1. COMANDOS LOCAIS (no aparelho, sem enviar nada): "próximos prazos", "quando é o recurso de setembro?",
//     "quando recebo? final 7", "ir para março", "mês que vem", "dia 20", "anotar no dia 20: ...",
//     "imprimir o mês", "o que é o motivo 3.2?". Respondem com os dados cadastrados no app e oferecem botões.
//  2. BASE PÚBLICA PARA A IA: baseParaIA(pergunta) monta até 4 itens (calendário do mês, próximos prazos, dias de
//     pagamento por final de NIS, valores em vigor, trechos da Legenda de Motivos) e panorama() diz o dia de hoje,
//     o mês na tela e o cartão em destaque. Assim o Paulus responde com os números reais do Anona, sem inventar data.
//  3. BOTÕES "✨ IA": cada cartão ganha um botão que pergunta sobre ele; o calendário ganha "Explicar o mês" e o
//     painel do dia ganha "O que fazer neste dia?".
//
// REGRAS (não mude sem pensar)
//  - Nada de dado pessoal sai daqui: nem NIS, nem notas, nem planilhas, nem nomes. Os dias de pagamento vão TODOS
//    (os 10 finais), nunca só o da pessoa; o app só informa à IA SE o final do NIS foi preenchido, sem o dígito.
//  - "Anotar" só PREENCHE o campo de nota e leva o foco até ele; quem salva é a pessoa.
//  - Texto sempre inserido com textContent (nunca innerHTML).
//  - Comandos locais não entram no histórico enviado ao Worker.
//
// O app oferece uma ponte pequena e estável em window.AnonaApp (definida no index.html). Em teste (Node) o módulo
// recebe um app de mentira: node tests/ia.test.js
(function (raiz) {
  "use strict";

  var MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  var RE_MES = "(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)";
  var TIPOS = { saude: "Saúde", edu: "Educação", sicon: "SICON", interrupt: "Interrupção" };

  function sem(t) {
    return String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  }
  function dois(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + dois(d.getMonth() + 1) + "-" + dois(d.getDate()); }
  function deIso(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dm(d) { return dois(d.getDate()) + "/" + dois(d.getMonth() + 1); }
  function dmSemana(d) { return dm(d) + " (" + DIAS_SEMANA[d.getDay()] + ")"; }
  function mesAno(ano, mes) { return NOMES_MES[mes] + "/" + ano; }
  function inicioDoDia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function corta(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function criar(obterApp) {
    function app() { return typeof obterApp === "function" ? obterApp() : obterApp; }
    function pronto() { var a = app(); return !!(a && typeof a.hoje === "function"); }
    function hoje() { return inicioDoDia(app().hoje()); }

    // ------------------------------------------------------------ dados do calendário
    function anos() { var r = app().anos(); return r && r.length === 2 ? r : [hoje().getFullYear(), hoje().getFullYear()]; }
    function temAno(a) { var r = anos(); return a >= r[0] && a <= r[1]; }

    // todos os prazos oficiais, em ordem de data: [{ data, tipo, titulo, desc }]
    function eventos() {
      var r = anos(), lista = [];
      for (var a = r[0]; a <= r[1]; a++) {
        var mapa = app().eventos(a) || {};
        Object.keys(mapa).forEach(function (k) {
          (mapa[k] || []).forEach(function (e) { lista.push({ data: deIso(k), tipo: e.type, titulo: e.title, desc: e.desc || "" }); });
        });
      }
      lista.sort(function (x, y) { return x.data - y.data; });
      return lista;
    }
    function eventosDoMes(ano, mes) {
      return eventos().filter(function (e) { return e.data.getFullYear() === ano && e.data.getMonth() === mes; });
    }
    function eventosDoDia(d) {
      var k = iso(d);
      return eventos().filter(function (e) { return iso(e.data) === k; });
    }
    function destaques(ano, mes) { return (app().destaques(ano, mes) || []); }

    // dia de pagamento do final f (0-9) no mês; null se não houver
    function diaPagamento(ano, mes, f) {
      var arr = (app().pagamentos(ano) || {})[mes];
      if (!arr || arr.length !== 10) return null;
      return arr[f === 0 ? 9 : f - 1];
    }
    function proximoPagamento(f) {
      var h = hoje();
      for (var i = 0; i < 14; i++) {
        var d = new Date(h.getFullYear(), h.getMonth() + i, 1);
        if (!temAno(d.getFullYear())) break;
        var dia = diaPagamento(d.getFullYear(), d.getMonth(), f);
        if (dia == null) continue;
        var alvo = new Date(d.getFullYear(), d.getMonth(), dia);
        if (alvo >= h) return alvo;
      }
      return null;
    }
    function quando(alvo) {
      var n = Math.round((alvo - hoje()) / 86400000);
      return n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n > 0 ? "em " + n + " dias" : "há " + (-n) + " dias";
    }

    // ------------------------------------------------------------ leitura do texto
    function acharMes(t) {
      var m = new RegExp("\\b" + RE_MES + "\\b(?:(?:\\s+de\\s+|\\s+|\\/)(20\\d\\d))?").exec(t);
      if (!m) return null;
      var nome = m[1], i = MESES.indexOf(nome);
      if (i < 0) i = MESES_ABREV.indexOf(nome);
      if (i < 0) return null;
      var h = hoje(), ano = m[2] ? +m[2] : null;
      if (!ano) {
        var tela = app().mes();
        ano = tela && temAno(tela.ano) ? tela.ano : h.getFullYear();
      }
      return { mes: i, ano: ano };
    }
    function acharFinal(t) {
      var m = /\b(?:final|termina(?:do)?\s+em|termina\s+com)\s*(?:do\s+)?(?:meu\s+)?(?:nis\s*)?(?:e\s+|eh\s+)?(\d)\b/.exec(t) ||
        /\bnis\b\D{0,24}\b(\d)\b(?!\d)/.exec(t);
      return m ? +m[1] : null;
    }
    function acharDia(t) {
      var h = hoje();
      if (/\bamanha\b/.test(t)) return new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1);
      if (/\bhoje\b/.test(t)) return h;
      if (/\bontem\b/.test(t)) return new Date(h.getFullYear(), h.getMonth(), h.getDate() - 1);
      var tela = app().mes() || { ano: h.getFullYear(), mes: h.getMonth() };
      var m = /\bdia\s+(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(20\d\d))?/.exec(t);
      if (m) return validar(m[3] ? +m[3] : tela.ano, +m[2] - 1, +m[1]);
      m = new RegExp("\\bdia\\s+(\\d{1,2})\\s+(?:de\\s+)?" + RE_MES + "\\b(?:\\s+(?:de\\s+)?(20\\d\\d))?").exec(t);
      if (m) {
        var mi = MESES.indexOf(m[2]); if (mi < 0) mi = MESES_ABREV.indexOf(m[2]);
        return validar(m[3] ? +m[3] : tela.ano, mi, +m[1]);
      }
      m = /\bdia\s+(\d{1,2})\b/.exec(t);
      if (m) return validar(tela.ano, tela.mes, +m[1]);
      return null;
    }
    function validar(ano, mes, dia) {
      var d = new Date(ano, mes, dia);
      return d.getMonth() === mes && d.getDate() === dia && temAno(ano) ? d : null;
    }

    function linhaEvento(e, curto) {
      return "• " + dmSemana(e.data) + " — " + e.titulo + (e.data < hoje() ? " (já passou)" : "");
    }

    // ------------------------------------------------------------ respostas
    function respostaPrazos(t) {
      var h = hoje(), lista = null, titulo = "Próximos prazos a partir de hoje (" + dm(h) + ")", filtro = null, rot = "";
      var mes = acharMes(t);
      var tipos = [["recurso", /recurso/, "recurso"], ["sicon", /sicon/, "SICON"], ["edu", /(frequencia|escola|educacao|edu\b)/, "educação"], ["saude", /(saude|vacina|pre-?natal|coleta)/, "saúde"], ["interrupt", /interrupcao/, "interrupção"]];
      tipos.forEach(function (x) { if (!filtro && x[1].test(t)) { filtro = x[0] === "recurso" ? /recurso/i : x[0]; rot = x[2]; } });
      function casa(e) {
        if (!filtro) return true;
        if (filtro instanceof RegExp) return filtro.test(sem(e.titulo));
        return e.tipo === filtro;
      }
      var todos = eventos().filter(casa);
      if (mes) {
        // "recurso de setembro": o prazo do recurso de um mês de REFERÊNCIA cai no mês seguinte (ex.: "Recurso Set/26" em 29/10)
        var ab = MESES_ABREV[mes.mes], reRef = new RegExp("(^|[^a-z])" + ab + "([^a-z]|$)");
        var refs = todos.filter(function (e) { return reRef.test(sem(e.titulo)) && e.data.getFullYear() === mes.ano; });
        if (filtro && refs.length) { lista = refs; titulo = "Prazos de " + rot + " referentes a " + mesAno(mes.ano, mes.mes); rot = ""; filtro = null; }
        else { lista = todos.filter(function (e) { return e.data.getFullYear() === mes.ano && e.data.getMonth() === mes.mes; }); titulo = "Prazos de " + mesAno(mes.ano, mes.mes); }
      } else {
        lista = todos.filter(function (e) { return e.data >= h; }).slice(0, 6);
      }
      var txt = titulo + (filtro ? " (" + rot + ")" : "") + ":\n";
      if (!lista.length) return txt + "Não há prazos cadastrados no app para isso. Confira o normativo vigente e o app oficial.";
      return txt + lista.slice(0, 10).map(linhaEvento).join("\n");
    }

    function respostaPagamento(t) {
      var f = acharFinal(t), do_app = app().nis(), h = hoje();
      var proprio = false;
      if (f == null && do_app !== "" && do_app != null) { f = +do_app; proprio = true; }
      if (f == null) {
        var tela = app().mes() || { ano: h.getFullYear(), mes: h.getMonth() };
        var txt = "Para dizer o seu dia, preciso do final do NIS (o último dígito). Diga, por exemplo, “final 7”, ou digite em “Seu NIS”.";
        var linhas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map(function (x) { var d = diaPagamento(tela.ano, tela.mes, +x); return d == null ? null : "final " + x + ": dia " + d; }).filter(Boolean);
        if (linhas.length) txt += "\n\nPagamentos de " + mesAno(tela.ano, tela.mes) + " (calendário do app):\n" + linhas.join(" · ");
        return txt;
      }
      var p = proximoPagamento(f);
      if (!p) return "O calendário do app não traz o próximo pagamento do final " + f + ". Confira o calendário oficial da Caixa.";
      return (proprio ? "O seu próximo pagamento" : "O próximo pagamento do final " + f) + " é " + dmSemana(p) + " (" + quando(p) + "), pelo calendário cadastrado no app. Datas podem mudar: confirme no app oficial.";
    }

    function respostaMes(ano, mes) {
      var dst = destaques(ano, mes), evs = eventosDoMes(ano, mes);
      var txt = mesAno(ano, mes) + ":";
      if (dst.length) txt += "\n" + dst.map(function (d) { return "• " + d.title + (d.desc ? " — " + d.desc : ""); }).join("\n");
      if (evs.length) txt += "\n\nPrazos do mês:\n" + evs.slice(0, 8).map(linhaEvento).join("\n");
      if (!dst.length && !evs.length) txt += "\nSem destaques nem prazos cadastrados no app para este mês.";
      return txt;
    }

    function respostaDia(d) {
      var evs = eventosDoDia(d), txt = dmSemana(d) + ":";
      txt += evs.length ? "\n" + evs.map(function (e) { return "• " + e.titulo + (e.desc ? " — " + e.desc : ""); }).join("\n") : "\nNão há prazo cadastrado neste dia.";
      return txt;
    }

    function respostaMotivo(t) {
      var lista = app().motivos ? app().motivos() : [];
      var cod = /\b(\d{1,2}(?:[.\-]\d{1,2})*)\b/.exec(t);
      var achados = [];
      lista.forEach(function (g) {
        (g.items || []).forEach(function (it) {
          var c = sem(it[0]), d = sem(it[1]);
          if (cod ? c === cod[1] || c.indexOf(cod[1]) === 0 : false) achados.push({ cat: g.cat, cod: it[0], desc: it[1] });
        });
      });
      if (!cod) {
        var termo = t.replace(/\b(o que|que|qual|quais|e|eh|significa|motivo|motivos|codigo|de|do|da|frequencia|legenda|sobre|me|diga|mostre)\b/g, " ").replace(/\s+/g, " ").trim();
        if (termo.length >= 4) lista.forEach(function (g) { (g.items || []).forEach(function (it) { if (sem(it[1]).indexOf(termo) !== -1) achados.push({ cat: g.cat, cod: it[0], desc: it[1] }); }); });
      }
      if (!achados.length) return null;
      return "Na Legenda de Motivos de frequência:\n" + achados.slice(0, 5).map(function (a) { return "• " + a.cod + " — " + a.desc + " (" + a.cat + ")"; }).join("\n");
    }

    // ------------------------------------------------------------ ações (botões)
    function ac(rotulo, fn) { return { rotulo: rotulo, tipo: "fazer", fn: fn }; }
    function acPergunta(rotulo, texto) { return { rotulo: rotulo, tipo: "pergunta", texto: texto }; }
    function acIA(rotulo, prompt, mostrar) { return { rotulo: rotulo, tipo: "ia", prompt: prompt, mostrar: mostrar }; }

    // ------------------------------------------------------------ comandos
    // devolve { texto, acoes } ou null (null = não é comando; segue para a IA)
    function tratar(texto) {
      if (!pronto()) return null;
      var t = sem(texto);
      if (!t || t.length > 200) return null;
      var a = app(), h = hoje(), m;
      var pergunta = /^(o que|qual|quais|quando|como|por que|porque|quanto|quantos|quem|onde|posso|devo|preciso)\b/.test(t);

      // anotar (só preenche o campo)
      if ((m = /^(anota\w*|anote|criar nota|criar anotacao|adicionar nota|adicionar anotacao|nota)\b\s*(.*)$/.exec(t)) && !pergunta) {
        var resto = m[2] || "", dia = acharDia(resto) || null, textoNota = "";
        var corpo = /:\s*(.+)$/.exec(String(texto)) || null;
        if (corpo) textoNota = corpo[1].trim();
        else { var q = /\b(?:que|sobre)\s+(.+)$/i.exec(String(texto)); if (q) textoNota = q[1].trim(); }
        var alvo = dia || (a.selecionado ? inicioDoDia(a.selecionado()) : h);
        if (!temAno(alvo.getFullYear())) return { texto: "Esse dia está fora dos anos cadastrados no app.", acoes: [] };
        a.irDia(alvo);
        a.preencherNota(textoNota);
        return { texto: "Abri o dia " + dmSemana(alvo) + " e " + (textoNota ? "coloquei o texto no campo de anotação" : "levei você ao campo de anotação") + ". Confira e toque em Salvar: eu não salvo nada sozinho.", acoes: [] };
      }

      // imprimir / exportar
      if (/\bimprim\w*\b/.test(t) && /\b(mes|calendario)\b/.test(t)) {
        a.imprimirMes();
        return { texto: "Abri a impressão do calendário de " + (a.mes() ? mesAno(a.mes().ano, a.mes().mes) : "este mês") + ".", acoes: [] };
      }
      if ((/\bimprim\w*\b/.test(t) || /\b(exportar|baixar|salvar)\b/.test(t)) && /\b(notas|anotacoes|pdf)\b/.test(t) && !pergunta) {
        a.irCartao("exportar");
        return { texto: "Levei você ao cartão Exportar. Lá você escolhe o mês (ou todos) e baixa as anotações em PDF.", acoes: [] };
      }

      // definir o final do NIS
      if (/\bnis\b/.test(t) && !pergunta && !/\b(pagamento|recebo|receber|quando|dia)\b/.test(t) && (m = acharFinal(t)) != null) {
        a.setNis(String(m));
        return { texto: "Pronto, destaquei no calendário o pagamento do final " + m + ".", acoes: [acPergunta("Quando recebo?", "quando recebo o pagamento?")] };
      }
      if (/\b(limpar|apagar|tirar)\b.*\bnis\b/.test(t)) { a.setNis(""); return { texto: "Limpei o campo do NIS.", acoes: [] }; }

      // pagamento
      var falaPag = /\b(pagamento|pagamentos|recebo|receber|recebimento|parcela|cai|sai o)\b/.test(t) || /\bquando\b.*\b(pago|paga|depositam|deposita)\b/.test(t);
      if (falaPag && /\b(quando|que dia|qual dia|dia|proximo|meu|final|nis|recebo)\b/.test(t) && !/\b(valor|quanto|motivo|bloque|suspen|cancel|nao recebi|atras)/.test(t)) {
        return { texto: respostaPagamento(t), acoes: [ac("Ver no calendário", function () { a.irCartao("calendario"); })] };
      }

      // prazos
      if (!falaPag && (/\b(prazos?|vence|vencem|vencimentos?|agenda|proximos eventos|datas importantes)\b/.test(t) ||
        /\bquando\s+(e|eh|fecha|termina|acaba|abre|comeca|vence)\b.*\b(recurso|registro|fechamento|impressao|coleta|interrupcao|sicon|vigencia|repercussao)\b/.test(t) ||
        /\bate\s+quando\b.*\b(recurso|registro|fechamento|impressao|coleta|sicon)\b/.test(t))) {
        return { texto: respostaPrazos(t), acoes: [acIA("Explicar com a IA", "Explique, em poucos passos, o que a equipe do CRAS faz primeiro com os próximos prazos do calendário do app.", "Explique os próximos prazos")] };
      }

      // navegação de calendário (só quando é um pedido curto, não uma pergunta)
      if (!pergunta) {
        if (/^(ir (para )?|va (para )?|vai (para )?|ver |mostr\w+ |abr\w+ |leve\w* (me )?(para |ao )?)?(hoje|o dia de hoje)$/.test(t)) {
          a.irHoje();
          return { texto: "Voltei para hoje, " + dmSemana(h) + ".", acoes: [] };
        }
        if (/\b(proximo mes|mes que vem|mes seguinte)\b/.test(t)) { a.mudarMes(1); return mensagemMes(a); }
        if (/\b(mes passado|mes anterior|voltar um mes)\b/.test(t)) { a.mudarMes(-1); return mensagemMes(a); }
        var verbo = /^(ir|va|vai|ver|mostr\w*|abr\w*|leve\w*|me leva|me mostr\w*|calendario|destaques?)\b/.test(t);
        if (verbo) {
          var dnav = acharDia(t);
          if (dnav) { a.irDia(dnav); return { texto: respostaDia(dnav), acoes: [acIA("O que fazer neste dia?", promptDia(dnav), "O que fazer neste dia?")] }; }
          var mnav = acharMes(t);
          if (mnav) {
            if (!temAno(mnav.ano)) return { texto: "O app não tem o calendário de " + mnav.ano + " cadastrado.", acoes: [] };
            a.irMes(mnav.ano, mnav.mes);
            return { texto: respostaMes(mnav.ano, mnav.mes), acoes: [acIA("Explicar o mês", promptMes(mnav.ano, mnav.mes), "Explicar " + mesAno(mnav.ano, mnav.mes))] };
          }
        }
      }

      // legenda de motivos
      if (/\b(motivo|motivos|codigo)\b/.test(t) && /\b(frequencia|legenda|significa|codigo|motivo)\b/.test(t)) {
        var r = respostaMotivo(t);
        if (r) return { texto: r, acoes: [ac("Abrir a Legenda", function () { a.irCartao("legenda de motivos"); })] };
      }
      return null;
    }

    function mensagemMes(a) {
      var tela = a.mes();
      return { texto: respostaMes(tela.ano, tela.mes), acoes: [acIA("Explicar o mês", promptMes(tela.ano, tela.mes), "Explicar " + mesAno(tela.ano, tela.mes))] };
    }

    // ------------------------------------------------------------ pedidos à IA (já com os prazos públicos)
    function promptMes(ano, mes) {
      var dst = destaques(ano, mes).map(function (d) { return d.title + (d.desc ? " (" + d.desc + ")" : ""); });
      var evs = eventosDoMes(ano, mes).slice(0, 10).map(function (e) { return dm(e.data) + " " + e.titulo; });
      return "Explique, para a equipe do CRAS, o que significa o mês de " + mesAno(ano, mes) + " no calendário de condicionalidades do Bolsa Família e o que fazer primeiro. " +
        "Destaques: " + (dst.join("; ") || "nenhum") + ". Prazos: " + (evs.join("; ") || "nenhum") + ". Responda em poucos passos e só com estas datas.";
    }
    function promptDia(d) {
      var evs = eventosDoDia(d).map(function (e) { return e.titulo + (e.desc ? " (" + e.desc + ")" : ""); });
      return "Explique o que fazer em " + dmSemana(d) + " no calendário de condicionalidades do Bolsa Família. Prazos do dia: " + (evs.join("; ") || "nenhum") +
        ". Seja objetivo, em poucos passos, e use só estas datas.";
    }
    function promptCartao(titulo) {
      return "Explique para que serve o cartão “" + titulo + "” do app e como usar, em poucos passos.";
    }

    // ------------------------------------------------------------ contexto da IA (só dado público)
    var RE_LEGENDA = /\b(motivo|motivos|legenda|codigo|frequencia)\b/;
    function baseParaIA(pergunta) {
      if (!pronto()) return [];
      var h = hoje(), t = sem(pergunta), base = [];
      var tela = app().mes() || { ano: h.getFullYear(), mes: h.getMonth() };
      var mm = acharMes(t), ref = mm || tela;
      var dst = destaques(ref.ano, ref.mes), evs = eventosDoMes(ref.ano, ref.mes);
      var cal = [];
      dst.forEach(function (d) { cal.push(d.title + (d.desc ? ": " + d.desc : "")); });
      evs.slice(0, 12).forEach(function (e) { cal.push(dm(e.data) + " — " + e.titulo + (e.desc ? ": " + e.desc : "")); });
      if (cal.length) base.push({ titulo: "Calendário de " + mesAno(ref.ano, ref.mes), texto: cal.join(" | "), origem: "calendário oficial cadastrado no app" });
      var prox = eventos().filter(function (e) { return e.data >= h; }).slice(0, 8).map(function (e) { return dm(e.data) + " — " + e.titulo; });
      if (prox.length) base.push({ titulo: "Próximos prazos a partir de hoje (" + dm(h) + ")", texto: prox.join(" | "), origem: "calendário oficial cadastrado no app" });
      if (/\b(pagamento|pagamentos|recebo|receber|parcela|nis|final)\b/.test(t)) {
        var pag = [];
        for (var f = 1; f <= 10; f++) { var x = f % 10, d = diaPagamento(ref.ano, ref.mes, x); if (d != null) pag.push("final " + x + ": dia " + d); }
        if (pag.length) base.push({ titulo: "Dias de pagamento de " + mesAno(ref.ano, ref.mes), texto: pag.join("; ") + (app().nis() !== "" && app().nis() != null ? ". A pessoa já informou o final do NIS no app: diga “o seu dia de pagamento”, sem citar o dígito." : ""), origem: "calendário de pagamentos cadastrado no app" });
      }
      if (/\b(valor|valores|quanto|reais|beneficio|piso)\b/.test(t) && app().valores) {
        var v = app().valores();
        if (v) base.push({ titulo: "Valores em vigor", texto: "Benefício de Renda de Cidadania R$ " + v.brc + " por pessoa; Complementar (piso por família) R$ " + v.bco + "; Primeira Infância R$ " + v.bpi + " por criança de 0 a 7 anos incompletos; Variável Familiar R$ " + v.bvf + ".", origem: v.fonte || "valores cadastrados no app" });
      }
      if (RE_LEGENDA.test(t) && app().motivos) {
        var termos = t.split(" ").filter(function (w) { return w.length >= 5 && !/^(motivo|motivos|legenda|codigo|frequencia|significa|quais)$/.test(w); });
        var ach = [];
        app().motivos().forEach(function (g) { (g.items || []).forEach(function (it) {
          var d = sem(it[1]), cod = sem(it[0]);
          if (termos.some(function (w) { return d.indexOf(w) !== -1; }) || (t.indexOf(cod) !== -1 && /\d/.test(cod) && cod.length >= 2)) ach.push(it[0] + " — " + it[1]);
        }); });
        if (ach.length) base.push({ titulo: "Legenda de Motivos (frequência escolar)", texto: ach.slice(0, 8).join(" | "), origem: "Legenda de Motivos do app" });
      }
      return base.slice(0, 4).map(function (b) { return { titulo: b.titulo, texto: corta(b.texto, 1400), origem: b.origem }; });
    }

    function panorama() {
      if (!pronto()) return "";
      var h = hoje(), tela = app().mes(), r = anos();
      var txt = "Hoje é " + DIAS_SEMANA[h.getDay()] + ", " + dm(h) + "/" + h.getFullYear() + ".";
      if (tela) txt += " O calendário na tela mostra " + mesAno(tela.ano, tela.mes) + ".";
      txt += " O calendário cadastrado no app cobre " + (r[0] === r[1] ? r[0] : r[0] + " a " + r[1]) + ". Datas fora disso: não existem no app.";
      return txt;
    }

    return { tratar: tratar, baseParaIA: baseParaIA, panorama: panorama, promptMes: promptMes, promptDia: promptDia, promptCartao: promptCartao,
      _: { eventos: eventos, proximoPagamento: proximoPagamento, acharMes: acharMes, acharFinal: acharFinal, acharDia: acharDia } };
  }

  var api = { criar: criar, sem: sem };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  // ------------------------------------------------------------ navegador: botões "✨ IA" e ligação com o app
  if (typeof document === "undefined") return;
  var IA = criar(function () { return raiz.AnonaApp; });
  raiz.AnonaIA = IA;

  function chip(rotulo, aria, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "anona-ia-chip";
    b.textContent = rotulo;
    b.setAttribute("aria-label", aria);
    b.style.cssText = "margin-left:.5rem;padding:.1rem .55rem;border-radius:999px;border:1px solid var(--line,rgba(13,46,99,.25));" +
      "background:transparent;color:var(--azul,#0D2E63);font-size:.7rem;font-weight:700;cursor:pointer;vertical-align:middle;";
    b.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); fn(); });
    return b;
  }
  function perguntar(prompt, mostrar) {
    var P = raiz.PaulusAnona;
    if (P && P.perguntar) P.perguntar(prompt, { ia: true, mostrar: mostrar, origem: "balao" });
  }

  // um botão em cada cartão (títulos h2.eyebrow e h3.passbook-label), sem duplicar
  function marcarCartoes() {
    var app = document.getElementById("appContent");
    if (!app) return;
    var hs = app.querySelectorAll("h2.eyebrow, h3.passbook-label");
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (h.querySelector(".anona-ia-chip")) continue;
      var tit = (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70);
      if (!tit) continue;
      (function (hh, titulo) {
        hh.appendChild(chip("✨ IA", "Perguntar ao Paulus sobre " + titulo, function () { perguntar(IA.promptCartao(titulo), "Sobre “" + titulo + "”"); }));
      })(h, tit);
    }
  }

  // "Explicar o mês" no cabeçalho do calendário e "O que fazer neste dia?" no painel do dia
  function marcarCalendario() {
    var rot = document.getElementById("currentMonthLabel");
    if (rot && rot.parentNode && !document.getElementById("anonaIaMes")) {
      var b = chip("✨ Explicar o mês", "Explicar o mês na tela com a IA", function () {
        var t = raiz.AnonaApp && raiz.AnonaApp.mes();
        if (t) perguntar(IA.promptMes(t.ano, t.mes), "Explicar " + mesAno(t.ano, t.mes));
      });
      b.id = "anonaIaMes";
      b.style.marginLeft = "0";
      rot.parentNode.appendChild(b);
    }
    var lista = document.getElementById("eventList");
    if (lista && lista.parentNode && !document.getElementById("anonaIaDia")) {
      var d = chip("✨ O que fazer neste dia?", "Perguntar à IA o que fazer no dia selecionado", function () {
        var s = raiz.AnonaApp && raiz.AnonaApp.selecionado();
        if (s) perguntar(IA.promptDia(inicioDoDia(s)), "O que fazer em " + dm(s) + "?");
      });
      d.id = "anonaIaDia";
      d.style.margin = "0 0 .75rem 0";
      lista.parentNode.insertBefore(d, lista);
    }
  }

  function aoCarregar() {
    marcarCartoes(); marcarCalendario();
    // o app aparece depois do login e refaz partes da tela: observa e recoloca os botões sem custo
    var agenda = null;
    var obs = new MutationObserver(function () {
      if (agenda) return;
      agenda = setTimeout(function () { agenda = null; marcarCartoes(); marcarCalendario(); }, 400);
    });
    var alvo = document.getElementById("appContent") || document.body;
    obs.observe(alvo, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", aoCarregar);
  else aoCarregar();
})(typeof window !== "undefined" ? window : globalThis);
