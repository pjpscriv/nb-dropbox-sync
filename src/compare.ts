import * as readline from 'readline';
import { diffLines } from 'diff';
import { compare, fileCompareHandlers, Result } from 'dir-compare';
import { readFileSync } from 'fs';
import { extname, join } from 'path';
import { Config } from './shared/config';
import { Env } from './shared/types';
import { parseStringFlag, parseEnvFlag } from './shared/args';
import { Color as c } from './shared/colors';

const SKIP_DIFF_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico',
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.fnt'
]);

const COMPARE_OPTIONS = {
  compareContent: true,
  compareFileAsync: fileCompareHandlers.lineBasedFileCompare.compareAsync,
  ignoreLineEnding: true,
  excludeFilter: '',
  includeFilter: '*',
  noDiffSet: false,
};


class DirectoryComparer {
  private readonly distDir: string;
  private readonly prodDir: string;
  private readonly showDiffs: boolean;

  constructor(config: Config, env: Env, showDiffs: boolean) {
    const { dist } = config.getProject();
    const { dropbox } = config.getEnv(env);
    this.distDir = dist;
    this.prodDir = dropbox;
    this.showDiffs = showDiffs;
  }

  public async compare(): Promise<void> {
    console.log(`\nComparing: ${this.distDir}`);
    console.log(`     with: ${this.prodDir}\n`);

    const res: Result = await compare(this.prodDir, this.distDir, COMPARE_OPTIONS);

    for (const entry of res.diffSet || []) {
      const isEqual = entry.state === 'equal';

      if (entry.type1 === 'file' && entry.type2 === 'file') {
        const status = isEqual ? '✅' : '⚠️';
        console.log(isEqual || this.showDiffs ? `${status} ${entry.name1}` : `${c.YELLOW}${status} ${entry.name1}${c.RESET}`);

        if (this.showDiffs && !isEqual) {
          this.printDiff(entry.name1!, entry.name2!);

          // Wait for user input before proceeding
          await this.confirm('Continue? ')
        }
      } else if (entry.type1 === 'file' && !entry.type2) {
        console.log(`${c.RED}❌ ${entry.name1} (only in output)${c.RESET}`);
      } else if (!entry.type1 && entry.type2 === 'file') {
        console.log(`${c.RED}❌ ${entry.name2} (only in Dropbox)${c.RESET}`);
      } else {
        console.log(`${c.YELLOW}⚠️ ${entry.name1 || entry.name2} (Type: ${entry.type1 || entry.type2})${c.RESET}`);
      }
    }

    if (res.same) {
      console.log(`${c.GREEN}\n ✅ All files are identical! ✅\n${c.RESET}`);
    } else {
      console.log(`${c.YELLOW}\n ⚠️ Some files differ or are missing. ⚠️\n${c.RESET}`);
    }
  }

  private printDiff(name1: string, name2: string): void {
    const ext = extname(name1).toLowerCase();
    if (SKIP_DIFF_EXTS.has(ext)) return;

    try {
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      const content1 = normalize(readFileSync(join(this.distDir, name1), 'utf8'));
      const content2 = normalize(readFileSync(join(this.prodDir, name2), 'utf8'));
      for (const part of diffLines(content1, content2)) {
        if (part.added) {
          process.stdout.write(`${c.RED}${part.value.replace(/^(?=.)/gm, '- ')}${c.RESET}`);
        } else if (part.removed) {
          process.stdout.write(`${c.GREEN}${part.value.replace(/^(?=.)/gm, '+ ')}${c.RESET}`);
        }
      }
    } catch (e) {
      console.error(`${c.RED}Error reading files for diff:${c.RESET}`, e);
    }
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
}


async function main(): Promise<void> {
  // Get args
  const showDiffs = process.argv.includes('--showDiffs');
  const env = parseEnvFlag();

  // Create config
  const config = new Config(parseStringFlag('config'), parseStringFlag('mappings'));

  // Create comparer
  const comparer = new DirectoryComparer(config, env, showDiffs);

  // Do the thing
  await comparer.compare();
}

main().catch(err => {
  console.error('Error comparing directories:', err);
});
