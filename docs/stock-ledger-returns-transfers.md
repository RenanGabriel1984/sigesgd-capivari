# Integração de devoluções e transferências ao livro-razão

## Devoluções utilizáveis

Uma devolução de material não utilizado reverte uma saída real, sem editar o movimento original. O registro de retorno mantém o vínculo com a saída, produto, operador, local de destino, condição e motivo.

Para produtos rastreados por lote, cada parcela devolvida é registrada em `returnLotAllocations` (documento de devolução) e em `stockMovementLotAllocations` (movimento no ledger), com `allocationType: "reversal"`. Isso deixa a trilha por lote e armário consultável a partir do movimento que recompôs os saldos.

Antes da recomposição, o backend valida o livro-razão global, os saldos por armário, os saldos por lote e lote × armário, além das reservas. A área da saída e as áreas dos lotes são comparadas. Uma devolução não pode combinar lotes de áreas distintas nem misturar lotes classificados e sem área.

## Quarentena

Material parcialmente utilizado, defeituoso ou com condição não confirmada permanece fora do estoque disponível. A devolução e suas parcelas ficam registradas como pendentes de inspeção. A liberação após inspeção repõe global, armário e lote, e cria as alocações reversoras do movimento. O descarte registra a decisão e não recompõe saldos.

A inspeção só pode ser concluída uma vez: o registro deixa de estar em `quarantine` depois da decisão. A mutação é transacional, então uma falha de validação não deixa apenas parte dos saldos alterada.

## Transferências entre armários

A transferência muda a distribuição física, não o total global nem a reserva. O backend confirma o ledger e as reservas, valida a distribuição de cada lote por armário, a igualdade entre lote e soma de armários e a igualdade entre o global e a soma dos armários.

O registro `stockTransfers` mantém produto/lote, origem, destino, quantidade, responsável e observação. Cada nova transferência recebe um movimento `transfer` vinculado nos dois sentidos; o movimento identifica a origem em `locationId`, o destino em `toLocationId`, o lote e sua área. Quando há lote, o movimento também recebe uma alocação `reclassification` na trilha comum `stockMovementLotAllocations`, identificando a parcela e o armário de origem; o destino permanece no movimento de transferência. Os vínculos novos são opcionais no schema para preservar a leitura dos registros anteriores.

## Limites operacionais

- A etapa adiciona apenas campos opcionais e novos vínculos; não reclassifica histórico.
- Nenhuma migração ou alteração de saldo é executada por estes artefatos.
- Transferências sem lote continuam permitidas somente para produtos sem histórico de lotes/saldos lote-local.
- Divergências, áreas incompatíveis, lotes inativos positivos, saldos duplicados ou saldos não rastreáveis bloqueiam a operação para regularização.


## Validação transacional controlada no DEV

O workflow `.github/workflows/stock-dev-transactional-validation.yml` publica este código exclusivamente em `dev:first-herring-264` e executa as mutations públicas reais com identidade de um operador DEV ativo autorizado. A fixture é criada em uma transação interna, com produto, lote, área, entrada e dois armários identificados pelo prefixo `__SIGESGD_DEV_TXN__` e pelo ID único da execução.

O cenário cobre transferência entre armários, devolução parcial, bloqueio de devolução acima do saldo, entrada em quarentena, liberação após inspeção e descarte sem recomposição. Cada etapa compara estoque global, soma dos armários, saldo dos lotes e lote × armário. O runner sempre tenta a limpeza em `finally`; um segundo passo do workflow repete a limpeza de forma idempotente e confirma que o produto de fixture não existe mais.

A fixture não reutiliza os produtos, lotes ou armários operacionais. As saídas de origem são movimentos sintéticos vinculados apenas ao produto descartável de teste, evitando consumir o sequencial real de saídas. O workflow recusa qualquer chave diferente do prefixo `dev:first-herring-264`; não contém caminho de execução em produção.
