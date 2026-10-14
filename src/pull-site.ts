import * as path from 'path';
import * as fs from 'fs';
import { Config } from './shared/config';
import { LogOptions, Env } from './shared/types';
import { parseLogOptions, parseStringFlag, parseEnvFlag } from './shared/args';
import { Color as c } from './shared/colors';
import { getAllFiles, CLEAN_EXCLUDED } from './shared/files';

function log(opts: LogOptions, msg: string, ansiCode: string = '', override: boolean = false): void {
  if (opts.quiet && !override) return;
  console.log(opts.color && ansiCode ? `${ansiCode}${msg}${c.RESET}` : msg);
}

function main(): void {
  const config = new Config(parseStringFlag('config'), parseStringFlag('mappings'));
  const env: Env = parseEnvFlag();
  const opts = parseLogOptions();

  const { dropbox } = config.getSiteEnv(env);
  const siteDir = config.getSiteDir();

  log(opts, dropbox, c.CYAN, true);
  log(opts, `  → ${siteDir}\n`, c.GREEN, true);

  fs.mkdirSync(siteDir, { recursive: true });

  log(opts, 'Cleaning site directory...', '', true);
  for (const item of fs.readdirSync(siteDir)) {
    if (CLEAN_EXCLUDED.has(item)) {
      log(opts, `  ${item} (skipped — excluded from clean)`, c.YELLOW);
      continue;
    }
    fs.rmSync(path.join(siteDir, item), { recursive: true, force: true });
    log(opts, `  ${item} (deleted)`, c.RED);
  }
  log(opts, '');

  const files = getAllFiles(dropbox);
  for (const file of files) {
    const rel = path.relative(dropbox, file);
    const dest = path.join(siteDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    log(opts, `  ${rel}`);
  }

  log(opts, `Copied ${files.length} files.`, '', true);
  console.log('\nDone.\n');
}

main();
