export function operationalPrompt(task:{role:string;prompt:string}) {
  if(['geral','general'].includes(task.role.trim().toLowerCase())) return task.prompt;
  return `Especialidade: ${task.role}. Não execute comandos nem delegue tarefas.\nSiga o formato de resposta solicitado na tarefa abaixo.\n\n${task.prompt}`;
}
