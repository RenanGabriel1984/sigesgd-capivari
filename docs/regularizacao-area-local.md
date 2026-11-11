# Regularização de área e local físico — SIGESGD Capivari

## Modelo operacional

- **Área/subestoque** classifica o material (por exemplo: TI Geral ou Impressoras).
- **Local físico** identifica onde o material está guardado (por exemplo: Armário TI 01 ou Armário TI 02).
- Um local físico pode conter produtos de diversas áreas.
- Lotes e linhas de saldo mantêm os dois identificadores separadamente.
- O campo legado `storageLocations.areaId` permanece apenas para leitura de compatibilidade; não define a área do conteúdo do armário.

## Correções implementadas nesta branch

- Entradas, solicitações, saídas, classificação, consultas de saldo e devoluções validam área e local independentemente.
- Cadastro de local físico não exige nem atribui área fixa.
- Transferência passou a exigir área e local de origem e área e local de destino. Permite mover material entre áreas no mesmo armário ou entre armários dentro da mesma área.
- Carga inicial manual e importação de planilha exigem área explícita por item; a importação aceita uma área padrão com exceções individuais.
- A consulta de subestoque usa a área do lote/linha de saldo, não a área legada do armário.

## Regularização histórica protegida

Módulo: `src/convex/stockRegularization.ts`

A rotina abrange exclusivamente as entradas auditadas:

- `ENT-2026-000001`: implantação inicial, 53 itens/lotes.
- `ENT-2026-000002`: entrada Gomaq, 8 itens/lotes.

A classificação inicial usa os 53 nomes de produtos da planilha de carga original (36 TI Geral e 17 Impressoras). As unidades de medida são corrigidas apenas nos dez itens cuja unidade da linha de entrada divergiu da planilha original. Não há conversão nem alteração de quantidade.

A pré-validação verifica vínculos item→lote, áreas, locais, quantidades, saldos globais, saldos por produto/local, reservas, solicitações aprovadas, movimentações, vínculos de lote das saídas e a devolução registrada.

### Ordem de execução

1. Confirmar que existe backup do deployment correto, incluindo File Storage, guardado fora do Convex.
2. Publicar o código/schema no deployment de destino correto, depois de revisar o alvo. Esta branch não publica produção automaticamente.
3. No Dashboard do deployment que realmente atende o Preview, executar a query `stockRegularization:preview` com argumentos vazios.
4. Interromper se a query falhar ou se os resultados não forem compatíveis com a auditoria: 61 lotes, 53 itens iniciais, 8 itens Gomaq, distribuição inicial de 36 TI Geral e 17 Impressoras.
5. Revisar as contagens de alterações propostas. A prévia não escreve dados.
6. A mutation `stockRegularization:applyAuditedInitialStockRegularization` exige o argumento literal `{"confirm":"REGULARIZAR_SIGESGD_2026"}`. Ela só deve ser executada após aprovação expressa do responsável, com a prévia conferida.
7. Executar novamente `stockRegularization:preview`. O resultado esperado é `hasChanges: false` e `alreadyRegularized: true` ao repetir a mutation de aplicação, sem duplicar registros.
8. Repetir a auditoria independente dos saldos globais, lotes, saldos por localização, movimentações e reservas.

## Limites de segurança

A rotina não altera `stock.physicalQuantity`, `lots.quantityReceived`, `lots.quantityAvailable`, nem quantidades reservadas. O saldo agregado de `stockByLocation` é validado antes de ser reparticionado por área; o total por produto/local precisa permanecer idêntico.

A rotina não altera a entrada histórica, fornecedor, NF-e, datas, custos, produtos fora das duas entradas auditadas ou o 58º produto que ficou fora do escopo da auditoria. Se qualquer vínculo, total ou pré-condição divergir, a mutation aborta integralmente.

**Não executar Restore, scripts de carga, seeds, migrations genéricas ou deploy de produção como parte desta rotina.**
