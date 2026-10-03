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
function fixture(t, { nest = 'pack/plan', files = scaffold } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'skills'), skill = path.join(repo, nest);
  fs.mkdirSync(skill, { recursive: true }); fs.mkdirSync(path.join(dir, 'project'));
  fs.copyFileSync(path.join(here, 'bootstrap.sh'), path.join(skill, 'bootstrap.sh'));
  const s = tree(path.join(skill, 'scaffold'), repo), p = tree(path.join(dir, 'project'));
  for (const [file, text] of Object.entries(files)) s.write(file, text, file.endsWith('.sh') ? 0o755 : 0o644);
  s.git('init', '--quiet', '--initial-branch', 'main');
  const v1 = s.commit('version 1');
  const run = (args = [], options = {}) => spawnSync('bash', [path.join(skill, 'bootstrap.sh'), ...args], { cwd: p.root, encoding: 'utf8', env, ...options });
  return { dir, s, p, v1, run, stamp: () => p.read(stampFile).trim() };
}
// A project that already is a repository, on the given branch, with a first commit.
const existing = (f, branch) => { f.p.git('init', '--quiet', '--initial-branch', branch); f.p.write('README.md', '# Product\n'); f.p.commit('first'); };
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
  assert.match(u.lines.at(-2), /^FAIL     the version is not recorded\. Resolve each CONFLICT above .*, then run: bash \S+\/bootstrap\.sh --stamp \S+\/project$/);
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
  const unborn = fixture(t);
  unborn.p.git('init', '--quiet', '--initial-branch', 'develop');
  assert.match(unborn.run().stdout, /^base     develop$/m);
  assert.equal(JSON.parse(unborn.p.read('docs/plans/backlog.json')).base_branch, 'develop');
});
test('origin/HEAD decides the base before any local branch', t => {
  const remote = (f, branch) => { f.p.git('update-ref', `refs/remotes/origin/${branch}`, 'HEAD'); f.p.git('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`); };
  const other = fixture(t);
  existing(other, 'main'); remote(other, 'develop');
  assert.match(other.run().stdout, /^base     develop$/m);
  assert.equal(JSON.parse(other.p.read('docs/plans/backlog.json')).base_branch, 'develop');
  const main = fixture(t);
  existing(main, 'trunk'); remote(main, 'main');
  assert.doesNotMatch(main.run().stdout, /^(base|WARN) /m);
  assert.equal(main.p.read('docs/plans/backlog.json'), manifest);
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
  const report = [`No recorded scaffold version: comparing every file with the scaffold at ${f.v1}`, 'differs  AGENTS.md', 'missing  docs/agents/claude.md'];
  assert.deepEqual(lines(f.run(['--diff'])), report);
  f.p.write(stampFile, '0123456789abcdef0123456789abcdef01234567\n');
  assert.deepEqual(lines(f.run(['--diff'])), report);
  assert.equal(f.p.read('AGENTS.md'), '# Ours\n');
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
test('--update refuses a project without a recorded version, or with one the skill repository does not know, and changes nothing', t => {
  for (const recorded of [null, '0123456789abcdef0123456789abcdef01234567']) {
    const f = scaffolded(t);
    if (recorded) f.p.write(stampFile, `${recorded}\n`); else f.p.remove(stampFile);
    f.p.commit('the version is lost');
    f.s.write('Makefile', newMakefile); f.s.commit('version 2');
    const result = f.run(['--update']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`^FAIL  \\S+/project records no scaffold version that is a commit of \\S+/pack/plan \\(recorded: ${recorded ?? 'none'}\\), so there is no base to merge from: compare with --diff, apply the changes by hand, then --stamp\\n$`));
    assert.equal(f.p.status(), '');
    assert.equal(f.p.read('Makefile'), makefile);
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
