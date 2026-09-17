# SIGESGD Capivari — Classificação oficial dos 53 produtos do estoque

**Operação:** somente cadastro (`products.categoryId`) + categorias oficiais.
**Deployment:** `https://first-herring-264.convex.cloud`
**Execução:** `productClassification:applyProductClassificationInternal`
(`confirm="CLASSIFICAR-53-PRODUTOS"`) — precedida de prévia
(`previewProductClassificationInternal`) e de `dryRun: true`.

## 1. Categorias (7 oficiais)

| Categoria | Origem do registro | Ação |
|---|---|---|
| Periféricos | registro existente (inativo) | reativada |
| Redes e Conectividade | registro "Redes" (inativo) | reutilizada e renomeada |
| Armazenamento e Hardware | registro "Armazenamento" (inativo) | reutilizada e renomeada |
| Telefonia e Comunicação | — | criada |
| Suprimentos de Impressão | registro existente (inativo) | reativada |
| Materiais de Infraestrutura | — | criada |
| Ferramentas e Manutenção | — | criada |

Sem duplicatas. A categoria **"Diversos" foi preservada** no banco, ativa e
**vazia** (nenhum dos 53 produtos permanece nela), conforme instruído. A
categoria "Consumiveis" permanece inativa, sem produtos.

## 2. Distribuição de produtos distintos

| Categoria | Produtos |
|---|---|
| Periféricos | 11 |
| Redes e Conectividade | 9 |
| Armazenamento e Hardware | 2 |
| Telefonia e Comunicação | 4 |
| Suprimentos de Impressão | 17 |
| Materiais de Infraestrutura | 5 |
| Ferramentas e Manutenção | 5 |
| **Total** | **53** |

## 3. Os 53 produtos classificados

### Periféricos (11)
Adaptador HDMI para VGA · Cabo adaptador DisplayPort para VGA · Hub USB 3.0 ·
Kit teclado e mouse · Mouse com fio · Mouse wireless · Mousepad · Teclado ·
Teclado com fio · Teclado KB 110 com fio · Teclado numérico

### Redes e Conectividade (9)
Conector linear de emenda para cabo RJ45 CAT6 · Conector RJ45 ·
Conector RJ45 blindado CAT5 · Conector RJ45 Cat5E · Keystone Jack para RJ45 ·
RouterBoard · Switch 26 portas · Switch 5 portas 10/100 PoE · Switch JetStream 8 portas

### Armazenamento e Hardware (2)
Cooler para processador Intel · Leitor de DVD

### Telefonia e Comunicação (4) — homônimos identificados por `_id` + marca/modelo
Telefone (Attimo) · Telefone VoIP TIP 125I (Intelbras) ·
Telefone VoIP TIP 125I — Montado (Intelbras) · Telefone VoIP V5502 (Intelbras)

### Suprimentos de Impressão (17)
Cartão PVC para crachá · Etiqueta para impressão adesiva ·
Papel para impressora térmica · Protetor de crachá — caixa fechada ·
Protetor de crachá — unidade avulsa · Ribbon para impressora de etiqueta adesiva ·
Toner AltaLink (Amarelo, Ciano, Magenta, Preto) · Toner CX735 (Amarelo, Magenta) ·
Toner Lexmark XM5365 · Toner VersaLink (Amarelo, Ciano, Magenta, Preto)

### Materiais de Infraestrutura (5)
Abraçadeira de nylon · Cadeado chave tetra · Caixa com tampa de sobrepor para tomada ·
Fita isolante · Módulo para tomada

### Ferramentas e Manutenção (5)
Jogo de chaves — 6 peças · Jogo de chaves — 8 peças · Limpa contato ·
Pasta térmica · Pilha AAA

## 4. Garantias verificadas

- Produtos criados: **0** · Produtos excluídos: **0**
- Quantidades/lotes/movimentações/entradas/solicitações/fornecedores/organizações
  alterados: **0** (snapshot antes/depois idêntico, verificado na própria mutation)
- Estoque global **2.803** = `stockByLocation` **2.803** · divergência **0** ·
  negativos **0** · reservado **0** ≤ físico
- Armário TI 01 = **2.597** · Armário TI 02 = **206** (2.597 + 206 = 2.803)
- **ENT-2026-000001** intacta: 53 itens, 53 lotes, 53 movimentações, 2.803 unidades
- Organizações: **72** (72 ativas)
- Auditoria: 53 registros `update` em `products` (produto, categoria anterior,
  categoria nova, usuário do canal interno, timestamp) + registros das categorias

## 5. Como revalidar

```bash
bunx convex run productClassification:previewProductClassificationInternal
bunx convex run diagnostics:categoryAuditInternal
bunx convex run diagnostics:officialProductsInternal
bunx convex run diagnostics:screensSmokeTestInternal
```
