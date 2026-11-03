import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishSnapshot } from './publish.mjs';

const hasGit = spawnSync('git', ['--version']).status === 0;
const files = ['data/auctions/lots.json', 'data/auctions/coverage.json', 'data/auctions/coverage.md'];
const fixtureOptions = { skip: hasGit ? false : 'Git unavailable locally; integration runs on GitHub Ubuntu' };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'auction-publish-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.error?.message);
    return r.stdout.trim();
  };
  const remote = join(root, 'origin.git'), writer = join(root, 'writer'), collector = join(root, 'collector');
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'clone', remote, writer);
  const config = dir => {
    git(dir, 'config', 'user.name', 'Offline test');
    git(dir, 'config', 'user.email', 'fixture@example.invalid');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'core.autocrlf', 'false');
  };
  config(writer);
  const write = (dir, name, value) => {
    const p = join(dir, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, value + '\n');
  };
  // Synthetic local Git fixtures only. These files never enter production data.
  for (const name of files) write(writer, name, 'base fixture');
  write(writer, 'index.html', 'original human page');
  write(writer, 'scripts/collect_auctions.mjs', '// original fixture runtime');
  git(writer, 'add', '.'); git(writer, 'commit', '-m', 'fixture base'); git(writer, 'push', 'origin', 'main');
  git(root, 'clone', remote, collector); config(collector);
  const human = (name, value) => {
    write(writer, name, value); git(writer, 'add', '--', name);
    git(writer, 'commit', '-m', 'human edit'); git(writer, 'push', 'origin', 'main');
    return git(writer, 'rev-parse', 'HEAD');
  };
  const generate = () => files.forEach(name => write(collector, name, 'new generated fixture'));
  const remoteRead = name => git(remote, 'show', 'main:' + name);
  return { root, remote, writer, collector, git, write, human, generate, remoteRead };
}

test('workflow delegates atomic publication and publisher never forces a push', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/auctions.yml', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./publish.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/auctions\/publish\.mjs/);
  assert.doesNotMatch(workflow, /git push origin "HEAD:/);
  assert.doesNotMatch(source, /['"]--force(?:-with-lease)?['"]/);
});

test('publishes all three snapshot files in one data-only commit', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  const r = publishSnapshot({ cwd: f.collector, branch: 'main' });
  assert.equal(r.attempts, 1);
  assert.deepEqual(f.git(f.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').split('\n').sort(), [...files].sort());
  for (const name of files) assert.equal(f.remoteRead(name), 'new generated fixture');
});

test('replays snapshot onto a newer human page commit without losing it', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  const human = f.human('index.html', 'newer human page');
  publishSnapshot({ cwd: f.collector, branch: 'main' });
  assert.equal(f.remoteRead('index.html'), 'newer human page');
  assert.equal(f.git(f.remote, 'rev-parse', 'main^'), human);
});

test('retries a human commit racing the first push', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  const r = publishSnapshot({ cwd: f.collector, branch: 'main', beforePush(attempt) {
    if (attempt === 1) f.human('index.html', 'human edit during publication');
  } });
  assert.equal(r.attempts, 2);
  assert.equal(f.remoteRead('index.html'), 'human edit during publication');
  for (const name of files) assert.equal(f.remoteRead(name), 'new generated fixture');
});

test('refuses concurrent snapshot edits even when Git could auto-merge them', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  const human = f.human('data/auctions/coverage.md', 'manual human coverage correction');
  assert.throws(() => publishSnapshot({ cwd: f.collector, branch: 'main' }), /Concurrent auction snapshot changed/);
  assert.equal(f.git(f.remote, 'rev-parse', 'main'), human);
  assert.equal(f.remoteRead('data/auctions/coverage.md'), 'manual human coverage correction');
  assert.equal(f.remoteRead('data/auctions/lots.json'), 'base fixture');
});

test('bounds retries and retains all human commits if every push races', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  assert.throws(() => publishSnapshot({ cwd: f.collector, branch: 'main', attempts: 2,
    beforePush(attempt) { f.human('index.html', 'human race ' + attempt); }
  }), /failed after 2 attempts/);
  assert.equal(f.remoteRead('index.html'), 'human race 2');
  assert.equal(f.remoteRead('data/auctions/lots.json'), 'base fixture');
});

test('unchanged snapshot creates no commit and performs no push', fixtureOptions, t => {
  const f = fixture(t); const before = f.git(f.remote, 'rev-parse', 'main');
  const r = publishSnapshot({ cwd: f.collector, branch: 'main', beforePush() { assert.fail('Unexpected push'); } });
  assert.deepEqual(r, { changed: false, attempts: 0 });
  assert.equal(f.git(f.collector, 'rev-parse', 'HEAD'), before);
  assert.equal(f.git(f.remote, 'rev-parse', 'main'), before);
});

test('rejects a snapshot collected with an older runtime', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  const human = f.human('scripts/collect_auctions.mjs', '// changed fixture runtime');
  assert.throws(() => publishSnapshot({ cwd: f.collector, branch: 'main' }), /Collection runtime changed/);
  assert.equal(f.git(f.remote, 'rev-parse', 'main'), human);
});

test('does not silently commit or discard unrelated local work', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  f.write(f.collector, 'index.html', 'unrelated local edit');
  f.git(f.collector, 'add', 'index.html');
  assert.throws(() => publishSnapshot({ cwd: f.collector, branch: 'main' }), /unrelated local changes/);
  assert.equal(f.remoteRead('index.html'), 'original human page');
  assert.equal(readFileSync(join(f.collector, 'index.html'), 'utf8'), 'unrelated local edit\n');
});

test('preserves multiple racing human commits and publishes exactly one data commit', fixtureOptions, t => {
  const f = fixture(t); f.generate();
  const r = publishSnapshot({ cwd: f.collector, branch: 'main', beforePush(attempt) {
    if (attempt === 1) f.human('index.html', 'first racing human edit');
    if (attempt === 2) f.human('notes.txt', 'second racing human edit');
  } });
  assert.equal(r.attempts, 3);
  assert.equal(f.remoteRead('index.html'), 'first racing human edit');
  assert.equal(f.remoteRead('notes.txt'), 'second racing human edit');
  assert.equal(f.git(f.remote, 'rev-parse', 'main^'), f.git(f.writer, 'rev-parse', 'HEAD'));
  assert.deepEqual(f.git(f.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').split('\n').sort(), [...files].sort());
});
