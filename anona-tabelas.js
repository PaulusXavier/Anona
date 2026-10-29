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

  const fmtPct = n => (Math.round(n * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

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
  function estilizar(ws, opts) {
    opts = opts || {};
    const cor = opts.cor || '0B2F7A', sz = opts.tamFonte || 11, fmt = opts.formatos || {};
    const range = root.XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const claro = clarear(cor, 0.90), base = clarear(cor, 0.96);
    const cab = {
      font: { name: 'Arial', sz: sz + 1, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: cor } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: cor } }, bottom: { style: 'medium', color: { rgb: cor } }, left: { style: 'thin', color: { rgb: cor } }, right: { style: 'thin', color: { rgb: cor } } }
    };
    ws['!rows'] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      ws['!rows'][r] = { hpt: r === range.s.r && !opts.semCabecalho ? (opts.altCab || 40) : (opts.altLinha || 24) };
      for (let c = range.s.c; c <= range.e.c; c++) {
        const a = endereco(r, c);
        if (!ws[a]) ws[a] = { v: '', t: 's' };
        if (r === range.s.r && !opts.semCabecalho) { ws[a].s = cab; continue; }
        const nome = c === opts.colunaNome, numero = ws[a].t === 'n' || ws[a].f;
        ws[a].s = {
          font: { name: 'Arial', sz, bold: nome, color: { rgb: nome ? '000000' : '1F2937' } },
          alignment: { vertical: 'center', wrapText: true, horizontal: numero ? 'right' : 'left' },
          border: BORDAS, fill: { patternType: 'solid', fgColor: { rgb: r % 2 === 0 ? claro : base } }
        };
        if (fmt[c] && numero) ws[a].z = fmt[c];
      }
    }
    ws['!cols'] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      let max = 10;
      for (let r = range.s.r; r <= range.e.r; r++) { const x = ws[endereco(r, c)]; max = Math.max(max, x && x.v != null ? String(x.v).length : 0); }
      ws['!cols'][c] = { wch: Math.min(max + 4, opts.larguraMax || 42) };
    }
    if (opts.filtro !== false) ws['!autofilter'] = { ref: ws['!ref'] };
    if (opts.congelar !== false) ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!tabColor'] = { rgb: cor };
    ws['!margins'] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
    ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
    return ws;
  }

  const aspas = n => "'" + String(n).replace(/'/g, "''") + "'";
  // Célula com FÓRMULA e o valor já calculado (para visualizadores que não recalculam, como o prévia do celular).
  const celulaFormula = (f, v) => ({ t: typeof v === 'number' ? 'n' : 's', f, v });

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
    const w = root.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return w instanceof ArrayBuffer ? new Uint8Array(w) : w;
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
    const X = root.XLSX, lim = ctx.lim, rows = ctx.linhas.filter(l => Number.isFinite(lerInteiro(l.dias)));
    const cab = ['Mês', ctx.unidade === 'aulas' ? 'Aulas dadas' : 'Dias letivos', 'Faltas', 'Presenças', '% de faltas', '% de frequência', 'Máx. de faltas (' + lim + '%)', 'Folga de faltas', 'Situação', 'Repercussão'];
    const aoa = [cab];
    rows.forEach(l => aoa.push([l.mesNome, lerInteiro(l.dias), Number.isFinite(lerInteiro(l.faltas)) ? lerInteiro(l.faltas) : null, null, null, null, null, null, null, ctx.repercussao[l.mes] || '']));
    const ws = X.utils.aoa_to_sheet(aoa);
    rows.forEach((l, i) => {
      const r = i + 2, d = 'B' + r, f = 'C' + r, tem = Number.isFinite(lerInteiro(l.faltas));
      const av = tem ? avaliar(lerInteiro(l.dias), lerInteiro(l.faltas), lim) : null;
      const vazio = 'ISBLANK(' + f + ')';
      // O mínimo usa inteiros: ceil(lim×dias/100) = INT((lim×dias+99)/100), igual ao cálculo da tela.
      const minP = 'INT((' + lim + '*' + d + '+99)/100)';
      ws['D' + r] = celulaFormula('IF(' + vazio + ',"",' + d + '-' + f + ')', av ? av.presencas : '');
      ws['E' + r] = celulaFormula('IF(' + vazio + ',"",' + f + '/' + d + ')', av ? av.pctFaltas / 100 : '');
      ws['F' + r] = celulaFormula('IF(' + vazio + ',"",(' + d + '-' + f + ')/' + d + ')', av ? av.pctFreq / 100 : '');
      ws['G' + r] = celulaFormula(d + '-' + minP, av ? av.faltasMax : (lerInteiro(l.dias) - minPresencas(lerInteiro(l.dias), lim)));
      ws['H' + r] = celulaFormula('IF(' + vazio + ',"",G' + r + '-' + f + ')', av ? av.folga : '');
      ws['I' + r] = celulaFormula('IF(' + vazio + ',"",IF(' + f + '>' + d + ',"Conferir valores",IF(' + d + '-' + f + '>=' + minP + ',"Frequência regular","Baixa frequência")))',
        av ? (av.cumpriu ? 'Frequência regular' : 'Baixa frequência') : '');
    });
    const last = rows.length + 1, tot = last + 1;
    // Linha de totais (informativa: o Presença avalia mês a mês).
    ws['A' + tot] = { t: 's', v: 'Total / visão geral' };
    const soma = col => 'SUM(' + col + '2:' + col + last + ')';
    const ok = rows.filter(l => Number.isFinite(lerInteiro(l.faltas)));
    const dT = ok.reduce((a, l) => a + lerInteiro(l.dias), 0), fT = ok.reduce((a, l) => a + lerInteiro(l.faltas), 0);
    ws['B' + tot] = celulaFormula('SUMIF(C2:C' + last + ',"<>",B2:B' + last + ')', dT);       // só os meses já lançados
    ws['C' + tot] = celulaFormula(soma('C'), fT);
    ws['D' + tot] = celulaFormula('B' + tot + '-C' + tot, dT - fT);
    ws['E' + tot] = celulaFormula('IF(B' + tot + '=0,"",C' + tot + '/B' + tot + ')', dT ? fT / dT : '');
    ws['F' + tot] = celulaFormula('IF(B' + tot + '=0,"",D' + tot + '/B' + tot + ')', dT ? (dT - fT) / dT : '');
    const nBaixa = ok.filter(l => !avaliar(lerInteiro(l.dias), lerInteiro(l.faltas), lim).cumpriu).length;
    ws['I' + tot] = celulaFormula('COUNTIF(I2:I' + last + ',"Baixa frequência")&" mês(es) com baixa frequência"', nBaixa + ' mês(es) com baixa frequência');
    ws['!ref'] = 'A1:J' + tot;
    estilizar(ws, { cor: '159947', formatos: { 4: '0.0%', 5: '0.0%' }, filtro: false, altLinha: 26, larguraMax: 30 });
    // Cor condicional simples nas situações já calculadas + formatação % na linha de total.
    for (let r = 2; r <= tot; r++) {
      ['E', 'F'].forEach(c => { if (ws[c + r]) ws[c + r].z = '0.0%'; });
      const cel = ws['I' + r]; if (!cel) continue;
      if (r === tot) continue;
      const baixa = cel.v === 'Baixa frequência', reg = cel.v === 'Frequência regular';
      if (baixa || reg) cel.s = Object.assign({}, cel.s, { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: baixa ? 'B91C1C' : '047857' } }, fill: { patternType: 'solid', fgColor: { rgb: baixa ? 'FEE2E2' : 'D1FAE5' } } });
    }
    for (let c = 0; c < 10; c++) { const a = endereco(tot - 1, c); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = { font: { name: 'Arial', sz: 11, bold: true }, border: { top: { style: 'medium', color: { rgb: '159947' } }, bottom: BORDA, left: BORDA, right: BORDA }, alignment: { vertical: 'center', horizontal: c === 0 || c === 8 ? 'left' : 'right' }, fill: { patternType: 'solid', fgColor: { rgb: 'E8F5EC' } } }; if (c === 4 || c === 5) ws[a].z = '0.0%'; }

    const info = [
      ['Frequência escolar — Bolsa Família (cálculo de orientação, método do Sistema Presença)'],
      ctx.nome ? ['Estudante', ctx.nome] : null,
      ['Rede / ano', ctx.rede + ' · ' + ctx.ano], ['Faixa etária', ctx.faixaTxt + ' — mínimo de ' + lim + '% de frequência'],
      ['Contagem em', ctx.unidade === 'aulas' ? 'aulas / horas-aula' : 'dias letivos'],
      [], ['Como ler: o Presença avalia cada mês separadamente; a linha de total é só informativa. As colunas D a I são fórmulas: edite Dias letivos ou Faltas e tudo recalcula.'],
      ['Estimativa para orientação: vale sempre o registro oficial da escola no Sistema Presença.']
    ].filter(Boolean);
    const wsInfo = X.utils.aoa_to_sheet(info);
    wsInfo['!cols'] = [{ wch: 22 }, { wch: 80 }];
    wsInfo['A1'].s = { font: { name: 'Arial', sz: 13, bold: true, color: { rgb: '0B2F7A' } } };
    wsInfo['!tabColor'] = { rgb: '0B2F7A' };
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
    csv, tabelaHTML, tsv, copiarTabela,
    estilizar, abaDeDados, abaResumoComFormulas, celulaFormula, escrever, baixarBlob, MIME_XLSX, nomeArquivoSeguro, clarear,
    panoramaWorkbook, panoramaParaMatriz
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AnonaTabelas;
})(typeof window !== 'undefined' ? window : globalThis);
