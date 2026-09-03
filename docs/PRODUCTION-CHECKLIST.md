# SIGESGD Capivari — Checklist de Produção

## ✅ Pré-Deploy

- [ ] Repositório versionado no GitHub
- [ ] `.gitignore` exclui `.env`, `.env.local`, `node_modules`, `dist`
- [ ] Nenhum segredo commitado (credenciais, tokens, chaves)
- [ ] `package.json` com nome e versão corretos (`sigesgd-capivari`, `0.7.0`)
- [ ] Build local passa: `bun run build`
- [ ] Testes passam: `bun vitest run`
- [ ] TypeScript compila: `bun tsc -b --noEmit`
- [ ] Convex compila: `bun convex dev --once`

---

## 🔐 Segurança

- [ ] RBAC implementado no backend (não apenas frontend)
- [ ] Usuários inativos bloqueados no backend
- [ ] Chaves de licença mascaradas para não-admin
- [ ] Upload restrito a tipos permitidos
- [ ] Auditoria registrando todas as operações sensíveis
- [ ] Senhas com hash PBKDF2 (não texto plano)
- [ ] Proteção contra estoque negativo no backend
- [ ] Validação de concorrência em aprovações

---

## 🗄️ Convex (Backend/Banco)

- [ ] Deployment Convex configurado
- [ ] Variáveis de ambiente configuradas (VITE_CONVEX_URL, CONVEX_DEPLOYMENT)
- [ ] Schema validado (sem erros de tipos)
- [ ] Funções Convex deployadas
- [ ] Storage configurado para fotos e documentos

---

## 🌐 Frontend

- [ ] Build de produção gera `dist/` sem erros
- [ ] PWA configurado (manifest, Service Worker)
- [ ] Responsivo: funciona em celular e desktop
- [ ] Rotas protegidas com RequireAuth
- [ ] Redirect após autenticação funciona corretamente

---

## 📊 Dados Iniciais

### Organizações
- [ ] Secretaria de Gestão e Governo Digital criada
- [ ] Departamentos cadastrados
- [ ] Unidades cadastradas

### Categorias
- [ ] Toner/Insumos
- [ ] Hardware
- [ ] Software
- [ ] Rede
- [ ] Periféricos
- [ ] Outros

### Produtos
- [ ] Produtos essenciais cadastrados
- [ ] Estoque inicial registrado via Entradas
- [ ] Lotes gerados automaticamente

### Estoque
- [ ] Estoque inicial conferido
- [ ] Locais de armazenamento cadastrados

### Impressoras Gomaq
- [ ] Impressoras cadastradas
- [ ] Compatibilidade toner↔impressora configurada

### Equipamentos
- [ ] Equipamentos patrimoniais cadastrados

### Licenças
- [ ] Licenças de software cadastradas

### Usuários
- [ ] Administradores criados
- [ ] Responsáveis pelo estoque criados
- [ ] Técnicos criados
- [ ] Senhas iniciais definidas

---

## ✅ Validação Final

- [ ] Login funciona para todos os papéis
- [ ] Dashboard carrega indicadores
- [ ] Entrada de estoque confirma corretamente
- [ ] Solicitação é criada e aparece para aprovação
- [ ] Aprovação reserva estoque
- [ ] Entrega baixa estoque e registra recebedor
- [ ] Cancelamento libera reserva
- [ ] Devolução retorna estoque
- [ ] Transferência entre locais funciona
- [ ] Inventário contagem e fechamento funciona
- [ ] GomaQ troca registra carcaça
- [ ] GomaQ coleta atualiza status
- [ ] Equipamento pode ser criado e atribuído
- [ ] Manutenção pode ser registrada
- [ ] Peça pode ser instalada (reduz estoque)
- [ ] Licença pode ser vinculada a equipamento
- [ ] Relatórios exportam CSV
- [ ] Auditoria registra todas as operações
- [ ] Mensagens de erro são claras ao usuário

---

## 🚀 Deploy

- [ ] Frontend deployado (Vercel/Netlify/estático)
- [ ] Backend Convex deployado (`bun convex deploy`)
- [ ] Domínio configurado
- [ ] HTTPS habilitado
- [ ] `CONVEX_SITE_URL` atualizado com domínio de produção

---

## 📋 Pós-Deploy

- [ ] Teste de login em produção
- [ ] Teste de fluxo completo em produção
- [ ] Verificar PWA instala em celular
- [ ] Verificar Performance em conexão lenta
- [ ] Documentar processo de backup
- [ ] Treinar usuários finais

---

## 🔄 Atualizações Futuras

Para atualizar o sistema:

```bash
git pull origin main
bun install
bun convex dev --once
bun run build
# Deploy automático (se CI/CD configurado)
```

---

## 📞 Contato

- **Suporte Técnico**: [email do responsável]
- **Repositório**: [URL do GitHub]
- **Convex Dashboard**: https://dashboard.convex.dev
