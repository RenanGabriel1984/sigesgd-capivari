# Modelo-alvo de rastreabilidade do estoque por lote e armário

**Status:** especificação técnica para a próxima fase. Não implementada nesta etapa.  
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

Adicionar uma tabela `lotLocationBalances` (nome provisório) com um registro por combinação **lote × localização física**:

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
Ao confirmar uma entrada, criar:
- lote com sua área;
- saldo do lote no armário de destino;
- saldo físico do produto no armário;
- saldo global e movimentação/auditoria.

### Saídas, requisições e consumos
O FIFO deve consumir simultaneamente:
- `lotLocationBalances` do armário/lote de origem;
- `lots.quantityAvailable`;
- `stockByLocation.quantity`;
- `stock.physicalQuantity`.

O fluxo deve respeitar a área/localidade quando a solicitação as especificar. GomaQ, suprimentos de impressão, peças patrimoniais e saídas diretas devem usar o mesmo serviço de consumo, preservando seus dados operacionais e auditorias específicas.

### Transferência
Para transferência parcial de um lote:
- reduzir o saldo daquele lote no armário de origem;
- aumentar o saldo do mesmo lote no armário de destino;
- não reduzir `lots.quantityAvailable`;
- não alterar o saldo global do produto;
- registrar transferência e auditoria.

Se o lote já tiver saldo em ambos os armários, atualizar os dois buckets existentes sem criar duplicidade lógica.

### Devolução
A devolução deve informar o armário de destino e o lote original (quando rastreável). A quantidade volta ao mesmo lote no armário de destino, elevando os saldos físico, local e do lote na mesma transação. Material avariado/não reutilizável continua fora do saldo disponível.

### Inventário
O inventário que ajusta estoque deve contar por lote e armário, não somente por produto agregado. Diferenças devem ser atribuídas aos lotes efetivamente contados. Não distribuir diferença automaticamente por FIFO, pelo lote mais novo ou por qualquer outro critério presumido.

## 5. Migração dos registros atuais

A migração deve ter duas fases independentes:

**Fase A — diagnóstico sem escrita**
- Para cada lote, localizar os `entryItems` vinculados por `lotId`.
- Verificar se existe exatamente um destino de recebimento e se a quantidade do lote é conciliável com o saldo físico do produto/armário.
- Identificar produtos com transferências, devoluções, baixas sem localização e entradas legadas sem `lotId`.
- Gerar relatório de classificados, ambíguos e não conciliados, com quantidades e motivos.
- Não assumir que `entryItems.locationId` ainda é a localização atual quando há indícios de transferência ou divisão.

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

## 7. Fora desta especificação

- Não alterar saldos existentes automaticamente.
- Não reclassificar lotes históricos sem evidência.
- Não executar migrações/rotinas internas, seeds ou cargas em deployment real.
- Não publicar Freebuff nem implantar Convex.
