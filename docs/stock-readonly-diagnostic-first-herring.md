# Execução do diagnóstico read-only do estoque em DEV

Este workflow publica funções e schema apenas no deployment `dev:first-herring-264`
e executa `stockSetup:lotLocationMigrationReadinessInternal`, uma consulta interna
sem operações de escrita.

A execução é acionada por push na branch `codex/stock-readonly-diagnostic-first-herring`.
Antes da publicação, o workflow executa a suíte completa e a compilação de produção.
A chave é validada pelo prefixo exato `dev:first-herring-264`; os deployments oficiais
e de homologação são explicitamente rejeitados.

O relatório consolida saldos globais, saldos por armário, saldos dos lotes, propostas
documentais, itens bloqueados e o caso do Cooler. Não chama mutations, não executa
migração, não cria áreas e não altera quantidades.

## Execução pós-integração

A branch de execução usa o mesmo código já integrado à `main`. O push controlado
que inicia o workflow serve apenas como gatilho operacional; o workflow repete testes
e build antes de publicar em DEV e consultar o banco em modo read-only.

O workflow publica também um status no commit com link direto para a execução,
permitindo verificar o resultado, os logs e o resumo sem depender de uma leitura
manual da página de Actions.
