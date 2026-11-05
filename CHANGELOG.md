# Histórico

## 0.1.0 — 2026-11-05

Primeira versão experimental do orquestrador local.

- HTTP em localhost, SQLite persistente, reservas atômicas, heartbeat e recuperação limitada de execuções.
- Dez ferramentas MCP stdio para agentes, tarefas, escala e resultados.
- Chrome dedicado via CDP, propriedade explícita de abas e limites de criação/capacidade.
- Userscript Tampermonkey 0.1.5 com identidade por aba, cancelamento, parciais e captura de MarkdownRoot.
- Prompts gerais literais; contexto curto somente para especialidades explícitas.
- Autenticação com tokens separados e exclusão de dados locais do Git.
- Testes de serviço, concorrência, segurança, MCP e integração com Chrome controlado.
- Fluxos reais com um, dois e três agentes validados e documentados.

Limitações: mudanças na interface web podem quebrar seletores; podem ocorrer respostas vazias ou limites compartilhados da conta. Anexos são capturados apenas quando expostos como downloads blob. Histórico e anexos ainda não têm retenção automática. A ponte não executa código retornado pelos agentes.
