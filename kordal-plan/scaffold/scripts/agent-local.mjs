import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './agent-workflow.mjs';
import { needsGate } from './agent-scope.mjs';

// Local delivery (docs/agents/workflow.md): tasks are claimed, gated and
// integrated in the local repository. State lives in Git, which every
// worktree of the repository shares:
//   - done:    the task's completed plan is on the integration branch;
//   - claimed: the branch task/<id> exists;
//   - gated:   <git dir>/agent-gates/<commit>.<gate> records a passed gate.
// A manifest that names a GitHub repository gets a mirror of that state:
// `claim` and `finish` push the integration branch and sync the issues.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// task-check gates every task; pr-check, the full gate, gates the task that
// completes the queue, and covers a task as task-check does.
const gateNames = ['task-check', 'pr-check', 'premerge-check'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const planPath = (task, phase) => `docs/plans/${phase}/${task.id}-${task.slug}.md`;
const taskBranch = task => `task/${task.id.toLowerCase()}`;
const gateRecord = (sha, gate) => path.join(path.resolve(root, git('rev-parse', '--git-common-dir')), 'agent-gates', `${sha}.${gate}`);

function load() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/plans/backlog.json'), 'utf8'));
  validateManifest(manifest);
  assert(tryGit('rev-parse', '--verify', '--quiet', `refs/heads/${manifest.integration_branch}`), `The integration branch ${manifest.integration_branch} does not exist; create it from main`);
  return manifest;
}
export function stateOf(manifest, task) {
  const done = t => tryGit('cat-file', '-e', `${manifest.integration_branch}:${planPath(t, 'completed')}`) !== null;
  if (done(task)) return { state: 'DONE' };
  if (tryGit('rev-parse', '--verify', '--quiet', `refs/heads/${taskBranch(task)}`)) return { state: 'CLAIMED', detail: taskBranch(task) };
  if (task.external_blocker) return { state: 'BLOCKED', detail: task.external_blocker };
  const waiting = task.depends_on.filter(id => !done(manifest.tasks.find(t => t.id === id)));
  return waiting.length ? { state: 'WAIT', detail: `needs ${waiting.join(', ')}` } : { state: 'READY', detail: task.title };
}
function taskById(manifest, id) {
  const task = manifest.tasks.find(t => t.id === id);
  assert(task, `Unknown task ${id ?? ''}; use an ID of backlog.json`);
  return task;
}
// The GitHub mirror: the integration branch and the issues. A failure leaves
// the local result standing and a marker that `next` reports until a later
// publish succeeds. Returns null when the manifest names no repository.
const syncPending = () => path.join(path.resolve(root, git('rev-parse', '--git-common-dir')), 'agent-sync-pending');
function publish(manifest) {
  if (!manifest.repository) return null;
  const branch = manifest.integration_branch;
  const pushed = tryGit('push', '--quiet', 'origin', `${branch}:${branch}`) !== null;
  const synced = spawnSync(process.execPath, [path.join(root, 'scripts/agent-issues.mjs'), 'sync'], { cwd: root, stdio: 'inherit' }).status === 0;
  if (pushed && synced) { fs.rmSync(syncPending(), { force: true }); return true; }
  fs.writeFileSync(syncPending(), `${new Date().toISOString()}\n`);
  console.error(`WARN: GitHub was not updated (${[!pushed && `push of ${branch}`, !synced && 'issue sync'].filter(Boolean).join(', ')} failed). Run: node scripts/agent-local.mjs publish`);
  return false;
}
const runtimeChange = (from, to) => needsGate(git('diff', '--name-only', '--no-renames', from, to).split('\n').filter(Boolean));

function main() {
  const [command = 'next', argument] = process.argv.slice(2);
  assert(['next', 'claim', 'gate', 'finish', 'publish'].includes(command), 'Usage: agent-local.mjs next|claim <ID>|gate [task-check|pr-check|premerge-check]|finish <ID>|publish');
  const manifest = load(), integration = manifest.integration_branch;
  if (command === 'next') {
    for (const task of manifest.tasks) {
      const { state, detail } = stateOf(manifest, task);
      if (state !== 'DONE') console.log(`${state} ${task.id}: ${detail}`);
    }
    if (fs.existsSync(syncPending())) console.log('GitHub is out of sync. Run: node scripts/agent-local.mjs publish');
    return;
  }
  if (command === 'publish') {
    const result = publish(manifest);
    assert(result !== false, 'GitHub is still out of sync');
    console.log(result ? `Pushed ${integration}; issues synced.` : 'backlog.json names no repository: nothing to publish.');
    return;
  }
  if (command === 'claim') {
    const task = taskById(manifest, argument), { state, detail } = stateOf(manifest, task);
    assert(state === 'READY', `${task.id} is not ready: ${state}${detail ? ` (${detail})` : ''}`);
    // Creating the branch is the claim: Git refuses a second one.
    assert(tryGit('branch', taskBranch(task), integration) !== null, `${task.id} was claimed a moment ago: ${taskBranch(task)} exists`);
    console.log(`Claimed ${task.id} on ${taskBranch(task)} (from ${integration}). Work there: git switch ${taskBranch(task)}`);
    publish(manifest);
    return;
  }
  if (command === 'gate') {
    const gate = argument ?? 'task-check';
    assert(gateNames.includes(gate), `Unknown gate ${gate}; use ${gateNames.join(' or ')}`);
    assert(!git('status', '--porcelain'), 'Commit your work first: a gate is recorded for a commit');
    const sha = git('rev-parse', 'HEAD');
    const result = spawnSync(process.env.AGENT_MAKE ?? 'make', [gate], { cwd: root, stdio: 'inherit' });
    assert(result.status === 0, `${gate} failed on ${sha}; nothing recorded`);
    assert(git('rev-parse', 'HEAD') === sha && !git('status', '--porcelain'), `The checkout changed while ${gate} ran; nothing recorded`);
    fs.mkdirSync(path.dirname(gateRecord(sha, gate)), { recursive: true });
    fs.writeFileSync(gateRecord(sha, gate), `${new Date().toISOString()}\n`);
    console.log(`${gate} passed on ${sha}; recorded.`);
    return;
  }
  const task = taskById(manifest, argument);
  assert(git('rev-parse', '--abbrev-ref', 'HEAD') === taskBranch(task), `Finish ${task.id} from its branch ${taskBranch(task)}`);
  assert(!git('status', '--porcelain'), 'Commit your work first');
  assert(fs.existsSync(path.join(root, planPath(task, 'completed'))), `Move the plan to ${planPath(task, 'completed')} first`);
  const base = git('rev-parse', integration), head = git('rev-parse', 'HEAD');
  assert(tryGit('merge-base', '--is-ancestor', base, head) !== null, `${integration} moved: merge it into ${taskBranch(task)}, then gate again`);
  const files = git('diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
  for (const other of manifest.tasks.filter(t => t.id !== task.id)) {
    for (const phase of ['active', 'completed']) assert(!files.includes(planPath(other, phase)), `This branch also changes ${other.id}; one task per branch`);
  }
  // A runtime change needs the fast gate on a commit of this branch that no
  // runtime change follows: later commits may only complete the plan.
  const covered = gates => git('rev-list', `${base}..${head}`).split('\n').find(sha => gates.some(gate => fs.existsSync(gateRecord(sha, gate))) && !runtimeChange(sha, head));
  if (runtimeChange(base, head)) assert(covered(['task-check', 'pr-check']), `No passed task-check covers ${head}. Run: node scripts/agent-local.mjs gate`);
  // The task that completes the queue carries the full gate for all of it,
  // whatever that task itself changed.
  const last = manifest.tasks.every(t => t.id === task.id || stateOf(manifest, t).state === 'DONE');
  if (last) assert(covered(['pr-check']), `${task.id} completes the queue: no passed pr-check covers ${head}. Run: node scripts/agent-local.mjs gate pr-check`);
  assert(!git('worktree', 'list', '--porcelain').split('\n').includes(`branch refs/heads/${integration}`), `${integration} is checked out in a worktree; switch that worktree to another branch`);
  // Fast-forward, and only from the revision that was verified above.
  assert(tryGit('update-ref', `refs/heads/${integration}`, head, base) !== null, `${integration} moved during verification; rerun`);
  const published = publish(manifest);
  console.log(`${task.id} is on ${integration} at ${head}. ${published === null ? 'Nothing was pushed.' : published ? `Pushed ${integration}; issues synced.` : 'GitHub was not updated.'}`);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
