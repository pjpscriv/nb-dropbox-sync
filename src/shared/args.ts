import { LogOptions, Env } from './types';

export function parseLogOptions(): LogOptions {
  const rawArgs = process.argv;
  const args = rawArgs.slice(2);
  const color = !args.includes('--no-color') && !args.includes('--plain');
  const quiet = (args.includes('--quiet') || args.includes('-q'))
    && !args.includes('--verbose') && !args.includes('-v');
  return { color, quiet };
}

export function parseForceFlag(): boolean {
  return process.argv.includes('--force');
}

export function parseStringFlag(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

export function parseIntListFlag(flag: string): number[] | undefined {
  const raw = parseStringFlag(flag);
  if (raw === undefined) return undefined;
  return raw.split(',').map(s => parseInt(s.trim(), 10));
}

export function parseEnvFlag(): Env {
  const raw = parseStringFlag('env') ?? 'prod';
  if (raw !== 'prod' && raw !== 'test') {
    console.error(`Error: --env must be "prod" or "test" (got "${raw}").`);
    process.exit(1);
  }
  return raw;
}
