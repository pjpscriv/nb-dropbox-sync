import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { Config } from './shared/config';
import { LogOptions } from './shared/types';
import { parseLogOptions, parseStringFlag } from './shared/args';
import { Color as c } from './shared/colors';


const ALLOWED_EXTENSIONS = new Set([
  '.html',
  '.scss',
  '.js',
  '.png', '.jpg', '.jpeg', '.svg',
  '.css', '.map',
  '.json',
  '.eot', '.ttf', '.woff',
]);


const IGNORED_DIRS = new Set([
  '.git'
]);


class FileCompiler {
  private readonly srcDir: string;
  private readonly destDir: string;
  private readonly logOpts: LogOptions;

  constructor(config: Config, logOpts: LogOptions) {
    this.srcDir = config.getSrcDir();
    this.destDir = config.getProject().dist;

    this.logOpts = logOpts;
  }

  public compile(): void {
    // Validate src folder
    if (!fs.existsSync(this.srcDir) || !fs.statSync(this.srcDir).isDirectory()) {
      console.error(`Error: src folder not found: ${this.srcDir}`);
      process.exit(1);
    }

    // Clear + recreate dest folder
    if (fs.existsSync(this.destDir)) {
      fs.rmSync(this.destDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.destDir, { recursive: true });

    // Copy over files, flattening SCSS imports along the way
    const files = this.getAllFiles(this.srcDir);
    for (const srcFile of files) {
      const ext = path.extname(srcFile).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        const relSrc = path.relative(this.srcDir, srcFile);
        this.log(`  ${relSrc} (skipped - extension not whitelisted)`, c.DIM);
        continue;
      }

      const destFile = this.getDestFile(srcFile);
      const isScss = ext === '.scss';
      if (isScss) {
        this.copyScssFlattenImports(srcFile, destFile);
      } else {
        fs.copyFileSync(srcFile, destFile);
      }

      this.logSuccessfulCopy(srcFile, destFile, isScss);
    }

    this.log(`\n${files.length} Files copied and SCSS imports flattened.\n`, '', '', true);
  }

  private getAllFiles(dir: string): string[] {
    let results: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory() && !IGNORED_DIRS.has(file)) {
        results = results.concat(this.getAllFiles(filePath));
      } else {
        results.push(filePath);
      }
    }
    return results;
  }

  private getDestFile(srcFile: string): string {
    const relSrc = path.relative(this.srcDir, srcFile);

    if (relSrc === path.join('.vscode', 'settings.json')) {
      const vscodeDest = path.join(this.destDir, '.vscode');
      if (!fs.existsSync(vscodeDest)) {
        fs.mkdirSync(vscodeDest, { recursive: true });
      }
      return path.join(vscodeDest, 'settings.json');
    }

    return path.join(this.destDir, path.basename(srcFile));
  }

  private copyScssFlattenImports(srcFile: string, destFile: string): void {
    let content = fs.readFileSync(srcFile, 'utf8');
    content = content.replace(/@import\s+(["'])([^"']+)\1;/g, (_match, quote, importPath) => {
      const flatImport = path.basename(importPath);
      return `@import ${quote}${flatImport}${quote};`;
    });
    fs.writeFileSync(destFile, content, 'utf8');
  }

  private logSuccessfulCopy(srcFile: string, destFile: string, isScss: boolean): void {
    const relSrc = path.relative(this.srcDir, srcFile);
    const relDest = path.relative(this.destDir, destFile);
    const line = `  ${relSrc} → ${relDest}${isScss ? ' (imports flattened)' : ''}`;
    this.log(line, isScss ? c.HOT_PINK : '');
  }

  public async preflight(check: boolean = false): Promise<void> {
    this.log(this.srcDir,  c.CYAN,  '\nCompiling from: ', true);
    this.log(this.destDir, c.GREEN, '            to: ', true);

    if (check) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ok = await new Promise(resolve => {
        rl.question('Continue? [Y/n] ', answer => {
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

  private log(msg: string, ansiCode: string = '', prefix: string = '', override: boolean = false): void {
    if (this.logOpts.quiet && !override) return;
    let text = this.logOpts.color && ansiCode ? `${ansiCode}${msg}${c.RESET}` : msg;
    if (prefix.length > 0) text = prefix + text;
    console.log(text);
  }
}


async function main(): Promise<void> {
  // Load config and log options
  const config = new Config(parseStringFlag('config'), parseStringFlag('mappings'));
  const logOpts = parseLogOptions();

  // Create compiler class
  const compiler = new FileCompiler(config, logOpts);

  // Show preflight info (and optionally confirm)
  await compiler.preflight();

  // Do the thing!!
  compiler.compile();

  // Done
  console.log('\nDone.\n');
}

main();
