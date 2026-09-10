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

- 1 registro real incluído: **Toner Lexmark XM5365** (Armário TI 02, 1 un, marca Lexmark).
- Os 52 registros da relação atual de estoque dos armários estão com o responsável pelo estoque (fora deste ambiente) e devem ser **acrescentados a este arquivo** antes da importação — o sistema não inventa quantidades.
- **Pré-requisito**: os locais `Armário TI 01` e `Armário TI 02` precisam estar cadastrados (Administração → Locais ou seed `seedStorageLocations`).