# Teste real: partir do Google e executar três agentes

Objetivo: validar que o Codex decide criar/reutilizar agentes conforme três trabalhos independentes, sem transformar a aba pessoal do Google em agente e sem depender de abrir conversas manualmente.

Preparação manual única: deixe o Chrome dedicado com uma aba do Google. Mantenha Tampermonkey, userscript 0.1.5+ e sessão do ChatGPT configurados no mesmo perfil. HTTP/MCP devem estar funcionando. Não é preciso abrir três abas ChatGPT.

## Pedido ao Codex

```text
Execute um teste de integração da Ponte GPT a partir do Chrome dedicado aberto no Google.

Planeje como orquestrador e resolva estes três trabalhos independentes usando três agentes GPT em paralelo:
A. Calcular 19 vezes 37, respondendo apenas com o número.
B. Calcular 41 vezes 23, respondendo apenas com o número.
C. Somar os inteiros de 1 até 50, inclusive, respondendo apenas com o número.

Consulte limites e agentes antes de decidir quais reutilizar ou criar. Não peça que eu abra abas ChatGPT manualmente.
Preserve a aba do Google e qualquer outra aba desconhecida do gerenciador.
Use role geral para enviar as perguntas literalmente. Aguarde o registro dos agentes antes de delegar.
Não sobrescreva rascunhos desconhecidos. Se existirem resíduos de testes anteriores, identifique-os exatamente e preserve uma cópia antes de qualquer recuperação autorizada.
Confirme a execução simultânea nas três abas e a correspondência entre taskId, agentId, tabId e executionId.
Consulte cada resultado pelo MCP e confira-o independentemente. Não execute código retornado pelos agentes.
Ao final, reporte os resultados, erros, tentativas, número de abas criadas/reutilizadas e se a aba do Google foi preservada.
```

## Decisões esperadas

1. Verificar CDP e registrar IDs/hash de URL das abas do Google existentes, sem expor consultas de pesquisa.
2. Consultar get_system_status/list_agents e considerar somente agentes ativos com heartbeat recente. Históricos disconnected não contam como capacidade ocupada.
3. Escolher três agentes porque este é um teste explícito de três trabalhos independentes. Se já existirem agentes adequados, reutilizar; criar somente a diferença. O limite de agentes não conta a aba do Google.
4. Se uma antiga aba ChatGPT foi navegada para o Google, aguardar expiração de sua ponte antes de considerá-la disponível. Não fechar nem redirecionar essa aba.
5. Criar os agentes via MCP e esperar idle/registro. Manter número de agentes dentro de maxAgents e abertura dentro de newTabsPerMinute.
6. Delegar tarefas direcionadas a três agentes distintos, sem dependências. Observar os três ocupados simultaneamente.
7. Obter resultados MCP. Resultados esperados para conferência independente: A=703, B=943, C=1275.
8. Conferir que os mesmos IDs/hash das abas Google permanecem, sem navegação ou fechamento provocado pelo teste.
9. Deixar agentes disponíveis para reutilização/ociosidade conforme configuração. Não classificar o teste como aprovado se qualquer resposta faltar ou houver captura de tarefa errada.

O relatório deve distinguir preparação, criação/registro, execução simultânea, geração na interface e retorno ao MCP. Uma resposta correta em uma aba não basta para aprovar as três.

## Execução real em 2026-11-05: aprovada

Estado inicial confirmado por CDP: uma aba https://www.google.com e nenhuma aba ChatGPT. Não havia agentes ativos disponíveis; maxAgents=4 e newTabsPerMinute=4. O Codex escolheu criar três agentes para os três trabalhos independentes. O usuário não precisou abrir abas ChatGPT.

Foram criadas três abas via spawn_agent e aguardado registro idle. O Chrome restaurou nas três o rascunho exato da tarefa anterior e065dad5-d349-411b-bb5c-eeda544f2857. A comparação integral confirmou a origem; cada cópia foi preservada em .local/recovered-smoke-draft-*.json antes da limpeza controlada. Não houve remoção de texto desconhecido.

| Trabalho | Task ID | Agent ID | Resultado MCP |
| --- | --- | --- | --- |
| A: 19 × 37 | d1561775-6672-4366-967f-39d600984d77 | 75152a7b-fc51-4674-bd00-34fd99cdb652 | 703 |
| B: 41 × 23 | 7198c224-c4f8-48d3-a668-21b61835575d | 070bd8b1-f37a-4144-9f6b-db05257fabdd | 943 |
| C: soma de 1 a 50 | ae92bc50-e966-492e-ba0a-708163abbf1d | 8dcb6ff4-a634-424f-82f7-69536cd54495 | 1275 |

Todas usaram role geral, newConversation=true e terminaram completed, attempts=1, error=null. Os três agentIds, tabIds e executionIds eram distintos. Uma consulta capturou os três agentes busy simultaneamente; a interseção dos intervalos de execução das tarefas foi 7.932ms. Os resultados foram consultados pelo MCP e conferidos independentemente (19*37, 41*23 e soma explícita de 1 a 50).

Estado final: quatro abas, sendo três ChatGPT e a aba Google original. O ID do target Google permaneceu 30557EA5655C14C67B5A67E0461BD96F e o hash SHA-256 da URL permaneceu igual ao inicial. A aba não foi redirecionada nem fechada. Os três agentes ficaram idle, cada um com uma tarefa concluída, disponíveis para reutilização conforme a política de ociosidade.

Esse teste comprova a orquestração de três abas para essas tarefas e esse estado inicial. Não implica que toda tarefa futura terminará sem erros nem que o tempo interno de inferência do serviço remoto foi medido; a simultaneidade observada refere-se aos estados e intervalos de execução do sistema local.
