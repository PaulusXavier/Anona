# Segurança do Anona — o que mudou e o que ainda depende de você

Revisão de 16/11/2026. O app guarda notas e planilhas de **famílias atendidas**, então o cuidado é maior que o de um site comum.

## O que foi corrigido no código

| # | Problema | Correção |
|---|----------|----------|
| 1 | **Restaurar um backup .json adulterado executava JavaScript no app** (campos `id`, `ano` e `sizeKB` iam direto para `onclick`/`innerHTML`). Reproduzido num Chromium real no app original; na versão corrigida não executa. | Cada planilha do backup é reconstruída e validada (id só com letras/números/`_`/`-`; mês 0–11; ano 2000–2100; tamanho recalculado; base64 de verdade). A tela também escapa esses campos (defesa em profundidade). |
| 2 | **pdf.js 3.11.174 (CVE-2024-4367)**: um PDF malicioso podia executar JavaScript (o app abre PDFs de fichas). | `isEvalSupported: false` e `enableXfa: false`. Além disso o CSP bloqueia `eval` (confirmado no app real). A versão continua a mesma; atualizar o pdf.js exige testar a leitura das fichas. |
| 3 | Bibliotecas carregadas de CDN sem verificação. | lucide, jsPDF, pdf-lib, JSZip, xlsx-js-style e pdf.js ficam em `vendor/`, nas **mesmas versões**, baixadas do npm (hashes abaixo). |
| 4 | Tailwind via `cdn.tailwindcss.com` (sem versão fixa, executa código de terceiros a cada abertura). | CSS gerado localmente em `tailwind.css` (Tailwind 3.4.17). **Se você adicionar classes novas, gere de novo** (ver abaixo). |
| 5 | Sem Content-Security-Policy. | CSP em `<meta>`: só carrega script/estilo/fonte/imagem/conexão dos domínios que o app realmente usa; sem `eval`; sem plugins. |
| 6 | Sem proteção contra clickjacking (app dentro de iframe de outro site). | Script no `<head>` que oculta a página e sai do iframe. (`frame-ancestors` não funciona em `<meta>`; o GitHub Pages não deixa configurar cabeçalhos.) |
| 7 | Sessão nunca expirava. | Sai da conta após **30 min sem uso** (`anona-seguranca.js`), com aviso na tela de entrada. Testado: logado aos 29 min, desconectado aos 31. |
| 8 | Dados das famílias ficavam no aparelho depois de sair. | Botão **Limpar aparelho**: sai da conta e apaga notas, planilhas, e-mail lembrado e o cache local do Firestore. |
| 9 | Regras do Firestore permissivas demais. | Dono único; `users/{uid}` só aceita o campo `notes` (até 3000 entradas); `users/{uid}/rotas/{id}` (rotas salvas do mapa) só com campos conhecidos, nome ≤ 60, ≤ 8 paradas; **todo o resto negado**. |
| 10 | OCR (tesseract.js) e idioma português vinham de CDN. | Agora em `vendor/tesseract/` (tesseract.js 5.1.1, core e `por.traineddata.gz`), sem blob nem CDN. Testado de verdade no Chromium com o CSP ativo: leu o texto de uma imagem. O CSP deixou de permitir cdnjs/jsDelivr/tessdata. |
| 11 | `icon-512.png.png` (nome duplicado) quebrava o ícone do PWA. | Renomeado para `icon-512.png`, como o `manifest.json` e o `sw.js` já esperavam. |

O service worker passou para `v56` (todo mundo baixa a versão nova).

## O que SÓ você pode fazer (fora do código)

1. **Publicar `firestore.rules`** no Console do Firebase e testar no *Playground de regras* (leitura/escrita do próprio uid: permitir; de outro uid, sem login, campo extra: negar). Não passou por emulador aqui.
2. **Restringir a chave de API do Firebase** ao seu domínio (Google Cloud Console → Credenciais → restrição de HTTP referrer). A chave no código é pública por natureza; a restrição impede uso por outros sites.
3. **Ativar o App Check** (reCAPTCHA Enterprise/v3) para o Firestore.
4. **Authentication:** ativar a *proteção contra enumeração de e-mails* e, se só a equipe usa, **desativar o cadastro aberto** (criar as contas você mesmo).
5. **Revisar o Worker do Paulus (IA)** em `paulus-ia.paulo-ae18.workers.dev`: o código dele não está no zip e não foi analisado. Confira limite de uso por IP, CORS só para o seu domínio e que ele não registra o texto das perguntas.

## Riscos que continuam

- O CSP mantém `'unsafe-inline'` (cerca de 87 `onclick` no HTML), então ele **não barra XSS sozinho**; por isso a causa (item 1) foi corrigida no código.
- xlsx-js-style embute o SheetJS 0.18.5, com falhas conhecidas ao **ler** planilhas feitas de propósito para explorar. Não há versão corrigida que mantenha os estilos de célula. Abra apenas planilhas de origem confiável (SICON/MDS).
- Firebase real e service worker foram testados só com módulos simulados. Depois de publicar, teste login, sincronização de notas, uma folha escaneada (OCR) e o modo offline. Se algo for bloqueado, o console do navegador mostra "Refused to…": acrescente o domínio na política (`<meta http-equiv="Content-Security-Policy">` no `index.html`).

## Como regenerar o CSS do Tailwind (quando criar classes novas)

```
npm i -D tailwindcss@3.4.17
npx tailwindcss --content "./index.html,./*.js" -i entrada.css -o tailwind.css --minify
```
(`entrada.css` contém só: `@tailwind base; @tailwind components; @tailwind utilities;`)

## Hashes SHA-384 das bibliotecas em `vendor/`

| arquivo | sha384 |
|---|---|
| `vendor/jspdf/jspdf.umd.min.js` | `7a7ff3b5f3d246419f304e0a226d398e8617ca7ab35206ec1b99ccae3ff11050075e47997cedf230af1043e98fee9d7f` |
| `vendor/jszip/jszip.min.js` | `fa66d5d88635664fd7d69fe75a5946c9225250df2e32cfa0500375d0eafde54047d1fa63e867ca80f9a00b911789e5c6` |
| `vendor/leaflet/leaflet.js` | `bb93389887b4dae48e4d3612853482bce8759a778b405e96a1d19107871c6205f1fcffdd46aee3889def02b136b4ad15` |
| `vendor/lucide/lucide.min.js` | `8499c5e40c22744d7c1925930061efdc1cb3cef7cd6754dcc79cb55145775a46aeb8c084cc1241312c12b7f3d43d79cc` |
| `vendor/pdf-lib/pdf-lib.min.js` | `c1e300070ae5b40ea3591f030def49a796e593eb59421eee8290ac177270480e7759933dff5e0f8d2e4b009347363008` |
| `vendor/pdfjs/pdf.min.js` | `ff5a940921b04eeafdbe37ffcfd966bbf7825186e93938128e6a5b310675fc2b57daffd670020aa91bfe5350d4086e9e` |
| `vendor/pdfjs/pdf.worker.min.js` | `4a7ccea1ba5130b5d9e76889bd99bf0b47d8c343907a64d7cd38c8b1db1f31cac2b4211ef6a833c537774529253b9c76` |
| `vendor/xlsx-js-style/xlsx.bundle.js` | `3945bd7aeb94cb1c87700853a9b848f88c9bf0b32cb17b7f729cf4c9786cf54586dbf47fb9a59d6a4c7fe1c7f0c3b55b` |
| `vendor/tesseract/tesseract.min.js` | `189a92bbbbee790f6a37413dc8b3dbdd6b6977b3ab80af0a998cc2f13d48cac1b56dcbf1bc83b8aad611fc3dc0f7dd45` |
| `vendor/tesseract/worker.min.js` | `cf19fe56aa1f1735e91fdf5d51bddf6b8cb0a1205024fcbaffaa046891cf95b9595ebe776b4835265ebbdb4be04b307b` |
| `vendor/tesseract/core/tesseract-core-lstm.wasm.js` | `10a598e490f0a61428cb186f614ede68273243411d57a7d92b72f6bf37d972fda272145d35dea94a7c963cdbfa7ccb91` |
| `vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js` | `60cd46fb3696632f554913f60b5d352c283387b9f71ea6fa3849bda83a196200800ec9e2de79c40ac902dd689a95007b` |
| `vendor/tesseract/lang/por.traineddata.gz` | `ef674dc769e2169b954f714404945ccd93969e8f4923f3a3967b4462fd35cbe42615ccad51cdaf63dfd7d706fa95028b` |

Origem: pacotes npm lucide@0.469.0, jspdf@2.5.2, pdf-lib@1.17.1, jszip@3.10.1, xlsx-js-style@1.2.0, pdfjs-dist@3.11.174, tesseract.js@5.1.1, tesseract.js-core@5.1.1, @tesseract.js-data/por@1.0.0, leaflet (já estava em `vendor/`).

O app agora só contacta de fora: Firebase (login/notas), fontes do Google, mapas/rotas (OpenStreetMap, OSRM, Nominatim, Overpass, Esri) e o Worker do Paulus.
