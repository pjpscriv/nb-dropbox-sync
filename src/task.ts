import * as path from 'path';
import { spawnSync } from 'child_process';
import { Color as c } from './shared/colors';
import { Config } from './shared/config';
import { SchtasksResult, TaskQueryResult } from './shared/types';
import { parseStringFlag } from './shared/args';


class TaskScheduler {
  private readonly taskName: string;
  private readonly scriptPath: string;
  private readonly projectDir: string;
  private readonly extraSyncArgs: string;

  constructor(taskName: string, scriptPath: string, projectDir: string, extraSyncArgs?: string) {
    this.taskName = taskName;
    this.scriptPath = scriptPath;
    this.projectDir = projectDir;
    this.extraSyncArgs = extraSyncArgs ?? '';
  }

  public register(): void {
    const node = process.execPath;
    const extraArgs = this.extraSyncArgs ? ' ' + this.extraSyncArgs : '';
    const taskRunCommand = `cmd /c "cd /d "${this.projectDir}" && "${node}" "${this.scriptPath}"${extraArgs}"`;

    const result = this.runSchtasks([
      '/Create',
      '/TN', this.taskName,
      '/TR', taskRunCommand,
      '/SC', 'HOURLY', '/MO', '1', '/ST', '00:00',
      '/F',
    ]);

    if (result.status === 0) {
      console.log([
        `${c.GREEN}Task '${this.taskName}' registered successfully.${c.RESET}`,
        `${c.CYAN}To verify:  nb-sync task check`,
        `To run now: schtasks /Run /TN "${this.taskName}"`,
        `To remove:  nb-sync task remove`,
        '',
        `${c.YELLOW}Action required: Open the task properties (General tab) and check:`,
        `  - "Run whether user is logged on or not"`,
        `  - "Run with highest privileges"${c.RESET}`,
        `${c.CYAN}Opening Task Scheduler...${c.RESET}`,
      ].join('\n'));
      spawnSync('cmd', ['/c', 'start', '%windir%\\system32\\taskschd.msc', '/s']);
    } else {
      console.error(`${c.RED}Registration failed (exit code ${result.status}).${c.RESET}`);
      if (result.stderr) console.error(result.stderr);
      process.exit(1);
    }
  }

  public check(): void {
    const { found, fields } = this.queryTask();

    if (!found) {
      console.error(`${c.RED}Task '${this.taskName}' not found. Has it been registered?${c.RESET}`);
      process.exit(1);
    }

    const status = fields['Status'] ?? 'Unknown';
    const statusColor = status === 'Running'  ? c.GREEN
                      : status === 'Ready'    ? c.CYAN
                      : status === 'Disabled' ? c.YELLOW
                      : c.RED;

    const lastResult = fields['Last Result'] ?? 'N/A';
    const resultNote = lastResult === '0' ? ' (success)' : lastResult !== 'N/A' ? ' (non-zero!)' : '';

    console.log('');
    console.log(`Task:         ${this.taskName}`);
    console.log(`Status:       ${statusColor}${status}${c.RESET}`);
    console.log(`Last Run:     ${fields['Last Run Time'] ?? 'N/A'}`);
    console.log(`Last Result:  ${lastResult}${resultNote}`);
    console.log(`Next Run:     ${fields['Next Run Time'] ?? 'N/A'}`);
    console.log('');

    if (status === 'Running') {
      console.log(`${c.GREEN}Task is currently running.${c.RESET}`);
    } else if (status === 'Ready') {
      console.log(`${c.CYAN}Task is registered and will run at next scheduled time.${c.RESET}`);
    } else if (status === 'Disabled') {
      console.log(`${c.YELLOW}Task is disabled. Enable it in Task Scheduler or re-run: nb-sync task register${c.RESET}`);
    } else {
      console.log(`${c.RED}Unexpected status: ${status}${c.RESET}`);
    }
  }

  public remove(): void {
    const { found } = this.queryTask();

    if (!found) {
      console.log(`${c.YELLOW}Task '${this.taskName}' not found — nothing to remove.${c.RESET}`);
      return;
    }

    const result = this.runSchtasks(['/Delete', '/TN', this.taskName, '/F']);

    if (result.status === 0) {
      console.log(`${c.GREEN}Task '${this.taskName}' removed successfully.${c.RESET}`);
    } else {
      console.error(`${c.RED}Failed to remove task (exit code ${result.status}).${c.RESET}`);
      if (result.stderr) console.error(result.stderr);
      process.exit(1);
    }
  }

  private queryTask(): TaskQueryResult {
    const result = this.runSchtasks(['/Query', '/TN', this.taskName, '/FO', 'LIST']);
    if (result.status !== 0) {
      return { found: false, fields: {} };
    }
    const fields: Record<string, string> = {};
    for (const line of result.stdout.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        if (key && value) fields[key] = value;
      }
    }
    return { found: true, fields };
  }

  private runSchtasks(args: string[]): SchtasksResult {
    const result = spawnSync('schtasks', args, { encoding: 'utf8' });
    if (result.error) {
      console.error(`Failed to run schtasks.exe: ${result.error.message}`);
      process.exit(1);
    }
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
}


function main(): void {
  // schtasks (that this class relies on) is a Windows-only tool (I'm pretty sure)
  if (process.platform !== 'win32') {
    console.error('This tool requires Windows (schtasks.exe is not available on this platform).');
    process.exit(1);
  }

  // Get arguments
  const [subcommand] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!subcommand) {
    console.error('Usage: task <register|check|remove>');
    process.exit(1);
  }

  // Validate nb-sync.config.json (or the --config= override) exists in this directory
  new Config(parseStringFlag('config'), parseStringFlag('mappings'));

  // Derive project name + task name from the folder the command is run in
  const projectDir = process.cwd();
  const projectName = path.basename(projectDir);
  const taskName = `NB-Dropbox-Sync-${projectName}`;
  const scriptPath = path.join(path.resolve(__dirname), 'sync.js');

  // Build the extra args baked into the scheduled command line
  const extraArgs: string[] = [];
  const runAtNzHoursArg = process.argv.find(a => a.startsWith('--runAtNzHours='));
  if (runAtNzHoursArg) extraArgs.push(runAtNzHoursArg);

  const envArg = parseStringFlag('env');
  if (envArg) {
    if (envArg !== 'prod' && envArg !== 'test') {
      console.error(`Error: --env must be "prod" or "test" (got "${envArg}").`);
      process.exit(1);
    }
    extraArgs.push(`--env=${envArg}`);
  }

  // Set up scheduler
  const scheduler = new TaskScheduler(taskName, scriptPath, projectDir, extraArgs.join(' '));

  // Do one of 3 things
  switch (subcommand) {
    case 'register':
      return scheduler.register();
    case 'check':
      return scheduler.check();
    case 'remove':
      return scheduler.remove();
    default:
      console.error('Usage: task <register|check|remove>');
      process.exit(1);
  }
}

main();
