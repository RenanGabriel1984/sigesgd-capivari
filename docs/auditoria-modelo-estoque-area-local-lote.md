# Auditoria do modelo de estoque por área, localização e lote

Data: 17/11/2026  
Branch auditada: `codex/rbac-audit-hardening`  
Escopo: leitura do código; nenhuma consulta/mutation foi executada contra Convex e nenhum dado real foi alterado.

## 1. Estado atual confirmado

O modelo atual mantém três níveis que não formam uma única fonte de verdade:

- `stock`: saldo físico e reservado agregado por produto.
- `stockByLocation`: saldo agregado por produto e local físico, sem área e sem lote.
- `lots`: saldo disponível por lote e área (`areaId`), mas sem localização física.

`entryItems` registra `locationId` e liga o item ao lote, mas esse vínculo representa o local informado na entrada; não acompanha de forma transacional o lote quando o material é transferido, consumido, devolvido ou contado.

Portanto, hoje não é possível reconstruir com segurança o saldo de cada combinação produto × área × local × lote apenas consultando essas tabelas.

## 2. Achados por operação

| Operação | Comportamento observado | Consequência |
|---|---|---|
| Confirmação de entrada (`entries.confirm`) | Cria lote com `areaId` e quantidade; soma no saldo global e, se informado, no saldo do local. | A entrada sem local aumenta o global e o lote, mas não cria saldo por local. |
| Transferência (`stockTransfers.create`) | Move quantidade entre linhas de `stockByLocation`; quando `lotId` é informado, também subtrai a quantidade de `lots.quantityAvailable`. | Uma transferência física pode reduzir a disponibilidade total do lote sem reduzir o saldo global. Não existe registro de quanto daquele lote ficou em cada local. |
| Saída rápida (`quickExit`) | Consome lotes por FIFO global e reduz o saldo do local selecionado separadamente. | Pode consumir lote que não está no local escolhido; a seleção do lote não é conciliada com a localização. |
| Entrega de requisição (`requests.deliver`) | Reduz global/reservado e consome lotes por FIFO global. | A requisição não fixa área/local de origem e a baixa não é distribuída por localização. |
| Troca GomaQ (`gomaQ.createExchange`) | Reduz global e consome FIFO global; preserva a regra de troca/carcarças. | Não vincula o consumo a área/local e grava somente um lote no cabeçalho mesmo quando o FIFO pode consumir vários. |
| Devolução (`returns.create`) | Restaura global, local opcional e lote resolvido pela saída. | Sem alocação por lote/local, pode devolver o lote a um local diferente daquele de origem sem trilha de saldo por combinação. |
| Inventário (`inventory.close`) | Ajusta saldo global ou saldo agregado do local. | Não ajusta a quantidade dos lotes; após contagem, lote e saldo físico podem divergir. |
| Estorno de entrada (`entries.reverse`) | Ajusta global/local e inativa os lotes da entrada. | A validação usa o agregado do produto/local, não a quantidade remanescente específica do lote. |

## 3. Inconsistência adicional de identificação de lote

O campo `stockMovements.lotId` é texto livre (`v.optional(v.string())`) e não tem semântica uniforme:

- confirmação de entrada grava o número do lote (`lotNumber`);
- saída rápida grava o ID do documento do lote quando só um lote foi consumido;
- devolução grava o número do lote;
- outras operações podem não preencher o campo ou registrar apenas um dos lotes consumidos.

Além disso, `requestItemLots` já existe e permite relacionar item de requisição a vários lotes, mas não resolve a distribuição por localização física.

Isso impede tratar o campo histórico `stockMovements.lotId` como uma referência confiável para backfill automático.

## 4. Modelo-alvo recomendado

Adotar uma única tabela de alocação física por lote/local, por exemplo `lotLocationBalances`, com:

- `productId`, `areaId`, `lotId`, `locationId`;
- `quantity` (saldo físico naquela combinação);
- `reservedQuantity` ou vínculo explícito às reservas por lote/local, caso reservas passem a ser dimensionadas;
- datas de criação/atualização e índices para produto, área, lote e localização.

Regras fundamentais:

1. A área é herdada do lote e não pode ser alterada por uma transferência entre armários.
2. A soma das alocações de um lote/local deve reconciliar com o saldo físico remanescente daquele lote.
3. A soma das alocações de todos os lotes deve reconciliar com o saldo por produto/local.
4. A soma por produto/área/local deve reconciliar com o saldo global do produto.
5. Transferência move alocação de lote entre locais; não consome quantidade total do lote nem altera o saldo global.
6. Saídas, requisições e GomaQ consomem alocações elegíveis da área/local escolhidos, com FIFO dentro desse escopo.
7. Devolução restaura a alocação rastreável da saída; quando o local de retorno for diferente, registra a movimentação entre locais.
8. Inventário deve contar e ajustar produto/lote/local; diferenças sem identificação de lote devem ficar em fila de conciliação, não ser distribuídas automaticamente.
9. `stock` e `stockByLocation` tornam-se projeções agregadas compatíveis durante a transição; não devem ser uma segunda fonte independente de saldo.

## 5. Migração segura — não executar automaticamente

Os dados existentes não permitem inferir todas as alocações históricas. O plano deve ser dividido:

### Fase A — diagnóstico somente leitura

Criar relatório que, por produto e lote, mostre:

- saldo global (`stock`);
- soma por local (`stockByLocation`);
- soma dos lotes (`lots.quantityAvailable`);
- áreas dos lotes;
- entradas e locais declarados nos `entryItems`;
- transferências com e sem `lotId`;
- movimentações com `lotId` como ID válido, número de lote ou valor não resolvido;
- requisições/devoluções/inventários que não têm dimensão suficiente para atribuição;
- diferenças e quantidades sem classificação segura.

O relatório deve classificar cada unidade como migrável com evidência, ambígua ou sem evidência. Não deve gravar, corrigir ou completar nenhum dado.

### Fase B — implantação aditiva

Adicionar tabela, índices, funções puras de reconciliação e consultas de leitura. Não preencher saldos legados automaticamente nesta fase.

### Fase C — entrada controlada de novas operações

Passar a gravar alocações em entradas novas e integrar transferências, saídas, devoluções, requisições, GomaQ e inventários. Manter as projeções agregadas reconciliadas na mesma mutation transacional.

### Fase D — reconciliação assistida do legado

Apresentar divergências para decisão humana. Só criar alocações legadas quando houver evidência documental/operacional suficiente (entrada, lote, local, transferência e histórico). Quantidades ambíguas permanecem explicitamente pendentes; não inventar local ou lote.

### Fase E — leitura principal e encerramento da transição

Após testes e reconciliação comprovada, fazer as consultas/telas lerem do novo modelo. Manter compatibilidade histórica e trilha de auditoria.

## 6. Critérios obrigatórios de aceite

- Transferência não altera saldo global nem quantidade total remanescente do lote.
- Transferência só move quantidade disponível da combinação origem/lote/local para destino.
- Nenhuma saída consome lote fora da área/local selecionados.
- Nenhuma operação deixa saldo negativo, nem cria alocação sem lote/local válido.
- Inventário por local não altera lotes de outros locais nem áreas diferentes.
- Devolução restaura a alocação correta e respeita a quantidade efetivamente retirada na saída.
- Somatórios por lote, produto/local, produto/área e produto global reconciliam.
- Todas as operações mantêm auditoria com usuário, horário, origem, destino, lote, área e quantidade.
- Testes de regressão cobrem dados legados incompletos e operações sem localização.
- Nenhum backfill é executado em produção sem plano, relatório revisado e autorização explícita.

## 7. Próxima implementação

A próxima entrega técnica deve ser a Fase A: uma query/relatório de diagnóstico somente leitura e testes unitários das regras de reconciliação. Em paralelo, a correção da transferência deve impedir que uma movimentação entre armários seja tratada como consumo do lote; a implementação completa dessa correção depende da alocação lote/local, para não fingir que a origem do lote é conhecida quando o legado não a registra.
