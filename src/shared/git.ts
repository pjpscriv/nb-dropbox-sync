import { spawnSync, SpawnSyncReturns } from 'child_process';

export function git(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

// True only if git is installed and cwd is inside a work tree
export function inGitRepo(cwd: string): boolean {
  const res = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return !res.error && res.status === 0 && (res.stdout ?? '').trim() === 'true';
}

export function hasUpstream(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).status === 0;
}

// Returns a human-readable problem if git can't be used for a pull/push flow, else undefined
export function gitProblem(cwd: string): string | undefined {
  const version = git(cwd, ['--version']);
  if (version.error || version.status !== 0) {
    return 'git was not found. Install git and make sure it is on your PATH.';
  }
  if (!inGitRepo(cwd)) {
    return `'${cwd}' is not inside a git repository.`;
  }
  if (!hasUpstream(cwd)) {
    return 'the current branch has no remote/upstream branch configured, so there is nothing to pull from or push to.';
  }
  return undefined;
}
