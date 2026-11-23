# SIGESGD Capivari — Controle de Água Mineral

## Finalidade

Controlar a compra coletiva de água mineral feita pelos próprios funcionários, sem tratar esses recebimentos como compras institucionais. A quantidade de galões e os valores são informados manualmente; não há exigência de NF-e, DANFE, XML, AF ou empenho.

## Recebimentos

Cada recebimento pertence a um período de rateio aberto e registra data, galões cheios recebidos, galões vazios entregues ao fornecedor, valor total em centavos, origem/entregador opcional, pessoa que pagou opcional e observação. O valor unitário é derivado do total dividido pela quantidade recebida; o total original permanece como referência financeira.

## Períodos e rateio

O período pode ser mensal, bimestral ou personalizado. Só pode haver um período aberto por vez, para que cada recebimento tenha destino financeiro inequívoco. Vários recebimentos podem ser acumulados no período. Antes do fechamento, o responsável pode ajustar a lista dos participantes. No fechamento, o sistema congela os nomes dos participantes e divide o total em partes iguais, em centavos, distribuindo eventual resíduo de centavo deterministicamente.

## Participantes e pagamentos

Participantes são pessoas do controle de água, independentes das contas de acesso ao SIGESGD. Podem ser ativados/desativados sem apagar histórico. O fechamento gera uma parcela individual para cada participante. Pagamentos podem ser registrados integral ou parcialmente; o sistema calcula pago, pendente e situação individual.

## Galões retornáveis

O saldo de galões cheios e vazios é controlado separadamente. Recebimentos adicionam cheios e, quando houver troca, retiram vazios devolvidos. Consumo converte cheios em vazios. Devoluções ao fornecedor retiram vazios (ou cheios, quando aplicável). Ajustes iniciais/corretivos são auditados e não podem deixar qualquer saldo negativo.

## Auditoria e segurança

Consultas exigem `water.view`; qualquer alteração exige `water.manage`. Participantes, períodos, recebimentos, movimentos, fechamentos e pagamentos geram registros de auditoria. Nenhuma operação deste módulo altera estoque institucional, lotes, entradas fiscais ou financeiro da Prefeitura.

## Limites da primeira entrega

O módulo registra rateio e pagamentos informados pelo responsável; não movimenta contas bancárias, não gera cobrança automática e não substitui contabilidade ou prestação de contas institucional.
