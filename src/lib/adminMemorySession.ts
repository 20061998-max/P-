// Sessão administrativa por senha mantida estritamente em memória RAM (nunca em localStorage/sessionStorage).
let memoryAdminToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAdminPasscodeToken(): string | null {
  return memoryAdminToken;
}

export function setAdminPasscodeToken(token: string | null): void {
  memoryAdminToken = token;
  for (const listener of listeners) {
    listener(memoryAdminToken);
  }
}

export function subscribeAdminPasscodeToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  listener(memoryAdminToken);
  return () => {
    listeners.delete(listener);
  };
}
