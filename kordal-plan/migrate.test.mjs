import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A hook or `git rebase --exec` exports these: the fixtures' Git would then write into the caller's repository.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']) delete process.env[name];

// migrate.mjs on a project as the scaffold left it before the rename: the
// manifest's "mvp", the branch mvp1 with a bare origin, mvp1 documents, a
// task plan that links to them, and a fake gh that holds the milestone "MVP 1".
// The base branch is main, or the one the manifest names as "base_branch".
const here = path.dirname(fileURLToPath(import.meta.url));
const fakeGh = `#!/usr/bin/env node
const fs = require('fs');
const file = process.env.GH_STATE, state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (process.env.GH_FAIL) { console.error('error connecting to api.github.com'); process.exit(1); }
const [, endpoint, , method] = process.argv.slice(2);
const data = method ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
const parts = endpoint.split('?')[0].split('/').slice(3);
let out = state.milestones;
if (method) {
  state.writes.push(method + ' ' + parts.join('/') + ' ' + JSON.stringify(data));
  if (parts[0] === 'milestones') { out = state.milestones.find(m => m.number === Number(parts[1])); out.title = data.title; }
  else out = {};
}
fs.writeFileSync(file, JSON.stringify(state));
console.log(JSON.stringify(out));
`;
function fixture(t, base = 'main') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'project');
  const write = (file, text, mode) => { fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true }); fs.writeFileSync(path.join(project, file), text, { mode }); };
  const git = (...args) => { const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  write('docs/plans/backlog.json', JSON.stringify({ version: 1, mvp: 1, repository: 'owner/product', integration_branch: 'mvp1', ...(base === 'main' ? {} : { base_branch: base }), tasks: [{ id: 'FIG-001', title: 'Figure', slug: 'figure', issue: 4, depends_on: [], adrs: [] }] }, null, 2));
  write('docs/plans/planned/FIG-001-figure.md', '# FIG-001: Figure\n\n[scope](../../product/mvp1.md) and [research](../../product/mvp1-research.md#baseline)\n');
  write('docs/product/mvp1.md', '# MVP 1: Figures\n\nSee the [summary](mvp1-summary.html).\n');
  write('docs/product/mvp1-research.md', '# Research\n\n## Baseline\n');
  write('docs/product/mvp1-summary.html', '<html></html>\n');
  write('README.md', 'The word mvp1 alone and a path src/mvp1.js stay.\n');
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin/gh'), fakeGh, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'bin/github.json'), JSON.stringify({ milestones: [{ number: 1, title: 'MVP 1' }, { number: 2, title: 'Backlog' }], writes: [] }));
  git('init', '--quiet', '--initial-branch', base);
  git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  spawnSync('git', ['init', '--quiet', '--bare', path.join(dir, 'origin.git')]);
  git('remote', 'add', 'origin', path.join(dir, 'origin.git'));
  git('add', '--all'); git('commit', '--quiet', '--message', 'plan');
  git('branch', 'mvp1'); git('push', '--quiet', 'origin', base, 'mvp1');
  const run = offline => spawnSync(process.execPath, [path.join(here, 'migrate.mjs')], { cwd: project, encoding: 'utf8', env: { ...process.env, AGENT_GH: path.join(dir, 'bin/gh'), GH_STATE: path.join(dir, 'bin/github.json'), ...(offline ? { GH_FAIL: '1' } : {}) } });
  const github = () => JSON.parse(fs.readFileSync(path.join(dir, 'bin/github.json'), 'utf8'));
  const read = file => fs.readFileSync(path.join(project, file), 'utf8');
  return { project, write, git, run, github, read };
}

test('the manifest, the branch, the documents, their links and GitHub are renamed', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(JSON.parse(f.read('docs/plans/backlog.json'))), ['version', 'milestone', 'repository', 'integration_branch', 'tasks']);
  assert.equal(JSON.parse(f.read('docs/plans/backlog.json')).integration_branch, 'milestone1');
  assert.equal(f.git('branch', '--list', 'mvp1', 'milestone1').trim(), 'milestone1');
  assert.deepEqual(fs.readdirSync(path.join(f.project, 'docs/product')).sort(), ['milestone1-research.md', 'milestone1-summary.html', 'milestone1.md']);
  assert.match(f.read('docs/plans/planned/FIG-001-figure.md'), /\(\.\.\/\.\.\/product\/milestone1\.md\) and \[research\]\(\.\.\/\.\.\/product\/milestone1-research\.md#baseline\)/);
  assert.match(f.read('docs/product/milestone1.md'), /\(milestone1-summary\.html\)/);
  assert.equal(f.read('README.md'), 'The word mvp1 alone and a path src/mvp1.js stay.\n', 'only links to the renamed documents change');
  assert.deepEqual(f.github().writes, ['PATCH milestones/1 {"title":"Milestone 1"}', 'POST branches/mvp1/rename {"new_name":"milestone1"}']);
  assert.match(f.run().stdout, /Nothing to migrate/, 'a second run changes nothing');
});
test('a project whose base branch is not main migrates the same way, and its base_branch stays', t => {
  const f = fixture(t, 'trunk');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(f.read('docs/plans/backlog.json'));
  assert.deepEqual(Object.keys(manifest), ['version', 'milestone', 'repository', 'integration_branch', 'base_branch', 'tasks']);
  assert.deepEqual([manifest.integration_branch, manifest.base_branch], ['milestone1', 'trunk']);
  assert.equal(f.git('branch', '--list', 'mvp1', 'milestone1').trim(), 'milestone1');
  assert.equal(f.git('branch', '--show-current'), 'trunk');
  assert.deepEqual(f.github().writes, ['PATCH milestones/1 {"title":"Milestone 1"}', 'POST branches/mvp1/rename {"new_name":"milestone1"}']);
});
test('a GitHub failure leaves the project untouched', t => {
  const f = fixture(t);
  const result = f.run(true);
  assert.equal(result.status, 1);
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.git('branch', '--list', 'mvp1').trim(), 'mvp1');
  assert.equal(f.run().status, 0, 'and the run can be repeated');
});
test('it refuses a dirty tree, a task in progress and an unmerged integration branch', t => {
  const f = fixture(t);
  f.write('notes.md', 'draft\n');
  assert.match(f.run().stderr, /Commit or stash your changes first/);
  fs.rmSync(path.join(f.project, 'notes.md'));
  f.git('branch', 'task/fig-001');
  assert.match(f.run().stderr, /Finish the tasks in progress first: FIG-001/);
  f.git('branch', '--delete', '--force', 'task/fig-001');
  f.git('switch', '--quiet', 'mvp1'); f.write('src/app.js', 'export {};\n'); f.git('add', '--all'); f.git('commit', '--quiet', '--message', 'task'); f.git('switch', '--quiet', 'main');
  assert.match(f.run().stderr, /mvp1 holds work this checkout lacks: merge its pull request first, then migrate on the base branch$/m);
  assert.equal(f.github().writes.length, 0, 'nothing was changed on GitHub');
});
