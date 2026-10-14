import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { spawnSync } from 'child_process';
import { Config } from './shared/config';
import { LogOptions, Env } from './shared/types';
import { parseForceFlag, parseLogOptions, parseStringFlag, parseEnvFlag } from './shared/args';
import { Color as c } from './shared/colors';
import { showDiff, filesAreTheSame, isBinary } from './shared/diff';

// NationBuilder's attachments admin page lists this many items per page.
const ATTACHMENTS_PAGE_SIZE = 500;

class DropboxPusher {
  private readonly srcDir: string;
  private readonly distDir: string;
  private readonly dropboxDir: string;
  private readonly logOpts: LogOptions;
  private readonly force: boolean;
  private readonly publishLink: string | undefined;
  private readonly configOverride: string | undefined;
  private readonly mappingsOverride: string | undefined;

  constructor(
    config: Config,
    env: Env,
    logOpts: LogOptions,
    force: boolean,
    configOverride: string | undefined,
    mappingsOverride: string | undefined
  ) {
    const projectConf = config.getProject();
    this.srcDir = config.getSrcDir();
    this.distDir = projectConf.dist;
    const envConf = config.getEnv(env);
    this.dropboxDir = envConf.dropbox;
    this.publishLink = this.normalizePublishLink(envConf.publish_link);

    this.logOpts = logOpts;
    this.force = force;
    this.configOverride = configOverride;
    this.mappingsOverride = mappingsOverride;
  }

  public async preflight(): Promise<void> {
    this.log(this.srcDir,     c.BLUE, '\nPushing from: ', true);
    this.log(this.distDir,    c.CYAN,   '     through: ', true);
    this.log(this.dropboxDir, c.GREEN,  '          to: ', true);
    console.log('');
  }

  public async push(): Promise<void> {
    // Compile dist so it's fresh
    this.runCompileStep();

    // Walk dist and push changes to Dropbox
    this.log('Checking for changes...')
    const distFiles = this.getAllFiles(this.distDir);
    let pushed = 0;
    let skipped = 0;

    for (const distFile of distFiles) {
      // Get dropbox file path
      const relPath = path.relative(this.distDir, distFile).replace(/\\/g, '/');
      const dropboxFile = path.join(this.dropboxDir, relPath);

      // If files are identical → skip
      const isNew = !fs.existsSync(dropboxFile);
      if (!isNew && filesAreTheSame(distFile, dropboxFile)) {
        continue;
      }

      // Log proposed change
      const statusLabel = isNew ? 'new file' : 'modified';
      this.log(`\n${relPath} (${statusLabel})`, c.CYAN, '', true);
      if (!isNew && !isBinary(distFile)) {
        showDiff(dropboxFile, distFile, relPath, this.logOpts.color);
      }

      // Get confirmation from user (optional)
      let doPush = this.force;
      if (!this.force) {
        doPush = await this.confirm('Push this change? [y/N] ');
      }

      // Perform copy!
      if (doPush) {
        this.createFileDir(dropboxFile);
        fs.copyFileSync(distFile, dropboxFile);
        this.log('  pushed', c.GREEN, '', true);
        pushed++;
      } else {
        this.log('  skipped', c.YELLOW, '', true);
        skipped++;
      }
    }

    // Report Dropbox files absent from dist (informational only)
    // TODO: Could implement deleting here in the future
    const distRelPaths = new Set(
      distFiles.map(f => path.relative(this.distDir, f).replace(/\\/g, '/'))
    );
    for (const dropboxFile of this.getAllFiles(this.dropboxDir)) {
      const relPath = path.relative(this.dropboxDir, dropboxFile).replace(/\\/g, '/');
      if (!distRelPaths.has(relPath)) {
        this.log(`\n${relPath} (only in Dropbox — not touched)`, c.YELLOW, '', true);
      }
    }

    this.log(`\nPushed: ${pushed}, Skipped: ${skipped}.`, '', '', true);

    if (this.publishLink) {
      this.log(`\nPublish at: ${this.publishLink}/page_templates`, c.CYAN, '', true);
      this.log(  `        or: ${this.publishLink}`, c.CYAN, '', true);

      // Changed files can appear on later pages
      const totalPages = Math.ceil(distFiles.length / ATTACHMENTS_PAGE_SIZE);
      if (totalPages > 1) {
        for (let page = 2; page <= totalPages; page++) {
          this.log(`        or: ${this.publishLink}?page=${page}`, c.CYAN, '', true);
        }
      }
    }
  }

  private runCompileStep(): void {
    this.log('Compiling...', '', '', true);
    const args = [path.join(__dirname, 'compile.js'), '--quiet', '--no-color'];
    if (this.configOverride) args.push(`--config=${this.configOverride}`);
    if (this.mappingsOverride) args.push(`--mappings=${this.mappingsOverride}`);
    const compiled = spawnSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (compiled.status !== 0) {
      process.stderr.write(compiled.stderr);
      console.error('Compile step failed. Aborting.');
      process.exit(1);
    }
    this.log('Compiling done.', '', '', true)
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

  private async confirm(message: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
      rl.question(message, answer => {
        rl.close();
        resolve(answer.toLowerCase() === 'y');
      });
    });
  }

  private normalizePublishLink(publishLink: string | undefined): string | undefined {
    if (!publishLink) return publishLink;
    const trimmed = publishLink.replace(/\/+$/, '');
    return trimmed.endsWith('/attachments') ? trimmed : `${trimmed}/attachments`;
  }

  private createFileDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
  const configOverride = parseStringFlag('config');
  const mappingsOverride = parseStringFlag('mappings');
  const config = new Config(configOverride, mappingsOverride);
  const env = parseEnvFlag();
  const logOpts = parseLogOptions();
  const force = parseForceFlag();

  // Create pusher class
  const pusher = new DropboxPusher(config, env, logOpts, force, configOverride, mappingsOverride);

  // Show preflight info (src + dest paths)
  await pusher.preflight();

  // Compile, diff, and interactively push changes to Dropbox
  await pusher.push();

  // Done
  console.log('\nDone.\n');
}

main();
