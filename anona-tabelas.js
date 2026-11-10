/* Anona — módulo único de CÁLCULOS e TABELAS.
 *
 * Antes, cada planilha gerada (divisão do Território Volante, famílias recorrentes, relatório filtrado)
 * repetia ~60 linhas de formatação e gravava totais como números fixos. Aqui fica tudo num lugar só:
 *   - cálculo de frequência (puro, testável em Node: `node tests/tabelas.test.js`);
 *   - "Panorama do ano": a tabela mês a mês da Calculadora de Faltas, com totais;
 *   - estilização padrão de abas (.xlsx), abas de resumo com FÓRMULAS (recalculam se alguém editar);
 *   - exportar para .xlsx / .csv e copiar como tabela (cola formatada no Word/Excel/e-mail).
 * Nada de estudante é salvo: tudo vive só na tela, como a calculadora.
 */
(function (root) {
  'use strict';

  /* ───────────────────────── Cálculo ───────────────────────── */

  // Lê um número inteiro digitado ("3", " 3 ", "3,0"). Decimal de verdade ("2,5") e lixo ("abc") viram NaN —
  // antes o parseInt aceitava "2,5" como 2 em silêncio.
  function lerInteiro(txt) {
    if (txt == null) return NaN;
    const s = String(txt).trim().replace(',', '.');
    if (s === '' || !/^\d+(\.0+)?$/.test(s)) return NaN;
    return Math.round(Number(s));
  }

  // Mínimo de presenças em inteiros (sem erro de ponto flutuante): ceil(lim × dias / 100).
  function minPresencas(dias, lim) { return Math.floor((lim * dias + 99) / 100); }

  // Avalia um mês/período. dias = dias letivos (ou aulas dadas); faltas = number|NaN.
  function avaliar(dias, faltas, lim) {
    if (!(dias > 0)) return { estado: 'sem-dias' };
    if (!Number.isFinite(faltas) || faltas < 0) return { estado: 'vazio' };
    if (faltas > dias) return { estado: 'erro', faltas, dias };
    const presencas = dias - faltas, minP = minPresencas(dias, lim);
    return {
      estado: 'ok', dias, faltas, presencas, minPresencas: minP, faltasMax: dias - minP,
      pctFaltas: faltas / dias * 100, pctFreq: presencas / dias * 100,
      pctFaltasMax: (dias - minP) / dias * 100, pesoFalta: 100 / dias,
      cumpriu: presencas >= minP, folga: (dias - minP) - faltas      // folga < 0 = faltas além do limite
    };
  }

  // Panorama do ano. linhas: [{ mes, dias, faltas }] (faltas pode ser '' = ainda não lançado).
  // periodos: [{ nome, meses:[...] }] (os 5 do Presença). Devolve linhas avaliadas, resumo por período e totais.
  function panorama(linhas, periodos, lim) {
    const itens = linhas.map(l => ({ mes: l.mes, r: avaliar(lerInteiro(l.dias), lerInteiro(l.faltas), lim) }));
    const porMes = new Map(itens.map(i => [i.mes, i.r]));
    const porPeriodo = periodos.map((p, idx) => {
      const rs = p.meses.map(m => porMes.get(m) || { estado: 'sem-dias' });
      const lancados = rs.filter(r => r.estado === 'ok');
      const baixos = p.meses.filter((m, k) => rs[k].estado === 'ok' && !rs[k].cumpriu);
      return {
        idx, nome: p.nome, meses: p.meses, lancados: lancados.length, total: p.meses.length, baixos,
        completo: lancados.length === p.meses.length,
        situacao: lancados.length === 0 ? 'vazio' : (baixos.length ? 'baixa' : (lancados.length === p.meses.length ? 'regular' : 'parcial'))
      };
    });
    const ok = itens.filter(i => i.r.estado === 'ok');
    const dias = ok.reduce((a, i) => a + i.r.dias, 0), faltas = ok.reduce((a, i) => a + i.r.faltas, 0);
    const geral = dias > 0 ? avaliar(dias, faltas, lim) : null;
    const erros = itens.filter(i => i.r.estado === 'erro').map(i => i.mes);
    return {
      itens, porPeriodo, erros,
      totais: {
        mesesLancados: ok.length, dias, faltas, geral,
        mesesBaixa: ok.filter(i => !i.r.cumpriu).map(i => i.mes),
        periodosBaixa: porPeriodo.filter(p => p.baixos.length).map(p => p.idx)
      }
    };
  }

  /* ───────────────────────── Texto / CSV / HTML ───────────────────────── */

  // Mesma regra do cfFmt() da tela: 1 casa decimal, MAS se o arredondamento "encostar" em 60, 75 ou 100 sem o valor real
  // ter chegado lá (74,96% virando "75,0%" e, ao lado, "Baixa frequência"), mostra 2 casas sem arredondar para o limite.
  // Antes a tela mostrava 74,96% e a impressão/CSV/cópia mostravam 75,0% para o mesmo mês.
  function fmtNum(n) {
    const r1 = Math.round(n * 10) / 10;
    if (r1 !== n && (r1 === 60 || r1 === 75 || r1 === 100)) {
      const t = n < r1 ? Math.floor(n * 100) / 100 : Math.ceil(n * 100) / 100;
      return t.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  const fmtPct = n => fmtNum(n) + '%';

  // CSV que o Excel brasileiro abre direto: separador ";", vírgula decimal e BOM UTF-8 (acentos).
  function csv(aoa) {
    const cel = v => {
      if (v == null) return '';
      let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s;     // evita "injeção de fórmula" ao abrir no Excel
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + aoa.map(l => l.map(cel).join(';')).join('\r\n');
  }
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Tabela HTML simples e com estilo embutido (o Word/Outlook/Docs mantêm o estilo ao colar).
  function tabelaHTML(aoa, opts) {
    opts = opts || {};
    const cor = opts.cor || '#0B2F7A';
    const th = 'style="background:' + cor + ';color:#fff;border:1px solid #999;padding:4px 8px;font:bold 11pt Arial"';
    const td = 'style="border:1px solid #bbb;padding:4px 8px;font:11pt Arial"';
    return '<table style="border-collapse:collapse">' + aoa.map((l, i) => '<tr>' + l.map(v =>
      i === 0 ? '<th ' + th + '>' + escHtml(v) + '</th>' : '<td ' + td + '>' + escHtml(v) + '</td>').join('') + '</tr>').join('') + '</table>';
  }
  // Texto seguro para as fontes padrão do PDF (Helvetica, alfabeto "WinAnsi"): emoji, setas, símbolos e letras
  // de outros alfabetos NÃO existem nela — no jsPDF saíam como lixo ("Ø=Ý") e no pdf-lib davam erro e travavam o PDF.
  // Mantém acentos do português; troca o que tem equivalente simples e descarta o resto.
  const PDF_OK = /[\t\n\r\x20-\x7E\xA0-\xFF\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122\u2013\u2014\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC]/;
  const PDF_TROCAS = { '\u2192': '->', '\u2190': '<-', '\u2191': '^', '\u2193': 'v', '\u2713': 'OK', '\u2714': 'OK', '\u2705': 'OK', '\u2717': 'X', '\u2718': 'X', '\u274C': 'X', '\u2605': '*', '\u2606': '*', '\u2B50': '*', '\u2264': '<=', '\u2265': '>=', '\u00A0': ' ', '\u200B': '', '\u200D': '', '\uFE0F': '', '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-' };
  function textoParaPdf(v) {
    if (v == null) return '';
    if (typeof v !== 'string') return v;
    let out = '';
    for (const ch of v.normalize('NFC')) {
      if (PDF_TROCAS[ch] != null) { out += PDF_TROCAS[ch]; continue; }
      if (PDF_OK.test(ch)) { out += ch; continue; }
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');       // "ć" -> "c"
      out += base !== ch && PDF_OK.test(base) ? base : '';
    }
    // palavra sem espaço maior que ~60 caracteres (link, código) não quebra linha no PDF e invadia a margem/coluna ao lado
    return out.replace(/\S{60,}/g, m => m.replace(/(.{50})/g, '$1 '));
  }

  // Tabela para IMPRESSÃO (página própria do app): <thead> repete em cada folha, linha não é cortada ao meio.
  function tabelaImpressao(aoa, opts) {
    opts = opts || {};
    const num = opts.colunasNumero || [];
    // opts.classeCelula(valor, coluna, linha) -> classe extra (ex.: 'bad', 'ok'): destaca situação e valores negativos na folha.
    const extra = (v, i, l) => { try { return opts.classeCelula ? (opts.classeCelula(v, i, l) || '') : ''; } catch (e) { return ''; } };
    const cel = (tag, v, i, l) => {
      const cls = ((num.indexOf(i) >= 0 ? 'n ' : '') + (tag === 'td' ? extra(v, i, l) : '')).trim();
      return '<' + tag + (cls ? ' class="' + escHtml(cls) + '"' : '') + '>' + escHtml(v) + '</' + tag + '>';
    };
    const [cab, ...corpo] = aoa;
    const total = opts.ultimaLinhaTotal && corpo.length ? corpo.pop() : null;
    return '<table class="pr-tab"><thead><tr>' + cab.map((v, i) => cel('th', v, i)).join('') + '</tr></thead><tbody>'
      + corpo.map(l => '<tr>' + l.map((v, i) => cel('td', v, i, l)).join('') + '</tr>').join('') + '</tbody>'
      + (total ? '<tfoot><tr>' + total.map((v, i) => cel('td', v, i, total)).join('') + '</tr></tfoot>' : '') + '</table>';
  }
  const tsv = aoa => aoa.map(l => l.map(v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');

  async function copiarTabela(aoa, opts) {
    const html = tabelaHTML(aoa, opts), txt = tsv(aoa);
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([txt], { type: 'text/plain' })
        })]);
        return true;
      }
      await navigator.clipboard.writeText(txt); return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e2) { return false; }
    }
  }

  /* ───────────────────────── Planilhas (.xlsx) ───────────────────────── */

  const BORDA = { style: 'thin', color: { rgb: 'D9D9D9' } };
  const BORDAS = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
  function clarear(hex, f) {
    const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    return c.map(v => Math.round(v + (255 - v) * f).toString(16).padStart(2, '0').toUpperCase()).join('');
  }
  const endereco = (r, c) => root.XLSX.utils.encode_cell({ r, c });

  // Aba de DADOS a partir de uma matriz (1ª linha = cabeçalho). Já sai formatada.
  // opts: cor, colunaNome (índice em negrito), formatos {coluna: '0.0"%"'}, larguraMax, altCab, altLinha, tamFonte, congelar, filtro
  function abaDeDados(aoa, opts) {
    const ws = root.XLSX.utils.aoa_to_sheet(aoa);
    return estilizar(ws, opts);
  }
  /* ── Medidas pelo conteúdo real ──
   * Antes a largura era "nº de caracteres + 4" e a altura da linha fixa (34/36 pt): em Arial 12 isso é ~20% estreito demais,
   * então o texto quebrava em 3 linhas dentro de uma linha de 2 e saía CORTADO (endereço, nome do bairro), e a página
   * impressa ficava ilegível de tão larga. Agora: largura por percentil do conteúdo (um endereço gigante não alarga a coluna
   * inteira), nunca menor que a maior palavra (não quebra palavra no meio) e altura da linha = nº de linhas que o texto realmente ocupa. */
  const PT_POR_UNIDADE = 5.25;                       // 1 unidade de largura de coluna do Excel ≈ 5,25 pt
  function larguraTexto(txt, sz, negrito) {          // largura aproximada em pt (Arial)
    let w = 0;
    for (const ch of String(txt)) {
      let f = 0.52;
      if ('iljI.,;:\'!|() '.indexOf(ch) >= 0) f = 0.27;
      else if ('mwMW@%'.indexOf(ch) >= 0) f = 0.82;
      else if (ch >= 'A' && ch <= 'Z') f = 0.67;
      else if (ch >= '0' && ch <= '9') f = 0.56;
      w += f;
    }
    return w * sz * (negrito ? 1.07 : 1);
  }
  // nº de linhas que o texto ocupa numa coluna de `disponivel` pt (quebra em espaços; palavra maior que a coluna quebra em pedaços).
  function linhasDoTexto(txt, disponivel, sz, negrito) {
    const blocos = String(txt == null ? '' : txt).split(/\r?\n/);
    let total = 0;
    blocos.forEach(b => {
      let atual = 0, n = 1;
      const esp = larguraTexto(' ', sz, negrito);
      b.split(/\s+/).filter(Boolean).forEach(p => {
        let w = larguraTexto(p, sz, negrito);
        if (w > disponivel) {                           // palavra maior que a coluna: ocupa várias linhas
          const ocupa = Math.ceil(w / disponivel);
          if (atual > 0) n++;
          n += ocupa - 1; atual = w - (ocupa - 1) * disponivel; return;
        }
        if (atual === 0) atual = w;
        else if (atual + esp + w <= disponivel) atual += esp + w;
        else { n++; atual = w; }
      });
      total += n;
    });
    return Math.max(1, total);
  }
  const alturaParaLinhas = (n, sz) => Math.ceil(n * sz * 1.27 + 8);
  // Altura (pt) de um texto corrido numa área de `larguraUnid` unidades de coluna (para células mescladas).
  function alturaTexto(txt, larguraUnid, sz, negrito) {
    return alturaParaLinhas(linhasDoTexto(txt, larguraUnid * PT_POR_UNIDADE - 8, sz, negrito), sz);
  }
  // Recalcula !cols e !rows de uma aba JÁ preenchida. opts: sz, larguraMin, larguraMax, altMin, altCab, cabecalho (linha de títulos; padrão: a 1ª),
  // semCabecalho, ate (última linha considerada; as de baixo — textos corridos — ficam com altura simples), negrito (colunas em negrito).
  function ajustarMedidas(ws, opts) {
    opts = opts || {};
    const X = root.XLSX, sz = opts.sz || 11, range = X.utils.decode_range(ws['!ref'] || 'A1');
    const lMin = opts.larguraMin || 8, lMax = opts.larguraMax || 42, altMin = opts.altMin || 22, altCab = opts.altCab || 40;
    const fim = opts.ate != null ? Math.min(opts.ate, range.e.r) : range.e.r;
    const linhaCab = opts.semCabecalho ? -1 : (opts.cabecalho != null ? opts.cabecalho : range.s.r);
    const texto = (r, c) => { const x = ws[endereco(r, c)]; if (!x || x.v == null || x.v === '') return ''; return (typeof x.v === 'number' && x.z && /%/.test(x.z)) ? '00,0%' : String(x.v); };
    const negrito = c => opts.negrito != null && opts.negrito.indexOf(c) >= 0;
    const cols = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const larg = [];
      let palavra = 0;
      for (let r = range.s.r; r <= fim; r++) {
        const t = texto(r, c); if (!t) continue;
        const neg = r === linhaCab || negrito(c);
        if (r !== linhaCab) larg.push(Math.max(...String(t).split(/\r?\n/).map(l => larguraTexto(l, sz, neg))));
        // a maior PALAVRA nunca pode ser quebrada no meio (títulos de coluna incluídos)
        String(t).split(/\s+/).forEach(p => { palavra = Math.max(palavra, larguraTexto(p, sz + (r === linhaCab ? 1 : 0), neg)); });
      }
      larg.sort((a, b) => a - b);
      const tipico = larg.length ? larg[Math.min(larg.length - 1, Math.floor(larg.length * 0.85))] : 0;
      const wch = Math.min(lMax, Math.max(lMin, Math.ceil((Math.max(tipico, palavra) + 12) / PT_POR_UNIDADE)));
      cols[c] = { wch: Math.max(wch, Math.min(lMax, Math.ceil((palavra + 12) / PT_POR_UNIDADE))) };
    }
    ws['!cols'] = cols;
    ws['!rows'] = ws['!rows'] || [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (r > fim) { ws['!rows'][r] = { hpt: opts.altTexto || 20 }; continue; }
      let n = 1;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const t = texto(r, c); if (!t) continue;
        const disp = (cols[c].wch * PT_POR_UNIDADE) - 8;
        n = Math.max(n, linhasDoTexto(t, disp, r === linhaCab ? sz + 1 : sz, r === linhaCab || negrito(c)));
      }
      ws['!rows'][r] = { hpt: Math.max(r === linhaCab ? altCab : altMin, alturaParaLinhas(n, sz)) };
    }
    return ws;
  }

  function estilizar(ws, opts) {
    opts = opts || {};
    const cor = opts.cor || '0B2F7A', sz = opts.tamFonte || 11, fmt = opts.formatos || {};
    const range = root.XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const claro = clarear(cor, 0.90), base = clarear(cor, 0.96);
    const centro = opts.centralizar || [], alinhar = opts.alinhar || {};
    const cab = {
      font: { name: 'Arial', sz: sz + 1, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: cor } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: cor } }, bottom: { style: 'medium', color: { rgb: cor } }, left: { style: 'thin', color: { rgb: cor } }, right: { style: 'thin', color: { rgb: cor } } }
    };
    const rTotal = opts.totalUltimaLinha ? range.e.r : -1;
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const a = endereco(r, c);
        if (!ws[a]) ws[a] = { v: '', t: 's' };
        if (r === range.s.r && !opts.semCabecalho) { ws[a].s = cab; continue; }
        const nome = c === opts.colunaNome;
        // Só é "número" (alinhado à direita) quando o valor é de fato numérico: antes TODA célula com fórmula ia para a direita,
        // inclusive as que devolvem texto ("Frequência regular"), que ficavam coladas na coluna ao lado.
        const numero = typeof ws[a].v === 'number';
        const horizontal = alinhar[c] || (centro.indexOf(c) >= 0 ? 'center' : (numero ? 'right' : 'left'));
        ws[a].s = r === rTotal ? {
          font: { name: 'Arial', sz, bold: true, color: { rgb: '1F2937' } },
          alignment: { vertical: 'center', wrapText: true, horizontal },
          border: { top: { style: 'medium', color: { rgb: cor } }, bottom: BORDA, left: BORDA, right: BORDA }, fill: { patternType: 'solid', fgColor: { rgb: clarear(cor, 0.82) } }
        } : {
          font: { name: 'Arial', sz, bold: nome, color: { rgb: nome ? '000000' : '1F2937' } },
          alignment: { vertical: 'center', wrapText: true, horizontal },
          border: BORDAS, fill: { patternType: 'solid', fgColor: { rgb: r % 2 === 0 ? claro : base } }
        };
        if (fmt[c] && numero) ws[a].z = fmt[c];
      }
    }
    ajustarMedidas(ws, { sz, larguraMax: opts.larguraMax || 42, larguraMin: opts.larguraMin, altMin: opts.altLinha || 24, altCab: opts.altCab || 40, semCabecalho: opts.semCabecalho });
    if (opts.filtro !== false) ws['!autofilter'] = { ref: ws['!ref'] };
    if (opts.congelar !== false) ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!tabColor'] = { rgb: cor };
    ws['!margins'] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
    ws['!pageSetup'] = { orientation: opts.orientacao || 'landscape', fitToWidth: 1, fitToHeight: 0 };
    return ws;
  }

  const aspas = n => "'" + String(n).replace(/'/g, "''") + "'";
  // Célula com FÓRMULA e o valor já calculado (para visualizadores que não recalculam, como o prévia do celular).
  // Valor calculado que não é número de verdade (NaN, Infinity) NUNCA pode ir para o arquivo: o .xlsx ficaria
  // com <v>NaN</v> e o Excel avisa que o arquivo está corrompido. Nesse caso grava texto vazio.
  const celulaFormula = (f, v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) v = '';
    return { t: typeof v === 'number' ? 'n' : 's', f, v };
  };

  // Aba de resumo com contagens VIVAS: =COUNTA('Aba'!A:A)-1 para cada aba de dados (linhas − cabeçalho).
  // itens: [{ rotulo, aba, linhas, coluna:'A', extras:[...] }]; devolve também a linha de total (=SOMA).
  function abaResumoComFormulas(titulos, itens, opts) {
    opts = opts || {};
    const aoa = [titulos];
    itens.forEach(it => aoa.push([it.rotulo, ...(it.extras || []), null]));
    const ws = root.XLSX.utils.aoa_to_sheet(aoa);
    const colN = titulos.length - 1;                                  // a última coluna recebe a contagem
    itens.forEach((it, i) => { ws[endereco(i + 1, colN)] = celulaFormula('COUNTA(' + aspas(it.aba) + '!' + (it.coluna || 'A') + ':' + (it.coluna || 'A') + ')-1', it.linhas); });
    if (opts.total !== false && itens.length > 1) {
      const r = itens.length + 1, L = root.XLSX.utils.encode_col(colN);
      ws[endereco(r, 0)] = { t: 's', v: 'Total' };
      ws[endereco(r, colN)] = celulaFormula('SUM(' + L + '2:' + L + (r) + ')', itens.reduce((a, x) => a + x.linhas, 0));
      ws['!ref'] = root.XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: titulos.length - 1 } });
    }
    estilizar(ws, Object.assign({ filtro: false, altLinha: 26 }, opts));
    if (opts.total !== false && itens.length > 1) {
      const r = itens.length + 1;
      for (let c = 0; c < titulos.length; c++) {
        const a = endereco(r, c); if (!ws[a]) ws[a] = { t: 's', v: '' };
        ws[a].s = { font: { name: 'Arial', sz: (opts.tamFonte || 11), bold: true }, border: { top: { style: 'medium', color: { rgb: opts.cor || '0B2F7A' } }, bottom: BORDA, left: BORDA, right: BORDA }, alignment: { horizontal: c === titulos.length - 1 ? 'right' : 'left' } };
      }
    }
    return ws;
  }

  // Marca nome/cor das abas e devolve bytes do .xlsx.
  function escrever(wb, corPorAba) {
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Sheets = wb.SheetNames.map(name => ({ name, Hidden: 0, TabColor: { rgb: (corPorAba && corPorAba(name)) || '0B2F7A' } }));
    // Impressão: nas abas com cabeçalho congelado, a linha 1 se repete no topo de TODA página impressa
    // (antes, da 2ª folha em diante a tabela ficava sem títulos de coluna).
    const nomes = (wb.Workbook.Names || []).filter(n => n.Name !== '_xlnm.Print_Titles');
    wb.SheetNames.forEach((name, i) => {
      const fr = wb.Sheets[name] && wb.Sheets[name]['!freeze'];
      if (fr && fr.ySplit >= 1) nomes.push({ Name: '_xlnm.Print_Titles', Sheet: i, Ref: aspas(name) + '!$1:$' + (fr.ySplit | 0) });
    });
    if (nomes.length) wb.Workbook.Names = nomes;
    const w = root.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return w instanceof ArrayBuffer ? new Uint8Array(w) : w;
  }
  // A biblioteca de planilhas (xlsx-js-style) IGNORA em silêncio '!freeze', '!tabColor' e '!pageSetup': o
  // cabeçalho nunca ficava congelado, a guia não ganhava cor e a impressão não saía "ajustar à largura".
  // Esta etapa abre o .xlsx gerado e escreve esses três itens direto no XML de cada aba.
  // Se algo falhar (ou o JSZip não carregou), devolve os bytes originais: o arquivo nunca fica pior.
  async function polirXlsx(bytes, wb) {
    try {
      if (!root.JSZip || !wb || !wb.SheetNames) return bytes;
      const zip = await root.JSZip.loadAsync(bytes);
      for (let i = 0; i < wb.SheetNames.length; i++) {
        const ws = wb.Sheets[wb.SheetNames[i]], arq = zip.file('xl/worksheets/sheet' + (i + 1) + '.xml');
        if (!ws || !arq) continue;
        let xml = await arq.async('string');
        const fr = ws['!freeze'];
        const xs = fr && fr.xSplit > 0 ? fr.xSplit | 0 : 0, ys = fr && fr.ySplit > 0 ? fr.ySplit | 0 : 0;
        if ((xs || ys) && !/<pane\b/.test(xml)) {
          const topLeft = endereco(ys, xs), ativo = xs && ys ? 'bottomRight' : (ys ? 'bottomLeft' : 'topRight');
          const pane = '<pane' + (xs ? ' xSplit="' + xs + '"' : '') + (ys ? ' ySplit="' + ys + '"' : '') +
            ' topLeftCell="' + topLeft + '" activePane="' + ativo + '" state="frozen"/><selection pane="' + ativo + '" activeCell="' + topLeft + '" sqref="' + topLeft + '"/>';
          xml = xml.replace(/<sheetView([^>]*?)\/>/, '<sheetView$1>' + pane + '</sheetView>');
        }
        const cor = ws['!tabColor'] && ws['!tabColor'].rgb, ps = ws['!pageSetup'];
        if ((cor || ps) && !/<sheetPr\b/.test(xml)) {
          const sp = '<sheetPr>' + (cor ? '<tabColor rgb="FF' + String(cor).slice(-6).toUpperCase() + '"/>' : '') + (ps ? '<pageSetUpPr fitToPage="1"/>' : '') + '</sheetPr>';
          xml = xml.replace(/<dimension\b/, sp + '<dimension');
        }
        if (ps && !/<pageSetup\b/.test(xml)) {
          // paperSize 9 = A4 (sem isso, o Excel imprime em "Carta" em alguns computadores). Rodapé: aba, página X de Y e data.
          const tag = '<pageSetup paperSize="' + (ps.paperSize || 9) + '" orientation="' + (ps.orientation === 'portrait' ? 'portrait' : 'landscape') + '" fitToWidth="' + (ps.fitToWidth != null ? ps.fitToWidth : 1) + '" fitToHeight="' + (ps.fitToHeight != null ? ps.fitToHeight : 0) + '"/>'
            + (/<headerFooter\b/.test(xml) ? '' : '<headerFooter><oddFooter>&amp;L&amp;8Anona · &amp;A&amp;C&amp;8Página &amp;P de &amp;N&amp;R&amp;8Impresso em &amp;D</oddFooter></headerFooter>');
          xml = /<pageMargins\b[^>]*\/>/.test(xml) ? xml.replace(/(<pageMargins\b[^>]*\/>)/, '$1' + tag) : xml.replace('</worksheet>', tag + '</worksheet>');
        }
        zip.file(arq.name, xml);
      }
      return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    } catch (e) { console.warn('Não consegui aplicar o acabamento extra da planilha (o arquivo sai sem ele):', e); return bytes; }
  }
  // Escreve o workbook e já aplica o acabamento acima. Devolve Uint8Array.
  async function escreverPolido(wb, corPorAba) { return polirXlsx(escrever(wb, corPorAba), wb); }
  function bytesParaBase64(bytes) {
    let bin = ''; const passo = 0x8000;
    for (let i = 0; i < bytes.length; i += passo) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
    return btoa(bin);
  }
  function baixarBlob(bytesOuTexto, nome, mime) {
    const blob = new Blob([bytesOuTexto], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const nomeArquivoSeguro = t => String(t || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

  /* ───────────────────────── Planilha do Panorama do ano ───────────────────────── */

  // Monta o .xlsx do panorama com FÓRMULAS: presenças, % e situação recalculam se a pessoa mudar dias/faltas.
  // ctx: { nome, rede, ano, faixaTxt, lim, unidade:'dias letivos'|'aulas', repercussao:{mes:'Maio/2026'}, linhas:[{mes,mesNome,dias,faltas}] }
  function panoramaWorkbook(ctx) {
    // Só entram meses com dias letivos (> 0): com 0 dias a fórmula do % dividia por zero (#DIV/0!), como o Excel mostraria.
    const X = root.XLSX, lim = ctx.lim, rows = ctx.linhas.filter(l => lerInteiro(l.dias) > 0);
    const cab = ['Mês', ctx.unidade === 'aulas' ? 'Aulas dadas' : 'Dias letivos', 'Faltas', 'Presenças', '% de faltas', '% de frequência', 'Máx. de faltas (' + lim + '%)', 'Folga de faltas', 'Situação', 'Repercussão'];
    const aoa = [cab];
    rows.forEach(l => aoa.push([l.mesNome, lerInteiro(l.dias), Number.isFinite(lerInteiro(l.faltas)) ? lerInteiro(l.faltas) : null, null, null, null, null, null, null, ctx.repercussao[l.mes] || '']));
    const ws = X.utils.aoa_to_sheet(aoa);
    rows.forEach((l, i) => {
      const r = i + 2, d = 'B' + r, f = 'C' + r, tem = Number.isFinite(lerInteiro(l.faltas));
      const av = tem ? avaliar(lerInteiro(l.dias), lerInteiro(l.faltas), lim) : null;
      // `=""` vale tanto para célula realmente vazia quanto para texto vazio ("")
      // — o estilizar() grava células vazias como texto vazio, e ISBLANK() daria
      // FALSO nelas (o Excel então calcularia D = B − "" → #VALOR!).
      const vazio = 'OR(' + f + '="",' + f + '>' + d + ')';      // sem lançamento OU faltas maiores que os dias (inválido)
      // O mínimo usa inteiros: ceil(lim×dias/100) = INT((lim×dias+99)/100), igual ao cálculo da tela.
      const minP = 'INT((' + lim + '*' + d + '+99)/100)';
      const valido = av && av.estado === 'ok';
      ws['D' + r] = celulaFormula('IF(' + vazio + ',"",' + d + '-' + f + ')', valido ? av.presencas : '');
      ws['E' + r] = celulaFormula('IF(' + vazio + ',"",' + f + '/' + d + ')', valido ? av.pctFaltas / 100 : '');
      ws['F' + r] = celulaFormula('IF(' + vazio + ',"",(' + d + '-' + f + ')/' + d + ')', valido ? av.pctFreq / 100 : '');
      ws['G' + r] = celulaFormula(d + '-' + minP, valido ? av.faltasMax : (lerInteiro(l.dias) - minPresencas(lerInteiro(l.dias), lim)));
      ws['H' + r] = celulaFormula('IF(' + vazio + ',"",G' + r + '-' + f + ')', valido ? av.folga : '');
      ws['I' + r] = celulaFormula('IF(' + f + '="","",IF(' + f + '>' + d + ',"Conferir valores",IF(' + d + '-' + f + '>=' + minP + ',"Frequência regular","Baixa frequência")))',
        !av ? '' : (av.estado === 'erro' ? 'Conferir valores' : (av.cumpriu ? 'Frequência regular' : 'Baixa frequência')));
    });
    const last = rows.length + 1, tot = last + 1;
    // Linha de totais (informativa: o Presença avalia mês a mês).
    ws['A' + tot] = { t: 's', v: 'Total / visão geral' };
    // Totais SÓ com meses válidos: lançados e com faltas <= dias (mês com "Conferir valores" fica de fora,
    // igual ao panorama da tela). SUMPRODUCT com vírgula trata o texto vazio como 0, sem dar #VALOR!.
    const rng = c => c + '2:' + c + last;
    const validos = 'SUMPRODUCT(--ISNUMBER(' + rng('C') + '),--(' + rng('C') + '<=' + rng('B') + '),';
    const avs = rows.map(l => ({ l, av: Number.isFinite(lerInteiro(l.faltas)) ? avaliar(lerInteiro(l.dias), lerInteiro(l.faltas), lim) : null })).filter(x => x.av && x.av.estado === 'ok');
    const dT = avs.reduce((a, x) => a + x.av.dias, 0), fT = avs.reduce((a, x) => a + x.av.faltas, 0);
    ws['B' + tot] = celulaFormula(validos + rng('B') + ')', dT);
    ws['C' + tot] = celulaFormula(validos + rng('C') + ')', fT);
    ws['D' + tot] = celulaFormula('B' + tot + '-C' + tot, dT - fT);
    ws['E' + tot] = celulaFormula('IF(B' + tot + '=0,"",C' + tot + '/B' + tot + ')', dT ? fT / dT : '');
    ws['F' + tot] = celulaFormula('IF(B' + tot + '=0,"",D' + tot + '/B' + tot + ')', dT ? (dT - fT) / dT : '');
    const nBaixa = avs.filter(x => !x.av.cumpriu).length;
    ws['I' + tot] = celulaFormula('COUNTIF(I2:I' + last + ',"Baixa frequência")&" mês(es) com baixa frequência"', nBaixa + ' mês(es) com baixa frequência');
    ws['!ref'] = 'A1:J' + tot;
    estilizar(ws, { cor: '159947', formatos: { 4: '0.0#%', 5: '0.0#%' }, alinhar: { 8: 'center' }, filtro: false, altLinha: 26, larguraMax: 36 });
    // Cor condicional simples nas situações já calculadas + formatação % na linha de total.
    for (let r = 2; r <= tot; r++) {
      ['E', 'F'].forEach(c => { if (ws[c + r]) ws[c + r].z = '0.0#%'; });
      const cel = ws['I' + r]; if (!cel) continue;
      if (r === tot) continue;
      const baixa = cel.v === 'Baixa frequência', reg = cel.v === 'Frequência regular';
      if (baixa || reg) cel.s = Object.assign({}, cel.s, { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: baixa ? 'B91C1C' : '047857' } }, fill: { patternType: 'solid', fgColor: { rgb: baixa ? 'FEE2E2' : 'D1FAE5' } } });
    }
    for (let c = 0; c < 10; c++) { const a = endereco(tot - 1, c); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = { font: { name: 'Arial', sz: 11, bold: true }, border: { top: { style: 'medium', color: { rgb: '159947' } }, bottom: BORDA, left: BORDA, right: BORDA }, alignment: { vertical: 'center', horizontal: c === 0 || c === 8 ? 'left' : 'right' }, fill: { patternType: 'solid', fgColor: { rgb: 'E8F5EC' } } }; if (c === 4 || c === 5) ws[a].z = '0.0#%'; }

    const info = [
      ['Frequência escolar — Bolsa Família (cálculo de orientação, método do Sistema Presença)'],
      ctx.nome ? ['Estudante', ctx.nome] : null,
      ['Rede / ano', ctx.rede + ' · ' + ctx.ano], ['Faixa etária', ctx.faixaTxt + ' — mínimo de ' + lim + '% de frequência'],
      ['Contagem em', ctx.unidade === 'aulas' ? 'aulas / horas-aula' : 'dias letivos'],
      [], ['Como ler: o Presença avalia cada mês separadamente; a linha de total é só informativa. As colunas D a I são fórmulas: edite Dias letivos ou Faltas e tudo recalcula.'],
      ['Estimativa para orientação: vale sempre o registro oficial da escola no Sistema Presença.']
    ].filter(Boolean);
    const wsInfo = X.utils.aoa_to_sheet(info);
    // Aba de texto: antes saía sem quebra de linha nem ajuste de página — o texto longo atravessava a folha e a impressão
    // era cortada em duas páginas. Agora: rótulo em negrito, valor com quebra de linha, frases longas mescladas na largura toda
    // (altura calculada) e página A4 em pé ajustada à largura.
    const LARG_A = 22, LARG_B = 78, mesclas = [];
    wsInfo['!cols'] = [{ wch: LARG_A }, { wch: LARG_B }];
    wsInfo['!rows'] = [];
    info.forEach((linha, r) => {
      const a = endereco(r, 0), b = endereco(r, 1);
      if (!linha.length) { wsInfo['!rows'][r] = { hpt: 8 }; return; }
      if (linha.length === 1) {                                           // frase corrida: mescla A:B
        wsInfo[a].s = { font: { name: 'Arial', sz: r === 0 ? 13 : 10.5, bold: r === 0, color: { rgb: r === 0 ? '0B2F7A' : '374151' } }, alignment: { wrapText: true, vertical: 'top' } };
        mesclas.push({ s: { r, c: 0 }, e: { r, c: 1 } });
        wsInfo['!rows'][r] = { hpt: Math.max(r === 0 ? 24 : 18, alturaTexto(linha[0], LARG_A + LARG_B, r === 0 ? 13 : 10.5, r === 0)) };
        return;
      }
      wsInfo[a].s = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '1F2937' } }, alignment: { wrapText: true, vertical: 'top' } };
      if (wsInfo[b]) wsInfo[b].s = { font: { name: 'Arial', sz: 11, color: { rgb: '1F2937' } }, alignment: { wrapText: true, vertical: 'top' } };
      wsInfo['!rows'][r] = { hpt: Math.max(18, alturaTexto(linha[1], LARG_B, 11, false)) };
    });
    wsInfo['!merges'] = mesclas;
    wsInfo['!tabColor'] = { rgb: '0B2F7A' };
    wsInfo['!margins'] = { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
    wsInfo['!pageSetup'] = { orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Panorama do ano');
    X.utils.book_append_sheet(wb, wsInfo, 'Informações');
    return wb;
  }

  // Linhas "de papel" (para CSV / copiar) a partir do resultado de panorama().
  function panoramaParaMatriz(res, meta, lim) {
    const cab = ['Mês', meta.unidade === 'aulas' ? 'Aulas dadas' : 'Dias letivos', 'Faltas', 'Presenças', '% de faltas', '% de frequência', 'Máx. de faltas (' + lim + '%)', 'Folga', 'Situação', 'Repercussão'];
    const out = [cab];
    res.itens.forEach(({ mes, r }) => {
      if (r.estado === 'sem-dias') return;
      const base = [meta.nomesMes[mes], r.dias != null ? r.dias : (meta.dias[mes] || '')];
      if (r.estado !== 'ok') { out.push([...base, r.estado === 'erro' ? r.faltas : '', '', '', '', '', '', r.estado === 'erro' ? 'Conferir valores' : 'Aguardando faltas', meta.repercussao[mes] || '']); return; }
      out.push([base[0], r.dias, r.faltas, r.presencas, fmtPct(r.pctFaltas), fmtPct(r.pctFreq), r.faltasMax, r.folga, r.cumpriu ? 'Frequência regular' : 'Baixa frequência', meta.repercussao[mes] || '']);
    });
    const t = res.totais;
    if (t.geral) out.push(['Total / visão geral', t.dias, t.faltas, t.geral.presencas, fmtPct(t.geral.pctFaltas), fmtPct(t.geral.pctFreq), '', '', t.mesesBaixa.length + ' mês(es) com baixa frequência', '']);
    return out;
  }

  root.AnonaTabelas = {
    lerInteiro, minPresencas, avaliar, panorama, fmtPct,
    csv, tabelaHTML, tabelaImpressao, textoParaPdf, tsv, copiarTabela,
    estilizar, ajustarMedidas, alturaTexto, linhasDoTexto, larguraTexto, fmtNum, abaDeDados, abaResumoComFormulas, celulaFormula, escrever, escreverPolido, polirXlsx, bytesParaBase64, baixarBlob, MIME_XLSX, nomeArquivoSeguro, clarear,
    panoramaWorkbook, panoramaParaMatriz
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AnonaTabelas;
})(typeof window !== 'undefined' ? window : globalThis);
