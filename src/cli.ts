#!/usr/bin/env node
import * as path from 'path';
import { spawnSync } from 'child_process';

const COMMANDS = new Set(['init', 'pull', 'push', 'compile', 'compare', 'sync', 'task']);

function main(): void {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || !COMMANDS.has(subcommand)) {
    console.error(`Usage: nb-sync <${[...COMMANDS].join('|')}> [args...]`);
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, `${subcommand}.js`), ...rest],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

main();
