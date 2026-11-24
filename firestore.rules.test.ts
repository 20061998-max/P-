import assert from 'node:assert';

// Especificação de testes das regras de segurança Firestore (Dirty Dozen)
export const DIRTY_DOZEN_CASES = [
  { name: 'Anonimo altera /settings/public', expected: 'PERMISSION_DENIED' },
  { name: 'Nao-admin cria /plans/hack', expected: 'PERMISSION_DENIED' },
  { name: 'Admin com email_verified=false edita settings', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow field isSuperAdmin em /plans/p1', expected: 'PERMISSION_DENIED' },
  { name: 'Dias fora do intervalo (-10) em /plans/p1', expected: 'PERMISSION_DENIED' },
  { name: 'List query aberta em /settings', expected: 'PERMISSION_DENIED' },
  { name: 'Nao-admin lista /offline_licenses', expected: 'PERMISSION_DENIED' },
  { name: 'createdByUid forjado em /offline_licenses/l1', expected: 'PERMISSION_DENIED' },
  { name: 'Timestamp updatedAt forjado diferente de request.time', expected: 'PERMISSION_DENIED' },
  { name: 'ID invalido maior que 128 chars', expected: 'PERMISSION_DENIED' },
  { name: 'Array features maior que 8 itens', expected: 'PERMISSION_DENIED' },
  { name: 'Leitura em colecao nao mapeada /users/123', expected: 'PERMISSION_DENIED' },
] as const;

assert.strictEqual(DIRTY_DOZEN_CASES.length, 12);
