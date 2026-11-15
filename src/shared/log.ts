type Level = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[psc]';

function emit(level: Level, scope: string, args: unknown[]) {
  const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
  fn(`${PREFIX} ${scope}:`, ...args);
}

export function logger(scope: string) {
  return {
    debug: (...a: unknown[]) => emit('debug', scope, a),
    info: (...a: unknown[]) => emit('info', scope, a),
    warn: (...a: unknown[]) => emit('warn', scope, a),
    error: (...a: unknown[]) => emit('error', scope, a),
  };
}
