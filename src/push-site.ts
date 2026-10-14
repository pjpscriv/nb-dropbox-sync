import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { diffLines } from 'diff';
import { Config } from './shared/config';
import { LogOptions } from './shared/types';
import { parseForceFlag, parseLogOptions, parseStringFlag, parseEnvFlag } from './shared/args';
import { Color as c } from './shared/colors';
import { getAllFiles } from './shared/files';

const readNormalized = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

function log(opts: LogOptions, msg: string, ansiCode: string = ''): void {
  console.log(opts.color && ansiCode ? `${ansiCode}${msg}${c.RESET}` : msg);
}

function showDiff(opts: LogOptions, oldFile: string, newFile: string): void {
  for (const part of diffLines(readNormalized(oldFile), readNormalized(newFile))) {
    if (!part.added && !part.removed) continue;
    const sign = part.added ? '+' : '-';
    const color = part.added ? c.GREEN : c.RED;
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) log(opts, `${sign}${line}`, color);
  }
}

function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function main(): Promise<void> {
  const config = new Config(parseStringFlag('config'), parseStringFlag('mappings'));
  const env = parseEnvFlag();
  const opts = parseLogOptions();
  const force = parseForceFlag();

  const { dropbox, domain } = config.getSiteEnv(env);
  const siteDir = config.getSiteDir();
  if (!fs.existsSync(siteDir)) {
    console.error(`Error: site dir does not exist: ${siteDir}`);
    process.exit(1);
  }

  log(opts, `Pushing from: ${siteDir}`, c.BLUE);
  log(opts, `  → ${dropbox}\n`, c.GREEN);

  const modified: string[] = [];
  let skipped = 0;

  for (const file of getAllFiles(siteDir)) {
    const rel = path.relative(siteDir, file).replace(/\\/g, '/');
    const dest = path.join(dropbox, rel);
    const isNew = !fs.existsSync(dest);
    if (!isNew && readNormalized(file) === readNormalized(dest)) continue;

    log(opts, `\n${rel} (${isNew ? 'new file' : 'modified'})`, c.CYAN);
    if (!isNew) showDiff(opts, dest, file);

    if (force || await confirm('Push this change? [y/N] ')) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      log(opts, '  pushed', c.GREEN);
      modified.push(rel);
    } else {
      log(opts, '  skipped', c.YELLOW);
      skipped++;
    }
  }

  log(opts, `\nPushed: ${modified.length}, Skipped: ${skipped}.`);

  if (modified.length > 0) {
    log(opts, '\nModified pages:', c.CYAN);
    for (const rel of modified) {
      const slug = rel.replace(/\.html$/i, '');
      log(opts, `  https://${domain ?? '<SITE_DOMAIN>'}/${slug}`, c.CYAN);
    }
    if (!domain) log(opts, `\nSet "site_domain" in the "${env}" config entry to print real URLs.`, c.YELLOW);
  }
  console.log('\nDone.\n');
}

main();
