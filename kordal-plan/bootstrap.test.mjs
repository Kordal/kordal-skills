import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real bootstrap.sh, copied beside a small scaffold of its own into a
// skill repository in a temporary directory: the script finds its scaffold and
// its version from where it lies. The skill sits in a subdirectory of that
// repository, as kordal-plan does, and the project is a directory beside it.
const here = path.dirname(fileURLToPath(import.meta.url));
// A hook or "git rebase --exec" exports these, and the fixtures' Git would then write into the caller's repository.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']) delete process.env[name];
// Git and sort as the tests set them up: no configuration of this machine, no repository of a caller, one sort order.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), LC_ALL: 'C', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
};
const agents = ['# Agents', '', 'Rule one.', 'Rule two.', 'Rule three.', '', '## Map', '', 'Scripts are in scripts/.', ''].join('\n');
const gate = ['#!/usr/bin/env bash', 'set -euo pipefail', '', 'gate=$1', 'shift', '', 'echo "== $gate"', ''].join('\n');
const manifest = '{\n  "version": 1,\n  "milestone": 1,\n  "integration_branch": "milestone1",\n  "budgets": { "task_gate_minutes": 3 },\n  "tasks": []\n}\n';
const makefile = 'TASK_STAGES := lint test\n', newMakefile = 'TASK_STAGES := lint structure-check test\n';
const scaffold = {
  'AGENTS.md': agents, Makefile: makefile, 'docs/agents/claude.md': '# Claude\n', 'docs/agents/planning.md': '# Planning\n',
  'docs/plans/backlog.json': manifest, 'scripts/gate.sh': gate,
};
const stampFile = 'docs/agents/scaffold-version';

// The files under root, in the Git repository at repo.
function tree(root, repo = root) {
  const at = file => path.join(root, file);
  const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); return r.stdout.trimEnd(); };
  return {
    root, git, has: file => fs.existsSync(at(file)), read: file => fs.readFileSync(at(file), 'utf8'), remove: file => fs.rmSync(at(file)),
    executable: file => (fs.statSync(at(file)).mode & 0o100) !== 0,
    write: (file, text, mode) => { fs.mkdirSync(path.dirname(at(file)), { recursive: true }); fs.writeFileSync(at(file), text); if (mode) fs.chmodSync(at(file), mode); },
    commit: message => { git('add', '--all'); git('commit', '--quiet', '--allow-empty', '--message', message); return git('rev-parse', 'HEAD'); },
    status: () => git('status', '--porcelain', '--untracked-files=all'),
  };
}
// The skill repository at version 1 (s: its scaffold) and an empty project directory (p).
function fixture(t, { nest = 'pack/plan', files = scaffold, prefix = 'bootstrap-' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'skills'), skill = path.join(repo, nest);
  fs.mkdirSync(skill, { recursive: true }); fs.mkdirSync(path.join(dir, 'project'));
  fs.copyFileSync(path.join(here, 'bootstrap.sh'), path.join(skill, 'bootstrap.sh'));
  const s = tree(path.join(skill, 'scaffold'), repo), p = tree(path.join(dir, 'project'));
  for (const [file, text] of Object.entries(files)) s.write(file, text, file.endsWith('.sh') ? 0o755 : 0o644);
  s.git('init', '--quiet', '--initial-branch', 'main');
  const v1 = s.commit('version 1');
  const run = (args = [], options = {}) => spawnSync('bash', [path.join(skill, 'bootstrap.sh'), ...args], { cwd: p.root, encoding: 'utf8', env, ...options });
  return { dir, skill, s, p, v1, run, stamp: () => p.read(stampFile).trim() };
}
// A project that already is a repository, on the given branch, with a first commit.
const existing = (f, branch) => { f.p.git('init', '--quiet', '--initial-branch', branch); f.p.write('README.md', '# Product\n'); f.p.commit('first'); };
// ... whose origin/HEAD names the given branch, with or without that branch.
const remote = (f, branch, there = true) => { if (there) f.p.git('update-ref', `refs/remotes/origin/${branch}`, 'HEAD'); f.p.git('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`); };
// A version that is no commit of the skill repository.
const unknown = '0123456789abcdef0123456789abcdef01234567';
// A project bootstrapped from version 1 and committed.
function scaffolded(t, options) {
  const f = fixture(t, options);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  f.p.commit('scaffold');
  return f;
}
// ... in which the project and then the scaffold change, each in a commit, before the update runs.
function updated(t, { project = () => {}, scaffold: change = () => {} }, options) {
  const f = scaffolded(t, options);
  project(f.p); f.p.commit('the project\'s own changes');
  change(f.s); const v2 = f.s.commit('version 2');
  const result = f.run(['--update']);
  return { ...f, v2, result, lines: lines(result) };
}
const lines = result => result.stdout.trimEnd().split('\n');
// A report line without the reason in its parentheses.
const brief = list => list.map(line => line.replace(/ \(.*\)$/, ''));
const summary = (from, to, counts = {}) => {
  const n = { added: 0, updated: 0, merged: 0, removed: 0, kept: 0, conflicts: 0, ...counts };
  return `summary  ${from.slice(0, 12)} to ${to.slice(0, 12)}: ${n.added} added, ${n.updated} updated, ${n.merged} merged, ${n.removed} removed, ${n.kept} kept, ${n.conflicts} conflicts`;
};
// An update without a conflict: exactly these report lines, the new version recorded, exit 0.
function clean(u, report, counts) {
  assert.equal(u.result.status, 0, u.result.stdout + u.result.stderr);
  assert.deepEqual(brief(u.lines), [...report, `version  ${u.v2}`, summary(u.v1, u.v2, counts)]);
  assert.equal(u.stamp(), u.v2);
}
// An update with a conflict: exactly these report lines, how to go on, no version recorded, exit 1.
function conflicted(u, report, counts) {
  assert.equal(u.result.status, 1, u.result.stdout + u.result.stderr);
  assert.deepEqual(brief(u.lines.slice(0, -2)), report);
  assert.match(u.lines.at(-2), /^FAIL     the version is not recorded\. Resolve each CONFLICT above .*, then run --stamp, not --update again, which would merge from the old version once more: bash \S+\/bootstrap\.sh --stamp \S+\/project$/);
  assert.equal(u.lines.at(-1), summary(u.v1, u.v2, counts));
  assert.equal(u.stamp(), u.v1);
}

test('copy mode creates every scaffold file with its mode, makes the directory a repository on main and records the version', t => {
  const f = fixture(t);
  const result = f.run([f.p.root], { cwd: f.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result), ['init     Git repository on main', ...Object.keys(scaffold).sort().map(file => `created  ${file}`), `version  ${f.v1}`]);
  for (const [file, text] of Object.entries(scaffold)) assert.equal(f.p.read(file), text);
  assert.ok(f.p.executable('scripts/gate.sh'));
  assert.ok(!f.p.executable('Makefile'));
  assert.equal(f.p.read(stampFile), `${f.v1}\n`);
  assert.equal(f.p.git('symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(f.p.read('docs/plans/backlog.json'), manifest, 'a repository the run created is on main: no base_branch');
});
test('copy mode keeps a file the project already has, and the report says which', t => {
  const f = fixture(t);
  f.p.write('AGENTS.md', '# Ours\n'); f.p.write('scripts/gate.sh', 'ours\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result).slice(1, -1), ['kept     AGENTS.md', 'created  Makefile', 'created  docs/agents/claude.md', 'created  docs/agents/planning.md', 'created  docs/plans/backlog.json', 'kept     scripts/gate.sh']);
  assert.equal(f.p.read('AGENTS.md'), '# Ours\n');
  assert.equal(f.p.read('scripts/gate.sh'), 'ours\n');
  assert.ok(!f.p.executable('scripts/gate.sh'));
});
test('copy mode refuses a project that already has docs/agents/planning.md, and creates nothing', t => {
  const f = fixture(t);
  f.p.write('docs/agents/planning.md', '# Ours\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL  \S+\/project already has docs\/agents\/planning\.md: follow it, or bring it up to date with --update\n$/);
  assert.deepEqual(fs.readdirSync(f.p.root), ['docs'], 'no repository, no scaffold file');
  assert.deepEqual(fs.readdirSync(path.join(f.p.root, 'docs/agents')), ['planning.md'], 'no version');
});
test('copy mode refuses a directory that lies inside a repository and is not its root, and creates nothing', t => {
  const f = fixture(t);
  existing(f, 'trunk'); f.p.write('.gitignore', '/work/\n'); f.p.commit('ignore');
  // A directory the repository tracks, and one it ignores.
  for (const inside of ['apps/web', 'work/product']) {
    const dir = path.join(f.p.root, inside);
    fs.mkdirSync(dir, { recursive: true });
    const result = f.run([dir]);
    assert.equal(result.status, 1, inside);
    assert.match(result.stdout, new RegExp(`^FAIL  \\S+/project/${inside} lies inside the Git repository at \\S+/project and is not its root, where the scaffold's scripts look for docs/ and scripts/: run this at that root, or make the directory a repository of its own \\(git init\\) first\\n$`));
    assert.deepEqual(fs.readdirSync(dir), [], inside);
  }
  // The root of a repository, reached through a symbolic link, is its root.
  fs.symlinkSync(f.p.root, path.join(f.dir, 'link'));
  const result = f.run([path.join(f.dir, 'link')]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^base     trunk$/m);
});
test('copy mode creates nothing through a symbolic link: a link to nothing and a linked directory are kept as they are', t => {
  const f = fixture(t), shared = path.join(f.dir, 'shared');
  fs.mkdirSync(path.join(shared, 'scripts'), { recursive: true });
  fs.symlinkSync('../shared/AGENTS.md', path.join(f.p.root, 'AGENTS.md')); fs.symlinkSync('../shared/scripts', path.join(f.p.root, 'scripts'));
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const kept = file => `kept     ${file} (a symbolic link of the project leads there, and nothing is created through one)`;
  assert.deepEqual(lines(result).slice(1, -1), [kept('AGENTS.md'), 'created  Makefile', 'created  docs/agents/claude.md', 'created  docs/agents/planning.md', 'created  docs/plans/backlog.json', kept('scripts/gate.sh')]);
  assert.deepEqual(fs.readdirSync(shared), ['scripts'], 'no file beside the project');
  assert.deepEqual(fs.readdirSync(path.join(shared, 'scripts')), []);
  assert.equal(fs.readlinkSync(path.join(f.p.root, 'AGENTS.md')), '../shared/AGENTS.md');
});
test('copy mode leaves out the .DS_Store that Finder puts into the scaffold', t => {
  const f = fixture(t);
  f.s.write('docs/.DS_Store', 'finder\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /DS_Store/);
  assert.ok(!f.p.has('docs/.DS_Store'));
});
test('an exported CDPATH does not reach the script: run by a relative path, on a relative directory', t => {
  const f = fixture(t);
  // cd prints the directory it finds through CDPATH, and the script reads where it lies and where the project is from cd.
  const run = (...args) => spawnSync('bash', ['skills/pack/plan/bootstrap.sh', ...args, 'project'], { cwd: f.dir, encoding: 'utf8', env: { ...env, CDPATH: '.' } });
  const copy = run();
  assert.equal(copy.status, 0, copy.stdout + copy.stderr);
  assert.equal(lines(copy).at(-1), `version  ${f.v1}`);
  assert.equal(f.p.read(stampFile), `${f.v1}\n`);
  f.s.write('Makefile', newMakefile);
  const v2 = f.s.commit('version 2');
  assert.equal(run('--stamp').stdout, `version  ${v2}\n`);
  assert.equal(f.p.read(stampFile), `${v2}\n`);
  assert.deepEqual(fs.readdirSync(f.dir).sort(), ['project', 'skills'], 'no directory beside them');
});

test('an existing repository on trunk gets "base_branch": "trunk" in the manifest the run creates', t => {
  const f = fixture(t);
  existing(f, 'trunk');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^init /m);
  assert.deepEqual(lines(result).slice(-2), ['base     trunk', `version  ${f.v1}`]);
  const { base_branch: base, ...rest } = JSON.parse(f.p.read('docs/plans/backlog.json'));
  assert.equal(base, 'trunk');
  assert.deepEqual(rest, JSON.parse(manifest), 'nothing else changes');
  assert.match(f.p.read('docs/plans/backlog.json'), /"integration_branch": "milestone1",\n  "base_branch": "trunk",\n/, 'beside the integration branch');
  assert.equal(f.p.git('symbolic-ref', '--short', 'HEAD'), 'trunk');
});
test('without origin/HEAD the base is main, then master, then the branch the checkout is on', t => {
  const main = fixture(t);
  existing(main, 'main'); main.p.git('switch', '--quiet', '--create', 'feature');
  assert.doesNotMatch(main.run().stdout, /^(base|WARN) /m);
  assert.equal(main.p.read('docs/plans/backlog.json'), manifest, 'main is the default: not recorded');
  const master = fixture(t);
  existing(master, 'master'); master.p.git('switch', '--quiet', '--create', 'feature');
  assert.match(master.run().stdout, /^base     master$/m);
  const both = fixture(t);
  existing(both, 'master'); both.p.git('branch', 'main'); both.p.git('switch', '--quiet', '--create', 'feature');
  assert.doesNotMatch(both.run().stdout, /^(base|WARN) /m, 'main before master');
  assert.equal(both.p.read('docs/plans/backlog.json'), manifest);
  const unborn = fixture(t);
  unborn.p.git('init', '--quiet', '--initial-branch', 'develop');
  assert.match(unborn.run().stdout, /^base     develop$/m);
  assert.equal(JSON.parse(unborn.p.read('docs/plans/backlog.json')).base_branch, 'develop');
  // Beside a tag of its name the branch has another short name, heads/trunk: the base is still trunk.
  const tagged = fixture(t);
  existing(tagged, 'trunk'); tagged.p.git('tag', 'trunk');
  assert.match(tagged.run().stdout, /^base     trunk$/m);
});
test('a detached HEAD without origin/HEAD, main or master is on no base branch: none is recorded, and the report says so', t => {
  const f = fixture(t);
  existing(f, 'trunk'); f.p.git('checkout', '--quiet', '--detach'); f.p.git('branch', '--quiet', '-D', 'trunk');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(lines(result).slice(-2), ['WARN     the base branch could not be detected (a detached HEAD, and no origin/HEAD, main or master): add "base_branch": "<the base branch>" to docs/plans/backlog.json by hand', `version  ${f.v1}`]);
  assert.equal(f.p.read('docs/plans/backlog.json'), manifest);
  const main = fixture(t);
  existing(main, 'main'); main.p.git('checkout', '--quiet', '--detach');
  assert.doesNotMatch(main.run().stdout, /^(base|WARN) /m, 'detached, beside main: main is the base');
});
test('a base branch whose name the manifest does not take, or that is its integration branch, is not recorded: the report says why', t => {
  for (const name of ['dev+next', 'user@work', 'główna']) {
    const f = fixture(t);
    existing(f, name);
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(lines(result).slice(-2), [`WARN     the base branch ${name} is not recorded: "base_branch" takes a name of letters, digits, ".", "_", "/" and "-" that starts with a letter or a digit and holds no ".." or "//", and no "/", "." or ".lock" at its end. Until the branch has such a name, the workflow takes main for the base`, `version  ${f.v1}`]);
    assert.equal(f.p.read('docs/plans/backlog.json'), manifest, name);
  }
  const f = fixture(t);
  existing(f, 'milestone1');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(lines(result).slice(-2), ['WARN     the base branch milestone1 is not recorded: it is the manifest\'s integration_branch. Give the milestone\'s branch another name in docs/plans/backlog.json, then add "base_branch": "milestone1" to it by hand', `version  ${f.v1}`]);
  assert.equal(f.p.read('docs/plans/backlog.json'), manifest);
  // A name with every character the manifest takes is recorded.
  const taken = fixture(t);
  existing(taken, 'Release/1.x_next-2');
  assert.match(taken.run().stdout, /^base     Release\/1\.x_next-2$/m);
});
test('origin/HEAD decides the base before any local branch', t => {
  const other = fixture(t);
  existing(other, 'main'); remote(other, 'develop');
  assert.match(other.run().stdout, /^base     develop$/m);
  assert.equal(JSON.parse(other.p.read('docs/plans/backlog.json')).base_branch, 'develop');
  const main = fixture(t);
  existing(main, 'trunk'); remote(main, 'main');
  assert.doesNotMatch(main.run().stdout, /^(base|WARN) /m);
  assert.equal(main.p.read('docs/plans/backlog.json'), manifest);
  // Beside a tag origin/develop, the short name of origin/HEAD is remotes/origin/develop: the base is still develop.
  const tagged = fixture(t);
  existing(tagged, 'main'); remote(tagged, 'develop'); tagged.p.git('tag', 'origin/develop');
  assert.match(tagged.run().stdout, /^base     develop$/m);
  assert.equal(JSON.parse(tagged.p.read('docs/plans/backlog.json')).base_branch, 'develop');
  // An origin/HEAD that leads to no branch decides nothing.
  const stale = fixture(t);
  existing(stale, 'master'); remote(stale, 'gone', false);
  assert.match(stale.run().stdout, /^base     master$/m);
});
test('a manifest the project already has is not rewritten: the report names the edit to make by hand', t => {
  const own = '{ "version": 1, "milestone": 2, "integration_branch": "milestone2", "tasks": [] }\n';
  const f = fixture(t);
  existing(f, 'trunk'); f.p.write('docs/plans/backlog.json', own);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^kept     docs\/plans\/backlog\.json$/m);
  assert.match(result.stdout, /^WARN     the base branch is trunk and docs\/plans\/backlog\.json was kept: add "base_branch": "trunk" to it by hand$/m);
  assert.doesNotMatch(result.stdout, /^base /m);
  assert.equal(f.p.read('docs/plans/backlog.json'), own);
  const named = fixture(t), ownNamed = own.replace('"tasks"', '"base_branch": "trunk", "tasks"');
  existing(named, 'trunk'); named.p.write('docs/plans/backlog.json', ownNamed);
  assert.doesNotMatch(named.run().stdout, /^(base|WARN) /m, 'a kept manifest that names its base needs no edit');
  assert.equal(named.p.read('docs/plans/backlog.json'), ownNamed);
});
test('without node the base branch is not recorded, and the report names the edit to make by hand', t => {
  const f = fixture(t);
  existing(f, 'trunk');
  // A PATH that holds what copy mode runs, and no node.
  const bin = path.join(f.dir, 'bin');
  fs.mkdirSync(bin);
  for (const tool of ['bash', 'git', 'dirname', 'find', 'sed', 'sort', 'mkdir', 'cp', 'grep']) {
    const found = process.env.PATH.split(path.delimiter).map(folder => path.join(folder, tool)).find(file => fs.existsSync(file));
    assert.ok(found, `${tool} is not on the PATH`);
    fs.symlinkSync(found, path.join(bin, tool));
  }
  const result = f.run([], { env: { ...env, PATH: bin } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(lines(result).slice(-2), ['WARN     the base branch is trunk and there is no node to record it: add "base_branch": "trunk" to docs/plans/backlog.json by hand', `version  ${f.v1}`]);
  assert.equal(f.p.read('docs/plans/backlog.json'), manifest);
});

test('--diff with a recorded version prints what the scaffold changed since and the files the project lacks, and changes nothing', t => {
  const f = scaffolded(t);
  assert.equal(f.run(['--diff']).stdout, `The scaffold has not changed since ${f.v1}\n`);
  f.s.write('Makefile', newMakefile); f.s.write('docs/agents/acceptance.md', '# Acceptance\n');
  const v2 = f.s.commit('version 2');
  const result = f.run(['--diff']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lines(result)[0], `Scaffold changes from ${f.v1} to ${v2}:`);
  assert.match(result.stdout, /^--- a\/Makefile\n\+\+\+ b\/Makefile\n@@.*\n-TASK_STAGES := lint test\n\+TASK_STAGES := lint structure-check test$/m);
  assert.equal(lines(result).at(-1), 'missing  docs/agents/acceptance.md');
  assert.equal(f.p.status(), '');
  assert.equal(f.stamp(), f.v1);
});
test('--diff without a recorded version, or with one the skill repository does not know, compares every file', t => {
  const f = scaffolded(t);
  f.p.remove(stampFile); f.p.write('AGENTS.md', '# Ours\n'); f.p.remove('docs/agents/claude.md');
  const report = ['differs  AGENTS.md', 'missing  docs/agents/claude.md'];
  assert.deepEqual(lines(f.run(['--diff'])), [`No recorded scaffold version: comparing every file with the scaffold at ${f.v1}`, ...report]);
  // A version another checkout recorded: the scaffold here may be the older of the two, and the report says so.
  f.p.write(stampFile, `${unknown}\n`);
  assert.deepEqual(lines(f.run(['--diff'])), [`The recorded scaffold version ${unknown} is no commit of this checkout of ${f.skill}: comparing every file with the scaffold at ${f.v1}, which may be older than the project's`, ...report]);
  assert.equal(f.p.read('AGENTS.md'), '# Ours\n');
});
test('a recorded version that holds no scaffold where it lies now is no base: --update refuses, --diff compares every file', t => {
  const f = scaffolded(t);
  // The skill repository had its scaffold elsewhere in the version the project records.
  f.s.git('mv', 'pack/plan/scaffold', 'pack/plan/template');
  const elsewhere = f.s.commit('the scaffold, elsewhere');
  f.s.git('mv', 'pack/plan/template', 'pack/plan/scaffold'); f.s.write('Makefile', newMakefile); f.s.write('docs/agents/acceptance.md', '# Acceptance\n');
  const v2 = f.s.commit('version 2');
  f.p.write(stampFile, `${elsewhere}\n`); f.p.commit('scaffolded from there');
  const result = f.run(['--update']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`^FAIL  \\S+/project records the scaffold version ${elsewhere}, which holds no scaffold at pack/plan/scaffold/, so there is no base to merge from: compare with --diff, apply the changes by hand, then --stamp\\n$`));
  assert.equal(f.p.status(), '');
  assert.equal(f.stamp(), elsewhere);
  assert.deepEqual(lines(f.run(['--diff'])), [`The recorded scaffold version ${elsewhere} holds no scaffold at pack/plan/scaffold/: comparing every file with the scaffold at ${v2}`, 'differs  Makefile', 'missing  docs/agents/acceptance.md']);
});
test('--stamp records the current version, and warns when the scaffold has changes that no version holds', t => {
  const f = scaffolded(t);
  f.s.write('Makefile', newMakefile);
  const v2 = f.s.commit('version 2');
  assert.equal(f.run(['--stamp']).stdout, `version  ${v2}\n`);
  assert.equal(f.p.read(stampFile), `${v2}\n`);
  assert.equal(f.p.read('Makefile'), makefile, 'the stamp alone changes');
  f.s.write('Makefile', makefile);
  assert.deepEqual(lines(f.run(['--stamp', f.p.root], { cwd: f.dir })), ['WARN     the scaffold has uncommitted changes: the recorded version does not include them', `version  ${v2}`]);
});
test('--stamp over a version this checkout does not contain says that it may record an older one', t => {
  const f = scaffolded(t);
  const warned = recorded => [`WARN     the project recorded ${recorded}, which this checkout of ${f.skill} does not contain: unless its history was rewritten, the version recorded now is an older one`, `version  ${f.v1}`];
  f.p.write(stampFile, `${unknown}\n`);
  assert.deepEqual(lines(f.run(['--stamp'])), warned(unknown));
  // A later version the checkout holds and is not on.
  f.s.write('Makefile', newMakefile);
  const v2 = f.s.commit('version 2');
  f.s.git('checkout', '--quiet', f.v1);
  f.p.write(stampFile, `${v2}\n`);
  assert.deepEqual(lines(f.run(['--stamp'])), warned(v2));
  assert.equal(f.stamp(), f.v1);
});

test('--update leaves alone what the scaffold did not change: a customised file, a deleted one, the project\'s own files', t => {
  const ours = agents.replace('Rule one.', 'Rule one, as the project has it.');
  const u = updated(t, {
    project: p => { p.write('AGENTS.md', ours); p.remove('docs/agents/claude.md'); p.write('src/app.js', 'export {};\n'); },
    scaffold: s => s.write('Makefile', newMakefile),
  });
  clean(u, ['updated  Makefile'], { updated: 1 });
  assert.equal(u.p.read('AGENTS.md'), ours);
  assert.ok(!u.p.has('docs/agents/claude.md'));
  assert.equal(u.p.status(), ` M Makefile\n M ${stampFile}`, 'the update is a diff of the files the scaffold changed');
});
test('--update gives a file the project had not changed its new version, with its mode', t => {
  const u = updated(t, { scaffold: s => { s.write('Makefile', newMakefile); s.write('scripts/gate.sh', `${gate}echo passed\n`); } });
  clean(u, ['updated  Makefile', 'updated  scripts/gate.sh'], { updated: 2 });
  assert.equal(u.p.read('Makefile'), newMakefile);
  assert.equal(u.p.read('scripts/gate.sh'), `${gate}echo passed\n`);
  assert.ok(u.p.executable('scripts/gate.sh'));
});
test('--update merges a file both sides changed in different places: both changes are kept', t => {
  const rule = [/Rule one\./, 'Rule one, as the project has it.'], map = [/Scripts are in scripts\/\./, 'Scripts are in scripts/, tests in tests/.'];
  const u = updated(t, {
    project: p => { p.write('AGENTS.md', agents.replace(...rule)); p.write('scripts/gate.sh', gate.replace('set -euo pipefail', 'set -eu')); },
    scaffold: s => { s.write('AGENTS.md', agents.replace(...map)); s.write('scripts/gate.sh', `${gate}echo passed\n`); },
  });
  clean(u, ['merged   AGENTS.md', 'merged   scripts/gate.sh'], { merged: 2 });
  assert.equal(u.p.read('AGENTS.md'), agents.replace(...rule).replace(...map));
  assert.equal(u.p.read('scripts/gate.sh'), `${gate.replace('set -euo pipefail', 'set -eu')}echo passed\n`);
  assert.ok(u.p.executable('scripts/gate.sh'), 'a merged file keeps its mode');
});
test('--update carries the executable bit: a mode the scaffold changed arrives, a mode the project changed stays', t => {
  const u = updated(t, {
    project: p => { p.write('AGENTS.md', agents.replace('Rule one.', 'Rule one, as the project has it.')); p.write('scripts/gate.sh', gate.replace('set -euo pipefail', 'set -eu'), 0o644); },
    scaffold: s => { s.write('Makefile', makefile, 0o755); s.write('AGENTS.md', `${agents}Tests are in tests/.\n`, 0o755); s.write('scripts/gate.sh', `${gate}echo passed\n`); },
  });
  clean(u, ['merged   AGENTS.md', 'updated  Makefile', 'merged   scripts/gate.sh'], { updated: 1, merged: 2 });
  assert.ok(u.p.executable('Makefile'), 'the scaffold changed nothing but the mode');
  assert.ok(u.p.executable('AGENTS.md'), 'merged, with the mode the scaffold gave it');
  assert.ok(!u.p.executable('scripts/gate.sh'), 'merged, with the mode the project gave it');
});
test('--update writes conflict markers where both sides changed the same lines, exits 1 and records no version until --stamp', t => {
  const ours = 'Rule two, as the project has it.', theirs = 'Rule two, as the scaffold has it.';
  const u = updated(t, {
    project: p => p.write('AGENTS.md', agents.replace('Rule two.', ours)),
    scaffold: s => { s.write('AGENTS.md', agents.replace('Rule two.', theirs)); s.write('Makefile', newMakefile); },
  });
  conflicted(u, ['CONFLICT AGENTS.md', 'updated  Makefile'], { updated: 1, conflicts: 1 });
  assert.equal(u.lines[0], 'CONFLICT AGENTS.md (both changed the same lines: conflict markers written)');
  const marked = agents.replace('Rule two.\n', `<<<<<<< project\n${ours}\n||||||| scaffold ${u.v1.slice(0, 12)}\nRule two.\n=======\n${theirs}\n>>>>>>> scaffold ${u.v2.slice(0, 12)}\n`);
  assert.equal(u.p.read('AGENTS.md'), marked);
  assert.equal(u.p.read('Makefile'), newMakefile, 'the other changes of the run are applied');
  assert.match(u.run(['--update']).stdout, /^FAIL .* is not a clean Git checkout/, 'and the update does not run again over them');
  // Committed with its markers: a repeated update names the file again and does not nest the markers.
  u.p.commit('scaffold update, unresolved');
  const again = u.run(['--update']);
  conflicted({ ...u, result: again, lines: lines(again) }, ['CONFLICT AGENTS.md'], { conflicts: 1 });
  assert.equal(lines(again)[0], 'CONFLICT AGENTS.md (it still holds the conflict markers of an earlier update: resolve them)');
  assert.equal(u.p.read('AGENTS.md'), marked);
  // Resolved by hand, then stamped.
  u.p.write('AGENTS.md', agents.replace('Rule two.', 'Rule two, as both have it.'));
  assert.equal(u.run(['--stamp']).stdout, `version  ${u.v2}\n`);
  assert.equal(u.stamp(), u.v2);
});
test('--update repeated before the stamp finds its earlier merges in the project and lists nothing twice', t => {
  const theirs = agents.replace('Rule two.', 'Rule two, as the scaffold has it.'), merged = `${gate.replace('set -euo pipefail', 'set -eu')}echo passed\n`;
  const u = updated(t, {
    project: p => { p.write('AGENTS.md', agents.replace('Rule two.', 'Rule two, as the project has it.')); p.write('scripts/gate.sh', gate.replace('set -euo pipefail', 'set -eu')); },
    scaffold: s => { s.write('AGENTS.md', theirs); s.write('scripts/gate.sh', `${gate}echo passed\n`); },
  });
  conflicted(u, ['CONFLICT AGENTS.md', 'merged   scripts/gate.sh'], { merged: 1, conflicts: 1 });
  // The conflict resolved in the scaffold's favour and committed, the stamp forgotten.
  u.p.write('AGENTS.md', theirs); u.p.commit('scaffold update');
  const again = u.run(['--update']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(lines(again), [`version  ${u.v2}`, summary(u.v1, u.v2)]);
  assert.equal(u.p.read('scripts/gate.sh'), merged);
  assert.equal(u.p.status(), ` M ${stampFile}`);
});
test('--update repeated before the stamp leaves a conflict alone that was resolved by hand, and writes the markers again where the update was reverted', t => {
  const resolved = agents.replace('Rule two.', 'Rule two, as both have it.');
  const u = updated(t, {
    project: p => p.write('AGENTS.md', agents.replace('Rule two.', 'Rule two, as the project has it.')),
    scaffold: s => s.write('AGENTS.md', agents.replace('Rule two.', 'Rule two, as the scaffold has it.')),
  });
  conflicted(u, ['CONFLICT AGENTS.md'], { conflicts: 1 });
  const marked = u.p.read('AGENTS.md'), repeated = () => { const result = u.run(['--update']); return { ...u, result, lines: lines(result) }; };
  // Reverted: the file is what it was, and the update does what it did.
  u.p.git('checkout', '--', '.');
  let again = repeated();
  conflicted(again, ['CONFLICT AGENTS.md'], { conflicts: 1 });
  assert.equal(again.lines[0], 'CONFLICT AGENTS.md (both changed the same lines: conflict markers written)');
  assert.equal(u.p.read('AGENTS.md'), marked);
  // Resolved in words of its own and committed, the stamp forgotten: the same merge finds the same conflict, and the resolution stays.
  u.p.write('AGENTS.md', resolved); u.p.commit('scaffold update');
  again = repeated();
  conflicted(again, ['CONFLICT AGENTS.md'], { conflicts: 1 });
  assert.match(again.lines[0], /\(an earlier update wrote conflict markers into it, and it has changed since: taken as resolved by hand and left as it is; where it is not, merge it by hand with \S+\/scaffold\/AGENTS\.md\)$/);
  assert.equal(u.p.read('AGENTS.md'), resolved);
  assert.equal(u.p.status(), '');
  // The stamp ends it, and with it the note of the conflict in the project's Git directory.
  assert.ok(fs.existsSync(path.join(u.p.root, '.git/kordal-scaffold-conflicts')));
  assert.equal(u.run(['--stamp']).stdout, `version  ${u.v2}\n`);
  assert.ok(!fs.existsSync(path.join(u.p.root, '.git/kordal-scaffold-conflicts')));
  u.p.commit('the version');
  assert.deepEqual(lines(u.run(['--update'])), [`version  ${u.v2}`, summary(u.v2, u.v2)]);
  assert.equal(u.p.read('AGENTS.md'), resolved);
});
test('the command the FAIL line prints runs as it stands where the paths hold a space', t => {
  const u = updated(t, {
    project: p => p.write('AGENTS.md', agents.replace('Rule two.', 'Rule two, as the project has it.')),
    scaffold: s => s.write('AGENTS.md', agents.replace('Rule two.', 'Rule two, as the scaffold has it.')),
  }, { prefix: 'boot strap-' });
  assert.equal(u.result.status, 1, u.result.stdout + u.result.stderr);
  const command = /: (bash .* --stamp .*)$/.exec(u.lines.at(-2))?.[1];
  assert.ok(command, u.lines.at(-2));
  const stamped = spawnSync('bash', ['-c', command], { cwd: os.tmpdir(), encoding: 'utf8', env });
  assert.equal(stamped.status, 0, `${command}\n${stamped.stdout}${stamped.stderr}`);
  assert.equal(stamped.stdout, `version  ${u.v2}\n`);
  assert.equal(u.stamp(), u.v2);
});
test('--update leaves a file alone that both sides changed and Git cannot merge: a conflict', t => {
  const u = updated(t, { project: p => p.write('docs/logo.bin', '\u0000\u0001\u0003'), scaffold: s => s.write('docs/logo.bin', '\u0000\u0001\u0004') }, { files: { ...scaffold, 'docs/logo.bin': '\u0000\u0001\u0002' } });
  conflicted(u, ['CONFLICT docs/logo.bin'], { conflicts: 1 });
  assert.match(u.lines[0], /\(both changed it and Git cannot merge it: left as it is; merge it by hand with \S+\/scaffold\/docs\/logo\.bin\)$/);
  assert.equal(u.p.read('docs/logo.bin'), '\u0000\u0001\u0003');
  assert.equal(u.p.status(), '');
});
test('--update adds a file that is new in the scaffold, in a new directory and with its mode', t => {
  const u = updated(t, { scaffold: s => { s.write('docs/agents/acceptance.md', '# Acceptance\n'); s.write('tests/integration/check-docs.sh', '#!/usr/bin/env bash\n', 0o755); } });
  clean(u, ['added    docs/agents/acceptance.md', 'added    tests/integration/check-docs.sh'], { added: 2 });
  assert.equal(u.p.read('docs/agents/acceptance.md'), '# Acceptance\n');
  assert.ok(!u.p.executable('docs/agents/acceptance.md'));
  assert.equal(u.p.read('tests/integration/check-docs.sh'), '#!/usr/bin/env bash\n');
  assert.ok(u.p.executable('tests/integration/check-docs.sh'));
});
test('--update does not touch a project file where the scaffold now has a new one: a conflict, unless the two are the same', t => {
  const u = updated(t, {
    project: p => { p.write('docs/agents/acceptance.md', '# Acceptance, as the project wrote it\n'); p.write('docs/agents/workflow.md', '# Workflow\n'); },
    scaffold: s => { s.write('docs/agents/acceptance.md', '# Acceptance\n'); s.write('docs/agents/workflow.md', '# Workflow\n'); },
  });
  conflicted(u, ['CONFLICT docs/agents/acceptance.md'], { conflicts: 1 });
  assert.match(u.lines[0], /\(new in the scaffold, and the project has its own: left as it is; merge it by hand with \S+\/scaffold\/docs\/agents\/acceptance\.md\)$/);
  assert.equal(u.p.read('docs/agents/acceptance.md'), '# Acceptance, as the project wrote it\n');
  assert.equal(u.p.status(), '');
});
test('--update removes a file the scaffold dropped and the project had not changed', t => {
  const u = updated(t, { project: p => p.remove('docs/agents/planning.md'), scaffold: s => { s.remove('docs/agents/claude.md'); s.remove('docs/agents/planning.md'); } });
  clean(u, ['removed  docs/agents/claude.md'], { removed: 1 });
  assert.ok(!u.p.has('docs/agents/claude.md'));
  assert.equal(u.p.status(), ` D docs/agents/claude.md\n M ${stampFile}`, 'a file both sides removed is not listed');
});
test('--update keeps a file the scaffold dropped when the project changed it: a conflict', t => {
  const u = updated(t, { project: p => p.write('docs/agents/claude.md', '# Claude, as the project has it\n'), scaffold: s => s.remove('docs/agents/claude.md') });
  conflicted(u, ['CONFLICT docs/agents/claude.md'], { conflicts: 1 });
  assert.match(u.lines[0], /\(removed from the scaffold, but the project changed it: left as it is; delete it, or keep it as the project's own\)$/);
  assert.equal(u.p.read('docs/agents/claude.md'), '# Claude, as the project has it\n');
  assert.equal(u.p.status(), '');
});
test('--update leaves a file deleted that the project deleted, and says that the scaffold changed it', t => {
  const u = updated(t, { project: p => p.remove('docs/agents/claude.md'), scaffold: s => s.write('docs/agents/claude.md', '# Claude\n\nOne more rule.\n') });
  clean(u, ['kept     docs/agents/claude.md'], { kept: 1 });
  assert.equal(u.lines[0], 'kept     docs/agents/claude.md (the project deleted it: it stays deleted, the scaffold\'s change is not applied)');
  assert.ok(!u.p.has('docs/agents/claude.md'));
});
test('--update follows a renamed scaffold file: the old one is removed, the new one added', t => {
  const u = updated(t, { scaffold: s => { s.remove('docs/agents/claude.md'); s.write('docs/agents/roles.md', '# Claude\n'); } });
  clean(u, ['removed  docs/agents/claude.md', 'added    docs/agents/roles.md'], { added: 1, removed: 1 });
  assert.ok(!u.p.has('docs/agents/claude.md'));
  assert.equal(u.p.read('docs/agents/roles.md'), '# Claude\n');
});
test('--update finds the scaffold\'s earlier version wherever the skill lies in its repository', t => {
  const u = updated(t, { project: p => p.write('AGENTS.md', `${agents}Ours.\n`), scaffold: s => s.write('Makefile', newMakefile) }, { nest: '' });
  clean(u, ['updated  Makefile'], { updated: 1 });
});
test('--update reads a file name with a space and letters beyond ASCII as it is', t => {
  const name = 'docs/zażółć gęślą.md';
  const u = updated(t, { scaffold: s => { s.write(name, '# Jaźń, od nowa\n'); s.remove('docs/agents/claude.md'); } }, { files: { ...scaffold, [name]: '# Jaźń\n' } });
  clean(u, ['removed  docs/agents/claude.md', `updated  ${name}`], { updated: 1, removed: 1 });
  assert.equal(u.p.read(name), '# Jaźń, od nowa\n');
});
test('--update leaves alone the .DS_Store of an earlier scaffold version: the project\'s own is not removed with it', t => {
  const u = updated(t, { project: p => p.write('docs/.DS_Store', 'finder\n'), scaffold: s => { s.remove('docs/.DS_Store'); s.write('Makefile', newMakefile); } }, { files: { ...scaffold, 'docs/.DS_Store': 'finder\n' } });
  clean(u, ['updated  Makefile'], { updated: 1 });
  assert.ok(u.p.has('docs/.DS_Store'));
});
test('--update writes nothing through a symbolic link, to a file or to a directory above it: a conflict, and what the link leads to stays as it is', t => {
  const run = gate.replace('gate', 'tool'), link = (p, target, file) => { fs.rmSync(path.join(p.root, file), { recursive: true }); fs.symlinkSync(target, path.join(p.root, file)); };
  const u = updated(t, {
    project: p => {
      const shared = path.join(p.root, '../shared');
      fs.mkdirSync(path.join(shared, 'tools'), { recursive: true });
      // One scaffold file as a link to another; a file, an unchanged file and a directory as links out of the project; a link to nothing where the scaffold will add a file.
      link(p, '../../AGENTS.md', 'docs/agents/claude.md');
      fs.writeFileSync(path.join(shared, 'gate.sh'), gate, { mode: 0o755 }); link(p, '../../shared/gate.sh', 'scripts/gate.sh');
      fs.writeFileSync(path.join(shared, 'Makefile'), makefile); link(p, '../shared/Makefile', 'Makefile');
      for (const file of ['run.sh', 'old.sh']) fs.writeFileSync(path.join(shared, 'tools', file), run, { mode: 0o755 });
      link(p, '../shared/tools', 'tools');
      fs.symlinkSync('../../../shared/acceptance.md', path.join(p.root, 'docs/agents/acceptance.md'));
    },
    scaffold: s => {
      s.write('AGENTS.md', `${agents}Tests are in tests/.\n`); s.write('docs/agents/claude.md', '# Claude\n\nOne more rule.\n'); s.write('docs/agents/acceptance.md', '# Acceptance\n');
      s.write('scripts/gate.sh', `${gate}echo passed\n`); s.write('tools/run.sh', `${run}echo ran\n`); s.write('tools/new.sh', run, 0o755); s.remove('tools/old.sh'); s.remove('tools/gone.sh');
    },
  }, { files: { ...scaffold, 'tools/run.sh': run, 'tools/old.sh': run, 'tools/gone.sh': run } });
  conflicted(u, ['updated  AGENTS.md', 'CONFLICT docs/agents/acceptance.md', 'CONFLICT docs/agents/claude.md', 'CONFLICT scripts/gate.sh', 'CONFLICT tools/new.sh', 'CONFLICT tools/old.sh', 'CONFLICT tools/run.sh'], { updated: 1, conflicts: 6 });
  assert.match(u.lines[2], /\(the project reaches it through a symbolic link, and nothing is written through one: left as it is; bring the link's target up to \S+\/scaffold\/docs\/agents\/claude\.md by hand\)$/);
  assert.match(u.lines[5], /\(removed from the scaffold, and the project reaches it through a symbolic link: left as it is; delete it, or keep it as the project's own\)$/);
  assert.equal(u.p.read('AGENTS.md'), `${agents}Tests are in tests/.\n`, 'the file a link leads to is updated as itself, and holds no markers of the link\'s conflict');
  assert.equal(fs.readlinkSync(path.join(u.p.root, 'docs/agents/claude.md')), '../../AGENTS.md');
  assert.equal(u.p.status(), ' M AGENTS.md', 'the update is a diff of the project');
  const shared = tree(path.join(u.dir, 'shared'));
  assert.deepEqual(fs.readdirSync(shared.root).sort(), ['Makefile', 'gate.sh', 'tools']);
  assert.deepEqual(fs.readdirSync(path.join(shared.root, 'tools')).sort(), ['old.sh', 'run.sh']);
  assert.equal(shared.read('gate.sh'), gate);
  assert.equal(shared.read('tools/run.sh'), run);
});
test('--update leaves a file alone that Git does not track in the project: a conflict, as its change would be no diff to review', t => {
  const ours = agents.replace('Rule one.', 'Rule one, as the project has it.');
  const u = updated(t, {
    // Ignored by the project: its own AGENTS.md, and two files as the scaffold made them.
    project: p => { p.write('.gitignore', 'AGENTS.md\ndocs/agents/claude.md\nscripts/gate.sh\n'); p.git('rm', '--quiet', '--cached', 'AGENTS.md', 'docs/agents/claude.md', 'scripts/gate.sh'); p.write('AGENTS.md', ours); },
    scaffold: s => { s.write('AGENTS.md', `${agents}Tests are in tests/.\n`); s.write('Makefile', newMakefile); s.remove('docs/agents/claude.md'); s.write('scripts/gate.sh', `${gate}echo passed\n`); },
  });
  conflicted(u, ['CONFLICT AGENTS.md', 'updated  Makefile', 'CONFLICT docs/agents/claude.md', 'CONFLICT scripts/gate.sh'], { updated: 1, conflicts: 3 });
  assert.match(u.lines[0], /\(the scaffold changed it, and Git does not track it in the project: left as it is; merge it by hand with \S+\/scaffold\/AGENTS\.md\)$/);
  assert.match(u.lines[2], /\(removed from the scaffold, and Git does not track it in the project: left as it is; delete it, or keep it as the project's own\)$/);
  assert.equal(u.p.read('AGENTS.md'), ours);
  assert.equal(u.p.read('docs/agents/claude.md'), '# Claude\n');
  assert.equal(u.p.read('scripts/gate.sh'), gate);
  assert.equal(u.p.status(), ' M Makefile');
});
test('--update reads the executable bit of a file, not whether the file may run where it lies', t => {
  // Group and others may run it, its owner may not, and root may: Git and the scaffold see a file without the bit, the project's own change of mode.
  const others = updated(t, { project: p => p.write('scripts/gate.sh', gate, 0o655), scaffold: s => s.write('scripts/gate.sh', `${gate}echo passed\n`) });
  clean(others, ['merged   scripts/gate.sh'], { merged: 1 });
  assert.ok(!others.p.executable('scripts/gate.sh'), 'the mode the project gave it stays');
  // The bit is set and the file may not run: an access control list of macOS, as a noexec mount does it on Linux.
  if (process.platform !== 'darwin') return;
  const denied = updated(t, {
    project: p => assert.equal(spawnSync('chmod', ['+a', 'everyone deny execute', path.join(p.root, 'scripts/gate.sh')]).status, 0),
    scaffold: s => s.write('scripts/gate.sh', `${gate}echo passed\n`),
  });
  clean(denied, ['updated  scripts/gate.sh'], { updated: 1 });
  assert.ok(denied.p.executable('scripts/gate.sh'));
});
test('--update compares and merges a checkout with CRLF line endings as the text Git holds, and leaves it its line endings', t => {
  const crlf = text => text.replace(/\n/g, '\r\n'), ours = 'Rule two, as the project has it.', theirs = 'Rule two, as the scaffold has it.', own = gate.replace('set -euo pipefail', 'set -eu');
  const f = scaffolded(t, { files: { ...scaffold, 'docs/logo.bin': '\u0000\r\n\u0001' } });
  // The files as Git checks them out under the attribute, the recorded version among them.
  f.p.write('.gitattributes', '* text=auto eol=crlf\n'); f.p.commit('CRLF line endings');
  for (const file of [...Object.keys(scaffold), stampFile]) f.p.remove(file);
  f.p.git('checkout', '--', '.');
  assert.equal(f.p.read(stampFile), `${f.v1}\r\n`);
  assert.equal(f.p.read('Makefile'), crlf(makefile));
  f.p.write('AGENTS.md', crlf(agents.replace('Rule two.', ours))); f.p.write('scripts/gate.sh', crlf(own)); f.p.commit('the project\'s own changes');
  assert.equal(f.run(['--diff']).stdout, `The scaffold has not changed since ${f.v1}\n`);
  f.p.remove(stampFile);
  assert.deepEqual(lines(f.run(['--diff'])), [`No recorded scaffold version: comparing every file with the scaffold at ${f.v1}`, 'differs  AGENTS.md', 'differs  scripts/gate.sh']);
  f.p.git('checkout', '--', stampFile);
  f.s.write('AGENTS.md', agents.replace('Rule two.', theirs)); f.s.write('Makefile', newMakefile); f.s.write('scripts/gate.sh', `${gate}echo passed\n`); f.s.write('docs/logo.bin', '\u0000\r\n\u0002');
  const v2 = f.s.commit('version 2'), result = f.run(['--update']);
  conflicted({ ...f, v2, result, lines: lines(result) }, ['CONFLICT AGENTS.md', 'updated  Makefile', 'updated  docs/logo.bin', 'merged   scripts/gate.sh'], { updated: 2, merged: 1, conflicts: 1 });
  assert.equal(f.p.read('AGENTS.md'), crlf(agents.replace('Rule two.\n', `<<<<<<< project\n${ours}\n||||||| scaffold ${f.v1.slice(0, 12)}\nRule two.\n=======\n${theirs}\n>>>>>>> scaffold ${v2.slice(0, 12)}\n`)));
  assert.equal(f.p.read('Makefile'), crlf(newMakefile));
  assert.equal(f.p.read('scripts/gate.sh'), crlf(`${own}echo passed\n`));
  assert.ok(f.p.executable('scripts/gate.sh'));
  assert.equal(f.p.read('docs/logo.bin'), '\u0000\r\n\u0002', 'a binary file is no text with CRLF line endings');
  assert.equal(f.p.status(), ' M AGENTS.md\n M Makefile\n M docs/logo.bin\n M scripts/gate.sh');
  // Committed with its markers, which end in a carriage return here: they are found, not nested.
  f.p.commit('scaffold update, unresolved');
  const again = f.run(['--update']);
  assert.equal(lines(again)[0], 'CONFLICT AGENTS.md (it still holds the conflict markers of an earlier update: resolve them)');
  assert.equal(lines(again).length, 3, again.stdout);
  assert.equal(f.p.status(), '');
});
test('--update merges a file that has CRLF line endings in the scaffold itself as the file it is', t => {
  const bat = ['@echo off', 'rem one', 'rem two', 'rem three', 'rem four', 'rem five', ''].join('\r\n'), one = ['rem one', 'rem one, as the project has it'], five = ['rem five', 'rem five, as the scaffold has it'];
  const u = updated(t, { project: p => p.write('scripts/gate.bat', bat.replace(...one)), scaffold: s => s.write('scripts/gate.bat', bat.replace(...five)) }, { files: { ...scaffold, 'scripts/gate.bat': bat } });
  clean(u, ['merged   scripts/gate.bat'], { merged: 1 });
  assert.equal(u.p.read('scripts/gate.bat'), bat.replace(...one).replace(...five));
});
test('--update names the base branch a manifest lacks, where the repository has one other than main: it writes no manifest', t => {
  // A project on the given base branch; and what its update reports before the version, run on the other branch where one is given.
  const project = base => {
    const f = fixture(t);
    existing(f, base);
    assert.equal(f.run().status, 0);
    return f;
  };
  const report = (f, on) => {
    f.p.commit('scaffold');
    if (on) f.p.git('switch', '--quiet', '--create', on);
    f.s.write('Makefile', newMakefile);
    const v2 = f.s.commit('version 2'), result = f.run(['--update']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(lines(result).slice(-2), [`version  ${v2}`, summary(f.v1, v2, { updated: 1 })]);
    return lines(result).slice(0, -2);
  };
  const master = project('master');
  master.p.write('docs/plans/backlog.json', manifest);
  assert.deepEqual(report(master), ['updated  Makefile', 'WARN     the base branch is master and docs/plans/backlog.json names none: add "base_branch": "master" to it by hand']);
  assert.equal(master.p.read('docs/plans/backlog.json'), manifest);
  // On a task's branch, without origin/HEAD, main or master, the branch of the checkout is no answer.
  const trunk = project('trunk');
  trunk.p.write('docs/plans/backlog.json', manifest);
  assert.deepEqual(report(trunk, 'task/cap-009'), ['updated  Makefile', 'WARN     docs/plans/backlog.json names no "base_branch" and the repository has no origin/HEAD, main or master: add "base_branch": "<the base branch>" to it by hand']);
  // A manifest that names its base, and a repository whose base is main, need no edit.
  assert.deepEqual(report(project('master')), ['updated  Makefile']);
  const main = project('main');
  assert.deepEqual(report(main, 'task/cap-009'), ['updated  Makefile']);
});
test('--update refuses a project without a recorded version, or with one the skill repository does not know, and changes nothing', t => {
  // No version, and the one a skill outside any repository records: compare by hand. A commit this checkout lacks: update the checkout first.
  const none = recorded => `records no scaffold version that is a commit of \\S+/pack/plan \\(recorded: ${recorded}\\), so there is no base to merge from: compare with --diff, apply the changes by hand, then --stamp`;
  const lacking = `records the scaffold version ${unknown}, which this checkout of \\S+/pack/plan does not have, so there is no base to merge from: where a newer checkout recorded it, update this one \\(git pull\\) and run --update again; only where that commit is nowhere to be had, compare with --diff, apply the changes by hand, then --stamp`;
  for (const [recorded, why] of [[null, none('none')], ['unversioned', none('unversioned')], [unknown, lacking]]) {
    const f = scaffolded(t);
    if (recorded) f.p.write(stampFile, `${recorded}\n`); else f.p.remove(stampFile);
    f.p.commit('the version is lost');
    f.s.write('Makefile', newMakefile); f.s.commit('version 2');
    const result = f.run(['--update']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`^FAIL  \\S+/project ${why}\\n$`));
    assert.equal(f.p.status(), '');
    assert.equal(f.p.read('Makefile'), makefile);
  }
});
test('--update refuses a skills checkout that does not contain the recorded version, behind it or on a branch beside it, and changes nothing', t => {
  for (const beside of [false, true]) {
    const f = fixture(t);
    f.s.write('Makefile', newMakefile); f.s.write('docs/agents/acceptance.md', '# Acceptance\n');
    const v2 = f.s.commit('version 2');
    assert.equal(f.run().status, 0);
    f.p.commit('scaffold');
    // The checkout goes back to version 1, and from there to a version 3 of its own.
    f.s.git('checkout', '--quiet', f.v1);
    if (beside) { f.s.write('AGENTS.md', `${agents}Tests are in tests/.\n`); f.s.commit('version 3'); }
    const at = f.s.git('rev-parse', 'HEAD'), result = f.run(['--update']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`^FAIL  \\S+/project records the scaffold version ${v2}, which the checkout of \\S+/pack/plan \\(at ${at}\\) does not contain: it is older than the project's scaffold, or on another branch, and an update would undo changes the project already has\\. Update the skills checkout \\(git pull, or switch to the branch that holds that version\\) and run --update again; only where its history was rewritten \\(a squash merge, a rebase\\), compare with --diff, apply the changes by hand, then --stamp\\n$`));
    assert.equal(f.p.status(), '');
    assert.equal(f.stamp(), v2);
    assert.equal(f.p.read('Makefile'), newMakefile);
    assert.ok(f.p.has('docs/agents/acceptance.md'));
    // --diff shows the way back as what it is.
    assert.deepEqual(lines(f.run(['--diff'])).slice(0, 2), [`WARN     the checkout of ${f.skill} does not contain the recorded version ${v2}: unless its history was rewritten, update it first; the changes below lead back to an older scaffold`, `Scaffold changes from ${v2} to ${at}:`]);
  }
});
test('--update refuses a project tree that is not clean, or not a repository, and changes nothing', t => {
  const f = scaffolded(t);
  f.s.write('Makefile', newMakefile); f.s.commit('version 2');
  const refused = why => {
    const result = f.run(['--update']);
    assert.equal(result.status, 1, why);
    assert.match(result.stdout, /^FAIL  \S+\/project is not a clean Git checkout: commit or stash your changes first, so that the update is a diff you can review and revert\n$/, why);
    assert.equal(f.p.read('Makefile'), makefile, why);
    assert.equal(f.stamp(), f.v1, why);
  };
  f.p.write('AGENTS.md', `${agents}A draft.\n`);
  refused('a changed file');
  f.p.write('AGENTS.md', agents); f.p.write('notes.md', 'A draft.\n');
  refused('an untracked file');
  f.p.remove('notes.md'); fs.rmSync(path.join(f.p.root, '.git'), { recursive: true });
  refused('no repository');
});
test('a second --update after a clean one changes nothing', t => {
  const u = updated(t, {
    project: p => p.write('AGENTS.md', agents.replace('Rule one.', 'Rule one, as the project has it.')),
    scaffold: s => { s.write('AGENTS.md', `${agents}Tests are in tests/.\n`); s.write('Makefile', newMakefile); s.remove('docs/agents/claude.md'); s.write('docs/agents/acceptance.md', '# Acceptance\n'); },
  });
  clean(u, ['merged   AGENTS.md', 'updated  Makefile', 'added    docs/agents/acceptance.md', 'removed  docs/agents/claude.md'], { added: 1, updated: 1, merged: 1, removed: 1 });
  u.p.commit('scaffold update');
  const again = u.run(['--update', u.p.root], { cwd: u.dir });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(lines(again), [`version  ${u.v2}`, summary(u.v2, u.v2)]);
  assert.equal(u.p.status(), '');
});

test('the real scaffold, bootstrapped into an empty directory, passes its structure check and its documentation check', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-real-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync('bash', [path.join(here, 'bootstrap.sh'), dir], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(lines(result)[0], 'init     Git repository on main');
  assert.doesNotMatch(result.stdout, /^(kept|base) /m);
  assert.ok((fs.statSync(path.join(dir, 'scripts/gate.sh')).mode & 0o100) !== 0);
  for (const [command, ...args] of [[process.execPath, 'scripts/agent-workflow.mjs', 'check'], ['bash', 'tests/integration/check-docs.sh']]) {
    const check = spawnSync(command, args, { cwd: dir, encoding: 'utf8', env });
    assert.equal(check.status, 0, `${args.join(' ')}:\n${check.stdout}${check.stderr}`);
  }
});
