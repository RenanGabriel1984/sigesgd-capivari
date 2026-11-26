# Freebuff ↔ GitHub — conexão e fluxo de trabalho

Documento de registro da integração do workspace Freebuff com o repositório oficial
`RenanGabriel1984/sigesgd-capivari`.

## Fonte oficial

O GitHub é a fonte oficial do código. O workspace Freebuff foi importado a partir de
`main` (`937437e`) e não mantém conteúdo próprio: nenhuma alteração local é publicada
sem passar por branch + Pull Request.

## Conexão

- Conector oficial do Freebuff: **GitHub** (autorização OAuth da conta `RenanGabriel1984`).
- Permissões efetivas verificadas no repositório: `admin`, `maintain`, `push`, `pull`.
- Nenhum token, chave ou senha é armazenado no repositório ou em arquivos do projeto.

## Fluxo obrigatório

1. Desenvolvimento sempre em branch de trabalho (`freebuff/*`, `codex/*`), nunca em `main`.
2. Commits enviados apenas para a branch de trabalho.
3. Integração com `main` exclusivamente por Pull Request, com revisão manual.
4. Merge nunca é automático: é decisão do proprietário do repositório.

## Proteções em vigor

- **Guarda local `pre-push`**: bloqueia push direto para `main`/`master` e force-push.
- **`push.default = current`**: `git push` envia apenas a branch atual, com o mesmo nome.
- **CI de produção**: `.github/workflows/convex-production.yml` publica funções no backend
  oficial (`savory-sockeye-292`) **somente em push para `main`**, ou seja, apenas após
  merge aprovado. Pull Requests não disparam publicação de produção.
- **Homologação**: `.github/workflows/convex-homologacao.yml` é `workflow_dispatch` manual.

## Limitações conhecidas

- O conector do Freebuff expõe operações de repositório via API (branches, commits,
  Pull Requests), mas **não injeta credencial de git** no shell do workspace. Assim,
  `git push` por HTTPS/SSH continua indisponível; o envio de conteúdo é feito pelas
  operações de API do conector.
- `git fetch`/leitura continua funcionando normalmente (repositório público).
- A branch `main` **não possui regras de proteção no GitHub**. A proteção existente é a
  guarda local e o workflow de CI. Recomenda-se habilitar branch protection em
  `main` (exigir Pull Request e impedir force-push) como defesa adicional no servidor.

## Ambientes Convex

Este documento e o fluxo de Pull Request não alteram dados, variáveis, deployments ou
configurações dos ambientes Convex. Nenhum comando de deploy ou migração é executado
fora dos workflows oficiais aprovados.
