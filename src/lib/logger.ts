/**
 * Minimal structured logger. In development it is chatty; in production it stays
 * quiet unless something is genuinely wrong. It never logs credentials.
 */
const isDev = import.meta.env.DEV;

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, data?: unknown): void {
  const line = `[last-breath:${scope}] ${message}`;
  // Debug and info are development-only noise; warnings and errors always
  // surface, because in production they are the only signal a player's console
  // will carry.
  if (level === 'warn') {
    if (data === undefined) console.warn(line);
    else console.warn(line, data);
    return;
  }
  if (level === 'error') {
    if (data === undefined) console.error(line);
    else console.error(line, data);
    return;
  }
  if (!isDev) return;
  if (data === undefined) console.info(line);
  else console.info(line, data);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, data?: unknown) => emit('debug', scope, message, data),
    info: (message: string, data?: unknown) => emit('info', scope, message, data),
    warn: (message: string, data?: unknown) => emit('warn', scope, message, data),
    error: (message: string, data?: unknown) => emit('error', scope, message, data),
  };
}

export type Logger = ReturnType<typeof createLogger>;
