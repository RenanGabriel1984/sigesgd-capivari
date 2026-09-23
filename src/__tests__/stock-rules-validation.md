# Gestão de Estoque SGGD — Validação de Regras Críticas de Estoque
## Fase 0.6 — Testes Automatizados

**Data:** 01/09/2026
**Status:** Documentação de cenários de teste — validação manual via backend Convex

> **Nota:** Este projeto não possui framework de testes configurado.
> Os cenários abaixo devem ser executados via Convex Dashboard → Functions → Run
> ou futuramente integrados ao vitest/convex-test.

---

## Setup Inicial (Executar uma vez)

### Criar dados de teste:
```
users: bootstrapAdmin (name: "Admin Teste", email: "admin@teste.com", password: "123456")
organizations: create (name: "Secretaria Teste", type: "secretaria")
categories: create (name: "Toner/Insumos")
products: create (name: "Toner HP Preto", categoryId: [id], minimumStock: 2, idealStock: 5, maximumStock: 10)
stockMovements: createEntry (productId: [id], quantity: 10)
```

**Esperado:** Stock = { physicalQuantity: 10, reservedQuantity: 0 }

---

## Teste A: Aprovação Normal

### Cenário:
1. Criar solicitação de 4 unidades
2. Aprovar solicitação

### Validação:
```
stock: { physicalQuantity: 10, reservedQuantity: 4 }
solicitação: status = "approved"
```

### Esperado: ✅ PASS

---

## Teste B: Concorrência em Aprovação (Dois usuários)

### Cenário:
1. Criar 2 solicitações independentes de 1 unidade cada (mesmo produto, estoque = 1)
2. Tentar aprovar ambas

### Validação:
```
Somente UMA deve ser aprovada.
A outra deve falhar com: "Estoque insuficiente para concluir a aprovação"
stock nunca pode ficar: physicalQuantity < 0 OU reservedQuantity > physicalQuantity
```

### Esperado: ✅ PASS (segunda aprovação rejeitada)

---

## Teste C: Cancelamento de Pedido Pendente

### Cenário:
1. Criar solicitação (status = pending)
2. Cancelar solicitação

### Validação:
```
stock: { physicalQuantity: 10, reservedQuantity: 0 } (inalterado)
solicitação: status = "cancelled"
audit log: "Solicitação pendente cancelada pelo solicitante"
```

### Esperado: ✅ PASS

---

## Teste D: Cancelamento Libera Reserva (APPROVED → CANCELLED)

### Cenário:
1. Criar solicitação de 4
2. Aprovar (reservedQuantity = 4)
3. Cancelar

### Validação:
```
stock: { physicalQuantity: 10, reservedQuantity: 0 }
solicitação: status = "cancelled"
audit log: "Solicitação aprovada cancelada. Reserva liberada: Toner HP Preto: -4"
```

### Esperado: ✅ PASS

---

## Teste E: Duplo Cancelamento

### Cenário:
1. Criar e cancelar solicitação
2. Tentar cancelar novamente

### Validação:
```
Erro: "Solicitação já foi rejeitada ou cancelada."
```

### Esperado: ✅ PASS

---

## Teste F: Dupla Aprovação

### Cenário:
1. Criar solicitação
2. Aprovar solicitação
3. Tentar aprovar novamente

### Validação:
```
Erro: "Solicitação não está pendente. Verifique se já foi aprovada, rejeitada ou cancelada."
```

### Esperado: ✅ PASS

---

## Teste G: Entrega Após Aprovação

### Cenário:
1. Criar solicitação de 4
2. Aprovar (reserved = 4)
3. Entregar 4

### Validação:
```
stock: { physicalQuantity: 6, reservedQuantity: 0 }
solicitação: status = "delivered"
movimentação: type = "exit", quantity = 4
```

### Esperado: ✅ PASS

---

## Teste H: Cancelamento Após Entrega deve Falhar

### Cenário:
1. Criar solicitação
2. Aprovar
3. Entregar
4. Tentar cancelar

### Validação:
```
Erro: "Não é possível cancelar uma solicitação já entregue."
```

### Esperado: ✅ PASS

---

## Teste I: Estoque Insuficiente na Aprovação

### Cenário:
1. Estoque físico = 3, reserved = 0
2. Criar solicitação de 5
3. Tentar aprovar

### Validação:
```
Erro: "Estoque insuficiente para concluir a aprovação. 'Item': disponível 3, necessário 5. Nenhum item foi reservado."
stock permanece inalterado
```

### Esperado: ✅ PASS

---

## Teste J: Estorno de Entrada — Consumo Parcial

### Cenário:
1. Entrada de 10
2. Saída de 7
3. Tentar estornar entrada de 10

### Validação:
```
Erro: "Não é possível estornar esta entrada integralmente porque parte do saldo já foi consumida."
stock permanece: physicalQuantity = 3
```

### Esperado: ✅ PASS

---

## Teste K: Edição de Entrada — Redução

### Cenário:
1. Entrada de 10 (saldo = 10)
2. Editar entrada para 5 (diff = -5)

### Validação:
```
stock: physicalQuantity = 5
audit log: "Edição de entrada: quantidade 10 → 5 (Δ-5). Saldo: 10 → 5."
```

### Esperado: ✅ PASS

---

## Teste L: Edição de Entrada — Redução com Reserva

### Cenário:
1. Entrada de 10 (saldo = 10, reserved = 4)
2. Tentar editar entrada para 3 (diff = -7, stock ficaria 3 < reserved 4)

### Validação:
```
Erro: "A redução violaria o estoque reservado. Saldo pós-edição: 3. Reserva atual: 4."
```

### Esperado: ✅ PASS

---

## Teste M: Ajuste Positivo

### Cenário:
1. Estoque = 10
2. Ajuste para 15

### Validação:
```
stock: physicalQuantity = 15
movimentação: type = "adjustment", quantity = 5
audit log: "Ajuste: 10 → 15"
```

### Esperado: ✅ PASS

---

## Teste N: Ajuste Negativo

### Cenário:
1. Estoque = 10
2. Ajuste para 7

### Validação:
```
stock: physicalQuantity = 7
movimentação: type = "adjustment", quantity = 3
audit log: "Ajuste: 10 → 7"
```

### Esperado: ✅ PASS

---

## Teste O: Reserva Auditada

### Cenário:
1. Criar reserva via reserveStock

### Validação:
```
audit log: action = "reserve", details contém "Reserva: [nome] — [qty] unidade(s)."
```

### Esperado: ✅ PASS

---

## Teste P: Compatibilidade Toner Auditada

### Cenário:
1. Adicionar compatibilidade via upsertCompatibility
2. Atualizar compatibilidade (mesmo modelo)
3. Remover compatibilidade

### Validação:
```
audit log (1): action = "toner_update", details = "Compatibilidade adicionada: modelo ..."
audit log (2): action = "toner_update", details = "Compatibilidade atualizada: modelo ..."
audit log (3): action = "toner_update", details = "Compatibilidade removida: modelo ..."
```

### Esperado: ✅ PASS

---

## Teste Q: Fluxo Completo de Integridade

### Cenário (spec 19):
1. Estoque físico = 10, reservado = 0, disponível = 10
2. Criar solicitação de 4 → Aprovar → Físico=10, Reservado=4, Disponível=6
3. Entregar → Físico=6, Reservado=0, Disponível=6
4. Criar nova solicitação de 6 → Aprovar → Físico=6, Reservado=6, Disponível=0
5. Cancelar antes de entrega → Físico=6, Reservado=0, Disponível=6

### Validação em cada etapa:
| Etapa | physical | reserved | available |
|-------|----------|----------|-----------|
| Início | 10 | 0 | 10 |
| Após aprovação (4) | 10 | 4 | 6 |
| Após entrega | 6 | 0 | 6 |
| Após aprovação (6) | 6 | 6 | 0 |
| Após cancelamento | 6 | 0 | 6 |

### Esperado: ✅ PASS

---

## Limitações dos Testes

1. **Concorrência real:** O teste B valida que o backend rejeita, mas não testa concorrência simultânea de verdade (dois mutators ao mesmo tempo). O Convex serializa mutations, então a proteção do `request.status !== "pending"` é suficiente.

2. **Framework de testes:** Não há vitest/jest configurado. Os testes acima são cenários documentados para validação manual.

3. **Testes E2E:** Implementação futura com `convex-test` e vitest.
