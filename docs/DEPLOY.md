# SIGESGD Capivari — Guia de Deploy

## Pré-requisitos

- [Bun](https://bun.sh/) v1.0+
- Conta no [Convex](https://convex.dev/) (backend e banco de dados)
- Acesso ao repositório GitHub

---

## Estrutura do Projeto

```
FRONTEND/ARQUIVOS:
├── src/                  # Código-fonte React/TypeScript
├── public/               # Assets estáticos (manifest, logos)
├── index.html            # HTML principal
├── package.json          # Dependências e scripts
├── vite.config.ts        # Configuração Vite
├── tsconfig.json         # Configuração TypeScript
├── vitest.config.ts      # Configuração de testes

BACKEND/DADOS (Convex):
├── src/convex/           # Funções Convex (schema, mutations, queries)
├── convex.json           # Configuração do deployment Convex
├── .env.local            # Chaves do deployment (NÃO versionado)
```

---

## Variáveis de Ambiente

| Variável | Descrição | Onde configurar |
|----------|-----------|-----------------|
| `VITE_CONVEX_URL` | URL do deployment Convex (cliente) | `.env.local` |
| `CONVEX_DEPLOYMENT` | Deployment do Convex (backend) | `.env.local` |
| `CONVEX_SITE_URL` | URL do site para autenticação | `.env.local` |

> ⚠️ Nunca commite `.env` ou `.env.local`. O `.gitignore` já os exclui.

---

## Instalação

```bash
# Clonar o repositório
git clone <url-do-repositorio>
cd sigesgd-capivari

# Instalar dependências
bun install

# Configurar variáveis de ambiente
cp .env.example .env.local
# Editar .env.local com as chaves do Convex
```

---

## Desenvolvimento

```bash
# Iniciar o backend Convex
bun convex dev

# Em outro terminal, iniciar o frontend
bun dev
```

O aplicativo estará disponível em `http://localhost:5173`.

---

## Build de Produção

```bash
# Build completo (TypeScript + Vite)
bun run build

# Pré-visualização do build
bun preview
```

O build gera a pasta `dist/` com os arquivos estáticos para deploy.

---

## Deploy do Backend (Convex)

O backend é gerenciado pelo Convex e não requer servidor próprio.

```bash
# Push das funções para o Convex
bun convex dev --once

# Deploy de produção
bun convex deploy
```

O Convex gerencia:
- Banco de dados (serverless, real-time)
- Autenticação
- Storage (fotos e documentos)
- Functions (mutations e queries)

---

## Deploy do Frontend

O frontend é um aplicativo estático. Opções de hospedagem:

### Opção 1: Vercel (Recomendado)
1. Conectar o repositório GitHub ao Vercel
2. Configurar o build command: `bun run build`
3. Configurar o output directory: `dist`
4. Adicionar variáveis de ambiente no painel do Vercel

### Opção 2: Netlify
1. Conectar o repositório GitHub ao Netlify
2. Build command: `bun run build`
3. Publish directory: `dist`

### Opção 3: Servidor Estático
1. Executar `bun run build`
2. Copiar o conteúdo de `dist/` para o servidor web
3. Configurar redirect para `index.html` (SPA)

---

## Configuração de Domínio

1. Configurar DNS apontando para o hosting escolhido
2. Habilitar HTTPS (automático no Vercel/Netlify)
3. Atualizar `CONVEX_SITE_URL` no Convex com o domínio de produção

---

## Atualização

```bash
# Puxar últimas alterações
git pull origin main

# Instalar novas dependências (se houver)
bun install

# Push das alterações do Convex
bun convex dev --once

# Build de produção
bun run build

# Deploy do frontend
# (automático no Vercel/Netlify com CI/CD)
```

---

## Dados Iniciais (Seed)

O sistema possui funções de seed em `src/convex/seed.ts` para criar:
- Organizações (Secretaria de Gestão e Governo Digital)
- Categorias de produtos
- Usuários iniciais

> ⚠️ Executar seeds apenas na primeira implantação. Seeds são destrutivos para dados existentes.

---

## Monitoramento

- **Convex Dashboard**: https://dashboard.convex.dev
- **Logs**: Acessar pelo Convex Dashboard → Logs
- **Métricas**: Convex Dashboard → Metrics
