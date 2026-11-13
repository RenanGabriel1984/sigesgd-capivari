# Regularização de área e local físico — aviso de versão

Este arquivo contém instruções históricas e está **obsoleto**. Ele ainda cita a antiga mutation `applyAuditedInitialStockRegularization` e uma confirmação que não corresponde ao código atual.

**Não execute comandos, mutations ou passos deste documento.**

A única referência operacional vigente é:

- `docs/REGULARIZACAO_AREA_LOCAL.md` — escopo, pré-condições, validações, invariantes e fluxo de prévia/aplicação;
- `src/convex/stockRegularization.ts` — implementação atual, com prévia somente leitura e aplicação protegida;
- `src/lib/stock-regularization-manifest.ts` — manifesto de origem usado pela pré-validação.

A aplicação da regularização permanece bloqueada até que o deployment de destino seja confirmado, o schema esteja publicado nele, a prévia seja conferida e o responsável autorize expressamente a execução. Nenhuma regularização foi executada nesta branch.
