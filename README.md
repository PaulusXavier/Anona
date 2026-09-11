# Anona — Acompanhamento de Condicionalidades

> Ferramenta independente (não oficial), sem vínculo, afiliação ou endosso do Governo Federal, do Ministério do Desenvolvimento e Assistência Social (MDS) ou da Caixa Econômica Federal. "Bolsa Família" é usado aqui apenas para descrever o programa social cujas condicionalidades o app ajuda a acompanhar.

App simples (site estático) com:
- Calendário oficial de pagamentos do Bolsa Família 2026 por final do NIS;
- Prazos de saúde, educação, SICON e interrupção temporária;
- Bloco de anotações por dia, **sincronizado entre todos os seus dispositivos** via Firebase (Google), de graça.

Não precisa de servidor: você hospeda no próprio GitHub (GitHub Pages) e o Firebase cuida só do login e da sincronização das notas.

---

## 1. Estrutura dos arquivos

```
index.html                    -> o app inteiro (calendário + notas + login)
manifest.json                  -> permite "instalar" o app no celular/computador
sw.js                           -> deixa o app funcionando offline (guarda o "esqueleto" do app)
icon-192.png                    -> ícone do app (ilustração própria, sem uso de marca de terceiros)
icon-512.png                    -> ícone do app (versão maior)
firestore.rules                 -> regras de segurança (cole no console do Firebase)
```

**Importante:** os arquivos `icon-192.png` e `icon-512.png` têm que ficar **soltos na raiz do repositório, com esses nomes exatos** (não dentro de uma pasta `icons/` nem renomeados) — é assim que o `index.html`, o `manifest.json` e o `sw.js` procuram por eles. Se algum desses arquivos não for enviado ou for renomeado, a imagem correspondente simplesmente não aparece (o app continua funcionando normalmente, o `sw.js` já foi ajustado para não travar a instalação por causa disso).

Suba todos esses arquivos para a raiz do seu repositório no GitHub.

**Nota sobre a marca "Bolsa Família":** este projeto não usa mais o logotipo oficial do Programa Bolsa Família (arquivo `logo-bolsa-familia.png`, removido). O app usa apenas seu próprio ícone e cita o nome "Bolsa Família" de forma descritiva, para identificar o programa social acompanhado — sem qualquer logotipo, identidade visual oficial ou alegação de vínculo com o governo. Se você renomear também o repositório no GitHub (removendo "Bolsa Família" do nome/URL), evita ainda mais qualquer impressão de afiliação oficial.

---

## 2. Criar o projeto no Firebase (grátis)

1. Acesse **https://console.firebase.google.com** e entre com uma conta Google.
2. Clique em **Adicionar projeto**, dê um nome (ex: `anona-app`) e conclua a criação. Não precisa ativar o Google Analytics.
3. Dentro do projeto, clique no ícone **`</>`** ("Adicionar app da Web").
   - Dê um apelido, **não** marque Firebase Hosting (você vai usar o GitHub Pages).
   - O Firebase vai mostrar um bloco `firebaseConfig` parecido com este:
     ```js
     const firebaseConfig = {
       apiKey: "AIza...",
       authDomain: "anona-app.firebaseapp.com",
       projectId: "anona-app",
       storageBucket: "anona-app.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123456789:web:abcdef"
     };
     ```
   - **Copie esse bloco inteiro.**
4. Abra o arquivo `index.html`, procure por `SUBSTITUA pelos dados do SEU projeto Firebase` e troque o objeto `firebaseConfig` de exemplo pelo que você copiou.

### Ativar login por e-mail/senha
1. No menu lateral do Firebase, vá em **Build > Authentication**.
2. Clique em **Get started** (ou "Sign-in method").
3. Ative o provedor **E-mail/senha**.

### Criar o banco de dados (Firestore)
1. No menu lateral, vá em **Build > Firestore Database**.
2. Clique em **Criar banco de dados**.
3. Escolha **modo de produção** e a região mais próxima (ex: `southamerica-east1` — São Paulo).
4. Depois de criado, vá na aba **Regras** e cole o conteúdo do arquivo `firestore.rules` deste projeto. Clique em **Publicar**.

> **Se você já tinha o app publicado antes desta versão:** as regras mudaram (foi adicionada a subcoleção `repercussao`). Volte na aba **Regras** do Firestore e cole o `firestore.rules` atualizado de novo, senão o envio das planilhas de Repercussão vai dar erro de permissão.

Pronto — o Firebase está configurado. Isso é 100% grátis para uso pessoal (o plano gratuito do Firebase é bem generoso para um app individual).

---

## 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub (pode ser público ou privado) e suba todos os arquivos deste projeto (`index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `logo-bolsa-familia.png`, `firestore.rules`) soltos na raiz do repositório.
2. No repositório, vá em **Settings > Pages**.
3. Em "Source", escolha a branch `main` (ou `master`) e a pasta `/ (root)`.
4. Salve. Depois de 1–2 minutos, o GitHub mostra o link do seu site, algo como:
   `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`

---

## 4. Usando o app

- Abra o link em qualquer navegador (celular ou computador).
- Na tela inicial, **crie uma conta com e-mail e senha** (aba "Criar conta") ou entre com uma conta que já existe (aba "Entrar"). Esse login é obrigatório — é ele que protege o app, e é validado pelo próprio Firebase (Google), não por uma senha escrita no código do site.
- Depois de logado, toda anotação feita em um dia fica salva na nuvem — abra o mesmo site em outro celular, entre com o mesmo e-mail/senha, e as notas aparecem automaticamente.
- Esqueceu a senha? Use o link **"Esqueci minha senha"** na tela de login para receber um e-mail de redefinição.
- Digite o **final do seu NIS** na barra lateral para o calendário destacar automaticamente o seu dia de pagamento em cada mês.
- No celular, o navegador costuma oferecer **"Adicionar à tela inicial" / "Instalar app"** — isso instala o site como um app de verdade, com ícone próprio.

---

## 5. Sobre as informações do Bolsa Família incluídas

- Calendário de pagamentos por final do NIS: últimos 10 dias úteis de cada mês, com dezembro antecipado (encerra dia 23) — conforme calendário oficial MDS/Caixa 2026.
- Valor mínimo garantido por família: R$ 600 (Benefício Complementar).
- Benefício Primeira Infância: + R$ 150 por criança de 0 a 6 anos.
- Benefício Variável Familiar: + R$ 50 por gestante, nutriz, criança/adolescente de 7 a 18 anos incompletos.
- Necessidade de manter o Cadastro Único atualizado a cada 24 meses.
- Condicionalidades de saúde e frequência escolar.
- Prazo de 180 dias para sacar cada parcela.
- Canais oficiais: Disque Social MDS (121) e Central Caixa (111), além do app Caixa Tem.

**Atenção:** datas e valores podem mudar por decisão do governo ao longo do ano. Este app é uma ferramenta pessoal de organização — antes de qualquer decisão importante, confirme sempre no app oficial **Caixa Tem** ou no site **gov.br/mds**.

---

## 6. Funcionamento offline

Depois que o app for aberto **pelo menos uma vez com internet** (para baixar tudo: calendário, estilo visual, ícones e o gerador de PDF), ele passa a funcionar **totalmente offline**:

- O calendário, os prazos e o visual do app continuam aparecendo normalmente sem internet.
- Suas anotações continuam sendo salvas e lidas normalmente offline (ficam guardadas no aparelho e, quando a internet voltar, sincronizam sozinhas com a nuvem, se você estiver logado).
- A exportação em PDF também funciona sem internet.
- Assim que a internet voltar, o app aproveita para buscar a versão mais nova de tudo automaticamente (ver seção 7).

**Importante:** o primeiro acesso (a primeira vez que a pessoa abre o link) precisa ser com internet, para o aparelho baixar e guardar tudo. Depois disso, funciona offline normalmente — inclusive já instalado como app no celular.

## 7. Atualização automática do app

Toda vez que você editar `index.html` (ou qualquer arquivo) e subir a mudança para o GitHub, o app instalado no celular/computador das pessoas se atualiza sozinho, sem precisar desinstalar nada:

- Quando o app é aberto com internet, ele sempre busca a versão mais nova do `index.html` no servidor primeiro (e só usa a cópia salva localmente se estiver sem internet).
- Se o app já estava aberto e uma versão nova chega, ele recarrega a tela sozinho para mostrar a atualização.
- Ele também confere se há versão nova toda vez que o usuário volta a abrir o app (troca de aba, reabre o app no celular etc.).

Ou seja: você só precisa subir os arquivos atualizados no GitHub — não precisa avisar os usuários nem pedir para reinstalar.

**Exceção:** se um dia você trocar nomes de arquivos de ícones ou quiser forçar todo mundo a "limpar o cache" de uma vez (algo raro), edite o `sw.js` e aumente em 1 o número no final de `CACHE_NAME` (ex: de `"pbf-app-shell-v5"` para `"pbf-app-shell-v6"`). Isso não é necessário para atualizações normais de texto, calendário ou visual do app.

## 8. Repercussão de Condicionalidades (planilhas do MDS)

Na barra lateral do app, novo bloco **"Repercussão de Condicionalidades"**:

- Todo mês ímpar, quando o MDS mandar a planilha, clique em **"Enviar planilha (.xlsx)"** e selecione o arquivo.
- O app tenta identificar sozinho o mês e o ano pelo nome do arquivo (ex: `Repercussão_Setembro_de_2026...`); se não conseguir, ele pergunta.
- O arquivo fica guardado (sincronizado na nuvem, se você estiver logado — ou só neste aparelho, se não estiver) e aparece na lista, organizado por ano.
- A qualquer momento, clique no ícone de **download** para baixar o arquivo original de volta, ou no ícone de **lixeira** para apagá-lo.
- Use o filtro **"Todos os anos"** para ver só os arquivos de um ano específico.

**Limite:** por ser guardado no Firestore (plano gratuito), cada planilha precisa ter até ~900 KB. As planilhas de Repercussão normalmente ficam bem abaixo disso.

## 8.1 Divisão do Território Volante por técnico

Na barra lateral, bloco **"Território Volante — Divisão por técnico"**:

- Clique em **"Enviar tabela (.xlsx)"** e selecione a planilha de condicionalidades só do Território Volante (a primeira linha precisa ter os títulos das colunas).
- O app identifica a coluna do nome da família (procura por "Nome do Responsável Familiar"; se não achar, usa qualquer coluna com "nome"; se ainda não achar, usa a primeira coluna).
- As famílias são ordenadas de **A a Z** por esse nome e divididas em **três partes iguais** (se o total não for múltiplo de 3, as primeiras partes ficam com uma família a mais).
- O app baixa na hora uma planilha nova, **"Território Volante - Divisão por técnico.xlsx"**, com 4 abas:
  - **Resumo da divisão** — quantas famílias cada um recebeu e a faixa alfabética de cada parte.
  - **Paulo Xavier - Psicólogo** — 1ª parte (A→).
  - **Danilo Braga - Psicólogo** — 2ª parte (meio).
  - **Keomara Teles - Assistente Social** — 3ª parte (→Z).
- Nada é guardado na nuvem nem no aparelho — é só enviar e baixar. O arquivo original enviado não é alterado.

## 8.2 Relatório de Repercussão Individual

Na barra lateral, bloco **"Relatório de Repercussão Individual"**:

- Clique em **"Enviar tabela (.xlsx)"** e selecione qualquer tabela de condicionalidades que tenha uma coluna **"Efeito"** — pode ser o relatório bruto do MDS, a planilha já organizada por bairro (seção 8) ou a planilha dividida por técnico do Território Volante (seção 8.1), inclusive com todas as abas de técnicos juntas.
- O app baixa na hora um **PDF** com:
  - uma capa com o total de registros, o total de famílias distintas e a quantidade de cada efeito (Alerta, Bloqueio, Suspensão, Cancelamento...), além de um **gráfico de barras da quantidade de efeitos**;
  - o detalhamento completo, registro por registro, logo em seguida.
- **Todas as colunas ficam numa página só** (a página é mais larga, formato A3 deitado) — nada de colunas cortadas; já as **linhas continuam nas páginas seguintes** conforme necessário, com o cabeçalho da tabela repetido em cada página nova.
- Colunas totalmente vazias na planilha original são descartadas automaticamente, para não ocupar espaço à toa.
- Nada é guardado na nuvem nem no aparelho — é só enviar e baixar. O arquivo original enviado não é alterado.

## 8.3 Unificar Folhas de Família — Rota de Visita

Na barra lateral, bloco **"Unificar Folhas de Família — Rota de Visita"**:

- Envie as folhas resumo (**PDF**, uma por família) no **Bloco 1** (bairro Professora Araceli Souto Maior) e no **Bloco 2** (bairro 13 de Setembro). Limite: até **30 arquivos** e **50 MB** no total, somando os dois blocos (o contador no topo do bloco mostra quanto já foi usado).
- Use as setinhas ▲▼ ao lado de cada arquivo para colocá-lo na ordem em que você vai visitar aquela família dentro do bairro.
- Clique em **"Gerar PDF unificado da rota"**: o app junta tudo em um único PDF — capa com o endereço de partida e a quantidade de famílias por bloco, seguida do Bloco 1 completo (na ordem definida) e depois do Bloco 2 completo.
- Endereço de partida e nome/ordem dos blocos ficam nas constantes `UNIFICAR_PARTIDA` e `UNIFICAR_BLOCOS` no `index.html`, caso precise trocar de bairro ou de ponto de partida em outro dia.
- Nada é enviado à internet — a junção dos PDFs acontece no próprio aparelho, e os arquivos originais enviados não são alterados nem guardados.

## 8.4 Unificar Folhas de Família — Abrigos (Operação Acolhida)

Na barra lateral, bloco **"Unificar Folhas de Família — Abrigos (Operação Acolhida)"**:

- Envie as folhas resumo (**PDF**, uma por família) separadas por **abrigo** (Rondon 1, Rondon 5, PRA, Tuaronoko) e, dentro de cada abrigo, por **efeito**: Famílias em Alerta, Famílias em Bloqueio e Famílias Suspensas. Limite: até **60 arquivos** e **80 MB** no total, somando todos os abrigos e efeitos (o contador no topo do bloco mostra quanto já foi usado).
- Use as setinhas ▲▼ ao lado de cada arquivo para reordenar as famílias dentro de cada efeito.
- Clique em **"Gerar PDF unificado dos abrigos"**: o app junta tudo em um único PDF — capa com a quantidade de famílias por abrigo (já detalhada por efeito), seguida de cada abrigo (na ordem Rondon 1 → Rondon 5 → PRA → Tuaronoko) e, dentro de cada um, os três efeitos na ordem Alerta → Bloqueio → Suspensão.
- Nomes dos abrigos e dos efeitos ficam nas constantes `ABRIGO_UNIFICAR_ABRIGOS` e `ABRIGO_UNIFICAR_EFEITOS` no `index.html`, caso precise trocar algum nome (se adicionar ou remover abrigos/efeitos, é preciso também ajustar os blocos correspondentes no HTML, que usam um índice fixo = abrigo × 3 + efeito).
- Nada é enviado à internet — a junção dos PDFs acontece no próprio aparelho, e os arquivos originais enviados não são alterados nem guardados.

## 9. Personalizando

- Cores, textos e ícones: tudo está em `index.html` (é um arquivo único, fácil de editar).
- Para trocar o nome do app na tela inicial do celular, edite `name` e `short_name` em `manifest.json`.

---

## 10. Atualização anual (todo início de ano)

O app foi organizado para essa atualização ser rápida. Tudo o que muda de ano para ano fica junto, no topo do segundo bloco de código (`<!-- APP -->`) dentro do `index.html`. Abra o arquivo, procure por `ANO_VIGENTE` e siga os passos:

1. **Troque o número do ano**
   ```js
   const ANO_VIGENTE = 2026;
   ```
   Troque `2026` pelo novo ano (ex: `2027`). Isso já atualiza sozinho: o título da aba, a tela de senha, o cabeçalho, o rodapé, o nome/título do PDF exportado e o limite de navegação do calendário (o app só deixa passear pelos meses do ano vigente).

2. **Troque os três blocos de dados oficiais**, logo abaixo do `ANO_VIGENTE` (estão marcados com um comentário `EDITAR TODO INÍCIO DE ANO`). Pegue os dados novos no calendário oficial MDS/Caixa e nos comunicados de Condicionalidades do ano novo, e substitua:
   - **`monthHighlights`** — os destaques de cada mês (saúde, educação, SICON, interrupção) que aparecem no resumo do mês.
   - **`officialEvents`** — os prazos específicos por data (formato `"AAAA-MM-DD"`), de saúde/educação/SICON/interrupção.
   - **`paymentCalendar`** — as datas de pagamento por final do NIS. Cada mês (0=Janeiro a 11=Dezembro) tem uma lista de **10 números**, na ordem: NIS final **1, 2, 3, 4, 5, 6, 7, 8, 9, 0** — nessa ordem exata.

   Dica: é mais fácil apagar o conteúdo de dentro das chaves `{ }` de cada um desses três blocos e colar o novo, mantendo o mesmo formato de quem já está lá.

3. **Confira se os valores dos benefícios mudaram** (seção "Valores" na barra lateral, perto da linha 175 do `index.html`): o mínimo garantido (hoje R$ 600), o Benefício Primeira Infância (hoje + R$ 150) e o Benefício Variável Familiar (hoje + R$ 50). Se o governo reajustar esses valores, edite o texto diretamente ali.

4. **Suba o `index.html` atualizado no GitHub.** Como o app se atualiza sozinho (ver seção 7), todo mundo que já tem o app instalado vai receber a versão nova automaticamente, sem precisar reinstalar.

**Não precisa mexer em:** `manifest.json`, `sw.js` ou `firestore.rules` — nenhum desses depende do ano.

---

## 11. Segurança — o que foi revisado

O app foi revisado e alguns pontos foram corrigidos diretamente no código. Resumo:

### Login forte (mudança principal desta revisão)
- **A senha fixa do app ("Paulus"), que ficava escrita no código-fonte, foi removida.** Ela nunca poderia ser realmente escondida num site estático (qualquer pessoa com "Ver código-fonte" a encontrava), então em vez de tentar escondê-la melhor, ela foi eliminada.
- **A tela inicial agora é o próprio login por e-mail/senha do Firebase** — o mesmo que antes só existia para sincronizar notas. Não existe mais um jeito de abrir o app sem uma conta real: é preciso **Entrar** ou **Criar conta** logo na primeira tela.
- Essa senha é conferida pelo Firebase (servidor do Google), não por uma comparação de texto escondida no HTML — por isso ninguém consegue "ler o código" e descobrir ou contornar a senha de alguém.
- Consequência: o app deixou de ter o modo "usar só neste aparelho, sem conta". Toda pessoa que for usar o Anona agora precisa de uma conta (grátis) de e-mail/senha.

### Corrigido no código
- **Vazamento por trás da tela de acesso (corrigido):** os dados (notas, planilhas) só são carregados e exibidos depois que o Firebase confirma um login válido — nada é escrito no HTML da página antes disso.
- **Nomes de arquivo sem escape (corrigido):** a lista de planilhas de Repercussão trata o nome do arquivo com segurança antes de exibir, evitando que um nome de arquivo malicioso injete código na página.
- **Biblioteca de ícones sem versão fixa (corrigido):** o `lucide@latest` foi trocado por uma versão fixa (`lucide@0.469.0`), pra evitar que uma atualização não testada da biblioteca quebre o app de uma hora pra outra.
- **Botão de sair claro:** com o login único na entrada, o antigo botão de "Travar o app" (que só escondia a tela, sem sair da conta) foi removido — agora só existe "Sair da conta", que desconecta de verdade e volta para a tela de login.

### Já estava OK
- **Regras do Firestore** (`firestore.rules`): cada pessoa só lê/escreve os próprios dados (`request.auth.uid == userId`). Isso já garante que ninguém acessa notas ou planilhas de outra conta pelo banco de dados.
- O texto das notas já era exibido com escape (protegido contra injeção de código).

### Limitações que continuam existindo (importante saber)
- **A `apiKey` do Firebase aparece no código do site.** Isso é normal e esperado para apps desse tipo (não é uma senha secreta) — a proteção de verdade é feita pelas regras do Firestore e pela autenticação, que já estão corretas. Mesmo assim, para reforçar, você pode:
  1. No **Google Cloud Console** (console.cloud.google.com) → **APIs e Serviços > Credenciais**, abrir essa chave de API e restringir "Restrições de aplicativo" para aceitar apenas o domínio do seu GitHub Pages (`https://SEU-USUARIO.github.io/*`). Isso impede que alguém copie sua chave e a use em outro site.
  2. Ativar **2 fatores (2FA)** na conta Google usada no Firebase — essa conta é o verdadeiro "cofre" de tudo: quem tiver acesso a ela, acessa o console e os dados de todo mundo que criou conta.
- **Como as notas podem conter dados sensíveis de famílias atendidas**, vale reforçar: use uma senha forte e exclusiva na sua conta de login, não compartilhe suas credenciais com ninguém, e sempre use "Sair da conta" ao terminar de usar num computador que não é só seu (biblioteca, órgão público etc.).
