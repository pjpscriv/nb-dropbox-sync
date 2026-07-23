import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { spawnSync } from 'child_process';
import { Config } from './shared/config';
import { LogOptions, MappingRule, Env } from './shared/types';
import { parseLogOptions, parseStringFlag, parseEnvFlag } from './shared/args';
import { Color as c } from './shared/colors';

const CLEAN_EXCLUDED = new Set([
  '.git',
  '.gitattributes',
  '.gitignore',
  'README.md',
  'bot-deploy.ps1',

  'node_modules',
  'package.json',
  'package-lock.json',
  'nb-sync.config.json',
  'nb-sync.mappings.json',
  'sync.log',
]);


class DropboxPuller {
  private readonly dropboxDir: string;
  private readonly srcDir: string;
  private readonly distDir: string;

  private readonly logOpts: LogOptions;
  private readonly mappings: MappingRule[];

  constructor(config: Config, env: Env, logOpts: LogOptions) {
    const projectConf = config.getProject();
    this.dropboxDir = config.getEnv(env).dropbox;
    this.srcDir = config.getSrcDir();
    this.distDir = projectConf.dist;

    this.logOpts = logOpts;

    this.mappings = config.getMappings();
  }

  public async preflight(check: boolean = false): Promise<void> {
    this.log(this.dropboxDir, c.CYAN, '\nPulling from: ', true);
    this.log(this.srcDir,     c.GREEN,  '          to: ', true);

    // Do check before executing
    if (check) {
      const message = 'Continue? [Y/n] ';
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ok = await new Promise(resolve => {
        rl.question(message, answer => {
          rl.close();
          resolve(answer === '' || answer.toLowerCase() === 'y');
        });
      });
      if (!ok) {
        console.log('Aborted.');
        process.exit(0);
      }
    }

    console.log('');
  }

  public pull(): void {
    // Pull latest from git before touching anything
    this.gitPull();

    // Clean destination before copying
    this.cleanSrcDir();

    // Make sure dest dir exists
    this.createFolder(this.srcDir)

    // Get file list from Dropbox
    this.log('Copying files...', '', '', true);
    const files = this.getAllFiles(this.dropboxDir);

    // Iterate + copy over files
    for (const file of files) {
      // Get copy destination
      const dest = this.getDestPath(file);
      const destFolder = path.dirname(dest);
      this.createFolder(destFolder)

      // Copy SCSS file
      if (this.fileIsScss(file)) {
        const importsChanged = this.pullScss(file, dest)
        this.logCopiedFile(file, dest, importsChanged);
        continue;
      }

      // Copy all other file types
      fs.copyFileSync(file, dest)
      this.logCopiedFile(file, dest);
    }

    // Strip line-ending-only changes so they don't appear as real diffs
    this.stripLineEndingChanges();

    this.log(`Copied ${files.length} files.`, '', '', true)
  }

  private gitPull(): void {
    const check = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.srcDir, encoding: 'utf8' });
    if (check.status !== 0 || check.stdout.trim() !== 'true') {
      this.log('Skipping git pull - src dir is not in a git repo.', c.YELLOW);
      return;
    }

    this.log('Pulling latest from git...', '', '', true);
    const result = spawnSync('git', ['pull'], { cwd: this.srcDir, encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      this.log('git pull failed. Aborting.', c.RED, '', true);
      process.exit(1);
    }
    if (result.stdout.trim()) this.log(result.stdout.trim());
  }

  private stripLineEndingChanges(): void {
    this.log('\nStripping line-ending-only changes...\n', '', '', true);
    spawnSync('git', ['add', '.'], { cwd: this.srcDir, encoding: 'utf8' });
    spawnSync('git', ['restore', '--staged', '.'], { cwd: this.srcDir, encoding: 'utf8' });
  }

  private cleanSrcDir(): void {
    const destDir = this.srcDir;

    if (!fs.existsSync(destDir)) return;

    this.log('Cleaning destination directory...', '', '', true)
    for (const item of fs.readdirSync(destDir)) {
      if (CLEAN_EXCLUDED.has(item)) {
        this.log(`  ${item} (skipped — excluded from clean)`, c.YELLOW);
        continue;
      }
      fs.rmSync(path.join(destDir, item), { recursive: true, force: true });
      this.log(`  ${item} (deleted)`, c.RED);
    }
    this.log('Directory cleaning done.\n\n');
  }

  private getAllFiles(dir: string): string[] {
    let results: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        results = results.concat(this.getAllFiles(filePath));
      } else {
        results.push(filePath);
      }
    }
    return results;
  }

  private getDestPath(srcFile: string): string {
    // Variables
    const srcDir = this.dropboxDir;
    const destDir = this.srcDir;

    // Normalise to forward slashes so rules work cross-platform
    const relPath = path.relative(srcDir, srcFile).replace(/\\/g, '/');
    const base = path.basename(srcFile);

    for (const rule of this.mappings) {
      if (new RegExp(rule.match).test(relPath)) {
        return path.join(destDir, rule.dest, base);
      }
    }

    // No rule matched — copy flat to root of dest
    return path.join(destDir, base);
  }

  private fileIsScss(file: string): boolean {
    const ext = path.extname(file).toLowerCase();
    return ext === '.scss'
  }

  private pullScss(srcFile: string, destFile: string): boolean {
    // Folder
    const srcDir = this.dropboxDir;

    let content = fs.readFileSync(srcFile, 'utf8');

    // If no @import statements, nothing to resolve - copy as-is
    if (!/@import\s/.test(content)) {
      fs.copyFileSync(srcFile, destFile);
      return false;
    }

    const currentDestFolder = path.dirname(destFile);
    let anyTransformed = false;

    content = content.replace(/@import\s+(["'])([^"']+)\1;/g, (_match, quote, importName) => {
      // Reconstruct the partial filename and look up its destination folder
      const importFilename = `_${importName}.scss`;
      const importFilePath = path.join(srcDir, importFilename);
      const importDest = this.getDestPath(importFilePath);
      const importDestFolder = path.dirname(importDest);

      // Relative path from this file's dest folder to the imported file's dest folder
      const relDir = path.relative(currentDestFolder, importDestFolder).replace(/\\/g, '/');

      if (!relDir) {
        return `@import ${quote}${importName}${quote};`;
      }

      anyTransformed = true;
      const newImportPath = `${relDir}/${importName}`;
      this.log(`    @import '${importName}' → '${newImportPath}'`, c.PINK);
      return `@import ${quote}${newImportPath}${quote};`;
    });

    fs.writeFileSync(destFile, content, 'utf8');
    return anyTransformed;
  }

  private logCopiedFile(srcFile: string, destFile: string, importsChanged: boolean = false): void {
    const srcDir = this.dropboxDir;
    const destDir = this.srcDir;

    if (this.logOpts.quiet) return;
    const relSrc = path.relative(srcDir, srcFile);
    const relDest = path.relative(destDir, destFile);

    const line = `  ${relSrc} → ${relDest}${importsChanged ? ' (imports updated)' : ''}`;
    const color = importsChanged ? c.HOT_PINK : '';

    this.log(line, color)
  }

  private createFolder(path: string): void {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
  }

  private log(msg: string, ansiCode: string = "", prefix: string = "", override: boolean = false): void {
    if (this.logOpts.quiet && !override) {
      return;
    }
    let text = this.logOpts.color ? `${ansiCode}${msg}${c.RESET}` : msg;
    if (prefix.length > 0) {
      text = prefix + text;
    }
    console.log(text);
  }
}


async function main(): Promise<void> {
  // Load config
  const config = new Config(parseStringFlag('config'), parseStringFlag('mappings'));
  const env = parseEnvFlag();
  const opts = parseLogOptions();

  // Create puller class
  const puller = new DropboxPuller(config, env, opts)

  // Check before running (optional)
  await puller.preflight();

  // Do the thing!!
  puller.pull();

  // Done
  console.log('\nDone.\n');
}

main();
