import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { Config } from './shared/config';
import { parseStringFlag, parseIntListFlag, parseEnvFlag } from './shared/args';
import { GitUser, CommitDetails, Env } from './shared/types';


class DropboxSyncer {
  private readonly logFile: string;
  private readonly gitDir: string;
  private readonly env: Env;
  private readonly commitDetails: CommitDetails;
  private readonly runAtNzHours: number[] | undefined;
  private readonly configOverride: string | undefined;
  private readonly mappingsOverride: string | undefined;

  constructor(
    config: Config,
    env: Env,
    commitDetails: CommitDetails,
    runAtNzHours: number[] | undefined,
    configOverride: string | undefined,
    mappingsOverride: string | undefined
  ) {
    this.logFile = path.join(process.cwd(), 'sync.log');
    this.gitDir = config.getSrcDir();
    this.env = env;
    this.commitDetails = commitDetails;
    this.runAtNzHours = runAtNzHours;
    this.configOverride = configOverride;
    this.mappingsOverride = mappingsOverride;
  }

  public sync(): void {
    if (this.runAtNzHours) {
      const nzHour = this.getNzHour();
      if (!this.runAtNzHours.includes(nzHour)) {
        this.log(`Skipping sync (NZ hour: ${nzHour}, scheduled for: ${this.runAtNzHours.join(',')}).`);
        return;
      }
    }

    this.log('');
    this.log('');
    this.log('=== sync started ===');

    // Confirm git repo is on main + up to date
    this.checkGitIsOnMainBranch();

    // Pull Dropbox files over to git repo
    this.pullDropbox();

    // Check if there are changes
    this.log('Checking if there are changes...');
    this.run('git', ['add', '.'], this.gitDir, 'git add', false);

    // If no changes - exit
    if (!this.hasChanges()) {
      this.log('No changes to commit - git push skipped.');
      this.log('=== sync finished ===');
      return;
    }

    // Commit & push
    this.commitAndPushChanges(this.commitDetails.user);
    this.log('=== sync finished ===');
  }

  private checkGitIsOnMainBranch(): void {
    this.log('Checking theme repo branch and pulling latest...');
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.gitDir, encoding: 'utf8' });
    const branch = branchResult.stdout.trim();
    if (branch !== 'main') {
      this.log(`ERROR: Theme repo is on branch '${branch}', not 'main'. Aborting.`);
      process.exit(1);
    }
    this.run('git', ['pull'], this.gitDir, 'git pull');
    this.log('Theme repo is on main and up to date.');
  }

  private pullDropbox(): void {
    this.log('Running dropbox-pull...');
    const args = [path.join(__dirname, 'pull.js'), `--env=${this.env}`, '--quiet', '--no-color'];
    if (this.configOverride) args.push(`--config=${this.configOverride}`);
    if (this.mappingsOverride) args.push(`--mappings=${this.mappingsOverride}`);
    this.run('node', args, process.cwd(), 'pull');
    this.log('dropbox-pull completed successfully.');
  }

  private hasChanges(): boolean {
    const result = spawnSync('git', ['status', '--porcelain'], { cwd: this.gitDir, encoding: 'utf8' });
    return result.stdout.trim().length > 0;
  }

  private commitAndPushChanges(user: GitUser): void {
    this.log('Pushing changes...');
    this.run('git', ['status'], this.gitDir, 'git status');
    const timestamp = this.getNztTimestamp();
    const commitMsg = `${this.commitDetails.msgPrefix} ${timestamp}`;
    const commitDesc = this.commitDetails.description ? ['-m', this.commitDetails.description] : [];
    
    const userArgs = ['-c', `user.name=${user.name}`];
    if (user.email) {
      userArgs.push('-c', `user.email=${user.email}`);
    }
    
    this.run('git', [...userArgs, 'commit', '-m', commitMsg, ...commitDesc], this.gitDir, 'git commit');
    this.run('git', ['push'], this.gitDir, 'git push');
    this.run('git', ['status'], this.gitDir, 'git status');
    this.log('Pushing changes complete.');
  }

  private getNzHour(): number {
    return parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', hour: 'numeric', hour12: false }).format(new Date()),
      10
    );
  }

  private getNztTimestamp(): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Auckland',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', hour12: true,
    }).formatToParts(new Date());

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}${get('dayPeriod').toLowerCase()}`;
  }

  private run(cmd: string, args: string[], cwd: string, tag: string, logResult: boolean = true): void {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

    if (logResult) {
      for (const line of (result.stdout + result.stderr).split('\n')) {
        if (line.trim()) this.log(`  [${tag}] ${line}`);
      }
    }

    if (result.error) {
      this.log(`ERROR: failed to run ${cmd}: ${result.error.message}`);
      process.exit(1);
    }

    if (result.status !== 0) {
      this.log(`ERROR: ${cmd} ${args[0]} exited with code ${result.status}. Aborting.`);
      process.exit(1);
    }
  }

  private log(msg: string): void {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `[${ts}] ${msg}`;
    fs.appendFileSync(this.logFile, line + '\n');
    console.log(line);
  }
}


function main(): void {
  // Read arguments
  const configOverride = parseStringFlag('config');
  const mappingsOverride = parseStringFlag('mappings');
  const commitMsg = parseStringFlag('commitMsg') ?? 'Dropbox auto-sync';
  const commitDesc = parseStringFlag('secondaryCommitMsg');
  const runAtNzHours = parseIntListFlag('runAtNzHours');
  const env = parseEnvFlag();

  // Load config
  const config = new Config(configOverride, mappingsOverride);

  // Set up git commit data
  const commitDetails: CommitDetails = {
    msgPrefix: commitMsg,
    description: commitDesc,
    user: config.getGitUser()
  };

  // Create syncer
  const syncer = new DropboxSyncer(config, env, commitDetails, runAtNzHours, configOverride, mappingsOverride)

  // Perform sync!
  syncer.sync();
}

main();
