# SIGESGD Capivari

**Sistema Integrado de Gestão da Secretaria de Gestão e Governo Digital — Capivari**

Aplicação web responsiva e instalável como PWA para controle interno de estoque, materiais, equipamentos e movimentações da Secretaria de Gestão e Governo Digital da Prefeitura Municipal de Capivari.

> ⚠️ **Projeto em desenvolvimento e estabilização.** O sistema ainda não está liberado para operação oficial. Homologação funcional e migração para a infraestrutura municipal são etapas obrigatórias.

---

## Objetivo

Controlar de forma integrada, rastreável e auditável todo o ciclo de vida dos materiais de TI da Secretaria — desde a entrada no estoque, passando por solicitações, reservas, entregas, até a devolução e inventário físico.

O sistema é utilizado tanto em computadores quanto em dispositivos móveis.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui |
| Backend / Banco | Convex (serverless, real-time) |
| Autenticação | Convex Auth + provider de credenciais SIGESGD |
| Roteamento | React Router v7 |
| Gráficos | Recharts |
| Animações | Framer Motion |
| PWA | vite-plugin-pwa, Service Worker com atualização automática e cache somente de recursos estáticos |
| Testes | Vitest |
| Pacote | Bun |

---

## Arquitetura

```
src/
├── convex/             # Backend Convex (schema, mutations, queries, auth)
│   ├── schema.ts       # Schema central do banco
│   ├── seed.ts         # Dados iniciais (organizações, categorias, etc.)
│   ├── entries.ts      # Entradas de estoque (multi-item, lotes)
│   ├── inventory.ts    # Inventário físico
│   ├── lots.ts         # Consultas de lotes
│   ├── printers.ts     # Impressoras e compatibilidade de toners
│   ├── products.ts     # Cadastro de produtos
│   ├── requests.ts     # Solicitações e ciclo de aprovação
│   ├── stockMovements.ts # Movimentações e saldo de estoque
│   ├── storage.ts      # Upload de fotos e documentos
│   ├── storageLocations.ts # Locais de armazenamento
│   ├── auditLogs.ts    # Registro de auditoria
│   ├── dashboard.ts    # Métricas do painel
│   ├── organizations.ts # Organizações / secretarias
│   ├── users.ts        # Gestão de usuários
│   ├── categories.ts   # Categorias de produtos
│   ├── suppliers.ts    # Fornecedores
│   └── auth/           # Autenticação (credenciais, OTP, senhas)
├── pages/              # Páginas do aplicativo
├── components/         # Componentes React (AppShell, FileUpload, etc.)
│   └── ui/             # Componentes shadcn/ui
├── hooks/              # Hooks customizados (use-auth, use-mobile)
├── types/              # Tipos e constantes compartilhados
└── __tests__/          # Testes automatizados (Vitest)
```

### Modelo de Dados

O estoque é controlado por uma **fonte única de verdade**: a tabela `stock`, com campos `physicalQuantity` e `reservedQuantity`. Disponível = físico − reservado.

- **Entradas** (`entries` + `entryItems`) → aumentam o saldo físico e geram lotes automaticamente.
- **Solicitações** (`requests` + `requestItems`) → ao serem aprovadas, reservam estoque.
- **Entregas** → baixam estoque físico e liberam reserva.
- **Cancelamentos** → liberam reserva quando aprovado; não permitem cancelamento após entrega.
- **Inventário** (`inventories` + `inventoryCounts`) → compara estoque do sistema com contagem física e gera ajustes auditados.
- **Movimentações** (`stockMovements`) → histórico de alterações de saldo, com estornos registrados e trilha de auditoria complementar.

---

## Módulos

| Módulo | Status | Descrição |
|--------|--------|-----------|
| Autenticação | ✅ Implementado | Credenciais + OTP por e-mail, RBAC (admin, stock_manager, director, secretary, technician, patrimony_manager) |
| Cadastro de Produtos | ✅ Implementado | CRUD completo, categorias, fornecedores, compatibilidade com impressoras |
| Estoque | ✅ Implementado | Saldo físico/reservado, fonte única, proteção contra negativo |
| Entradas | ✅ Implementado | Entradas multi-item, origem, NF, AF, fornecedor, fotos, documentos, lotes automáticos |
| Lotes | ✅ Implementado | Geração automática (LOT-YYYY-NNNNNN), rastreabilidade por entrada |
| Solicitações | ✅ Implementado | Fluxo completo: criar → aprovar → entregar → cancelar, com reserva automática |
| Entrega com Assinatura | ✅ Implementado | Termo de entrega digital com validação por senha |
| Logística Reversa (Toners) | ✅ Implementado | Checkbox de coleta de toner vazio na entrega |
| Impressoras / GOMAQ | ✅ Implementado | Cadastro de impressoras, matriz de compatibilidade toner↔impressão |
| Locais de Armazenamento | ✅ Implementado | Cadastro de locais físicos para lotes |
| Inventário | ✅ Implementado | Fluxo: draft → counting → review → closed, com ajustes automáticos auditados |
| Upload de Fotos/Documentos | ✅ Implementado | Convex Storage, upload real, preview, câmera mobile |
| Relatórios | ✅ Implementado | Métricas gerais, consumo de toners, movimentações |
| Painel (Dashboard) | ✅ Implementado | Indicadores, alertas, evolução mensal |
| Auditoria | ✅ Implementado | Registro completo de todas as operações sensíveis |
| PWA | ✅ Implementado no build | Manifest + Service Worker via vite-plugin-pwa, atualização automática e cache de recursos estáticos; dados do Convex não são cacheados offline |

---

## Pré-requisitos

- [Bun](https://bun.sh/) (gerenciador de pacotes)
- Conta no [Convex](https://convex.dev/) (backend e banco de dados)

---

## Desenvolvimento

```bash
# Instalar dependências
bun install

# Iniciar o backend Convex
bun convex dev

# Em outro terminal, iniciar o frontend
bun dev
```

O aplicativo estará disponível em `http://localhost:5173`.

---

## Build

```bash
# Build de produção (TypeScript + Vite)
bun run build

# Pré-visualização do build
bun preview
```

---

## Testes

```bash
# Executar todos os testes
bun vitest run

# Executar em modo observação
bun vitest
```

---

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `VITE_CONVEX_URL` | URL do deployment Convex (cliente) |
| `CONVEX_DEPLOYMENT` | Deployment do Convex (backend) |
| `CONVEX_SITE_URL` | URL do site para autenticação |

> ⚠️ **Nunca commite arquivos `.env` ou `.env.local`.** O `.gitignore` já os exclui.

---

## Homologação e infraestrutura municipal

O projeto permanece em desenvolvimento. A aprovação do build e dos testes automatizados não substitui a homologação funcional dos fluxos completos.

Antes da operação oficial, são obrigatórios:
- auditoria de segurança, autenticação e permissões;
- conciliação de saldos gerais, por local e por lote;
- rastreabilidade entre entradas, documentos, lotes, saídas, equipamentos e usuários;
- verificação de cobertura e integridade da auditoria;
- teste de backup e restauração;
- homologação em ambiente isolado;
- ensaio de instalação e migração na infraestrutura municipal.

O plano técnico, incluindo as dependências do Convex auto-hospedado, autenticação, e-mail, arquivos, backup e critérios de aceite, está em [docs/PLANO-MIGRACAO-INFRAESTRUTURA-MUNICIPAL.md](docs/PLANO-MIGRACAO-INFRAESTRUTURA-MUNICIPAL.md).

**Atenção:** não remover providers, dependências de plataforma ou configurações do ambiente atual antes de validar login, recuperação de senha, PWA, armazenamento e restauração em homologação municipal.

---

## Licença

Projeto interno da Prefeitura Municipal de Capivari — Secretaria de Gestão e Governo Digital.

---

*Desenvolvido com Convex, React e TypeScript.*
