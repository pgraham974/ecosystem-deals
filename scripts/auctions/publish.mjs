import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SNAPSHOT = ['data/auctions/lots.json', 'data/auctions/coverage.json', 'data/auctions/coverage.md'];

// Replay only the atomic snapshot on newer human commits, never replace history.
export function publishSnapshot({ cwd = process.cwd(), branch = process.env.GITHUB_REF_NAME, attempts = 3, beforePush = () => {} } = {}) {
  const run = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.error) throw result.error;
    return result;
  };
  const git = (...args) => {
    const result = run(...args);
    if (result.status !== 0) throw new Error('git ' + args[0] + ' failed: ' + (result.stderr || result.stdout).trim());
    return result.stdout.trim();
  };
  if (!branch || run('check-ref-format', '--branch', branch).status !== 0) throw new Error('A valid publication branch is required');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('Publication attempts must be between 1 and 5');
  for (const args of [['diff', '--name-only'], ['diff', '--cached', '--name-only']]) {
    const unrelated = git(...args).split('\n').filter(name => name && !SNAPSHOT.includes(name));
    if (unrelated.length) throw new Error('Refusing to include unrelated local changes: ' + unrelated.join(', '));
  }
  const base = git('rev-parse', 'HEAD');
  git('add', '--', ...SNAPSHOT);
  const diff = run('diff', '--cached', '--quiet');
  if (diff.status === 0) return { changed: false, attempts: 0 };
  if (diff.status !== 1) throw new Error('Could not inspect staged snapshot');
  git('commit', '-m', 'data: refresh live residential auctions and coverage');
  let appliedBase = base;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    git('fetch', '--no-tags', 'origin', 'refs/heads/' + branch);
    const target = git('rev-parse', 'FETCH_HEAD');
    if (run('merge-base', '--is-ancestor', base, target).status !== 0) throw new Error('Publication branch history changed; refusing to restore removed commits');
    const changed = git('diff', '--name-only', base, target).split('\n').filter(Boolean);
    if (changed.some(name => SNAPSHOT.includes(name))) throw new Error('Concurrent auction snapshot changed; rerun collection from the latest branch');
    if (changed.some(name => name === 'scripts/collect_auctions.mjs' || (name.startsWith('scripts/auctions/') && !name.endsWith('.test.mjs')))) {
      throw new Error('Collection runtime changed; rerun collection from the latest branch');
    }
    const rebase = run('rebase', '--onto', target, appliedBase);
    if (rebase.status !== 0) {
      run('rebase', '--abort');
      throw new Error('Snapshot could not be replayed cleanly; remote changes were preserved: ' + (rebase.stderr || rebase.stdout).trim());
    }
    appliedBase = target;
    beforePush(attempt);
    const pushed = run('push', 'origin', 'HEAD:refs/heads/' + branch);
    if (pushed.status === 0) return { changed: true, attempts: attempt, commit: git('rev-parse', 'HEAD') };
    if (attempt === attempts) throw new Error('Snapshot push failed after ' + attempts + ' attempts; remote changes were preserved: ' + (pushed.stderr || pushed.stdout).trim());
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(publishSnapshot())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
