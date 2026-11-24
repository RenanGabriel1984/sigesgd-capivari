# Planilha de Carga Inicial (Implantação de Estoque)

Arquivo: `docs/planilha-carga-inicial.csv`

## Formato

Colunas (separador `;` ou `,`, cabeçalho opcional):

```
Localização; Produto; Marca; Quantidade; Unidade; Observação
```

- **Localização**: nome exato do local cadastrado em Administração → Locais (ex.: `Armário TI 01`, `Armário TI 02`). Linhas com local não reconhecido são sinalizadas e **não** importadas.
- **Produto**: nome do item. Produtos existentes são associados pelo nome (sem duplicatas); produtos novos são cadastrados automaticamente.
- **Quantidade**: número (não converter caixas/pacotes/kits em unidades — preservar a informação na Observação).
- **Unidade**: `un`, `pc`, `cx`, `kt`, etc. (padrão: `un`).
- **Observação**: opcional. Toners de kit original de 4 cores (Xerox VersaLink, Xerox AltaLink, Lexmark CX735, Lexmark XM5365) recebem automaticamente `Parte do kit original e 4 cores` quando nenhuma observação é informada.

## Como importar

Operação → Inventário → aba **Implantação Inicial** → **Importar planilha** → colar o conteúdo → conferir a prévia → confirmar.

A confirmação gera, por item: entrada `initial_inventory`, lote rastreável, `stockByLocation`, `stock`, movimentação e auditoria. Nada é gravado antes da confirmação.

## Estado atual

- A planilha contém a **carga inicial oficial completa: 53 registros** (Armário TI 01 com 34, Armário TI 02 com 19), incluindo o **Toner Lexmark XM5365** (Armário TI 02, 1 un).
- A carga foi **efetivada** (entrada `initial_inventory` com 53 lotes rastreáveis, saldos por local e globais conferidos, movimentações e auditoria). A proteção contra duplicação impede nova carga inicial para os mesmos produtos.
- Observações com `;` interno (ex.: `Parte do kit original e 4 cores; CX735`, `Cat5E; 5 caixas com 100`) são preservadas integralmente pelo parser — a observação é sempre a última coluna da linha.
- **Pré-requisito já atendido**: os locais `Armário TI 01` e `Armário TI 02` estão cadastrados.
## Conciliação documental e operacional — referência de 24/11/2026

A versão de referência é este CSV do repositório (docs/planilha-carga-inicial.csv), validado automaticamente por src/__tests__/initial-stock-documentation.test.ts.

### Entrada inicial

- ENT-2026-000001: 53 registros e soma numérica registrada de 2.803.
- Armário TI 01: 34 registros, soma numérica 2.597.
- Armário TI 02: 19 registros, soma numérica 206.
- O CSV preserva kits, caixas, pacotes, rolos e unidades como unidades de medida distintas. A soma numérica não deve ser interpretada como quantidade de peças homogêneas.

### Entrada Gomaq

- ENT-2026-000002, NF 372043: 8 itens, soma numérica 535, destinados ao Armário TI 02.
- Com as duas entradas, a distribuição documental acumulada é: Armário TI 01 = 2.597; Armário TI 02 = 741 (206 + 535); total numérico = 3.338.

### Teste documentado do Cooler Intel

- Lote LOT-2026-000001, recebido com 15 unidades no Armário TI 01.
- Saída de teste: 1 unidade, movimento kx758yrsbatdw2yc4m09ytfapn8en7mn.
- Devolução integral sem uso: 1 unidade, retorno kx70n82skp2ph9wq5d75020wp58ez5ag, registro nd7av0f1qrq0ahyrc17q7wexns8ezxf1.
- Origem e destino da devolução: Armário TI 01. A saída e a devolução se anulam; o saldo esperado do lote permanece 15.

### Conciliação somente leitura de 24/11/2026

A execução 45410323281 consultou first-herring-264 (ambiente de desenvolvimento, não produção) e confirmou:

- 58 produtos ativos, 61 lotes e 63 movimentações.
- Saldo global, soma por armário, soma de lots.quantityAvailable e soma de lotLocationBalances.quantityAvailable: todos 3.338.
- Armário TI 01: 2.597; Armário TI 02: 741.
- Cooler Intel: 15 no saldo global, no Armário TI 01, no lote e em lote × armário.
- Nenhum produto sinalizado pelas regras de conciliação; nenhuma movimentação sem operador ou localização.
- A leitura não gravou dados. A consulta detalhada do vínculo histórico confirmou uma saída e uma devolução de 1 unidade ligadas ao mesmo lote e armário.

Links das evidências:
- Auditoria operacional somente leitura de 24/11/2026: https://github.com/RenanGabriel1984/sigesgd-capivari/actions/runs/45410323281
- Prévia somente leitura dos vínculos históricos de saída/devolução: https://github.com/RenanGabriel1984/sigesgd-capivari/actions/runs/45418290701

### Pendência residual de rastreabilidade

O saldo quantitativo está conciliado no snapshot consultado. Permanecem ausentes os dois registros de alocação estruturada do teste: a alocação withdrawal da saída e a linha correspondente em returnLotAllocations. A prévia read-only identificou os dois vínculos de forma única, mas não os gravou. Qualquer backfill deve inserir somente esses metadados, sem alterar saldos, quantidades dos lotes ou movimentos originais.

A confirmação de produção continua separada: o deployment de produção savory-sockeye-292 ainda precisa da consulta read-only com credencial restrita a esse deployment.
