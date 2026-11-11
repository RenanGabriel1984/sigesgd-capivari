# Regularização de Área e Local Físico — SIGESGD Capivari

## Estado

- Branch de implementação: `codex/regularizacao-area-local`
- Base: `codex/stock-areas-phase1` no commit `d58bf2d3945b205354b0d0ca838d9892c16aa664`
- Backup do deployment `first-herring-264`: realizado e armazenado pelo responsável.
- Código: alterações preparadas nesta branch.
- Backend/frontend: **não publicados** por este procedimento.
- Banco: **nenhuma mutation de regularização executada**.

## Regra de domínio

Área/subestoque e local físico são dimensões independentes:

- `stockAreas`: finalidade/classificação do material (ex.: TI Geral, Impressoras).
- `storageLocations`: posição física (ex.: Armário TI 01, Armário TI 02).
- `lots`: origem/rastreabilidade do material, com `areaId` e `locationId`.
- `stockByLocation`: saldo por produto + área + local físico.
- `stockMovements`: registra a área/local de origem e, em transferência, também destino.

Um armário pode armazenar lotes de diferentes áreas. O campo legado `storageLocations.areaId` permanece no schema apenas para compatibilidade com documentos antigos; não é fonte de classificação e não deve ser preenchido por novos fluxos.

## Correções de código nesta branch

1. Resumo e classificação de áreas usam a área do lote, sem exigir correspondência com a área legada do armário.
2. Cadastro de locais físicos não solicita nem grava área.
3. Entradas, carga inicial, solicitações, saídas, devoluções, transferências e inventários validam área e local físico separadamente.
4. Transferências e inventários identificam o saldo por produto + área + local.
5. Saída rápida distingue duas linhas do mesmo produto que estejam no mesmo armário, mas em áreas diferentes.
6. Importação de planilha aceita a coluna explícita `Área`, sem confundir observações antigas com ponto e vírgula.
7. O cadastro com saldo inicial exige a área explicitamente; não a infere pelo armário.
8. A tela de produto apresenta separadamente área e local físico.

## Manifesto da carga inicial

Fonte: `docs/planilha-carga-inicial.csv` (53 linhas).

| Grupo | Linhas | Quantidade |
|---|---:|---:|
| Impressoras | 17 | 884 |
| TI Geral | 36 | 1.919 |
| **Total** | **53** | **2.803** |

Distribuição física preservada:

| Local físico | Linhas | Quantidade |
|---|---:|---:|
| Armário TI 01 | 34 | 2.597 |
| Armário TI 02 | 19 | 206 |

A classificação de área é pelo produto, nunca pelo nome do armário.

## Correções documentais permitidas

Na entrada inicial `ENT-2026-000001`, dez itens têm `entryItems.unitOfMeasure` como `un`, enquanto a planilha original e o cadastro do produto concordam com outra unidade:

- Kit teclado e mouse → `kit`
- Pasta térmica → `pote`
- Jogo de chaves — 6 peças → `kit`
- Jogo de chaves — 8 peças → `kit`
- Fita isolante → `rolo`
- Protetor de crachá — caixa fechada → `caixa`
- Abraçadeira de nylon → `pacote`
- Etiqueta para impressão adesiva → `rolo`
- Ribbon para impressora de etiqueta adesiva → `rolo`
- Papel para impressora térmica → `rolo`

Somente o metadado da unidade no item da entrada será corrigido. A quantidade armazenada não será convertida nem multiplicada.

Na NF Gomaq 372043, as diferenças `pc/un` do Cartão PVC e `un/rolo` do papel térmico permanecem sem correção automática, pois a equivalência documental exige confirmação.

Datas, custos, totais financeiros e observações históricas não serão reescritos.

## Rotina de regularização

O módulo `src/convex/stockRegularization.ts` contém:

- `preview`: somente leitura; gera bloqueios, distribuição esperada e contagem das alterações planejadas.
- `apply`: mutation idempotente, restrita ao perfil administrador e protegida por confirmação literal.

O plano confere:

- 53 itens/lotes da entrada inicial e seus vínculos;
- 8 itens/lotes da NF Gomaq 372043, totalizando 535 unidades;
- os 61 lotes e sua rastreabilidade com os itens de entrada;
- os locais físicos conforme a planilha de origem;
- a área de cada lote conforme o manifesto;
- os 10 metadados de unidade autorizados;
- saldo global contra lotes ativos;
- saldo por produto/local contra a distribuição por área;
- movimentações que tenham lote verificável;
- devoluções vinculadas à saída original;
- reservas globais e solicitações aprovadas ainda não entregues.

A rotina não altera `stock.physicalQuantity`, `stock.reservedQuantity`, quantidades de lotes, quantidades de entrada, quantidades de movimentações ou datas. Os totais existentes de `stockByLocation` por produto/local devem fechar antes e permanecer idênticos após a divisão por área.

Qualquer inconsistência relevante interrompe o plano antes da primeira escrita. Não há exclusão de documentos.

## Ordem obrigatória de execução

1. Confirmar backup e deployment de destino.
2. Comparar o schema/versão do backend real com esta branch.
3. Publicar o backend somente após revisão específica de compatibilidade. A auditoria anterior encontrou `stockMovementLots` e `requestItemReservations` no schema versionado, mas ausentes na lista de tabelas do deployment consultado. A diferença precisa ser resolvida antes de executar a rotina.
4. No deployment correto, executar `stockRegularization:preview`.
5. Se houver qualquer bloqueio, não executar `apply`; corrigir e rodar a prévia novamente.
6. Com prévia sem bloqueios, o administrador pode aplicar a regularização.
7. Executar novamente `preview` e conferir que não há alterações pendentes (operação idempotente/no-op).
8. Repetir a auditoria consolidada e confirmar os saldos globais, reservas, lotes, movimentos e totais por produto/local.

## Fora do escopo desta rotina

- O 58º produto/registro de estoque que não aparece nas duas entradas auditadas permanece intocado.
- Nenhuma migração de dados entre deployments.
- Nenhum restore de backup.
- Nenhuma publicação de frontend.
- Nenhuma alteração das datas da entrada inicial.
- Nenhuma inferência ou conversão de unidades da NF Gomaq.
- Nenhuma exclusão ou reconstrução de estoque.
