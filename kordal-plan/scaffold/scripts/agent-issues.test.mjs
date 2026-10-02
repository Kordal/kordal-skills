import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real scripts in a real Git repository with a bare `origin`, and
// agent-issues.fake-gh.mjs in place of gh: two documentation tasks, the
// second depending on the first, planned on main and on milestone1.
const sections = ['Goal', 'Context', 'Task Contract', 'Scope', 'Out of Scope', 'Affected Components', 'Acceptance Criteria', 'Flow', 'Implementation Steps', 'Tests', 'Risks', 'Evidence', 'Review', 'Completion Notes'];
const tasks = () => [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', issue: null, depends_on: ['CAP-001'], adrs: [] },
];
const body = (task, heading) => {
  if (heading === 'Goal') return `Deliver ${task.title}.`;
  if (heading === 'Task Contract') return `Issue: none\n\nDependencies: ${task.depends_on.join(', ') || 'none'}\n`;
  return heading === 'Acceptance Criteria' ? '- [x] Works\n- [x] Fails safely' : 'Text.';
};
const plan = task => `# ${task.id}: ${task.title}\n\n` + sections.map(s => `## ${s}\n\n${body(task, s)}\n`).join('\n');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-issues-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text, { mode }); };
  const git = (...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  for (const script of ['agent-local.mjs', 'agent-workflow.mjs', 'agent-scope.mjs', 'agent-issues.mjs']) write(`scripts/${script}`, fs.readFileSync(path.join(scripts, script), 'utf8'));
  write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', repository: 'owner/product', tasks: tasks() }));
  for (const task of tasks()) write(`docs/plans/planned/${task.id}-${task.slug}.md`, plan(task));
  write('bin/gh', `#!/bin/sh\nexec "${process.execPath}" "${path.join(scripts, 'agent-issues.fake-gh.mjs')}" "$@"\n`, 0o755);
  write('.gitignore', 'bin/\n');
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  git('init', '--quiet', '--bare', path.join(dir, 'bin/origin.git'));
  git('remote', 'add', 'origin', path.join(dir, 'bin/origin.git'));
  const commit = message => { git('add', '--all'); git('commit', '--quiet', '--message', message); return git('rev-parse', 'HEAD'); };
  commit('plans');
  const env = offline => ({ ...process.env, AGENT_GH: path.join(dir, 'bin/gh'), GH_STATE: path.join(dir, 'bin/github.json'), ...(offline ? { GH_FAIL: '1' } : {}) });
  const run = script => (args, offline) => spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], { encoding: 'utf8', env: env(offline) });
  const github = () => JSON.parse(fs.readFileSync(path.join(dir, 'bin/github.json'), 'utf8'));
  const issue = number => { const i = github().issues[number - 1]; return { state: i.state, labels: i.labels.map(l => l.name), milestone: i.milestone?.number, title: i.title, body: i.body }; };
  const edit = change => { const state = github(); change(state); fs.writeFileSync(path.join(dir, 'bin/github.json'), JSON.stringify(state)); };
  const manifest = () => JSON.parse(fs.readFileSync(path.join(dir, 'docs/plans/backlog.json'), 'utf8'));
  // Stage 6 of planning: issues, their numbers committed, the integration branch.
  const plan6 = () => { assert.equal(run('agent-issues.mjs')(['sync']).status, 0); commit('issues'); git('branch', 'milestone1'); };
  // A documentation task delivered: claimed, its plan completed, finished.
  const deliver = (offline) => {
    assert.equal(run('agent-local.mjs')(['claim', 'CAP-001'], offline).status, 0);
    git('switch', '--quiet', 'task/cap-001');
    fs.mkdirSync(path.join(dir, 'docs/plans/completed'), { recursive: true });
    git('mv', 'docs/plans/planned/CAP-001-identity.md', 'docs/plans/completed/CAP-001-identity.md');
    commit('CAP-001');
    return run('agent-local.mjs')(['finish', 'CAP-001'], offline);
  };
  return { dir, git, commit, github, issue, edit, manifest, plan6, deliver, issues: run('agent-issues.mjs'), local: run('agent-local.mjs') };
}

test('sync creates the labels, the milestone and one issue per task, and records the numbers', t => {
  const f = fixture(t);
  const first = f.issues(['sync']);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(f.github().labels.map(l => l.name).sort(), ['status:blocked', 'status:done', 'status:in-progress', 'status:ready', 'status:waiting']);
  assert.deepEqual(f.github().milestones, [{ number: 1, title: 'Milestone 1' }]);
  assert.deepEqual(f.manifest().tasks.map(task => task.issue), [1, 2]);
  assert.match(fs.readFileSync(path.join(f.dir, 'docs/plans/planned/CAP-002-freshness.md'), 'utf8'), /^Issue: #2$/m);
  assert.deepEqual({ ...f.issue(1), body: undefined }, { state: 'open', labels: ['status:ready'], milestone: 1, title: 'CAP-001: Identity', body: undefined });
  assert.deepEqual(f.issue(2).labels, ['status:waiting']);
  assert.match(f.issue(2).body, /^Deliver Freshness\.\n\n\*\*Plan:\*\* `CAP-002-freshness\.md` under `docs\/plans\/`\n\n\*\*Depends on:\*\* #1 \(CAP-001\)\n\n### Acceptance criteria\n\n- \[ \] Works\n- \[ \] Fails safely\n/);
  assert.equal(spawnSync(process.execPath, [path.join(f.dir, 'scripts/agent-workflow.mjs'), 'check'], { encoding: 'utf8' }).status, 0, 'the plans agree with the manifest');
});
test('a second sync writes nothing, and the check passes', t => {
  const f = fixture(t);
  f.plan6();
  const writes = f.github().writes.length;
  assert.match(f.issues(['sync']).stdout, /PASS: 2 issues of owner\/product match the repository\n$/);
  assert.equal(f.issues(['sync', '--check']).status, 0);
  assert.equal(f.github().writes.length, writes);
});
test('an issue that exists under the task\'s title is adopted, not duplicated', t => {
  const f = fixture(t);
  assert.equal(f.issues(['sync']).status, 0);
  f.git('checkout', '--quiet', '--', '.');
  assert.equal(f.issues(['sync']).status, 0);
  assert.equal(f.github().issues.length, 2);
  assert.deepEqual(f.manifest().tasks.map(task => task.issue), [1, 2]);
});
test('claim and finish keep the status labels, the closed state and the pushed branch current', t => {
  const f = fixture(t);
  f.plan6();
  assert.equal(f.local(['claim', 'CAP-001']).status, 0);
  assert.deepEqual(f.issue(1).labels, ['status:in-progress']);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/milestone1'), f.git('rev-parse', 'milestone1'), 'the claim publishes the integration branch');
  f.git('branch', '--delete', '--force', 'task/cap-001');
  const finished = f.deliver();
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /CAP-001 is on milestone1 at [a-f0-9]{40}\. Pushed milestone1; issues synced\./);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/milestone1').split(/\s/)[0], f.git('rev-parse', 'milestone1'));
  assert.deepEqual({ state: f.issue(1).state, labels: f.issue(1).labels }, { state: 'closed', labels: ['status:done'] });
  assert.match(f.issue(1).body, /- \[x\] Works\n- \[x\] Fails safely/);
  assert.deepEqual({ state: f.issue(2).state, labels: f.issue(2).labels }, { state: 'open', labels: ['status:ready'] }, 'the dependant became ready');
  assert.equal(f.issues(['sync', '--check']).status, 0);
  // The next milestone gets its own GitHub milestone; the finished task keeps the one that delivered it.
  const manifest = f.manifest(); manifest.milestone = 2;
  fs.writeFileSync(path.join(f.dir, 'docs/plans/backlog.json'), JSON.stringify(manifest));
  assert.equal(f.issues(['sync']).status, 0);
  assert.deepEqual([f.issue(1).milestone, f.issue(1).state, f.issue(2).milestone], [1, 'closed', 2]);
});
test('the check names every difference and changes nothing; sync repairs it and keeps other labels', t => {
  const f = fixture(t);
  f.plan6();
  f.edit(state => { state.issues[0].state = 'closed'; state.issues[0].labels = [{ name: 'status:done' }, { name: 'bug' }]; state.issues[1].body = 'Edited on GitHub.'; });
  const writes = f.github().writes.length;
  const check = f.issues(['sync', '--check']);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /DRIFT CAP-001 #1: state, labels differ \(wanted status:ready\)\nDRIFT CAP-002 #2: body differ/);
  assert.match(check.stderr, /2 difference\(s\) between GitHub and the repository/);
  assert.equal(f.github().writes.length, writes);
  assert.equal(f.issues(['sync']).status, 0);
  assert.deepEqual({ state: f.issue(1).state, labels: f.issue(1).labels }, { state: 'open', labels: ['bug', 'status:ready'] });
  assert.match(f.issue(2).body, /^Deliver Freshness\./);
});
test('an unreachable GitHub does not stop the work; next says so until publish succeeds', t => {
  const f = fixture(t);
  f.plan6();
  const finished = f.deliver(true);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stderr, /WARN: GitHub was not updated \(issue sync failed\)\. Run: node scripts\/agent-local\.mjs publish/);
  assert.match(finished.stdout, /CAP-001 is on milestone1 at [a-f0-9]{40}\. GitHub was not updated\./);
  assert.deepEqual(f.issue(1).labels, ['status:ready'], 'GitHub still shows the old state');
  assert.match(f.local(['next']).stdout, /^READY CAP-002: Freshness\nGitHub is out of sync\. Run: node scripts\/agent-local\.mjs publish\n$/);
  assert.equal(f.local(['publish'], true).status, 1);
  assert.match(f.local(['publish']).stdout, /Pushed milestone1; issues synced\./);
  assert.equal(f.issue(1).state, 'closed');
  assert.equal(f.local(['next']).stdout, 'READY CAP-002: Freshness\n');
});
test('comment posts the status update on the task\'s issue', t => {
  const f = fixture(t);
  f.plan6();
  fs.writeFileSync(path.join(f.dir, 'bin/update.md'), '**Added:** identity.\n');
  assert.match(f.issues(['comment', 'CAP-002', path.join(f.dir, 'bin/update.md')]).stdout, /Commented on CAP-002 #2\./);
  assert.deepEqual(f.github().comments, [{ issue: 2, body: '**Added:** identity.\n' }]);
  assert.match(f.issues(['comment', 'CAP-009', path.join(f.dir, 'bin/update.md')]).stderr, /No issue for task CAP-009/);
});
test('a manifest without a repository has nothing to sync', t => {
  const f = fixture(t);
  const manifest = f.manifest(); delete manifest.repository;
  fs.writeFileSync(path.join(f.dir, 'docs/plans/backlog.json'), JSON.stringify(manifest));
  assert.match(f.issues(['sync']).stdout, /names no repository/);
  assert.equal(fs.existsSync(path.join(f.dir, 'bin/github.json')), false);
});
