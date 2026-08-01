type Level = 'info' | 'warn' | 'error';

/** Structured logs. One line of JSON per event, so you can grep a failed run later. */
export function log(level: Level, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function step(name: string) {
  const started = Date.now();
  return {
    done(data: Record<string, unknown> = {}) {
      log('info', `step.${name}`, { ms: Date.now() - started, ...data });
    },
  };
}
