# Verificação executada em 2026-11-05

Ambiente: Windows, Node 24.14.1, npm 11.11.0, Chrome 157.0.8103.38. Dependências instaladas localmente; npm informou zero vulnerabilidades na instalação. Nenhuma configuração global foi alterada.

| Verificação | Resultado observado |
| --- | --- |
| TypeScript / typecheck | passou |
| Compilação dist | passou |
| Sintaxe do userscript (node --check) | passou |
| npm test | 29 testes passaram; 1 teste Chrome opt-in ignorado nessa execução (após ajuste de prompts gerais e espera MCP) |
| npm run test:chrome | 1 teste passou separadamente: CDP real, dois agentes, editores textarea e contenteditable, reload gerenciado, resultados e preservação de aba desconhecida |
| Servidor HTTP real | iniciou e respondeu /health |
| MCP stdio real | cliente SDK listou 10 ferramentas e chamou get_system_status com sucesso |
| SQLite real | PRAGMA integrity_check retornou ok |
| Chrome dedicado | iniciado com perfil separado em .local/chrome-profile |
| Bind HTTP/CDP | Get-NetTCPConnection confirmou 127.0.0.1:3333 e 127.0.0.1:9222 |
| Tampermonkey real registrado | pendente de instalação/configuração pelo usuário |
| ChatGPT real, um agente | passou: tarefa 01d3d873-3546-4597-ab73-241eca5350d7 completed na primeira tentativa, JSON retornado ao MCP |
| ChatGPT real, dois agentes | passou com prompts gerais literais: duas tarefas simultâneas, completed na primeira tentativa e resultados conferidos pelo Codex |
| ChatGPT real, três agentes a partir do Google | passou: três abas criadas automaticamente, três tarefas completed na primeira tentativa, Google preservado |

O diagnóstico retorna exit code 1 enquanto a ponte real não estiver registrada. Isso é esperado nesta etapa: as verificações HTTP/MCP/CDP/SQLite passaram, mas a condição de prontidão completa ainda não foi satisfeita. A integração em HTML controlado simula grants Tampermonkey e respostas; não prova funcionamento da extensão ou dos seletores no ChatGPT autenticado.

Os primeiros testes foram bloqueados por EPERM ao iniciar workers no sandbox. A suíte foi executada com permissão para processos locais. Falhas de desenvolvimento foram corrigidas antes dos resultados registrados acima.

## Ajuste do userscript 0.1.2

Após relato de DOM_TIMEOUT com editor vazio, foram ampliados os seletores e adicionados diagnóstico sem conteúdo e erros por etapa. A integração CDP com Chrome passou incluindo contenteditable vazio, editor aninhado, textarea, campo oculto, botão composer-submit-button e ausência de editor. Na ausência de editor, o teste confirmou DOM_EDITOR_TIMEOUT e diagnóstico sem token. Sintaxe do userscript validada com node --check. A confirmação na página autenticada do usuário continua pendente da atualização do script instalado e de um novo teste.

## Ajuste do userscript 0.1.3

O teste real relatado pelo usuário enviou a pergunta, mas falhou ao reconhecê-la (DOM_MESSAGE_ACK_TIMEOUT). A confirmação deixou de depender de data-message-author-role e do UUID embutido na pergunta. Foram removidos os IDs do prompt e o esquema JSON padrão que contradizia o formato pedido pelo usuário. A integração Chrome passou com marcações alternativas, pergunta sem atributo de papel, botões de ação separados do conteúdo e pergunta repetida na mesma conversa, confirmando a segunda resposta e apenas um envio por tarefa. Também passaram 28 testes de unidade/serviço/HTTP/MCP, compilação, typecheck e sintaxe do userscript. A conclusão do fluxo com ChatGPT autenticado continua pendente do novo teste manual.

## Ajuste do userscript 0.1.4

O usuário mostrou a resposta correta visível na página, mas a tentativa terminou com DOM_RESPONSE_TIMEOUT e messageCounts zerados, sem messageHints. Portanto, a geração remota funcionou; a captura da ponte falhou. A integração Chrome foi ampliada para resposta sem article, sem atributo de autor e sem markdown, usando a estrutura de conteúdo/barra de ações. Também validou conteúdo rico sem autor, repetição da mesma pergunta sem capturar resposta antiga e rejeição de um JSON em aviso externo à conversa quando não existe resposta. O teste de integração passou; node --check passou. Os testes são em página controlada. Uma inspeção CDP somente de leitura na instância dedicada não encontrou a resposta do exemplo; não foi possível confirmar que essa é a mesma janela da imagem. A captura da página real continua pendente da instalação da versão 0.1.4 e novo teste.

## Ajuste do userscript 0.1.5

Uma nova inspeção CDP encontrou a resposta real {"resultado":391} em SPAN/P dentro de DilResponseRoot-HfQrEh e MarkdownRoot-rZKhxa, sem .markdown ou atributos de autor. O adaptador agora reconhece o prefixo estável MarkdownRoot-, independentemente do sufixo CSS, e mantém a raiz externa inteira. Foi adicionado teste com a estrutura observada, oito níveis de wrappers e mudança de sufixo. A integração Chrome passou novamente, incluindo pergunta repetida e rejeição de aviso externo; sintaxe do userscript e dos scripts de diagnóstico passou. Durante a tentativa posterior de executar o adaptador completo somente em leitura, a pergunta original não foi encontrada na página acessível. Portanto, a extração completa na conversa real e o retorno ao MCP não foram confirmados. A confirmação depende de manter a conversa original aberta; nenhuma tarefa failed foi alterada para completed.

Após o usuário voltar à conversa original, `node scripts/verify-capture.mjs 711d5c8b-bed3-4481-9389-30587fc8f3f9` passou na página real: matched=true, method=rich-content, rawText={"resultado":391}, following=true e sameConversation=true. Foi executado somente o adaptador de leitura do arquivo local 0.1.5. Nenhuma pergunta foi enviada e nenhum resultado persistido foi modificado. Isso confirma a captura na conversa autenticada; o ciclo completo com uma nova tarefa e envio automático de /complete ao MCP ainda precisa ser verificado separadamente.

## Fluxo real e teste com duas abas

O resultado de 01d3d873-3546-4597-ab73-241eca5350d7 foi consultado via MCP: completed, attempts=1, error=null, rawText={"resultado": 391} e structured.resultado=391. Isso confirma o fluxo completo de um agente real.

Ao iniciar o teste de duas abas, a abertura automática esbarrou no diretório temporário global do Playwright. ChromeDriver passou a usar artifactsDir dentro do dataDir configurado; typecheck, build e integração Chrome com esse diretório passaram. O servidor foi reiniciado sem tarefas ativas e criou/registrou duas abas gerenciadas com IDs e tabIds diferentes; CDP connected=true. As primeiras tarefas ALFA/BETA falharam antes do envio com COMPOSER_NOT_EMPTY. A leitura de atributos/comprimentos dos editores confirmou 193 caracteres em cada aba nova; o conteúdo não foi apagado. Solicitada limpeza manual dos rascunhos descartáveis antes de novas tarefas. O teste paralelo ainda não está aprovado nesta etapa.

## Resultado final do teste paralelo real

Depois de limpar os rascunhos, as primeiras execuções simultâneas tiveram resultados diferentes: BETA concluiu com frutas ordenadas e ALFA exibiu uma resposta realmente vazia, terminando em DOM_RESPONSE_TIMEOUT. A inspeção confirmou rich-content encontrado com texto vazio; não foi um JSON visível perdido pelo capturador. Não foi possível atribuir essa resposta vazia exclusivamente ao formato do prompt.

Para o controle, agentes com role geral/general passaram a receber exatamente task.prompt, sem preâmbulo. Especialidades explícitas mantêm o contexto curto. Foram adicionados testes dessa distinção e corrigida a espera MCP para retornar done=false ao atingir seu prazo, sem iniciar uma consulta HTTP com timeout de 1ms. Typecheck/build e 29 testes passaram. Após reiniciar o servidor, o Chrome restaurou rascunhos: o diagnóstico comparou-os integralmente com o prompt da tarefa BETA já concluída 79a0b96d-284b-4f78-915b-5a49f92d920c. Antes de limpar somente essas cópias conhecidas, foram salvos backups em .local/recovered-smoke-draft-*.json. Textos não reconhecidos são preservados; o utilitário prepare-smoke-editors.mjs é somente leitura por padrão e exige --clear-owned para editar.

O controle individual 9d526dee-07fd-412b-a0d7-11f48f230f3c retornou 391, completed, attempts=1. Em seguida foram delegadas duas perguntas literais e independentes em paralelo, reutilizando as conversas de teste com newConversation=false:

| Tarefa | Agente / aba | Pergunta | Resultado MCP |
| --- | --- | --- | --- |
| 0d1158bc-c192-4793-822d-d17c7969ad98 | agente 8f3e956e-3807-44e5-ae44-306f3d924769, tabId 2d2035d6-2a2c-484e-a914-846ae550baa2 | Quanto é 19 vezes 31? Responda apenas com o número. | rawText=589, structured=589, completed, attempts=1, error=null |
| e065dad5-d349-411b-bb5c-eeda544f2857 | agente dc29928a-d586-4956-9cf2-1408d5488ca1, tabId 179b6543-2996-44fb-a4f8-ba57163d591a | Quanto é 23 vezes 29? Responda apenas com o número. | rawText=667, structured=667, completed, attempts=1, error=null |

Uma consulta de status capturou os dois agentes busy e as duas tarefas running simultaneamente. A interseção dos intervalos entre reserva (deadline menos 10 minutos) e conclusão foi 14.855ms. ExecutionIds diferentes e respostas correspondentes foram verificados. O Codex conferiu independentemente 19*31=589 e 23*29=667, sem executar conteúdo dos agentes. O limite maxAgents continuou 4 e o prazo de ociosidade voltou ao valor padrão de 5 minutos após o reinício. As duas abas ficaram ociosas ao final. O teste comprova o ciclo real de duas abas com esses prompts; não garante ausência de respostas vazias futuras do ChatGPT nem confirma a causa da tentativa anterior.

## Três abas reais a partir do Google

O teste documentado em [test-three-tabs.md](test-three-tabs.md) foi executado e aprovado. O ponto de partida tinha somente uma aba Google; Codex verificou limites/ausência de agentes ativos, criou três agentes via MCP, aguardou registro, recuperou somente cópias exatas de rascunho de teste com backup e delegou três tarefas independentes. Resultados retornados: 703, 943 e 1275, todos completed na primeira tentativa, sem erro. Os três agentes foram observados busy simultaneamente, com interseção de execução local de 7.932ms. O ID e o hash da URL da aba Google foram conferidos antes/depois e permaneceram iguais. Ao final havia uma aba Google e três abas ChatGPT; os três agentes estavam idle. Não foi executado código recebido dos agentes.
