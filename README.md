# Codex Orchestrator + Ponte GPT

Plataforma local em TypeScript: o Codex delega pelo MCP stdio; um servidor HTTP com SQLite reserva tarefas; cada aba do Chrome executa um agente pelo Tampermonkey. Os executores usam a interface web do ChatGPT, sem API OpenAI. As respostas retornam como conteúdo para revisão, sem execução de código no computador.

**Versão experimental 0.1.0.** O fluxo real foi validado com um, dois e três agentes no Windows. A automação depende do DOM do ChatGPT e pode exigir manutenção quando a interface mudar; não há garantia de disponibilidade ou respostas sem falhas. Consulte [as evidências](docs/verification.md) e [as limitações](docs/architecture.md).

## Instalação e inicialização no Windows

Node **24 LTS recomendado**; mínimo 22.13. A instalação foi verificada com Node 24.14.1 e npm 11.11.0. O SQLite nativo pode emitir aviso experimental nessa versão. Dependências locais fixadas em package-lock.json; não é necessário instalar navegadores Playwright nem compiladores C++.

No PowerShell:

```powershell
git clone https://github.com/parrelladev/codex-gpt-orchestrator.git
cd codex-gpt-orchestrator
npm.cmd ci
npm.cmd run build
npm.cmd run setup
npm.cmd start
```

`setup` gera tokens novos na sua máquina e preserva uma configuração existente; nunca imprime tokens. A pasta `.local` não faz parte do repositório. `npm.cmd` evita o bloqueio de `npm.ps1` sem mudar a política do PowerShell. Em Linux/macOS use `npm` e ajuste caminhos; a validação manual desta versão foi feita no Windows.

Em outro terminal:

```powershell
npm.cmd run chrome
```

Esse comando abre uma janela **visível**, necessária para instalar extensão e entrar manualmente. Chrome usa `.local/chrome-profile`, CDP em `127.0.0.1:9222` e nenhuma alteração no perfil pessoal. Todas as abas gerenciadas compartilham esse perfil. Firefox pessoal permanece independente. Se necessário defina `$env:CHROME_PATH` com o executável do Chrome. Não use o perfil pessoal em `--user-data-dir`. Não exponha a porta CDP na rede.

## Instalar a ponte

1. Na janela dedicada, instale Tampermonkey pela loja oficial do Chrome e habilite a extensão.
2. Se Chrome/Tampermonkey solicitar, habilite a permissão **Allow User Scripts / Permitir scripts de usuário** na página de detalhes da extensão ou siga a instrução exibida pela versão instalada.
3. Crie um userscript, substitua o conteúdo pelo arquivo `userscript/ponte-gpt.user.js` e salve.
4. Faça login em `https://chatgpt.com/` manualmente e abra uma conversa vazia. Não há automação de login ou captura de credenciais.
5. Abra `.local/config.json` localmente. Copie somente **bridgeToken** para o menu Tampermonkey → **Ponte: configurar token e servidor**. O token fica no armazenamento privado da extensão. Nunca use `adminToken` no userscript.
6. Aceite a permissão de conexão a `127.0.0.1`, se solicitada. A aba mostrará “Ponte GPT: aguardando tarefa”. O botão flutuante permite pausar/retomar; pausar impede novas reservas, mantendo a tarefa atual.

A configuração de token vale para todas as abas; identidade e especialidade ficam no `sessionStorage` de cada aba. Cada documento recebe também um nonce novo. Uma aba duplicada recebe identidade distinta do servidor. Em aba criada pelo gerenciador, o CDP verifica o documento ao recarregar e preserva o agente, invalidando eventual execução anterior. Em aba manual ou de processo anterior, o reload cria novo agente e a sessão antiga expira. Após reinício do servidor, recarregue as abas que ficaram com sessão encerrada. Não digite na conversa enquanto a ponte executa uma tarefa.

## Conectar MCP ao Codex CLI e à extensão Codex no VS Code

O HTTP deve estar iniciado separadamente. O MCP não abre outro banco: usa o HTTP como escritor único. O token administrativo é lido do arquivo local; não precisa ser colocado no TOML. Não foi alterada a configuração global do Codex.

Adicione este trecho ao `%USERPROFILE%\.codex\config.toml` (CLI e extensão Codex), ou a `.codex/config.toml` de um projeto confiável:

```toml
[mcp_servers.ponte_gpt]
command = 'node'
args = ['C:\dev\codex-gpt-orchestrator\dist\mcp\main.js']
cwd = 'C:\dev\codex-gpt-orchestrator'
startup_timeout_sec = 15
tool_timeout_sec = 60
```

Substitua `C:\dev\codex-gpt-orchestrator` pelo caminho absoluto do seu clone. Confirme o caminho de Node com `Get-Command node`; use o caminho completo do executável em `command` se o cliente não encontrar `node` no PATH. Reinicie o cliente/servidores MCP e confira as dez ferramentas. A opção `PONTE_CONFIG` no ambiente do MCP permite escolher outro JSON por caminho absoluto. O arquivo `.env.example` é documentação; não existe carregamento implícito de `.env`.

Alternativamente, no CLI:

```powershell
codex mcp add ponte_gpt -- node 'C:\dev\codex-gpt-orchestrator\dist\mcp\main.js'
codex mcp list
```

O VS Code com a extensão **Codex** usa configuração Codex; um cliente MCP diferente pode ter seu próprio formato. Referência oficial consultada: [Model Context Protocol no Codex](https://learn.chatgpt.com/docs/extend/mcp).

## Usar pelo Codex

Peça: “Use a Ponte GPT para dividir esta tarefa em dois trabalhos independentes, revise os resultados, aplique as alterações e teste.” O `AGENTS.md` orienta planejamento, contexto mínimo, revisão e integração.

Sequência de ferramentas:

```text
get_system_status {}
list_agents {}
spawn_agent {"role":"backend"}
spawn_agent {"role":"testes","force":true}
delegate_task {"role":"backend","prompt":"...","newConversation":true}
delegate_task {"role":"testes","prompt":"...","newConversation":true}
wait_for_tasks {"taskIds":["UUID-1","UUID-2"],"timeoutMs":25000}
get_task_result {"taskId":"UUID-1"}
```

IDs reais são UUIDs retornados pelas ferramentas. `spawn_agent` reutiliza agente ocioso por padrão; `force:true` abre outro dentro dos limites. `delegate_task` aceita `agentId`, prioridade maior primeiro e dependências já existentes. Dependências liberam a reserva; resultados anteriores só entram no contexto se o Codex os incluir explicitamente. Especialidade é contexto operacional, não altera as instruções de sistema reais do ChatGPT.

Com `role: "geral"` (padrão), o prompt é enviado literalmente, sem cabeçalho adicional. Especialidades explícitas recebem um contexto curto de função. Para diagnosticar respostas vazias, comece com perguntas naturais curtas e confirme a resposta no navegador; não conclua que o formato do prompt foi a causa somente porque uma tentativa seguinte funcionou.

`scale_agents` define quantidade desejada naquela chamada. Criação automática posterior atende fila/minAgents quando `autoSpawn=true`. `wait_for_tasks` espera no máximo 25 segundos. Abertura de Chrome tem timeout; durante a chamada, `list_agents` mostra `starting`. Scale pode progredir parcialmente antes de esbarrar em limite; consulte o status antes de repetir.

## Configuração

Se uma tarefa falhar ao localizar o editor, confirmar o envio ou capturar a resposta visível, atualize o conteúdo do userscript no Tampermonkey para a versão 0.1.5, salve e recarregue o ChatGPT. A versão aparece no botão flutuante. Abra uma conversa vazia e retome a ponte se estiver pausada. A ponte verifica visibilidade, aceita contenteditable vazio/aninhado e ignora campos ocultos. Falhas do DOM pausam novas reservas para evitar repetição contínua. Se o servidor ainda for anterior à atualização 0.1.3, execute `npm.cmd run build` e reinicie `npm.cmd start` após parar o processo anterior com Ctrl+C. As atualizações de userscript após 0.1.3 não exigem reiniciar o servidor; basta salvar e recarregar a aba.

A versão 0.1.5 inclui o renderizador efetivamente observado no DOM do Chrome do usuário: `MarkdownRoot-…`, contendo `DilResponseRoot-…`, sem depender do sufixo CSS gerado. Prioriza a raiz externa completa, evitando capturar somente o último parágrafo ou botões de ação. A abertura de nova conversa também reconhece esse histórico. `scripts/verify-capture.mjs TASK_UUID` permite executar apenas o adaptador de leitura do userscript contra a pergunta/resposta já exibida no Chrome dedicado, sem enviar mensagens ou alterar o status persistido. Esse comando lê tokens somente do arquivo local e não os imprime; o relatório de captura contém o texto da resposta, portanto deve ser compartilhado apenas quando apropriado.

A versão 0.1.4 admite páginas sem atributos de autor: tenta conteúdo rico de resposta e, em seguida, conteúdo associado à barra de ações da mensagem. Exige que os elementos estejam depois da pergunta confirmada e no mesmo contêiner de conversa, sem incluir o editor. Não aceita texto genérico do body, avisos fora da conversa ou respostas anteriores. O diagnóstico inclui captureMethod, richContentCount e toolbarCount. Se houver dúvida sobre a janela, `npm.cmd run chrome` abre a instância dedicada; a extensão e a sessão precisam estar configuradas nessa instância. Uma instalação em outra janela/perfil não é automaticamente compartilhada.

O prompt agora tem contexto curto de especialidade e preserva o formato solicitado, sem impor outro esquema JSON. IDs de tarefa/execução ficam apenas no protocolo local. A confirmação procura o texto efetivamente enviado, normalizando quebras de linha e espaços; a captura admite marcações de mensagem alternativas e só considera respostas posteriores à nova mensagem. Não reenvia a pergunta automaticamente se faltar confirmação. Um timeout de confirmação também não aciona o botão de parada, para preservar eventual geração remota em andamento. Editor vazio/botão de envio ausente após o clique podem indicar envio normal; isoladamente não provam falha. Se não houver texto nem geração detectável após 90s, retorna DOM_RESPONSE_TIMEOUT, sem inventar resultado.

No menu Tampermonkey, **Ponte: diagnosticar página** mostra versão, contagem de editores, tipos/atributos dos campos e estado do envio, sem tokens nem conteúdo da conversa. Erros agora distinguem `DOM_EDITOR_TIMEOUT`, `DOM_NEW_CONVERSATION_TIMEOUT`, `DOM_SEND_BUTTON_TIMEOUT` e `DOM_MESSAGE_ACK_TIMEOUT`. Se persistir, copie esse diagnóstico para análise. Crie uma nova tarefa para repetir o teste; a tarefa anterior permanece no histórico como failed. `browser.connected=false` indica que o controlador ainda não se conectou por CDP; uma aba registrada manualmente pode executar via HTTP sem essa conexão.

Edite `.local/config.json` e reinicie HTTP/MCP para persistir mudanças. Valores iniciais:

```json
{
  "maxAgents": 4,
  "minAgents": 0,
  "idleTimeoutMinutes": 5,
  "maxTaskDurationMinutes": 10,
  "reuseIdleAgents": true,
  "autoCloseIdleAgents": true,
  "autoSpawn": true,
  "newTabsPerMinute": 4
}
```

Essas chaves ficam dentro de `limits`. Outros limites: heartbeat 45s, reserva renovável 60s, até 2 tentativas, até 200 tarefas pendentes. Tarefa excedente aguarda fila; capacidade de agentes nunca ultrapassa maxAgents. Falhas de Chrome causam espera progressiva de 30s até 5min, e fechamento impõe 15s antes de nova criação. Abas `starting` sem ponte expiram; não há criação ilimitada. Sem fila pronta, o gerenciador não cria agentes acima de minAgents.

`PATCH /config` aceita limites em tempo de execução com autenticação administrativa; a alteração não é persistente. Reduza agentes antes de reduzir maxAgents. Agentes com tarefas ativas não são encerrados por scale/terminate/ociosidade. Em shutdown explícito, tarefas são invalidadas e recuperáveis, e somente abas pertencentes ao processo atual são fechadas.

## Comandos e verificações

```powershell
npm.cmd run dev          # HTTP em desenvolvimento
npm.cmd run typecheck
npm.cmd run build
npm.cmd test             # agentes e navegador simulados; teste Chrome separado fica skipped
npm.cmd run test:chrome  # Chrome real headless, CDP + página simulada + dois userscripts
npm.cmd run diagnose    # Node, HTTP, MCP stdio, Chrome, CDP, ponte, agentes e SQLite
npm.cmd run manual      # ChatGPT real: um agente ocioso já registrado
npm.cmd run manual -- --two  # ChatGPT real: dois agentes ociosos já registrados
```

Consulte [o protocolo HTTP](docs/protocol.md), [o teste manual e a matriz de aceitação](docs/manual-test.md) e [as decisões e limitações](docs/architecture.md).

## Arquivos

```text
src/
  server/       Fastify, rotas, shutdown e manutenção
  mcp/          SDK oficial, dez ferramentas e transporte stdio
  browser/      CDP, propriedade de abas e escalonamento
  agents/       identidades, heartbeat, estados e coordenação
  tasks/        contratos Zod, estados e erros
  database/     SQLite, transações e eventos
  security/     autenticação e nomes seguros
  config/       configuração validada e caminhos
userscript/     ponte por aba
scripts/        setup, Chrome, diagnóstico e testes de integração
tests/          fila, concorrência, segurança, MCP e Chrome
docs/           protocolo, arquitetura e aceite manual
.local/         tokens, banco, anexos e perfil (ignorado pelo Git)
```

O servidor HTTP não executa comandos e o MCP nunca aplica código retornado. Ctrl+C encerra o servidor de forma controlada. Feche o Chrome dedicado manualmente depois de terminar; o processo Chrome e abas desconhecidas são preservados pelo controlador.

O controlador grava artefatos do Playwright em `.local/browser-artifacts`, evitando depender de permissão no diretório temporário global do Windows. Em teste com duas abas, confirme que os dois editores estão vazios: o ChatGPT pode restaurar rascunhos ao abrir abas. A ponte retorna COMPOSER_NOT_EMPTY e preserva esse conteúdo; limpe manualmente apenas rascunhos descartáveis antes de criar novas tarefas.
