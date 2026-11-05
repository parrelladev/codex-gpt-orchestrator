# Aceitação manual com ChatGPT real

Pré-requisitos: HTTP iniciado, Chrome dedicado aberto, sessão autenticada manualmente, Tampermonkey/ponte instalados e bridgeToken configurado. `npm run diagnose` deve informar CDP e ponte registrados. Não cole tokens em saídas compartilhadas.

## Uma aba

1. Abra uma conversa vazia no Chrome dedicado. Confira “aguardando tarefa”.
2. No Codex, chame list_agents. Deve haver agente idle, com heartbeat recente.
3. Execute `npm.cmd run manual`, ou delegate_task com agentId retornado e prompt `Retorne apenas JSON: {"message":"ponte funcionando"}`.
4. Observe envio automático e parciais. Consulte get_task_status; deve chegar a completed.
5. Consulte get_task_result. Confira rawText não vazio, structured quando JSON reconhecido e completed incrementado no agente.

O script manual usa o SDK cliente MCP stdio real, cria tarefa direcionada, espera em blocos de 25s e consulta o resultado. Não simula a resposta.

## Dois agentes em paralelo

1. Chame spawn_agent com force=true para criar outra aba. Ela deve registrar-se automaticamente no perfil compartilhado.
2. Aguarde ambos idle. Se autoCloseIdleAgents fechar a aba antes de preparar o teste, reabra-a ou aumente idleTimeoutMinutes.
3. Execute `npm.cmd run manual -- --two`.
4. Observe duas conversas executando simultaneamente e confira executionIds distintos, duas respostas completas retornadas ao cliente MCP e nenhuma tarefa repetida.

## Falhas e propriedade de abas

1. Abra uma aba comum no Chrome dedicado. Não a crie pelo gerenciador.
2. Solicite scale_agents count=0 com agentes ociosos e minAgents=0. A aba comum deve permanecer aberta. Ponte manual pode passar a stopping sem fechar a aba.
3. Duplique uma aba com ponte ativa: confira tabId/agentId distintos em list_agents. Se já atingiu maxAgents, registro adicional deve ser recusado.
4. Crie maxAgents agentes; force de mais um deve falhar. Com tarefas excedentes, a fila deve aguardar.
5. Cancele uma tarefa em execução; a ponte deve solicitar parada na próxima verificação e `/complete` tardio não pode substituir cancelled.
6. Feche uma aba ocupada criada pelo gerenciador: tarefa deve reenfileirar com nova execução, limitada a maxAttempts. Se fechar aba manual, espere expirar heartbeat.
7. Reinicie HTTP por Ctrl+C e start: tarefas interrompidas devem ser recuperadas e IDs antigos invalidados. Recarregue pontes com sessão encerrada. Abas antigas não são adotadas para fechamento.

## Matriz de evidências

| Critério | Verificação |
| --- | --- |
| HTTP e SQLite | testes automatizados + diagnóstico de processo real |
| Dez ferramentas MCP | cliente SDK in-memory + diagnóstico stdio real |
| Abrir/fechar aba Chrome, preservar desconhecida | integração CDP real em página simulada |
| Registro, fila, dois agentes, captura do userscript | integração Chrome em HTML controlado com grants simulados |
| Limites, cancelamento, concorrência, recuperação | testes automatizados de serviço e HTTP |
| Extensão Tampermonkey e ChatGPT autenticado | pendente até execução manual nesta sessão |
| Retorno de ChatGPT real ao Codex | pendente até execução manual nesta sessão |

Não marque os dois últimos itens como aprovados com base em testes simulados. Registre versão do Chrome, extensão, data, resultado e eventual alteração de seletor ao realizar os testes.
