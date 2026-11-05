# Protocolo local v0.1

HTTP em `http://127.0.0.1:3333`. JSON em todas as rotas. Todas exigem `Authorization: Bearer TOKEN`, exceto `/health`. Não coloque token em query string. Não há CORS: a ponte usa `GM_xmlhttpRequest`. Origem presente só é aceita se igual a `https://chatgpt.com`; rotas administrativas rejeitam qualquer Origin. Autenticação administrativa e da ponte são separadas.

| Método / rota | Token | Dados e resposta |
| --- | --- | --- |
| GET /health | nenhum | ok, service, version |
| GET /status | admin | agents, tasks (resumo), limits, browser |
| GET /agents | admin | agents |
| POST /agents/spawn | admin | role?, force? → agent, reused |
| POST /agents/scale | admin | count → status |
| POST /agents/terminate | admin | agentId → state |
| PATCH /config | admin | patch de limits → limites temporários |
| POST /tasks | admin | prompt, role?, agentId?, priority?, dependencies?, newConversation? → Task |
| GET /tasks/:id | admin | Task, texto original e JSON reconhecido |
| GET /chat/:id | admin | alias de consulta de tarefa |
| POST /tasks/:id/cancel | admin | cancela de forma idempotente |
| POST /register | ponte | tabId, instanceId, role?, agentId?, ticket? → agent, duplicate |
| POST /heartbeat | ponte | agentId, instanceId, paused? → state, taskId |
| GET /next | ponte | query agentId, instanceId → task ou null |
| GET /execution | ponte | query agentId, instanceId, taskId, executionId → active |
| POST /partial | ponte | identidade da execução + rawText → status |
| POST /complete | ponte | identidade da execução + rawText, error? → status |
| POST /attachments | ponte | identidade da execução + name, mime, base64 → metadados |

IDs são UUIDs. Identidade da execução contém `agentId`, `instanceId`, `taskId`, `executionId`. Ela é obrigatória em cada escrita. `next` reserva e retorna `operationalPrompt`, `deadline` e `leaseUntil`. Não há reserva anônima v3: essa incompatibilidade é intencional para evitar duplicidade. `/chat/:id` retorna o registro JSON, não uma página HTML. O código original Ponte Local ChatGPT v3.0.2 não foi fornecido; preserva-se o fluxo de polling/complete/chat e sua finalidade, sem alegar compatibilidade integral de payloads ou seletores.

Erros: `{ "error": { "code": "STALE_EXECUTION", "message": "..." } }`. Códigos HTTP: 400 validação, 401 autenticação, 403 origem, 404 inexistente, 409 conflito/capacidade/execução inválida, 413 corpo excessivo, 429 criação limitada, 503 Chrome/encerramento. Mensagens internas e credenciais não entram nas respostas. Ferramentas MCP retornam `{ok,data}` ou `{ok:false,error}` e `isError`.

Corpo até 3 MiB; prompt até 100 mil caracteres; texto até 1 milhão de caracteres. Até 10 anexos de 2 MiB por execução, armazenados por UUID sem extensão no diretório `attachments`; nome original é apenas metadado. Não há rota pública de download nem execução. O Codex pode inspecionar os arquivos locais com as próprias permissões. Caminhos de anexos não são aceitos da ponte. JSON é reconhecido quando o texto inteiro é JSON ou um bloco cercado JSON; o texto original permanece em `rawText`. Uma falha sem novo texto preserva o último parcial.

Estados de tarefas: queued → assigned → running/streaming → completed/failed. Cancelamento e timeout são terminais. Heartbeat renova a reserva até o deadline fixo. Desconexão pode reenfileirar com outro executionId até maxAttempts; resultado antigo é rejeitado. Dependência falha/cancelada/expirada faz a dependente falhar. Erros funcionais do ChatGPT não são repetidos automaticamente.

Logs de domínio vão ao stderr como JSON e à tabela events. Incluem agentId, taskId, estado, duração, tentativas e causas estáticas; não incluem token, prompt ou texto retornado. O SQLite contém dados sensíveis completos: proteja `.local` com permissões da sua conta. Não há acesso externo autorizado a esse diretório.
