# Modelo-alvo de rastreabilidade do estoque por lote e armário

**Status:** integração do livro-razão de saídas em validação na branch `codex/stock-read-model-integrity`. Entradas novas, carga inicial nova, transferências, devoluções e saídas FIFO centrais foram integradas em código; o CI ainda precisa aprovar a revisão mais recente e os fluxos de inventário/reconciliação legada permanecem pendentes.  
**Restrição operacional:** qualquer migração de dados reais depende de autorização explícita; esta especificação não autoriza execução em produção.

## 1. Situação encontrada

O banco atual mantém três visões que não são equivalentes:

- `stock`: saldo físico e reservado por produto.
- `stockByLocation`: saldo físico por produto e armário/local.
- `lots`: saldo disponível por produto e área, mas sem localização física atual.

`entryItems.locationId` identifica o armário informado no recebimento. Não é suficiente para representar a localização atual depois de transferências, especialmente quando apenas parte de um lote muda de armário.

Por isso, o relatório da etapa anterior apresenta separadamente:
- o total físico por armário, vindo de `stockByLocation`;
- o saldo disponível por área e lote, vindo de `lots`.

Não se deve inferir que o armário de recebimento continua sendo o armário atual.

## 2. Estrutura proposta

A tabela `lotLocationBalances` foi adicionada ao schema nesta fase, com um registro por combinação **lote × localização física**:

| Campo | Finalidade |
| --- | --- |
| `lotId` | Lote ao qual o saldo pertence |
| `productId` | Produto, duplicado intencionalmente para indexação e validação |
| `locationId` | Armário/local físico atual |
| `quantityAvailable` | Quantidade disponível daquele lote naquele local |
| `updatedAt` | Data/hora da última alteração |

A área continua pertencendo ao lote (`lots.areaId`), evitando manter duas classificações independentes para o mesmo lote. A visão por área é agregada por `lots.areaId`.

Índices necessários:
- `by_lot`: localizar todos os locais de um lote;
- `by_product_location`: localizar todos os lotes de um produto em um armário;
- `by_product`: conciliações e relatórios.

A unicidade lógica de `lotId + locationId` deve ser garantida na camada de mutation, pois um índice Convex comum não impõe unicidade.

Também foi adicionada a tabela `stockMovementLotAllocations`, vinculando cada movimentação a **todos** os lotes e armários que participaram, com quantidade e tipo da alocação (`withdrawal` ou `reclassification`). O campo legado `stockMovements.lotId` continua disponível para compatibilidade e aponta para um lote principal quando aplicável; relatórios e devoluções devem usar a tabela de alocações para rastreabilidade completa.


## 3. Invariantes obrigatórios

Para cada produto:

1. `stock.physicalQuantity = soma(stockByLocation.quantity)`.
2. `stock.physicalQuantity = soma(lotLocationBalances.quantityAvailable)`.
3. Para cada armário, `stockByLocation.quantity = soma(lotLocationBalances.quantityAvailable)` daquele produto e armário.
4. Para cada lote, `lots.quantityAvailable = soma(lotLocationBalances.quantityAvailable)` daquele lote.
5. Para cada área, o saldo é a soma dos lotes ativos/disponíveis classificados naquela área.
6. `0 <= stock.reservedQuantity <= stock.physicalQuantity`.
7. Toda baixa deve identificar os lotes e os locais de onde a quantidade foi consumida.
8. Transferência entre armários não altera o saldo global, o saldo total do lote nem a área do lote.

As mutations devem atualizar os registros envolvidos em uma única transação Convex. Se uma validação falhar, nenhuma parte da operação pode ser persistida.

## 4. Regras por fluxo

### Recebimento
**Implementado para novas entradas com localização:** ao confirmar uma entrada com locationId, o fluxo cria/atualiza o saldo do lote naquele armário. Entradas sem local continuam sem localização presumida. A carga inicial nova também cria `lotLocationBalances` no armário informado e grava `locationId` no movimento de implantação.

**Importante para o estoque já existente:** o inventário inicial já realizado e a DANFE de toners da GomaQ não são recriados nem alterados por estas mudanças. Como foram registrados antes da adoção integral do livro-razão, podem não possuir linhas em `lotLocationBalances`; o novo diagnóstico apenas identifica candidatos e divergências, sem gravar ou migrar dados.

### Saídas, requisições e consumos
**Integrado em código na branch:** existe um serviço compartilhado que calcula FIFO por `receivedAt` e consome exclusivamente do armário escolhido. Ele valida duplicidades, quantidades inválidas e conciliação integral entre lote × armários e `stockByLocation` antes de gravar. A mutation Convex aplica atomicamente a baixa em `lotLocationBalances`, `lots.quantityAvailable`, `stockByLocation.quantity` e, na chamadora, `stock.physicalQuantity`.

Os fluxos conectados são: saída rápida (`stockSetup.quickExit`), saída direta (`stockMovements.createExit`), entrega de requisições (`requests.deliver`), troca GomaQ (`gomaQ.createExchange`), retirada unitária e por família de suprimentos (`printSupplies.withdraw`/`withdrawFamily`) e instalação de peças (`assetParts.installPart`). Cada saída já grava alocações estruturadas de todos os lotes consumidos na tabela `stockMovementLotAllocations`; a abertura de embalagem registra a retirada dos lotes fechados separadamente da reclassificação e da saída das unidades avulsas. As telas de saída rápida, entrega de requisição e suprimentos de impressão pedem o armário de origem quando há mais de uma opção. A troca GomaQ e a instalação de peças ainda precisam de validação do fluxo de tela para seleção explícita quando o produto estiver em mais de um armário.

**Regra de segurança para legado:** se um lote antigo não estiver integralmente mapeado ou os totais não fecharem, a retirada é bloqueada com motivo; não há fallback para baixa global nem seleção arbitrária de lote/local.

### Transferência
**Implementado para transferências novas com lote e saldo rastreável na origem.** O fluxo reduz o saldo do lote no armário de origem, aumenta o mesmo lote no destino, não reduz `lots.quantityAvailable`, não altera o saldo global e registra transferência/auditoria. Se já houver saldo nos dois armários, atualiza os dois buckets. Se não houver saldo rastreável na origem, bloqueia e exige regularização — não infere localização pelo recebimento. Transferências legadas sem lote seguem pendentes de cobertura e diagnóstico.

### Devolução
**Implementado parcialmente para devoluções com lote resolvido:** exige armário de destino e recompõe o saldo do lote naquele local, além dos saldos global, físico-local e do lote. Material avariado/não reutilizável continua fora do saldo disponível. A ligação confiável entre saída original, ID do lote consumido e armário de origem ainda precisa ser padronizada em todos os fluxos de saída.

### Inventário
O inventário inicial já feito é preservado. O fluxo de inventário ainda precisa contar e ajustar por lote e armário. Até essa etapa estar concluída, inventários posteriores que alterem apenas saldos agregados podem tornar o livro-razão inconsistente; a rotina de baixa detectará a diferença e bloqueará a operação. Não distribuir diferença automaticamente por FIFO, pelo lote mais novo ou por qualquer outro critério presumido.

## 5. Migração dos registros atuais

A migração deve ter duas fases independentes:

**Fase A — diagnóstico sem escrita**
- Foi adicionada a consulta read-only `stockSetup.lotLocationReadiness`.
- Para cada lote, localiza `entryItems` por `lotId`, compara saldos lote × armário, saldo por armário e saldo global.
- Exibe o local informado no recebimento apenas como candidato, e somente quando não identifica saídas/ajustes, transferências ou devoluções posteriores para o produto. Mesmo assim, exige conferência humana.
- Identifica registros globais/físicos duplicados ou inválidos, lotes órfãos, saldos lote × armário duplicados, divergências, candidatos e lotes sem origem de localização suficiente.
- A consulta retorna `readOnly: true` e `migrationApplied: false`; não faz qualquer escrita.
- Não assume que `entryItems.locationId` ainda é a localização atual quando há indícios de transferência ou divisão.

**Fase B — execução autorizada**
- Criar saldo por lote/local somente para os casos cuja localização atual seja comprovável.
- Não inventar localização para os casos ambíguos; mantê-los em fila de regularização assistida.
- Registrar operador, horário, versão e resumo antes/depois em auditoria.
- Executar primeiro em cópia/ambiente de validação; em produção, somente com autorização explícita e plano de reversão.
- Reconciliar todos os invariantes após a migração.

## 6. Critérios de aceite

- Um lote pode estar dividido entre Armário TI 01 e Armário TI 02 sem perder identidade ou área.
- Transferir parte de um lote altera somente a distribuição por armário; não altera o saldo global nem o saldo total daquele lote.
- Uma saída FIFO reduz exatamente os lotes e armários que forneceram as unidades.
- Uma devolução pode retornar a um armário diferente do originalmente usado, sem distorcer a localização do saldo remanescente do lote.
- Inventário por lote/local corrige quantidades sem escolher lote arbitrariamente.
- Dashboard, relatório e CSV conciliam os mesmos totais e exibem exceções com causa rastreável.
- GomaQ, impressão, requisições, patrimônio, água e os demais fluxos existentes mantêm seus dados e auditorias.

## 7. Pendências de integração antes de considerar o livro-razão completo

- Confirmar CI completo da branch após as integrações de saída e corrigir eventuais incompatibilidades de código/testes.
- Implementar inventário e reconciliação por lote × armário, sem distribuir diferenças automaticamente.
- Integrar `stockMovementLotAllocations` às consultas, relatórios e ao fluxo de devolução para restaurar exatamente cada lote e armário, inclusive em saídas multi-lote.
- Executar o diagnóstico read-only no deployment somente após autorização para consulta; analisar individualmente os lotes do inventário inicial e os lotes da DANFE de toners da GomaQ.
- Preparar eventual migração assistida apenas para os casos comprovados, com plano de reversão e autorização explícita.
- Atualizar relatório e CSV com a nova dimensão e a situação da conciliação.

## 8. Fora desta especificação

- Não alterar saldos existentes automaticamente.
- Não reclassificar lotes históricos sem evidência.
- Não executar migrações/rotinas internas, seeds ou cargas em deployment real.
- Não publicar Freebuff nem implantar Convex.
