import { expect,it } from 'vitest';
import { operationalPrompt } from '../src/tasks/prompt.js';
it('preserves the requested output schema without imposing a conflicting JSON schema',()=>{
  const prompt='Calcule 17 × 23 e responda apenas com JSON: {"resultado": número}';
  const result=operationalPrompt({role:'geral',prompt});
  expect(result.endsWith(prompt)).toBe(true);
  expect(result).toBe(prompt);
  expect(result).not.toContain('summary');expect(result).not.toContain('files:');expect(result).not.toContain('PONTE TASK');
});
it('adds role context only when an explicit specialty is requested',()=>{
  const prompt='Revise a proposta de arquitetura.';
  expect(operationalPrompt({role:'arquitetura',prompt})).toContain('Especialidade: arquitetura');
  expect(operationalPrompt({role:'arquitetura',prompt}).endsWith(prompt)).toBe(true);
});
