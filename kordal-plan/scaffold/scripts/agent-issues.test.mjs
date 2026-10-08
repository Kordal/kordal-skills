import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, workerData } from 'node:worker_threads';

// A hook or `git rebase --exec` exports these: the fixtures' Git would then
// write into the caller's repository instead of their own.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']) delete process.env[name];

// The real scripts in a real Git repository with a bare `origin`, whose
// post-receive hook logs every push it receives, and agent-issues.fake-gh.mjs
// in place of gh, which logs every read and write: documentation tasks,
// planned on main and on milestone1. Two of them, the second depending on the
// first; or a round of three independent tasks, the task that waits for all
// of them, and one that waits for that.
const sections = ['Goal', 'Acceptance Criteria', 'Flow', 'Out of Scope', 'Affected Components', 'Review', 'Notes'];
const tasks = () => [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', issue: null, depends_on: ['CAP-001'], adrs: [] },
];
const round = () => [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-003', title: 'Search', slug: 'search', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-004', title: 'Acceptance', slug: 'acceptance', issue: null, depends_on: ['CAP-001', 'CAP-002', 'CAP-003'], adrs: [] },
  { id: 'CAP-005', title: 'Release', slug: 'release', issue: null, depends_on: ['CAP-004'], adrs: [] },
];
const three = ['CAP-001', 'CAP-002', 'CAP-003'];
const body = (task, heading) => {
  if (heading === 'Goal') return `Deliver ${task.title}.`;
  return heading === 'Acceptance Criteria' ? '- [x] Works\n- [x] Fails safely' : 'Text.';
};
const plan = task => `# ${task.id}: ${task.title}\n\nIssue: none\n\n` + sections.map(s => `## ${s}\n\n${body(task, s)}\n`).join('\n');
// A make that fails the target MAKE_FAIL names and reports as scripts/gate.sh
// does: its one stage, or premerge-check as not applicable.
const fakeMake = `#!/bin/sh
[ "$1" != "\${MAKE_FAIL:-}" ] || exit 1
case $1 in premerge-check) result=not-applicable stages= ;; *) result=passed stages='{"name":"e2e","result":"passed","seconds":7}' ;; esac
printf '{"gate":"%s","result":"%s","seconds":7,"stages":[%s]}\\n' "$1" "$result" "$stages" > "$GATE_REPORT"
`;
function fixture(t, list = tasks()) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-issues-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text, { mode }); };
  const git = (...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  for (const script of ['agent-local.mjs', 'agent-workflow.mjs', 'agent-scope.mjs', 'agent-issues.mjs']) write(`scripts/${script}`, fs.readFileSync(path.join(scripts, script), 'utf8'));
  write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', repository: 'owner/product', tasks: list }));
  for (const task of list) write(`docs/plans/planned/${task.id}-${task.slug}.md`, plan(task));
  write('bin/gh', `#!/bin/sh\nexec "${process.execPath}" "${path.join(scripts, 'agent-issues.fake-gh.mjs')}" "$@"\n`, 0o755);
  write('bin/make', fakeMake, 0o755);
  write('.gitignore', 'bin/\n');
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  git('init', '--quiet', '--bare', path.join(dir, 'bin/origin.git'));
  // One line per push that origin receives, with the branches it moved.
  write('bin/origin.git/hooks/post-receive', '#!/bin/sh\nrefs=""\nwhile read -r old new ref; do refs="$refs $ref"; done\necho "push$refs" >> pushes.log\n', 0o755);
  git('remote', 'add', 'origin', path.join(dir, 'bin/origin.git'));
  const commit = message => { git('add', '--all'); git('commit', '--quiet', '--message', message); return git('rev-parse', 'HEAD'); };
  commit('plans');
  const env = (offline, extra) => ({ ...process.env, AGENT_GH: path.join(dir, 'bin/gh'), AGENT_MAKE: path.join(dir, 'bin/make'), GH_STATE: path.join(dir, 'bin/github.json'), ...(offline ? { GH_FAIL: '1' } : {}), ...extra });
  const run = script => (args, offline, extra) => spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], { encoding: 'utf8', env: env(offline, extra) });
  const github = () => JSON.parse(fs.readFileSync(path.join(dir, 'bin/github.json'), 'utf8'));
  const issue = number => { const i = github().issues[number - 1]; return { state: i.state, labels: i.labels.map(l => l.name), milestone: i.milestone?.number, title: i.title, body: i.body }; };
  const edit = change => { const state = github(); change(state); fs.writeFileSync(path.join(dir, 'bin/github.json'), JSON.stringify(state)); };
  const manifest = () => JSON.parse(fs.readFileSync(path.join(dir, 'docs/plans/backlog.json'), 'utf8'));
  // Stage 6 of planning: issues, their numbers committed, the integration branch.
  const plan6 = () => { assert.equal(run('agent-issues.mjs')(['sync']).status, 0); commit('issues'); git('branch', 'milestone1'); };
  // A claimed documentation task completed on its branch.
  const complete = id => {
    const file = `${id}-${list.find(task => task.id === id).slug}.md`;
    git('switch', '--quiet', `task/${id.toLowerCase()}`);
    fs.mkdirSync(path.join(dir, 'docs/plans/completed'), { recursive: true });
    git('mv', `docs/plans/planned/${file}`, `docs/plans/completed/${file}`);
    return commit(id);
  };
  // A documentation task delivered: claimed, its plan completed, finished.
  const deliver = (offline) => {
    assert.equal(run('agent-local.mjs')(['claim', 'CAP-001'], offline).status, 0);
    complete('CAP-001');
    return run('agent-local.mjs')(['finish', 'CAP-001'], offline);
  };
  // What GitHub and origin were asked since the last look: the pushes origin
  // received, the reads and writes of gh, and the publications the helper logged.
  const pushes = () => fs.existsSync(path.join(dir, 'bin/origin.git/pushes.log')) ? fs.readFileSync(path.join(dir, 'bin/origin.git/pushes.log'), 'utf8').trim().split('\n') : [];
  const events = () => fs.existsSync(path.join(dir, '.git/agent-timings.jsonl')) ? fs.readFileSync(path.join(dir, '.git/agent-timings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const asked = () => ({ pushes: pushes(), reads: github().reads, writes: github().writes, published: events().filter(e => e.event === 'publish').map(e => `${e.mode}: push ${e.push}, sync ${e.sync}`) });
  let seen = { pushes: [], reads: [], writes: [], published: [] };
  const since = () => { const now = asked(), delta = Object.fromEntries(Object.keys(now).map(key => [key, now[key].slice(seen[key].length)])); seen = now; return delta; };
  const pending = () => fs.existsSync(path.join(dir, '.git/agent-sync-pending'));
  return { dir, write, git, commit, github, issue, edit, manifest, plan6, complete, deliver, since, events, pending, issues: run('agent-issues.mjs'), local: run('agent-local.mjs') };
}
const outOfSync = 'GitHub is out of sync. Run: node scripts/agent-local.mjs publish\n';
// The scenarios run side by side, each in a worker thread of this file, as
// those of agent-local.test.mjs do (see the end).
const scenarios = new Map();
const scenario = (name, body) => { assert.ok(!scenarios.has(name), `two scenarios named: ${name}`); scenarios.set(name, body); };

scenario('sync creates the labels, the milestone and one issue per task, and records the numbers', t => {
  const f = fixture(t);
  const first = f.issues(['sync']);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(f.github().labels.map(l => l.name).sort(), ['blocked', 'done', 'in-progress', 'ready', 'waiting']);
  assert.deepEqual(f.github().milestones, [{ number: 1, title: 'Milestone 1' }]);
  assert.deepEqual(f.manifest().tasks.map(task => task.issue), [1, 2]);
  assert.match(fs.readFileSync(path.join(f.dir, 'docs/plans/planned/CAP-002-freshness.md'), 'utf8'), /^Issue: #2$/m);
  assert.deepEqual({ ...f.issue(1), body: undefined }, { state: 'open', labels: ['ready'], milestone: 1, title: 'CAP-001: Identity', body: undefined });
  assert.deepEqual(f.issue(2).labels, ['waiting']);
  assert.match(f.issue(2).body, /^Deliver Freshness\.\n\n\*\*Plan:\*\* `CAP-002-freshness\.md` under `docs\/plans\/`\n\n\*\*Depends on:\*\* #1 \(CAP-001\)\n\n### Acceptance criteria\n\n- \[ \] Works\n- \[ \] Fails safely\n/);
  assert.equal(spawnSync(process.execPath, [path.join(f.dir, 'scripts/agent-workflow.mjs'), 'check'], { encoding: 'utf8' }).status, 0, 'the plans agree with the manifest');
});
scenario('a second sync writes nothing, and the check passes', t => {
  const f = fixture(t);
  f.plan6();
  const writes = f.github().writes.length;
  assert.match(f.issues(['sync']).stdout, /PASS: 2 issues of owner\/product match the repository\n$/);
  assert.equal(f.issues(['sync', '--check']).status, 0);
  assert.equal(f.github().writes.length, writes);
});
scenario('an issue that exists under the task\'s title is adopted, not duplicated', t => {
  const f = fixture(t);
  assert.equal(f.issues(['sync']).status, 0);
  f.git('checkout', '--quiet', '--', '.');
  assert.equal(f.issues(['sync']).status, 0);
  assert.equal(f.github().issues.length, 2);
  assert.deepEqual(f.manifest().tasks.map(task => task.issue), [1, 2]);
});
scenario('"issues": false pushes the integration branch and leaves GitHub issues alone', t => {
  const f = fixture(t, round());
  f.write('docs/plans/backlog.json', JSON.stringify({ ...f.manifest(), issues: false }));
  f.commit('issues off');
  f.git('branch', 'milestone1');
  assert.match(f.issues(['sync']).stdout, /^backlog\.json turns the issues off: nothing to sync\.\n$/);
  const claimed = f.local(['claim', 'CAP-001', 'CAP-002']);
  assert.equal(claimed.status, 0, `a round of tasks without issues is no refusal: ${claimed.stderr}`);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/milestone1'), f.git('rev-parse', 'milestone1'), 'the claim pushes the integration branch');
  f.complete('CAP-001');
  const finished = f.local(['finish', 'CAP-001']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /CAP-001 is on milestone1 at [a-f0-9]{40}\. Pushed milestone1\.\n$/);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/milestone1'), f.git('rev-parse', 'milestone1'), 'finish pushes it too');
  assert.match(f.local(['publish']).stdout, /^Pushed milestone1\.\n$/);
  assert.ok(!fs.existsSync(path.join(f.dir, 'bin/github.json')), 'gh was never called');
  assert.deepEqual(f.manifest().tasks.map(task => task.issue ?? null), [null, null, null, null, null]);
  assert.ok(f.events().filter(e => e.event === 'publish').every(e => e.sync === 'off'));
});
scenario('claim and finish keep the status labels, the closed state and the pushed branch current', t => {
  const f = fixture(t);
  f.plan6();
  assert.equal(f.local(['claim', 'CAP-001']).status, 0);
  assert.deepEqual(f.issue(1).labels, ['in-progress']);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/milestone1'), f.git('rev-parse', 'milestone1'), 'the claim publishes the integration branch');
  f.git('branch', '--delete', '--force', 'task/cap-001');
  const finished = f.deliver();
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /CAP-001 is on milestone1 at [a-f0-9]{40}\. Pushed milestone1; issues synced\./);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/milestone1').split(/\s/)[0], f.git('rev-parse', 'milestone1'));
  assert.deepEqual({ state: f.issue(1).state, labels: f.issue(1).labels }, { state: 'closed', labels: ['done'] });
  assert.match(f.issue(1).body, /- \[x\] Works\n- \[x\] Fails safely/);
  assert.deepEqual({ state: f.issue(2).state, labels: f.issue(2).labels }, { state: 'open', labels: ['ready'] }, 'the dependant became ready');
  assert.equal(f.issues(['sync', '--check']).status, 0);
  // The next milestone gets its own GitHub milestone; the finished task keeps the one that delivered it.
  const manifest = f.manifest(); manifest.milestone = 2;
  fs.writeFileSync(path.join(f.dir, 'docs/plans/backlog.json'), JSON.stringify(manifest));
  assert.equal(f.issues(['sync']).status, 0);
  assert.deepEqual([f.issue(1).milestone, f.issue(1).state, f.issue(2).milestone], [1, 'closed', 2]);
});
scenario('the check names every difference and changes nothing; sync repairs it and keeps other labels', t => {
  const f = fixture(t);
  f.plan6();
  f.edit(state => { state.issues[0].state = 'closed'; state.issues[0].labels = [{ name: 'done' }, { name: 'bug' }]; state.issues[1].body = 'Edited on GitHub.'; });
  const writes = f.github().writes.length;
  const check = f.issues(['sync', '--check']);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /DRIFT CAP-001 #1: state, labels differ \(wanted ready\)\nDRIFT CAP-002 #2: body differ/);
  assert.match(check.stderr, /2 difference\(s\) between GitHub and the repository/);
  assert.equal(f.github().writes.length, writes);
  assert.equal(f.issues(['sync']).status, 0);
  assert.deepEqual({ state: f.issue(1).state, labels: f.issue(1).labels }, { state: 'open', labels: ['bug', 'ready'] });
  assert.match(f.issue(2).body, /^Deliver Freshness\./);
});
scenario('an unreachable GitHub does not stop the work; next says so until publish succeeds', t => {
  const f = fixture(t);
  f.plan6();
  // A full publish that fails marks the mirror, also where nothing marked it before.
  assert.ok(!f.pending());
  assert.equal(f.local(['publish'], true).status, 1);
  assert.ok(f.pending());
  assert.equal(f.local(['publish']).status, 0);
  assert.ok(!f.pending());
  const finished = f.deliver(true);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stderr, /WARN: GitHub was not updated \(issue sync failed\)\. Run: node scripts\/agent-local\.mjs publish/);
  assert.match(finished.stdout, /CAP-001 is on milestone1 at [a-f0-9]{40}\. GitHub was not updated\./);
  assert.deepEqual(f.issue(1).labels, ['ready'], 'GitHub still shows the old state');
  assert.match(f.local(['next']).stdout, /^READY CAP-002: Freshness\nGitHub is out of sync\. Run: node scripts\/agent-local\.mjs publish\n$/);
  assert.equal(f.local(['publish'], true).status, 1);
  assert.ok(f.pending(), 'a full publish that fails keeps the marker');
  assert.match(f.local(['publish']).stdout, /Pushed milestone1; issues synced\./);
  assert.equal(f.issue(1).state, 'closed');
  assert.equal(f.local(['next']).stdout, 'READY CAP-002: Freshness\n');
});
scenario('comment posts the status update on the task\'s issue', t => {
  const f = fixture(t);
  f.plan6();
  fs.writeFileSync(path.join(f.dir, 'bin/update.md'), '**Added:** identity.\n');
  assert.match(f.issues(['comment', 'CAP-002', path.join(f.dir, 'bin/update.md')]).stdout, /Commented on CAP-002 #2\./);
  assert.deepEqual(f.github().comments, [{ issue: 2, body: '**Added:** identity.\n' }]);
  assert.match(f.issues(['comment', 'CAP-009', path.join(f.dir, 'bin/update.md')]).stderr, /No issue for task CAP-009/);
});
scenario('a manifest without a repository has nothing to sync', t => {
  const f = fixture(t);
  const manifest = f.manifest(); delete manifest.repository;
  fs.writeFileSync(path.join(f.dir, 'docs/plans/backlog.json'), JSON.stringify(manifest));
  assert.match(f.issues(['sync']).stdout, /names no repository/);
  assert.match(f.issues(['sync', '--only', 'CAP-001']).stdout, /names no repository/);
  assert.equal(fs.existsSync(path.join(f.dir, 'bin/github.json')), false);
});

scenario('a round is published in batches: one push and one targeted sync per command, and no list request; the full publish lists', t => {
  const f = fixture(t, round());
  f.plan6();
  f.since();
  const read = numbers => numbers.map(n => `GET issues/${n}`), patch = numbers => numbers.map(n => `PATCH issues/${n}`);
  const state = () => [1, 2, 3, 4, 5].map(n => `${f.issue(n).state} ${f.issue(n).labels.join(' ')}`);
  // The claim of the round: one push (origin does not hold the branch yet), the three issues and their direct dependant.
  assert.equal(f.local(['claim', ...three]).status, 0);
  assert.deepEqual(f.since(), { pushes: ['push refs/heads/milestone1'], reads: read([1, 2, 3, 4]), writes: patch([1, 2, 3]), published: ['targeted: push pushed, sync ok'] });
  assert.deepEqual(state(), ['open in-progress', 'open in-progress', 'open in-progress', 'open waiting', 'open waiting']);
  // A round that is refused asks nothing of origin or GitHub; neither does the work itself.
  assert.match(f.local(['integrate', ...three]).stderr, /^FAIL: CAP-001: Move the plan to docs\/plans\/completed\/CAP-001-identity\.md first\n$/);
  for (const id of three) f.complete(id);
  f.git('switch', '--quiet', 'main');
  assert.deepEqual(f.since(), { pushes: [], reads: [], writes: [], published: [] });
  // The integration of the round: one push, the same four issues.
  const done = f.local(['integrate', ...three]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^CAP-001, CAP-002, CAP-003 are on milestone1 at [a-f0-9]{40}\. No runtime file changed: no gate was needed\. Pushed milestone1; issues synced\.$/m);
  assert.match(done.stdout, /^PASS: the issues of CAP-001, CAP-002, CAP-003, CAP-004 in owner\/product match the repository \(4 fixed\)$/m);
  assert.deepEqual(f.since(), { pushes: ['push refs/heads/milestone1'], reads: read([1, 2, 3, 4]), writes: patch([1, 2, 3, 4]), published: ['targeted: push pushed, sync ok'] });
  assert.deepEqual(state(), ['closed done', 'closed done', 'closed done', 'open ready', 'open waiting'], 'the round is closed and its dependant ready');
  assert.match(f.issue(2).body, /- \[x\] Works\n- \[x\] Fails safely/);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/milestone1').split(/\s/)[0], f.git('rev-parse', 'milestone1'));
  // The next claim: origin holds the branch already, so nothing is pushed.
  // Origin is out of reach for it: a push that was attempted would fail, warn and mark the mirror.
  const origin = f.git('remote', 'get-url', 'origin');
  f.git('remote', 'set-url', 'origin', path.join(f.dir, 'bin/no-such-origin.git'));
  const next = f.local(['claim', 'CAP-004']);
  f.git('remote', 'set-url', 'origin', origin);
  assert.deepEqual([next.status, next.stderr, f.pending()], [0, '', false]);
  assert.deepEqual(f.since(), { pushes: [], reads: read([4, 5]), writes: patch([4]), published: ['targeted: push skipped, sync ok'] });
  // The mirror is whole, as the check, which reads everything, confirms; so does the full publish, which lists.
  assert.equal(f.issues(['sync', '--check']).status, 0);
  f.since();
  assert.match(f.local(['publish']).stdout, /^PASS: 5 issues of owner\/product match the repository\nPushed milestone1; issues synced\.\n$/);
  assert.deepEqual(f.since(), { pushes: [], reads: ['GET labels', 'GET milestones', 'GET issues'], writes: [], published: ['full: push pushed, sync ok'] });
});
scenario('sync --only reconciles the named tasks and their direct dependants, and leaves the rest to the full sync', t => {
  const f = fixture(t, round());
  f.plan6();
  // Drift everywhere: on the named task, on its dependant, and on issues the targeted sync does not look at.
  f.edit(state => {
    state.issues[0].labels = [{ name: 'waiting' }, { name: 'bug' }];
    state.issues[0].title = 'Renamed on GitHub';
    state.issues[1].body = 'Edited on GitHub.';
    state.issues[3].body = 'Edited on GitHub.';
    state.issues[4].body = 'Edited on GitHub.';
  });
  f.since();
  const only = f.issues(['sync', '--only', 'CAP-001']);
  assert.equal(only.status, 0, only.stderr);
  assert.equal(only.stdout, 'fixed CAP-001 #1: title, labels differ (wanted ready)\nfixed CAP-004 #4: body differ\nPASS: the issues of CAP-001, CAP-004 in owner/product match the repository (2 fixed)\n');
  assert.deepEqual(f.since(), { pushes: [], reads: ['GET issues/1', 'GET issues/4'], writes: ['PATCH issues/1', 'PATCH issues/4'], published: [] });
  assert.deepEqual(f.issue(1).labels, ['bug', 'ready']);
  assert.match(f.issue(4).body, /^Deliver Acceptance\./);
  assert.equal(f.issue(1).title, 'CAP-001: Identity', 'the title comes with the issue that is read anyway');
  assert.equal(f.issue(2).body, 'Edited on GitHub.', 'an issue that was not named stays as it is');
  assert.equal(f.issue(5).body, 'Edited on GitHub.', 'a dependant of a dependant is not touched');
  // A second run reads the same two issues and writes nothing.
  assert.equal(f.issues(['sync', '--only', 'CAP-001']).stdout, 'PASS: the issues of CAP-001, CAP-004 in owner/product match the repository\n');
  assert.deepEqual(f.since().writes, []);
  // The check still sees what is left, and the full sync repairs it.
  const check = f.issues(['sync', '--check']);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /^DRIFT CAP-002 #2: body differ\nDRIFT CAP-005 #5: body differ\n$/);
  assert.match(f.issues(['sync']).stdout, /PASS: 5 issues of owner\/product match the repository \(2 fixed\)/);
  assert.equal(f.issues(['sync', '--check']).status, 0);
  // The check is the whole mirror or nothing, and a name is a task of the manifest.
  f.since();
  assert.match(f.issues(['sync', '--check', '--only', 'CAP-001']).stderr, /^FAIL: --check compares the whole mirror: it takes no --only\n$/);
  assert.match(f.issues(['sync', '--only', 'CAP-099']).stderr, /^FAIL: Unknown task CAP-099; use an ID of backlog\.json\n$/);
  assert.match(f.issues(['sync', '--only']).stderr, /^FAIL: Usage: agent-issues\.mjs sync \[--check \| --only <ID>,<ID>\] \| comment <ID> <file>\n$/);
  // An argument it does not know is no full sync by accident.
  for (const args of [['sync', '--only=CAP-001'], ['sync', '--chek'], ['sync', 'CAP-001']]) assert.match(f.issues(args).stderr, /^FAIL: Usage: agent-issues\.mjs sync/, args.join(' '));
  assert.deepEqual(f.since(), { pushes: [], reads: [], writes: [], published: [] }, 'a refused sync asks nothing');
});
scenario('sync --only falls back to the full sync for a task that has no issue yet', t => {
  const f = fixture(t, round());
  f.plan6();
  // A task added during delivery: in the manifest and planned, without an issue.
  const added = { id: 'CAP-006', title: 'Export', slug: 'export', issue: null, depends_on: [], adrs: [] };
  const manifest = f.manifest(); manifest.tasks.push(added);
  f.write('docs/plans/backlog.json', JSON.stringify(manifest));
  f.write('docs/plans/planned/CAP-006-export.md', plan(added));
  f.since();
  const synced = f.issues(['sync', '--only', 'CAP-001,CAP-006']);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /^fixed CAP-006 has no issue\n[\s\S]*PASS: 6 issues of owner\/product match the repository \(2 fixed\)\n$/);
  const { reads, writes } = f.since();
  assert.deepEqual(reads.slice(0, 3), ['GET labels', 'GET milestones', 'GET issues'], 'the full sync lists');
  assert.deepEqual(writes, ['POST issues', 'PATCH issues/6']);
  assert.equal(f.manifest().tasks[5].issue, 6);
  assert.match(fs.readFileSync(path.join(f.dir, 'docs/plans/planned/CAP-006-export.md'), 'utf8'), /^Issue: #6$/m);
  // The claim of such a task creates its issue the same way.
  f.commit('a task added during delivery');
  assert.equal(f.issues(['sync', '--only', 'CAP-006']).stdout, 'PASS: the issues of CAP-006 in owner/product match the repository\n', 'with its issue, it is synced alone');
});
scenario('a pull request recorded as a task\'s issue is never rewritten or closed by the targeted sync', t => {
  const f = fixture(t);
  f.plan6();
  f.edit(state => { state.issues[0].pull_request = { url: 'https://api.github.com/repos/owner/product/pulls/1' }; });
  f.since();
  const claimed = f.local(['claim', 'CAP-001']);
  assert.equal(claimed.status, 0, 'the local claim stands');
  assert.match(claimed.stderr, /FAIL: CAP-001: #1 is a pull request of owner\/product, not an issue\nWARN: GitHub was not updated \(issue sync failed\)/);
  assert.deepEqual(f.since().writes, [], 'nothing was written to the pull request');
  assert.ok(f.pending());
});
scenario('an issue adopted from outside the sync, in no GitHub milestone yet, makes the claim\'s sync a full one', t => {
  const f = fixture(t);
  f.plan6();
  // The owner's own issue, taken as the task's: another title, no milestone.
  f.edit(state => { state.issues[0].title = 'Export the list as CSV'; state.issues[0].milestone = null; });
  f.since();
  assert.equal(f.local(['claim', 'CAP-001']).status, 0);
  const { reads } = f.since();
  assert.deepEqual(reads, ['GET issues/1', 'GET issues/2', 'GET labels', 'GET milestones', 'GET issues'], 'the task and its dependant read alone first, then everything with the lists');
  assert.deepEqual([f.issue(1).title, f.issue(1).milestone, f.issue(1).labels], ['CAP-001: Identity', 1, ['in-progress']]);
  assert.equal(f.issues(['sync', '--check']).status, 0);
});
scenario('a task without an issue is claimed on its own: its number is written into the checkout that delivers it', t => {
  const f = fixture(t, round());
  f.plan6();
  const added = { id: 'CAP-006', title: 'Export', slug: 'export', issue: null, depends_on: [], adrs: [] };
  const manifest = f.manifest(); manifest.tasks.push(added);
  f.write('docs/plans/backlog.json', JSON.stringify(manifest));
  f.write('docs/plans/planned/CAP-006-export.md', plan(added));
  f.since();
  const refused = f.local(['claim', 'CAP-001', 'CAP-006']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^FAIL: CAP-006 has no issue yet: claim it on its own, in the checkout that delivers it, and commit the issue number on its branch\n$/);
  assert.equal(f.git('branch', '--list', 'task/*'), '');
  assert.deepEqual(f.since(), { pushes: [], reads: [], writes: [], published: [] });
  assert.equal(f.local(['claim', 'CAP-006']).status, 0);
  assert.equal(f.manifest().tasks[5].issue, 6);
});

scenario('an unreachable GitHub during a round leaves the local result and the marker; a targeted publish that succeeds later does not clear it', t => {
  const f = fixture(t, round());
  f.plan6();
  const offline = f.local(['claim', 'CAP-001', 'CAP-002'], true);
  assert.equal(offline.status, 0, offline.stderr);
  assert.match(offline.stderr, /WARN: GitHub was not updated \(issue sync failed\)\. Run: node scripts\/agent-local\.mjs publish/);
  assert.equal(f.git('branch', '--list', 'task/*').split('\n').length, 2, 'both tasks are claimed');
  assert.ok(f.pending());
  assert.deepEqual(f.issue(1).labels, ['ready'], 'GitHub still shows the old state');
  assert.ok(f.local(['next']).stdout.endsWith(outOfSync));
  for (const id of ['CAP-001', 'CAP-002']) f.complete(id);
  f.git('switch', '--quiet', 'main');
  const integrated = f.local(['integrate', 'CAP-001', 'CAP-002'], true);
  assert.equal(integrated.status, 0, integrated.stderr);
  assert.match(integrated.stderr, /WARN: GitHub was not updated \(issue sync failed\)/);
  assert.match(integrated.stdout, /CAP-001, CAP-002 are on milestone1 at [a-f0-9]{40}\. No runtime file changed: no gate was needed\. GitHub was not updated\./);
  assert.equal(f.local(['next']).stdout, `READY CAP-003: Search\nWAIT CAP-004: needs CAP-003\nWAIT CAP-005: needs CAP-004\n${outOfSync}`);
  // GitHub is back: the next command's targeted publish succeeds, for its own task only.
  assert.equal(f.local(['claim', 'CAP-003']).status, 0);
  assert.deepEqual(f.issue(3).labels, ['in-progress']);
  assert.deepEqual([f.issue(1).state, f.issue(1).labels], ['open', ['ready']], 'what the failed publish left behind is still behind');
  assert.ok(f.pending(), 'a targeted publish proves its own issues, not the mirror');
  assert.ok(f.local(['next']).stdout.endsWith(outOfSync));
  // The full publish repairs everything and clears the marker.
  assert.match(f.local(['publish']).stdout, /Pushed milestone1; issues synced\./);
  assert.deepEqual([f.issue(1).state, f.issue(2).state, f.issue(3).labels], ['closed', 'closed', ['in-progress']]);
  assert.ok(!f.pending());
  assert.equal(f.local(['next']).stdout, 'CLAIMED CAP-003: task/cap-003\nWAIT CAP-004: needs CAP-003\nWAIT CAP-005: needs CAP-004\n');
});
scenario('--no-publish defers the mirror: nothing is pushed or synced, next says so, and publish catches up', t => {
  const f = fixture(t, round());
  f.plan6();
  f.since();
  const deferred = 'Publishing deferred: run node scripts/agent-local.mjs publish.';
  assert.equal(f.local(['claim', 'CAP-001', 'CAP-002', 'CAP-003', '--no-publish']).stdout.split('\n')[3], deferred);
  assert.ok(f.pending());
  assert.ok(f.local(['next']).stdout.endsWith(outOfSync));
  const head = f.complete('CAP-001');
  assert.equal(f.local(['finish', 'CAP-001', '--no-publish']).stdout, `CAP-001 is on milestone1 at ${head}. ${deferred}\n`);
  f.git('switch', '--quiet', 'task/cap-002');
  f.git('merge', '--quiet', '--no-edit', 'milestone1');
  f.complete('CAP-002');
  f.git('switch', '--quiet', 'main');
  assert.match(f.local(['integrate', 'CAP-002', '--no-publish']).stdout, new RegExp(`^CAP-002 is on milestone1 at [a-f0-9]{40}\\. No runtime file changed: no gate was needed\\. ${deferred.replace(/\./g, '\\.')}\\n$`));
  assert.deepEqual(f.since(), { pushes: [], reads: [], writes: [], published: [] }, 'nothing asked of origin or GitHub');
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/milestone1'), '', 'origin does not hold the branch');
  assert.deepEqual(f.issue(1).labels, ['ready']);
  assert.match(f.local(['publish']).stdout, /Pushed milestone1; issues synced\./);
  assert.deepEqual(f.since().pushes, ['push refs/heads/milestone1']);
  assert.deepEqual([1, 2, 3].map(n => `${f.issue(n).state} ${f.issue(n).labels}`), ['closed done', 'closed done', 'open in-progress']);
  assert.ok(!f.pending());
  assert.equal(f.local(['next']).stdout, 'CLAIMED CAP-003: task/cap-003\nWAIT CAP-004: needs CAP-003\nWAIT CAP-005: needs CAP-004\n');
});
scenario('a push that origin refuses is never forced: the local result stands and the mirror is marked', t => {
  const f = fixture(t);
  f.plan6();
  assert.equal(f.local(['claim', 'CAP-001']).status, 0);
  // Somebody else moved the branch on origin.
  f.git('checkout', '--quiet', '--detach', 'milestone1');
  f.git('commit', '--quiet', '--allow-empty', '--message', 'theirs');
  const theirs = f.git('rev-parse', 'HEAD');
  f.git('push', '--quiet', 'origin', 'HEAD:refs/heads/milestone1');
  const head = f.complete('CAP-001');
  const finished = f.local(['finish', 'CAP-001']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stderr, /WARN: GitHub was not updated \(push of milestone1 failed\)\. Run: node scripts\/agent-local\.mjs publish/);
  assert.equal(finished.stdout.split('\n').at(-2), `CAP-001 is on milestone1 at ${head}. GitHub was not updated.`);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/milestone1').split(/\s/)[0], theirs, 'origin keeps what it had');
  assert.equal(f.git('rev-parse', 'milestone1'), head);
  assert.ok(f.pending());
  assert.equal(f.local(['publish']).status, 1, 'publish does not force either');
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/milestone1').split(/\s/)[0], theirs);
});
scenario('timings says where the time went: the phases of a task, its gates with the failure, the full and the resilience gate, and publication', t => {
  const f = fixture(t);
  f.plan6();
  assert.equal(f.local(['claim', 'CAP-001']).status, 0);
  f.git('switch', '--quiet', 'task/cap-001');
  f.write('src/identity.js', 'export const id = 1;\n');
  const head = f.complete('CAP-001');
  assert.equal(f.local(['gate'], false, { MAKE_FAIL: 'task-check' }).status, 1);
  for (const gate of ['task-check', 'pr-check', 'premerge-check']) assert.equal(f.local(['gate', gate]).status, 0);
  assert.equal(f.local(['finish', 'CAP-001']).status, 0);
  assert.equal(f.local(['publish']).status, 0);
  const timings = f.local(['timings']);
  assert.equal(timings.status, 0, timings.stderr);
  assert.match(timings.stdout, new RegExp([
    '^CAP-001: \\d+:\\d\\d from claim to integration; implementation \\d+:\\d\\d; task gates 2 \\(1 failed\\), \\d+:\\d\\d; review and completion \\d+:\\d\\d',
    'CAP-002: nothing recorded',
    'Combined round gates: none',
    'Full gate \\(pr-check\\): 1, \\d+:\\d\\d; last passed: e2e 0:07',
    'Resilience gate \\(premerge-check\\): 1, \\d+:\\d\\d; last not applicable',
    'GitHub publication: 3 \\(3 pushed\\), \\d+:\\d\\d\\n$',
  ].join('\\n')));
  // The log: JSON lines in the Git directory that every worktree shares.
  const log = fs.readFileSync(path.join(f.dir, f.git('rev-parse', '--git-common-dir'), 'agent-timings.jsonl'), 'utf8');
  assert.ok(log.endsWith('\n') && log.trim().split('\n').every(line => JSON.parse(line).at), 'one JSON object per line');
  const events = f.events();
  assert.deepEqual(events.map(e => [e.event, e.gate ?? e.mode ?? e.task ?? e.tasks.join(' '), e.result ?? e.sync ?? ''].join(' ').trim()),
    ['claim CAP-001', 'publish targeted ok', 'gate task-check failed', 'gate task-check passed', 'gate pr-check passed', 'gate premerge-check not-applicable', 'integrate CAP-001', 'publish targeted ok', 'publish full ok']);
  for (const event of events) assert.ok(!Number.isNaN(Date.parse(event.at)), JSON.stringify(event));
  assert.deepEqual({ ...events[4], at: undefined, seconds: undefined }, { event: 'gate', gate: 'pr-check', task: 'CAP-001', sha: head, at: undefined, seconds: undefined, result: 'passed', combined: false, stages: [{ name: 'e2e', result: 'passed', seconds: 7 }] });
  assert.deepEqual(Object.keys(events[1]), ['event', 'mode', 'at', 'seconds', 'push', 'sync']);
  assert.deepEqual([events[2].stages, events[5].stages, events[6].sha], [[], [], head]);
});

if (isMainThread) {
  describe('scripts/agent-issues.mjs', { concurrency: os.availableParallelism() }, () => {
    for (const name of scenarios.keys()) {
      test(name, () => new Promise((resolve, reject) => {
        new Worker(new URL(import.meta.url), { workerData: name }).once('error', reject).once('exit', code => (code === 0 ? resolve() : reject(new Error(`The scenario exited with ${code}`))));
      }));
    }
  });
} else {
  const cleanup = [];
  try { await scenarios.get(workerData)({ after: remove => cleanup.push(remove) }); } finally { for (const remove of cleanup) remove(); }
}
