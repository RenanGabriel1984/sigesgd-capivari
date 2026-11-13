# SIGESGD Capivari — Plano de preparação e migração para a infraestrutura municipal

**Status:** planejamento técnico e requisitos de migração  
**Data de referência:** 12/11/2026  
**Destino:** infraestrutura administrada pela Prefeitura Municipal de Capivari  
**Regra de segurança:** este documento não autoriza migração, alteração de deployment, mudança de DNS ou operação sobre dados reais.

## 1. Objetivo

Preparar o SIGESGD para deixar o ambiente de desenvolvimento/hospedagem atual e operar em infraestrutura sob controle da Prefeitura, preservando integralmente:

- registros cadastrais e organizacionais;
- entradas, documentos fiscais, itens e lotes;
- saldos gerais, saldos por local e reservas;
- movimentações e vínculos com lotes;
- solicitações, aprovações, entregas, devoluções e transferências;
- equipamentos, unidades patrimoniais e históricos;
- licenças, impressoras, GomaQ e controle de água;
- usuários, perfis, permissões e histórico de auditoria;
- fotos, DANFEs, PDFs e demais arquivos;
- rotinas agendadas, índices e configurações necessárias ao funcionamento.

A migração só poderá ser considerada concluída depois de uma restauração de ensaio e de uma conferência de integridade independente.

## 2. Arquitetura atualmente observada no repositório

| Camada | Tecnologia/identificação | Observação |
|---|---|---|
| Interface | React, TypeScript e Vite | Aplicação SPA compilada em arquivos estáticos |
| Aplicação móvel | PWA / Service Worker | Cache de recursos estáticos; dados do Convex não devem ser armazenados em cache offline |
| Backend | Convex | Queries, mutations, actions, autenticação e lógica de negócio |
| Banco e arquivos | Convex deployment e Convex Storage | Precisam ser migrados em conjunto, com seus vínculos |
| Autenticação | Convex Auth + provider de credenciais SIGESGD | A configuração atual também contém um issuer federado Freebuff |
| E-mail de recuperação | Endpoint de e-mail Freebuff | Dependência externa que precisa ser substituída ou formalmente aprovada pela Prefeitura |
| Build | Vite | A pasta dist pode ser servida por servidor web estático |

A presença de vlyPlugin() no build e de um provider Freebuff na configuração de autenticação exige uma verificação específica de independência da plataforma. Essas integrações não devem ser removidas às cegas, pois podem fazer parte do fluxo de autenticação e desenvolvimento atual.

## 3. Arquitetura-alvo a validar

A arquitetura preferencial para a prova de conceito é:

1. **Frontend:** arquivos estáticos do Vite servidos por Nginx ou servidor web institucional, sob domínio da Prefeitura e HTTPS.
2. **Backend:** Convex auto-hospedado em containers, com versões fixadas e persistência configurada.
3. **Banco de dados:** armazenamento persistente suportado pela versão escolhida do backend. Avaliar PostgreSQL separado para o ambiente operacional; não adotar SQLite em volume efêmero.
4. **Arquivos:** armazenamento persistente separado para fotos e documentos, preferencialmente compatível com S3, ou volume persistente com política de backup validada.
5. **Proxy e TLS:** Nginx/Traefik ou solução institucional equivalente, encaminhando os domínios de API, site actions e interface administrativa.
6. **Painel administrativo:** acesso restrito à equipe de TI, preferencialmente por rede administrativa/VPN; não expor a chave administrativa na aplicação web.
7. **Operação:** logs centralizados, monitoramento, backup externo, teste de restauração e processo documentado de atualização.

O frontend não deve receber CONVEX_SELF_HOSTED_ADMIN_KEY, tokens de deploy, senhas de banco ou credenciais de armazenamento. O cliente recebe somente a URL pública do backend apropriada ao ambiente.

## 4. Dependências e limitações que precisam ser resolvidas

### 4.1 Convex auto-hospedado

A documentação oficial de auto-hospedagem descreve backend, dashboard e serviço de HTTP actions/site, com persistência em volume. O backend também pode ser configurado para utilizar banco SQL e armazenamento S3 compatível.

**Limitação crítica:** o README oficial informa que projetos que usam Convex Auth precisam de configuração manual no ambiente auto-hospedado e que o CLI ainda não oferece suporte completo a deployments auto-hospedados. Portanto, o SIGESGD não pode ser migrado diretamente sem uma prova de conceito que valide autenticação, emissão/verificação de tokens, sessões, funções HTTP, agendamentos e acesso ao dashboard.

Referências oficiais:
- https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md
- https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker/docker-compose.yml
- https://docs.convex.dev/auth/convex-auth

### 4.2 Autenticação e e-mail

O repositório contém:
- issuer de autenticação federada Freebuff em src/convex/auth.config.ts;
- envio de recuperação de senha pelo endpoint https://auth.freebuff.app/send_otp;
- variável FREEBUFF_EMAIL_API_KEY no backend.

Para a instalação municipal, precisamos:
- validar se o provider próprio do Convex funciona sem o issuer Freebuff;
- remover a dependência federada externa somente depois de testar o login de todos os perfis;
- implementar e testar SMTP ou relay institucional para recuperação de senha;
- manter respostas genéricas contra enumeração de contas;
- provisionar segredos no gerenciador institucional de segredos, nunca no repositório;
- testar redefinição, expiração, bloqueio, revogação e primeiro acesso.

Nenhuma credencial de usuário deve ser exportada em texto claro. A compatibilidade dos hashes e salts atuais deve ser preservada e testada; a troca do provedor de autenticação não pode redefinir senhas silenciosamente.

### 4.3 Importação e exportação de dados

A documentação oficial do Convex identifica Data Import/Export como recurso beta. Isso exige um ensaio real em ambiente isolado, com cópia dos dados e dos arquivos.

Não considerar um arquivo de exportação como prova suficiente de migração. Precisamos confirmar relações, IDs, arquivos, índices, funções, schedules, usuários e permissões após a restauração.

Referências:
- https://docs.convex.dev/database/import-export/
- https://docs.convex.dev/database/import-export/import

### 4.4 Dependências de plataforma

Antes do go-live, revisar:
- @vly-ai/integrations e vlyPlugin() no vite.config.ts;
- provider Freebuff em src/convex/auth.config.ts;
- serviço de e-mail em src/convex/email.ts;
- variáveis Vly/Freebuff;
- geração de URLs de arquivos;
- scripts de deploy e codegen do Convex.

O objetivo é garantir que o build e a operação possam ser executados por uma equipe da Prefeitura sem conta pessoal ou serviço obrigatório de terceiros não aprovado.

## 5. Plano de execução da migração

### Fase A — Inventário de infraestrutura

Registrar antes de instalar:
- servidor físico/VM, sistema operacional e versão;
- CPU, RAM, disco, RAID e espaço de crescimento;
- política de virtualização e containers;
- rede, DNS, VLAN, firewall e certificados;
- domínio institucional e acesso remoto;
- política de backup e local externo;
- responsável técnico e equipe autorizada.

Não publicar portas administrativas diretamente na internet.

### Fase B — Prova de conceito auto-hospedada

Criar um ambiente isolado, sem dados reais, e comprovar:
- backend e dashboard inicializam e permanecem saudáveis;
- frontend conecta ao backend por HTTPS;
- login, logout, primeiro acesso e recuperação de senha funcionam;
- RBAC mantém o bloqueio de usuários inativos e sem perfil;
- queries, mutations, actions e tarefas agendadas executam;
- upload/download de fotos e DANFEs funciona;
- PWA abre e atualiza sem cachear dados de negócio;
- logs e backups são produzidos e restaurados.

Falha em autenticação, armazenamento ou restauração bloqueia a migração.

### Fase C — Pacote de migração e reconciliação

Produzir:
- backup integral de dados do backend;
- exportação/cópia de documentos e fotos;
- inventário de tabelas, registros e índices;
- relação entre IDs e arquivos;
- lista de usuários e perfis sem exportar senhas em claro;
- inventário de variáveis, domínios e integrações;
- versão exata do código e dependências.

Após importação, comparar contagens por tabela, saldos de estoque, quantidades por lote/local, vínculos de entrada/nota, equipamentos, solicitações, movimentações e totais de auditoria. Validar também arquivos por amostragem e por hash quando o formato permitir.

### Fase D — Ensaio de corte

1. Criar backup verificável da origem.
2. Restaurar em homologação municipal isolada.
3. Executar testes funcionais com usuários e dados fictícios.
4. Simular interrupção e retorno ao ambiente anterior.
5. Corrigir divergências e repetir o ensaio.
6. Obter aceite técnico e administrativo.

### Fase E — Entrada em operação

Somente após autorização específica:
1. definir janela de manutenção;
2. bloquear temporariamente novas gravações na origem;
3. gerar backup final;
4. importar dados e arquivos finais;
5. conferir integridade e autenticação;
6. alterar DNS/configuração dos clientes;
7. monitorar a operação;
8. manter a origem preservada e em modo somente leitura durante o período de estabilização;
9. aplicar o plano de reversão se qualquer critério de aceite falhar.

Este plano não autoriza executar a Fase E neste momento.

## 6. Backup, restauração e continuidade

A rotina operacional deve contemplar:
- backup automatizado do banco;
- backup dos arquivos e documentos;
- cópia fora do servidor principal;
- criptografia e controle de acesso dos backups;
- retenção diária, semanal e mensal definida pela Prefeitura;
- registro do resultado de cada execução;
- alerta de falha e de espaço insuficiente;
- restauração periódica em ambiente isolado;
- documentação de RPO e RTO acordados com a TI municipal.

Um backup só será considerado válido depois de uma restauração concluída e conferida.

## 7. Critérios objetivos de aceite

A migração somente estará pronta quando todos estes itens tiverem evidência:

- [ ] Frontend implantado em domínio institucional e HTTPS.
- [ ] Backend auto-hospedado em versão fixada e suportada.
- [ ] Dados e arquivos persistentes e incluídos no backup.
- [ ] Autenticação sem dependência não aprovada de Freebuff/Vly.
- [ ] Recuperação de senha por serviço institucional testada.
- [ ] Todos os perfis e permissões testados.
- [ ] Totais de estoque conciliados por produto, área, local e lote.
- [ ] Entradas, solicitações, saídas, devoluções, transferências e reversões conciliadas.
- [ ] Auditoria histórica preservada e novos eventos registrados.
- [ ] Equipamentos e pendências de tombamento conciliados.
- [ ] Restauração de backup testada.
- [ ] Plano de rollback ensaiado.
- [ ] Manual de instalação, atualização e operação entregue.
- [ ] Aceite técnico e autorização administrativa registrados.

## 8. Regras de segurança para o desenvolvimento

- Nunca usar dados reais em testes destrutivos.
- Nunca executar rotinas de limpeza em deployment com dados operacionais.
- Nunca versionar arquivos .env, chaves, tokens ou senhas.
- Nunca apontar homologação para o backend de produção.
- Nunca trocar DNS, promover deployment ou migrar dados reais sem autorização expressa.
- Cada correção deve possuir teste de regressão e evidência de CI.
- Toda atualização de schema deve ser aditiva ou acompanhada de migração revisada e reversível.
