import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { baseBranch, validateManifest } from './agent-workflow.mjs';
import { needsGate, toolingChange } from './agent-scope.mjs';

// Local delivery (docs/agents/workflow.md): tasks are claimed, gated and
// integrated in the local repository. State lives in Git, which every
// worktree of the repository shares:
//   - done:    the task's completed plan is on the integration branch;
//   - claimed: the branch task/<id> exists;
//   - gated:   <git dir>/agent-gates/<commit>.<gate> records a gate that passed
//              or is not applicable; it covers every later commit that changes
//              no runtime file;
//   - timed:   <git dir>/agent-timings.jsonl logs every claim, gate,
//              integration and publication, for `timings`.
// Documentation needs no gate and keeps one, so no gate has seen what was
// written after it: `finish` and `integrate` run the documentation check on
// what they integrate.
// A manifest that names a GitHub repository gets a mirror of that state:
// `claim`, `finish` and `integrate` push the integration branch and sync the
// issues they affect, once per command; `publish` reconciles everything.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const self = 'node scripts/agent-local.mjs';
const usage = `Usage: ${self} <command>
  next                                  the queue: every unfinished task as READY, CLAIMED, WAIT or BLOCKED
  base                                  the base branch: base_branch of the manifest, main without one
  phase                                 delivering (a task is unfinished, or the integration branch holds work the base lacks) or between
  start                                 create the integration branch from the base branch, or fast-forward an unclaimed one to it
  claim <ID>... [--no-publish]          claim READY tasks: a branch task/<id> each, from one revision of the integration branch
  gate [task-check|pr-check|premerge-check] [--force]
                                        run a gate on the committed tree and record it; one that covers the commit is reused
  finish <ID> [--no-publish]            integrate one task, from its own branch
  integrate <ID>... [--no-publish]      integrate a round of claimed tasks in one step, from any clean checkout
  publish                               push the integration branch and reconcile every issue
  timings                               where the time went: per task, per gate, per publication`;
const options = { next: [], base: [], phase: [], start: [], claim: ['--no-publish'], gate: ['--force'], finish: ['--no-publish'], integrate: ['--no-publish'], publish: [], timings: [] };
// The most arguments a command takes beside its options; claim and integrate take any number.
const arity = { next: 0, base: 0, phase: 0, start: 0, gate: 1, finish: 1, publish: 0, timings: 0 };
// task-check gates every runtime change. pr-check, the full gate, and
// premerge-check, the resilience gate, gate the task that completes the queue.
// A pr-check is recorded only where a task-check covers the same runtime
// state, so it covers a task as a task-check does.
const gateNames = ['task-check', 'pr-check', 'premerge-check'], taskGates = ['task-check', 'pr-check'];
const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
const git = (...args) => run(...args).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const planPath = (task, phase) => `docs/plans/${phase}/${task.id}-${task.slug}.md`;
const taskBranch = task => `task/${task.id.toLowerCase()}`;
const tipOf = branch => tryGit('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
const isAncestor = (older, newer) => tryGit('merge-base', '--is-ancestor', older, newer) !== null;
// Every path that differs, to the byte of its name, and a submodule the
// project tells Git to ignore included: a moved pointer is a runtime change.
const changed = (from, to) => run('diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', from, to).split('\0').filter(Boolean);
const clean = (dir = root) => !git('-C', dir, 'status', '--porcelain', '--ignore-submodules=none');
// A file as a commit holds it, to the last byte; null where it holds none.
const show = (rev, file) => { try { return run('show', `${rev}:${file}`); } catch { return null; } };
const clock = seconds => {
  const s = Math.round(seconds), pad = n => String(n).padStart(2, '0');
  return s < 3600 ? `${Math.floor(s / 60)}:${pad(s % 60)}` : `${Math.floor(s / 3600)}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
};
let common;
const commonDir = () => common ??= path.resolve(root, git('rev-parse', '--git-common-dir'));
// The worktrees of the repository; `branch` is undefined where HEAD is detached.
const worktrees = () => git('worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ dir: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));

function load() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/plans/backlog.json'), 'utf8'));
  validateManifest(manifest);
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

// Where the time went: one JSON object per line, local and append-only.
// Observability only: a log that cannot be written never fails a command.
const timingLog = () => path.join(commonDir(), 'agent-timings.jsonl');
function log(event) {
  try { fs.appendFileSync(timingLog(), `${JSON.stringify(event)}\n`); } catch { /* the command stands without its log line */ }
}

// The GitHub mirror: the integration branch and the issues. With `ids` it is
// targeted: no push when origin already holds the branch, and only the issues
// of those tasks and of their direct dependants. Without, it is full. A
// failure leaves the local result standing and a marker that `next` reports
// until a full publish succeeds: only that one proves the whole mirror.
// Returns null when the manifest names no repository.
const syncPending = () => path.join(commonDir(), 'agent-sync-pending');
const markPending = () => fs.writeFileSync(syncPending(), `${new Date().toISOString()}\n`);
function publish(manifest, ids) {
  if (!manifest.repository) return null;
  const branch = manifest.integration_branch, started = Date.now();
  const held = Boolean(ids) && tryGit('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`) === tipOf(branch);
  const pushed = held || tryGit('push', '--quiet', 'origin', `${branch}:${branch}`) !== null;
  const synced = spawnSync(process.execPath, [path.join(root, 'scripts/agent-issues.mjs'), 'sync', ...(ids ? ['--only', ids.join(',')] : [])], { cwd: root, stdio: 'inherit' }).status === 0;
  log({ event: 'publish', mode: ids ? 'targeted' : 'full', at: new Date(started).toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10, push: held ? 'skipped' : pushed ? 'pushed' : 'failed', sync: synced ? 'ok' : 'failed' });
  if (pushed && synced) { if (!ids) fs.rmSync(syncPending(), { force: true }); return true; }
  markPending();
  console.error(`WARN: GitHub was not updated (${[!pushed && `push of ${branch}`, !synced && 'issue sync'].filter(Boolean).join(', ')} failed). Run: ${self} publish`);
  return false;
}
// The last sentence of a command that changed the queue: what GitHub holds
// now. A deferred update is marked as a failed one is.
function mirror(manifest, ids, defer) {
  if (!manifest.repository) return 'Nothing was pushed.';
  if (defer) { markPending(); return `Publishing deferred: run ${self} publish.`; }
  return publish(manifest, ids) ? `Pushed ${manifest.integration_branch}; issues synced.` : 'GitHub was not updated.';
}

// A gate record is JSON. A record of the helper before it, plain text
// `<ISO time> 12s`, stays valid: it passed, and it ran the tooling tests, as
// every task gate then did.
const gateRecord = (sha, gate) => path.join(commonDir(), 'agent-gates', `${sha}.${gate}`);
function readRecord(sha, gate) {
  let text;
  try { text = fs.readFileSync(gateRecord(sha, gate), 'utf8'); } catch { return null; }
  const legacy = /^(\d{4}-\d\d-\d\dT\S+) (\d+)s\s*$/.exec(text);
  if (legacy) return { gate, at: legacy[1], seconds: Number(legacy[2]), result: 'passed', tooling: true, stages: [] };
  try { const record = JSON.parse(text); return ['passed', 'not-applicable'].includes(record?.result) ? record : null; } catch { return null; }
}
// Coverage is a statement about the runtime tree: a record on commit S covers
// `head` when S is in its history and no runtime file differs between the
// two. Documentation committed after a gate keeps it; a runtime change never
// does. `tooling` asks for a gate that ran the tooling tests as well.
function covering(head, gates, tooling = false) {
  let recorded;
  try { recorded = new Set(fs.readdirSync(path.join(commonDir(), 'agent-gates'))); } catch { return null; }
  for (const sha of git('rev-list', '--max-count=500', head).split('\n')) {
    for (const gate of gates) {
      const record = recorded.has(`${sha}.${gate}`) ? readRecord(sha, gate) : null;
      if (record && !(tooling && record.tooling !== true) && !needsGate(changed(sha, head))) return { ...record, gate, sha };
    }
  }
  return null;
}

// One make target, with the JSON report of scripts/gate.sh where it wrote its
// own (a project may have replaced gate.sh, and agent-check is no gate). A
// signal that reaches this process is passed on to make and fails the run, so
// that whoever started the gate still cleans up after it.
function runMake(target) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-gate-')), file = path.join(dir, 'report.json'), started = Date.now();
  return new Promise(resolve => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    // A dry run or an ignore-errors flag inherited from an outer make would pass a gate that ran nothing.
    const { MAKEFLAGS, MFLAGS, GNUMAKEFLAGS, MAKELEVEL, ...outside } = process.env;
    const child = spawn(process.env.AGENT_MAKE ?? 'make', [target], { cwd: root, stdio: 'inherit', env: { ...outside, GATE_REPORT: file } });
    let interrupted = null, settled = false;
    const pass = signal => { interrupted = signal; child.kill(signal); };
    const settle = status => {
      if (settled) return;
      settled = true;
      for (const signal of signals) process.off(signal, pass);
      let report = null;
      try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no report */ }
      fs.rmSync(dir, { recursive: true, force: true });
      if (report?.gate !== target || !Array.isArray(report.stages)) report = null;
      const passed = status === 0 && !interrupted && report?.result !== 'failed';
      resolve({
        // The gate's own clock where it reports one: its stages then add up to it.
        at: new Date(started).toISOString(), seconds: Number.isInteger(report?.seconds) && report.seconds >= 0 ? report.seconds : Math.round((Date.now() - started) / 1000), interrupted,
        result: !passed ? 'failed' : report?.result === 'not-applicable' ? 'not-applicable' : 'passed',
        stages: (report?.stages ?? []).map(({ name, result, seconds }) => ({ name, result, seconds })),
      });
    };
    for (const signal of signals) process.on(signal, pass);
    child.on('error', () => settle(127));
    child.on('close', settle);
  });
}
// Runs one make target on the checked-out commit `sha` and records a gate that
// passed or is not applicable. A failure, an interruption or a checkout that
// changed meanwhile records nothing. agent-check is part of the task gate and
// has no record of its own.
async function runGate(manifest, gate, sha, { tooling = false, combined = false } = {}) {
  const made = await runMake(gate), took = clock(made.seconds), branch = tryGit('symbolic-ref', '--quiet', '--short', 'HEAD');
  log({ event: 'gate', gate, task: manifest.tasks.find(t => taskBranch(t) === branch)?.id ?? null, sha, at: made.at, seconds: made.seconds, result: made.result, combined, stages: made.stages });
  assert(made.result !== 'failed', `${gate} ${made.interrupted ? `was interrupted (${made.interrupted})` : 'failed'} on ${sha}; nothing recorded`);
  assert(git('rev-parse', 'HEAD') === sha && clean(), `The checkout changed while ${gate} ran; nothing recorded`);
  // Every runtime change is tested before it is integrated: only the gates of the end of a milestone can be declared away.
  assert(gate !== 'task-check' || made.result === 'passed', 'task-check cannot be not applicable: give TASK_STAGES its stages in the Makefile; nothing recorded');
  if (gate === 'agent-check') { console.log(`agent-check passed on ${sha} in ${took}.`); return null; }
  const record = { gate, at: made.at, seconds: made.seconds, result: made.result, tooling, stages: made.stages };
  fs.mkdirSync(path.dirname(gateRecord(sha, gate)), { recursive: true });
  fs.writeFileSync(gateRecord(sha, gate), `${JSON.stringify(record)}\n`);
  console.log(made.result === 'passed' ? `${gate} passed on ${sha} in ${took}; recorded.` : `${gate} is not applicable (its stage list is none) on ${sha}; recorded.`);
  // The budget the owner agreed at planning: a gate over it is reported, not refused.
  const budget = manifest.budgets?.[{ 'task-check': 'task_gate_minutes', 'pr-check': 'full_gate_minutes' }[gate]];
  if (budget && made.seconds > budget * 60) console.log(`WARN: ${gate} took ${took}, over its budget of ${budget} minutes. Tell the owner; a slow stage of the task gate belongs in MILESTONE_STAGES.`);
  return record;
}
// The task gate. The tooling's own tests are no stage of it: a change to the
// agent tooling runs `make agent-check` first, and its failure records nothing.
async function taskGate(manifest, sha, tooling, combined = false) {
  if (tooling) {
    console.log('The agent tooling changed: running make agent-check first.');
    await runGate(manifest, 'agent-check', sha, { combined });
  }
  return runGate(manifest, 'task-check', sha, { tooling, combined });
}
// The `gate` command. A gate that already covers the commit is not run again:
// the documentation committed since it passed changes nothing it checked.
async function gateCommand(manifest, name, force) {
  assert(clean(), 'Commit your work first: a gate is recorded for a commit');
  const sha = git('rev-parse', 'HEAD');
  // What this branch changed since it left the integration branch; where that
  // cannot be told, the tooling tests run.
  const from = tryGit('merge-base', manifest.integration_branch, sha), tooling = from === null || toolingChange(changed(from, sha));
  const reused = force ? null : covering(sha, [name], name === 'task-check' && tooling);
  if (reused) return console.log(`${name} ${reused.result === 'passed' ? 'passed' : 'is not applicable, recorded'} on ${reused.sha}; no runtime file changed since: reused.`);
  if (name === 'task-check') return taskGate(manifest, sha, tooling);
  if (name === 'premerge-check') return runGate(manifest, name, sha);
  // `make pr-check` runs the milestone stages only: its record also says that
  // the fast stages cover this runtime state.
  let fast = covering(sha, taskGates, tooling);
  if (!fast) {
    console.log(`No task-check covers ${sha}: running it first.`);
    fast = await taskGate(manifest, sha, tooling);
  }
  return runGate(manifest, name, sha, { tooling: fast.tooling === true });
}

// What makes a task's branch fit for the integration branch at `base`: finish
// and integrate both ask it of every task. Returns the files the task changed.
function verifyTask(manifest, task, base, head, round) {
  const branch = taskBranch(task), integration = manifest.integration_branch, completed = planPath(task, 'completed');
  for (const { dir } of worktrees().filter(w => w.branch === branch && fs.existsSync(w.dir))) assert(clean(dir), `Commit your work first: ${branch} has uncommitted changes in ${dir}`);
  assert(tryGit('cat-file', '-e', `${head}:${completed}`) !== null, `Move the plan to ${completed} first`);
  assert(isAncestor(base, head), round
    ? `${branch} does not start from ${integration} at ${base}: merge it and gate again, or finish it on its own`
    : `${integration} moved: merge it into ${branch}, then gate again`);
  const files = changed(base, head);
  for (const other of manifest.tasks.filter(t => t.id !== task.id)) {
    for (const phase of ['active', 'completed']) assert(!files.includes(planPath(other, phase)), `This branch also changes ${other.id}; one task per branch`);
  }
  // A runtime change needs the task gate on a commit that no runtime change
  // follows: later commits may only complete the plan. A change to the agent
  // tooling needs a gate that ran the tooling's own tests.
  if (needsGate(files)) {
    const tooling = toolingChange(files), record = covering(head, taskGates, tooling);
    assert(record || !tooling || !covering(head, taskGates), `The task-check that covers ${head} did not run the agent tooling tests, and this branch changes the agent tooling. Run: ${self} gate`);
    assert(record, `No passed task-check covers ${head}. Run: ${self} gate`);
  }
  return files;
}
// The task that completes the queue carries the full gates for all of it,
// whatever that task itself changed, on a branch that contains the base
// branch: the owner accepts what the base branch will hold after the merge.
// The base branch comes first: merging it is what the gates then run on.
function verifyLast(manifest, task, head) {
  // Both, each where it exists: a pull request merged on GitHub moves origin's
  // base branch only. The remote-tracking ref is as fresh as the last fetch.
  const base = baseBranch(manifest);
  for (const [ref, name] of [[`refs/heads/${base}`, base], [`refs/remotes/origin/${base}`, `origin/${base}`]]) {
    assert(!tryGit('rev-parse', '--verify', '--quiet', ref) || isAncestor(ref, head), `${name} has commits this branch lacks: merge ${name}, so that the owner accepts what ${base} will hold`);
  }
  for (const name of ['pr-check', 'premerge-check']) assert(covering(head, [name]), `${task.id} completes the queue: no passed ${name} covers ${head}. Run: ${self} gate ${name}`);
}
const assertFree = branch => {
  const held = worktrees().find(w => w.branch === branch);
  assert(!held, held && (fs.existsSync(held.dir)
    ? `${branch} is checked out in a worktree (${held.dir}); switch that worktree to another branch`
    : `${branch} is checked out in a worktree whose directory is gone (${held.dir}); run: git worktree prune`));
};
// The documentation check, on the checked-out commit that is about to be
// integrated. A task gate on that very commit ran it as part of lint; a
// project that removed the script has nothing to run.
const docsCheck = 'tests/integration/check-docs.sh';
function checkDocs(sha) {
  if (readRecord(sha, 'task-check') || !fs.existsSync(path.join(root, docsCheck))) return;
  const result = spawnSync('bash', [docsCheck], { cwd: root, encoding: 'utf8' });
  assert(result.status === 0, `The documentation check fails on ${sha}:\n${`${result.stderr}${result.stdout}`.trim()}\nNothing was moved: fix it, commit, and run the command again`);
}
// The integration branch moves in one compare-and-swap, only from the
// revision that was verified, and never under a worktree that holds it.
function advance(manifest, base, head, ids) {
  const integration = manifest.integration_branch;
  assertFree(integration);
  assert(tryGit('update-ref', '-m', `agent-local: ${ids.join(', ')}`, `refs/heads/${integration}`, head, base) !== null, `${integration} moved during verification; rerun`);
  log({ event: 'integrate', tasks: ids, sha: head, at: new Date().toISOString() });
}

function start(manifest) {
  const integration = manifest.integration_branch, base = baseBranch(manifest), from = tipOf(base), tip = tipOf(integration);
  assert(from, `The base branch ${base} does not exist in this repository; name the project's base branch as base_branch in backlog.json`);
  // A clone that lacks the branch origin holds: the finished tasks are there, not on the base branch.
  const remote = tip ? null : tryGit('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${integration}`);
  if (remote && !isAncestor(remote, from)) {
    assert(tryGit('update-ref', '-m', `agent-local: start from origin/${integration}`, `refs/heads/${integration}`, remote, '') !== null, `${integration} changed meanwhile; rerun`);
    return console.log(`Created ${integration} from origin/${integration} at ${remote}: it holds work that ${base} lacks.`);
  }
  if (tip === from) return console.log(`${integration} is at ${base} (${from}): nothing to do.`);
  // An integration branch that exists follows the base branch only while it
  // is nothing but an older revision of it that no task started from.
  if (tip) {
    assert(isAncestor(tip, from), `${integration} stays where it is: it holds work that ${base} lacks`);
    const claimed = manifest.tasks.filter(task => stateOf(manifest, task).state === 'CLAIMED' && isAncestor(tip, tipOf(taskBranch(task)))).map(task => task.id);
    assert(!claimed.length, `${integration} stays where it is: ${claimed.join(', ')} ${claimed.length > 1 ? 'are' : 'is'} claimed from it`);
    assertFree(integration);
  }
  assert(tryGit('update-ref', '-m', `agent-local: start from ${base}`, `refs/heads/${integration}`, from, tip ?? '') !== null, `${integration} changed meanwhile; rerun`);
  console.log(tip ? `Moved ${integration} forward to ${base} at ${from}.` : `Created ${integration} from ${base} at ${from}.`);
}
function claim(manifest, ids, defer) {
  assert(ids.length && new Set(ids).size === ids.length, usage);
  const integration = manifest.integration_branch, tasks = ids.map(id => taskById(manifest, id));
  for (const task of tasks) {
    const { state, detail } = stateOf(manifest, task);
    assert(state === 'READY', `${task.id} is not ready: ${state}${detail ? ` (${detail})` : ''}`);
  }
  // The claim of a task without an issue creates it and writes its number into
  // this checkout, to be committed on the task's branch: one task, one checkout.
  const unmirrored = manifest.repository && tasks.length > 1 ? tasks.filter(task => task.issue == null).map(task => task.id) : [];
  assert(!unmirrored.length, `${unmirrored.join(', ')} ${unmirrored.length > 1 ? 'have' : 'has'} no issue yet: claim ${unmirrored.length > 1 ? 'each' : 'it'} on its own, in the checkout that delivers it, and commit the issue number on its branch`);
  // Creating the branch is the claim: Git refuses a second one. One
  // transaction creates every branch of a round, from one revision, or none.
  const tip = git('rev-parse', `refs/heads/${integration}`);
  const created = spawnSync('git', ['update-ref', '-m', 'agent-local: claim', '--stdin'], { cwd: root, encoding: 'utf8', input: tasks.map(task => `create refs/heads/${taskBranch(task)} ${tip}\n`).join('') });
  assert(created.status === 0, `${tasks.filter(task => tipOf(taskBranch(task))).map(task => `${task.id} was claimed a moment ago: ${taskBranch(task)} exists`).join('; ') || String(created.stderr).trim().split('\n')[0]}${tasks.length > 1 ? '; nothing was claimed' : ''}`);
  for (const task of tasks) {
    log({ event: 'claim', task: task.id, at: new Date().toISOString() });
    console.log(`Claimed ${task.id} on ${taskBranch(task)} (from ${integration}). Work there: git switch ${taskBranch(task)}`);
  }
  const sentence = mirror(manifest, ids, defer);
  if (defer) console.log(sentence);
}
function finish(manifest, id, defer) {
  const task = taskById(manifest, id), integration = manifest.integration_branch;
  assert(git('rev-parse', '--abbrev-ref', 'HEAD') === taskBranch(task), `Finish ${task.id} from its branch ${taskBranch(task)}`);
  const base = git('rev-parse', `refs/heads/${integration}`), head = git('rev-parse', 'HEAD');
  verifyTask(manifest, task, base, head, false);
  if (manifest.tasks.every(t => t.id === task.id || stateOf(manifest, t).state === 'DONE')) verifyLast(manifest, task, head);
  checkDocs(head);
  advance(manifest, base, head, [task.id]);
  console.log(`${task.id} is on ${integration} at ${head}. ${mirror(manifest, [task.id], defer)}`);
}

// The assembled commit of a round, checked out detached in this checkout for
// as long as `prove` runs on it. The checkout always returns to where it was,
// also after a failure or a signal, which is held back until it has. Git would
// overwrite an ignored file of this checkout that the assembled commit tracks:
// that checkout is refused instead.
async function onAssembled(acc, prove) {
  if (git('rev-parse', 'HEAD') === acc) return prove();
  const origin = tryGit('symbolic-ref', '--quiet', '--short', 'HEAD') ?? git('rev-parse', 'HEAD');
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'], hold = () => {};
  for (const signal of signals) process.on(signal, hold);
  const reason = stderr => String(stderr).split('\n').map(line => line.trim()).filter(line => line && !/^(Please|Aborting)/.test(line)).join(' ');
  try {
    try { git('checkout', '--quiet', '--no-overwrite-ignore', '--detach', acc); } catch (error) {
      throw new Error(`The assembled commit ${acc} could not be checked out here (${reason(error.stderr)}). Nothing was moved: clear the way, or finish the tasks one at a time (${self} finish <ID>, from each branch)`);
    }
    return await prove();
  } finally {
    const back = spawnSync('git', ['checkout', '--quiet', origin, '--'], { cwd: root, encoding: 'utf8' });
    if (back.status !== 0) {
      process.exitCode = 1;
      const left = (tryGit('status', '--porcelain') ?? '').split('\n').filter(Boolean).map(line => line.trim().replace(/^\S+\s+/, ''));
      console.error(`WARN: this checkout is still on the assembled commit: it could not return to ${origin} (${reason(back.stderr)}).${left.length ? ` The gate left changes here (${left.join(', ')}): set them aside (git stash --include-untracked) or discard them, then run: git checkout ${origin}` : ` Run: git checkout ${origin}`}`);
    }
    for (const signal of signals) process.off(signal, hold);
  }
}
// A round: tasks claimed from one revision of the integration branch, each
// verified as `finish` verifies it, merged without touching any checkout,
// proven together where their runtime changes meet, then integrated in one
// step. All or nothing: a refusal moves no branch and records no gate.
async function integrate(manifest, named, defer) {
  assert(named.length && new Set(named).size === named.length, usage);
  for (const id of named) taskById(manifest, id);
  const ids = manifest.tasks.map(task => task.id).filter(id => named.includes(id));
  const integration = manifest.integration_branch, base = git('rev-parse', `refs/heads/${integration}`);
  assert(clean(), 'Commit your work first: a round is integrated from a clean checkout');
  assertFree(integration);
  const round = manifest.tasks.filter(task => ids.includes(task.id)).map(task => {
    const branch = taskBranch(task), { state } = stateOf(manifest, task);
    try {
      assert(state === 'CLAIMED', `not claimed (${state}); a round integrates claimed tasks`);
      const head = git('rev-parse', `refs/heads/${branch}`);
      return { task, branch, head, files: verifyTask(manifest, task, base, head, true) };
    } catch (error) { throw new Error(`${task.id}: ${error.message}`); }
  });

  // Assemble: a fast-forward where possible, else a merge commit made from
  // trees alone. Its conflicts stop the round before anything moved.
  let acc = base;
  for (const { task, branch, head } of round) {
    if (isAncestor(acc, head)) { acc = head; continue; }
    const merge = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', acc, head], { cwd: root, encoding: 'utf8' });
    const [tree, ...conflicts] = String(merge.stdout).split('\n').filter(Boolean);
    assert(merge.status === 0 || merge.status === 1, `git merge-tree could not merge ${branch} (${String(merge.stderr).trim().split('\n')[0]}). It needs Git 2.38 or newer; this is ${git('--version')}. Integrate the tasks one at a time: ${self} finish <ID>, from each branch`);
    const others = ids.filter(id => id !== task.id);
    assert(merge.status === 0, `${task.id} conflicts with the tasks of the round merged before it, in ${conflicts.join(', ')}. Nothing was moved. Integrate the others (${self} integrate ${others.join(' ')}), then merge ${integration} into ${branch}, gate, and ${self} finish ${task.id}`);
    acc = git('commit-tree', tree, '-p', acc, '-p', head, '-m', `Merge ${branch} into ${integration}`);
  }
  const shared = [...new Set(round.flatMap(r => r.files))].filter(file => round.filter(r => r.files.includes(file)).length > 1);
  if (shared.length) console.log(`NOTE: changed by more than one task and merged without a conflict: ${shared.join(', ')}. Read the result.`);

  // The structure of what the integration branch would hold, and whether the
  // queue ends there, by the manifest and the plans of the assembled commit:
  // a task of the round may have changed them.
  const read = file => show(acc, file);
  let assembled;
  try {
    assembled = JSON.parse(read('docs/plans/backlog.json'));
    validateManifest(assembled, read);
  } catch (error) { throw new Error(`The assembled round fails the structure check: ${error.message}. Nothing was moved`); }
  assert(!assembled.tasks.every(task => read(planPath(task, 'completed')) !== null), `This round completes the queue: the last task is finished on its own, with the full gates. Integrate the others, then: ${self} finish <ID>`);

  // The assembled runtime state is proven when a gate covers it: one task's
  // own gate does where only that task changed runtime files.
  const files = changed(base, acc), tooling = toolingChange(files);
  let proof = 'No runtime file changed: no gate was needed.';
  if (needsGate(files) && !covering(acc, taskGates, tooling)) {
    // The proof that the runtime changes of the round work together: the task gate on the assembled commit.
    console.log(`No recorded task-check covers the assembled commit ${acc}: running one combined task-check on it, in this checkout, which returns to where it is afterwards.`);
    await onAssembled(acc, () => taskGate(manifest, acc, tooling, true).catch(error => {
      throw new Error(`${error.message}. Nothing was moved: finish the tasks one at a time (${self} finish <ID>, from each branch) to find the one that breaks the others`);
    }));
    proof = 'One combined task-check passed on it.';
  } else {
    if (needsGate(files)) proof = 'A recorded task-check covers the assembled runtime state: no combined gate was needed.';
    // No gate ran on the assembled commit: its documentation is checked on its own.
    if (files.some(file => file.endsWith('.md')) && !readRecord(acc, 'task-check') && show(acc, docsCheck) !== null) await onAssembled(acc, () => checkDocs(acc));
  }
  advance(manifest, base, acc, ids);
  console.log(`${ids.join(', ')} ${ids.length > 1 ? 'are' : 'is'} on ${integration} at ${acc}. ${proof} ${mirror(manifest, ids, defer)}`);
}

// Whether work is under way: an unfinished task of the manifest, or an
// integration branch that holds work the base branch lacks. Ancestry cannot
// tell after a squash or a rebase merge, so the test is a merge: when merging
// the integration branch into the base branch changes nothing, the base holds
// all of it. One answer for every skill that asks whether a milestone is in
// progress.
function phase(manifest) {
  const integration = manifest.integration_branch, base = baseBranch(manifest), tip = tipOf(integration);
  const from = tipOf(base) ?? tryGit('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`);
  // Done on the integration branch, or on the base branch where the merged integration branch was deleted.
  const open = manifest.tasks.filter(task => stateOf(manifest, task).state !== 'DONE' && !(from && tryGit('cat-file', '-e', `${from}:${planPath(task, 'completed')}`) !== null)).map(task => task.id);
  let ahead = false;
  if (tip && from && !isAncestor(tip, from)) {
    const merge = spawnSync('git', ['merge-tree', '--write-tree', '--no-messages', from, tip], { cwd: root, encoding: 'utf8' });
    ahead = merge.status !== 0 || String(merge.stdout).split('\n')[0] !== git('rev-parse', `${from}^{tree}`);
  }
  const why = [open.length && `${open.join(', ')} ${open.length > 1 ? 'are' : 'is'} unfinished`, ahead && `${integration} holds work that ${base} lacks`].filter(Boolean);
  console.log(why.length ? `delivering: ${why.join('; ')}` : `between: every task is done and ${base} holds all of ${integration}`);
}

// Where the time of this manifest's tasks went, from the log alone: no step
// measures itself.
function timings(manifest) {
  let events = [];
  try {
    events = fs.readFileSync(timingLog(), 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).filter(e => e && typeof e === 'object');
  } catch { /* nothing logged yet */ }
  const ms = event => Date.parse(event.at), span = (from, to) => clock(Math.max(0, (to - from) / 1000));
  const total = list => clock(list.reduce((sum, e) => sum + (e.seconds ?? 0), 0));
  // A run of the task gate is its task-check, or the agent-check that failed before it.
  const runs = list => {
    const tries = list.filter(e => e.gate !== 'agent-check' || e.result === 'failed'), failed = tries.filter(e => e.result === 'failed').length;
    return `${tries.length}${failed ? ` (${failed} failed)` : ''}, ${total(list)}`;
  };
  const claims = events.filter(e => e.event === 'claim' && manifest.tasks.some(task => task.id === e.task));
  for (const { id } of manifest.tasks) {
    const claimed = claims.filter(e => e.task === id).at(-1), mine = events.filter(e => !claimed || ms(e) >= ms(claimed));
    const done = mine.filter(e => e.event === 'integrate' && e.tasks?.includes(id)).at(-1);
    const gates = mine.filter(e => e.event === 'gate' && e.task === id && !e.combined && ['task-check', 'agent-check'].includes(e.gate));
    const passed = gates.filter(e => e.gate === 'task-check' && e.result !== 'failed');
    // Implementation ends where the first gate that passed began: at its agent-check, where it had one.
    const before = gates[gates.indexOf(passed[0]) - 1], began = before?.gate === 'agent-check' && before.result !== 'failed' ? before : passed[0];
    const parts = [
      claimed && done ? `${span(ms(claimed), ms(done))} from claim to integration` : claimed ? `claimed ${claimed.at}, not integrated` : done && `integrated ${done.at}`,
      claimed && passed.length && `implementation ${span(ms(claimed), ms(began))}`,
      gates.length && `task gates ${runs(gates)}`,
      done && passed.length && `review and completion ${span(ms(passed.at(-1)) + passed.at(-1).seconds * 1000, ms(done))}`,
    ].filter(Boolean);
    console.log(`${id}: ${parts.join('; ') || 'nothing recorded'}`);
  }
  // The rest of the log from this manifest's first claim on: earlier lines are another milestone's.
  const since = claims.length ? Math.min(...claims.map(ms)) : 0, later = events.filter(e => ms(e) >= since);
  const gatesOf = (names, combined) => later.filter(e => e.event === 'gate' && names.includes(e.gate) && Boolean(e.combined) === combined);
  const stages = e => e.stages?.length ? `: ${e.stages.map(s => `${s.name} ${s.result === 'passed' ? clock(s.seconds) : s.result}`).join(', ')}` : '';
  const last = e => e.result === 'not-applicable' ? 'not applicable' : `${e.result}${stages(e)}`;
  const line = (label, list) => console.log(`${label}: ${list.length ? `${runs(list)}; last ${last(list.at(-1))}` : 'not run'}`);
  const combined = gatesOf(['task-check', 'agent-check'], true), published = later.filter(e => e.event === 'publish');
  console.log(`Combined round gates: ${combined.length ? runs(combined) : 'none'}`);
  line('Full gate (pr-check)', gatesOf(['pr-check'], false));
  line('Resilience gate (premerge-check)', gatesOf(['premerge-check'], false));
  const failed = published.filter(e => e.push === 'failed' || e.sync === 'failed').length;
  console.log(`GitHub publication: ${published.length ? `${published.length} (${published.filter(e => e.push === 'pushed').length} pushed${failed ? `, ${failed} failed` : ''}), ${total(published)}` : 'none'}`);
}

async function main() {
  const [command = 'next', ...rest] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) return console.log(usage);
  const flags = rest.filter(arg => arg.startsWith('--')), args = rest.filter(arg => !arg.startsWith('--'));
  assert(Object.hasOwn(options, command) && flags.every(flag => options[command].includes(flag)) && !(args.length > arity[command]), usage);
  const manifest = load(), integration = manifest.integration_branch, defer = flags.includes('--no-publish');
  if (command === 'base') return console.log(baseBranch(manifest));
  if (command === 'phase') return phase(manifest);
  if (command === 'start') return start(manifest);
  assert(tipOf(integration), `The integration branch ${integration} does not exist; create it: ${self} start`);
  if (command === 'next') {
    for (const task of manifest.tasks) {
      const { state, detail } = stateOf(manifest, task);
      if (state !== 'DONE') console.log(`${state} ${task.id}: ${detail}`);
    }
    if (fs.existsSync(syncPending())) console.log(`GitHub is out of sync. Run: ${self} publish`);
    return;
  }
  if (command === 'publish') {
    const result = publish(manifest);
    assert(result !== false, 'GitHub is still out of sync');
    return console.log(result ? `Pushed ${integration}; issues synced.` : 'backlog.json names no repository: nothing to publish.');
  }
  if (command === 'gate') {
    const name = args[0] ?? 'task-check';
    assert(gateNames.includes(name), `Unknown gate ${name}; use ${gateNames.join(' or ')}`);
    return gateCommand(manifest, name, flags.includes('--force'));
  }
  if (command === 'timings') return timings(manifest);
  if (command === 'claim') return claim(manifest, args, defer);
  if (command === 'integrate') return integrate(manifest, args, defer);
  return finish(manifest, args[0], defer);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
