# Homologação da Fase de Entradas — R32.0

Documento operacional do ambiente isolado do SIGESGD Capivari.
Regra mestra: **nada de produção** — sem deploy de funções para o backend em uso,
sem mutação de dados oficiais, sem confirmação de notas reais.

> **Mapa atualizado em 12/11/2026, confirmado pelo proprietário do SIGESGD.**
> Esta seção prevalece sobre referências históricas a previews antigos mais abaixo.

## Mapa correto dos ambientes

| Projeto Convex | Ambiente no painel | Deployment | Papel atual |
|---|---|---|---|
| `sigesgd-capivari-homologacao` | Production | `tame-alligator-797` | **Backend persistente de homologação**; destino único para o Preview isolado |
| `sigesgd-capivari-homologacao` | Development (Cloud) | `first-dinosaur-625` | Desenvolvimento separado; não usar como backend do Preview atual |
| `sigesgd-capivari` | Production | `savory-sockeye-292` | Slot Production do projeto principal; não presumir que contém os dados operacionais atuais |
| `sigesgd-capivari` | Development (Cloud) | `first-herring-264` | **Banco operacional atual**: o Freebuff carrega os dados utilizados pelo SIGESGD aqui. Preservar integralmente |
| `sigesgd-capivari` | Preview — `codex/stabilizacao-seguranca` | `first-starling-943` | Preview de branch do projeto principal; não é a homologação persistente |
| `sigesgd-capivari` | Preview — `codex/stock-areas-phase1` | `brilliant-bullfrog-982` | Preview antigo de outra branch; não é a homologação atual |

### Regras de proteção

- O nome/tipo `Development` do Convex não significa que o deployment esteja sem dados ou possa ser descartado. `first-herring-264` é a base operacional atual confirmada pelo proprietário.
- Não trocar automaticamente o app para `savory-sockeye-292`. Uma eventual migração do banco operacional para o slot Production exige plano, reconciliação, backup/restauração e autorização específica.
- O frontend de homologação deste projeto Vercel deve usar somente `tame-alligator-797.convex.cloud`.
- Builds de homologação devem recusar `savory-sockeye-292`, `first-herring-264`, `first-starling-943`, `brilliant-bullfrog-982` e `first-dinosaur-625`.
- Nenhum dos deployments do projeto principal pode ser usado como atalho para homologação.

---

## 1. Situação verificada em 03/11/2026

| Item | Valor verificado |
|---|---|
| Projeto Convex | `sigesgd-capivari` (time `raygabrielrmg`) |
| Deployment da deploy key do ambiente | `dev/raygabrielrmg` → `first-herring-264.convex.cloud` (tipo **dev**) |
| Backend usado pelo preview/dev | `first-herring-264.convex.cloud` (mesmo deployment) |
| Deployment de homologação/staging | **não confirmado** — não é possível listar deployments com deploy key |
| `VITE_APP_ENV` | não definido no ambiente → build publicado se identifica como `producao` |
| Build R31.9 (produção) | entry `index-BHZdxdWF.js` (após R32), `Entries-*` em chunk próprio |
| Criação de deployment pela CLI | **bloqueada**: `Creating a deployment isn't supported with a deploy key` |

O backend atual é um deployment de **desenvolvimento** que, na prática, guarda a
carga oficial (produtos, entradas, organizações). Por isso ele é tratado aqui
como **produção operacional**: nenhuma escrita foi feita nele.

### Achado que bloqueava a homologação (corrigido no R32.0)

`src/main.tsx` tinha a URL do Convex **fixa no código**
(`https://first-herring-264.convex.cloud`), por decisão anterior para resistir a
`VITE_CONVEX_URL` desatualizado injetado no build. Consequência: **nenhum build**
conseguiria apontar para um backend isolado — um "homolog" com rótulo de
homologação continuaria lendo/gravando no backend oficial.

Correção mínima (sem mudar fluxos): `src/lib/convex-url.ts` resolve a URL.

- produção (padrão): sempre o deployment oficial — `VITE_CONVEX_URL` é ignorado;
- homologação (`VITE_APP_ENV=homologacao`): `VITE_CONVEX_URL` é **obrigatória**,
  precisa ser `https://*.convex.cloud` e **não pode** ser o host oficial;
  sem isso a build falha fechada (erro explícito, sem tocar no banco oficial).

O mesmo resolvedor alimenta o diagnóstico da DANFE (`backend` exibido = backend
realmente usado pelo cliente Convex).

---

## 2. Ações que dependem do proprietário da conta

Nada aqui exige colar segredo no chat — todas as ações são no painel/CLI dele.

### 2.1 Criar o deployment isolado

1. Acessar <https://dashboard.convex.dev/t/raygabrielrmg/sigesgd-capivari>.
2. **Settings → Deployments → Create deployment**.
3. Preferência (staging persistente): nome `staging`, tipo **Production**
   (deployment próprio, sem `--default`, para não virar o destino de
   `convex deploy`); alternativa mais barata: tipo **Development** com nome
   `homolog`, expiração `none`.
4. Anotar a URL `https://<nome-do-deployment>.convex.cloud`.

### 2.2 Criar deploy key restrita ao staging

```bash
bunx convex deployment token create homolog-build --deployment staging
```

A chave é específica do staging. **Nunca** usar a chave de produção.

### 2.3 Publicar as funções **apenas** no staging

```bash
CONVEX_DEPLOY_KEY=<chave-do-staging> bunx convex deploy
```

Confirmar no cabeçalho do comando que o destino é o deployment de staging.

### 2.4 Gerar o frontend de homologação

```bash
VITE_CONVEX_URL=https://<staging>.convex.cloud \
VITE_APP_ENV=homologacao \
bun scripts/build-homolog.mjs
```

O script (`scripts/build-homolog.mjs`):

- recusa host oficial, URL não-Convex, `http://` e `VITE_APP_ENV` diferente de `homologacao`;
- valida com o **mesmo** resolvedor do app (`src/lib/convex-url.ts`);
- roda `tsc -b --noEmit` e `vite build --outDir dist-homolog`;
- confere no bundle final que o host de homologação foi embutido e que o rótulo
  `homologacao` existe;
- imprime `build`, `backend`, `ambiente` e `versão`;
- não publica, não faz deploy de funções, não executa mutação.

`--dry-run` valida a configuração sem compilar.

### 2.5 Publicar em URL separada da produção

Servir `dist-homolog/` em host estático próprio (Vercel/Netlify/hosting interno),
com domínio ou rota de teste. Não reutilizar o domínio de produção e não publicar
`dist-homolog` no ambiente oficial.

### 2.6 Comprovação obrigatória antes de considerar "pronto"

No app de homologação: **Entradas → Importar DANFE → Diagnóstico técnico** deve
mostrar `ambiente homologacao`, `build <hash>`, `backend <staging>.convex.cloud`
e `versão 0.7.0`. Se qualquer item divergir, **não homologar**.

---

## 3. Estratégia de dados fictícios (somente no staging)

Criar pelo próprio app, no backend de staging, depois que ele estiver no ar.
Nenhum dado real, nenhum dado pessoal, nenhum CNPJ de fornecedor existente.

### 3.1 Cadastros-base

| Tipo | Nome | Campos |
|---|---|---|
| Categoria | `Periféricos (homolog)` | — |
| Categoria | `Papelaria (homolog)` | — |
| Local | `Almoxarifado Homolog A` | prédio/andar fictícios |
| Local | `Depósito Homolog B` | — |
| Fornecedor | `Fornecedor Homologação Alfa Ltda` | CNPJ `11.222.333/0001-81`, e-mail `alfa@homolog.invalid`, telefone `(19) 0000-0000` |
| Fornecedor | `Fornecedor Homologação Beta ME` | CNPJ fictício validado pelo app, e-mail `beta@homolog.invalid` |
| Produto | `Teclado USB Slim — Homolog` | unidade `pc`, categoria Periféricos |
| Produto | `Mouse Óptico USB — Homolog` | unidade `pc`, categoria Periféricos |
| Produto | `Papel A4 75g — Homolog` | unidade `pct`, categoria Papelaria |

> Usar sufixo `— Homolog` em todos os nomes para que qualquer registro criado
> nesse ambiente seja reconhecível e jamais confundido com item oficial.

### 3.2 Nota fiscal fictícia (para a conferência)

| Campo | Valor |
|---|---|
| Número / série | `9001` / `900` |
| Emissão | `02/11/2026` |
| Fornecedor | Fornecedor Homologação Alfa Ltda |
| Chave de acesso | 44 dígitos fictícios iniciando por `9999`, gerada só para teste |
| AF / processo / empenho | `9001/2026` / `HOMOLOG-2026-001` / `9001/2026` |
| Item 1 | cód. `HOM-001`, Teclado USB Slim — Homolog, NCM `84716053`, CST `0102`, 10 PC × R$ 49,90 = R$ 499,00 |
| Item 2 | cód. `HOM-002`, Mouse Óptico USB — Homolog, NCM `84716053`, CST `0102`, 10 PC × R$ 24,90 = R$ 249,00 |
| Total | R$ 748,00 |
| Lote do fornecedor | `HOMOLOG-LOTE-01` |

Preparar também um XML fictício com os mesmos itens (para testar o caminho XML)
e uma entrada **manual** com um item sem código do fornecedor (para testar a
associação manual).

### 3.3 Regras

- Nenhuma confirmação de entrada na preparação (R32.0): a confirmação é etapa
  da homologação, com clique explícito e apenas no staging.
- Não importar XML/DANFE reais de fornecedores reais.
- Se o staging for recriado, os cadastros acima são recriados do zero — não
  exportar dados do backend oficial para ele.

---

## 4. Roteiro de homologação da Fase de Entradas

1. Importar DANFE/PDF fictícia → conferência abre, associações corretas.
2. Importar XML fictício → mesmos totais.
3. Itens sem associação → **Avançar para resumo** bloqueia, aponta a linha e rola até ela.
4. Associar manualmente e criar um produto novo pelo cadastro rápido (categoria nova).
5. **Avançar para resumo** → resumo confere nota, fornecedor, chave, AF/processo/empenho, itens, local, lote e total.
6. **Voltar para produtos** → dados preservados; **Cancelar** encerra sem gravar.
7. **Confirmar entrada** (clique explícito) → entrada criada, estoque e lote atualizados no staging.
8. Repetir o mesmo XML → duplicidade detectada, sem entrada nova.
9. Entrada manual → mesmo fluxo de resumo/confirmação.
10. Diagnóstico técnico comprovando `ambiente homologacao`, `build`, `backend` e `versão`.

---

## 5. Estado da entrega R32.0

- **Ambiente Convex de homologação existe?** Sim: projeto separado
  `sigesgd-capivari-homologacao`, com Production `tame-alligator-797` e
  Development `first-dinosaur-625`.
- **Frontend Preview atual existe?** Sim: deployment
  `dpl_AR2fkKVbBQYFJEM6EWbGEtTYAqXt`, commit `5ec6089`, estado READY:
  https://sigesgd-capivari-homologacao-36tw0my1r.vercel.app.
- **Backend de homologação atualizado?** Sim: workflow #1, tentativa 3,
  concluído com sucesso em 12/11/2026. O CLI confirmou
  `Schema validation complete` e
  `Deployed Convex functions to https://tame-alligator-797.convex.cloud`.
- **Escopo do deploy:** somente funções/schema do projeto e deployment
  `sigesgd-capivari-homologacao/tame-alligator-797`; não executou seeds,
  importações de DANFE ou mutations de negócio.
- **Testes de autorização de anexos em runtime?** Pendentes de sessão
  autenticada no Preview. A bateria automatizada local/CI cobre políticas de
  proprietário, leitura e reassociação; isso não substitui o teste real
  integrado após a publicação.
- **Produção/projeto principal modificados?** Não: nenhum deploy de funções,
  mutação, limpeza, migração ou confirmação de nota foi executado em
  `savory-sockeye-292` ou no backend operacional `first-herring-264`.


---

## 6. Atualização da homologação — 11/11/2026

### Backend Convex

- O Vercel criou o deployment de Preview associado à branch `codex/stock-areas-phase1`.
- Deployment: `brilliant-bullfrog-982`.
- URL: `https://brilliant-bullfrog-982.convex.cloud`.
- O comando `convex deploy` concluiu com sucesso e confirmou a publicação das funções.
- O log confirmou a inclusão dos índices das tabelas do módulo de água (`waterParticipants`, `waterPeriods`, `waterReceipts`, `waterShares`, `waterPayments` e `waterContainerMovements`).
- Nenhuma publicação no backend de produção foi solicitada ou realizada nesta etapa.

### Configuração de build no Vercel (Preview)

A branch de homologação precisa usar o script `scripts/build-homolog.mjs`, pois ele gera e valida especificamente `dist-homolog/`.

Build Command esperado:

```bash
if [ "$VERCEL_ENV" = "preview" ] && [ "$VERCEL_GIT_COMMIT_REF" = "codex/stock-areas-phase1" ]; then npx convex deploy --cmd "bun scripts/build-homolog.mjs" --cmd-url-env-var-name VITE_CONVEX_URL; else bun run build; fi
```

Output Directory do projeto de homologação: `dist-homolog`.

Variáveis esperadas no Preview:
- `CONVEX_DEPLOY_KEY`: segredo Preview criado para a homologação; nunca registrar seu valor neste documento.
- `VITE_APP_ENV=homologacao`.
- `VITE_CONVEX_URL`: injetada pelo comando `convex deploy` durante a compilação; deve resolver para o backend de Preview, nunca para o backend oficial.

### Diagnóstico do build

Um build anterior executou `bun run build`, gerou `dist/` e falhou porque o projeto Vercel procurava `dist-homolog/`. A correção é executar `scripts/build-homolog.mjs` na condição de Preview da branch indicada. O build final de frontend ainda precisa alcançar status `Ready` antes dos testes de interface.

### Limites de segurança

- Não alterar as variáveis de Production.
- Não usar Promote nem publicar o frontend no domínio oficial.
- Não executar seeds, importações ou mutações de dados reais.
- Testes funcionais atuais devem usar exclusivamente o backend persistente
  `tame-alligator-797` e registros fictícios identificados como homologação.
  A referência a `brilliant-bullfrog-982` abaixo é histórica e descreve um
  Preview de outra branch, não o destino atual.


## 7. Atualização de autenticação do Preview — 11/11/2026

Naquele momento, o Preview de branch `brilliant-bullfrog-982` recebeu funções
do projeto e tabelas do módulo de água. O frontend chegou a gerar build válido
(versão 0.7.0, build `72b8d79`). Esse deployment é agora identificado como
Preview da branch antiga `codex/stock-areas-phase1`; não é o destino da
homologação persistente atual.

**Bloqueio atual:** a emissão de sessão pelo Convex Auth no Preview falha com `Missing environment variable JWT_PRIVATE_KEY`. O usuário administrador de homologação foi criado somente no banco isolado, mas não consegue concluir o login enquanto a chave de assinatura não existir nesse deployment.

- Este erro pertence ao Preview e não comprova falha de senha nem de usuário na produção.
- As credenciais de produção não são compartilhadas com o banco de homologação.
- Não copiar a chave de produção para Preview e não alterar variáveis do ambiente Production.
- A homologação permanece **não aprovada para operação** até a configuração segura da chave exclusivamente no deployment de Preview e a repetição dos testes de login.
- Nenhuma chave foi gerada, exibida ou alterada durante a auditoria desta branch.


## Publicação das funções em homologação — 12/11/2026

- Workflow: `Convex — publicar funções em HOMOLOGAÇÃO`, execução #1, tentativa 3, GitHub Actions run `43288626841`.
- Resultado: `success`.
- As guardas validaram a deploy key como `prod:tame-alligator-797` sem imprimir o segredo.
- O log confirmou o alvo `tame-alligator-797`, upload das funções, `Schema validation complete` e a mensagem final de publicação no host correto.
- O projeto principal e o backend operacional não foram alvo.
- A validação de permissões/contexto de anexos via sessão autenticada do aplicativo continua pendente; não declarar a homologação funcional integral até concluir esses testes.
- Preview utilizado: `https://sigesgd-capivari-homologacao-36tw0my1r.vercel.app` (deployment `dpl_AR2fkKVbBQYFJEM6EWbGEtTYAqXt`, commit `5ec6089`).
