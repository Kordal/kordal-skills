import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, workerData } from 'node:worker_threads';

// The real scripts/agent-local.mjs in a real Git repository whose tasks are
// planned on the base branch and on the integration branch milestone1: two
// tasks, the second depending on the first, or a round of three independent
// tasks and the task that waits for all of them. `make` is a fake.
const sections = ['Goal', 'Context', 'Task Contract', 'Scope', 'Out of Scope', 'Affected Components', 'Acceptance Criteria', 'Flow', 'Implementation Steps', 'Tests', 'Risks', 'Review', 'Completion Notes'];
const tasks = [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', depends_on: ['CAP-001'], adrs: [] },
];
const round = [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', depends_on: [], adrs: [] },
  { id: 'CAP-003', title: 'Search', slug: 'search', depends_on: [], adrs: [] },
  { id: 'CAP-004', title: 'Acceptance', slug: 'acceptance', depends_on: ['CAP-001', 'CAP-002', 'CAP-003'], adrs: [] },
];
const three = ['CAP-001', 'CAP-002', 'CAP-003'];
const plan = task => `# ${task.id}: ${task.title}\n\nDependencies: ${task.depends_on.join(', ') || 'none'}\n\n`
  + sections.map(s => `## ${s}\n\n${s === 'Acceptance Criteria' ? '- [x] Works' : 'Text.'}\n`).join('\n');
// The fake make logs every invocation with its arguments and the commit it ran
// on, then passes, fails, hangs, leaves a file or a lock behind, or is not
// applicable, as the MAKE_* variables name its target (or `all`); a gate
// reports to GATE_REPORT as scripts/gate.sh does, or writes MAKE_REPORT there.
const fakeMake = `#!/bin/sh
echo "make $* @$(git rev-parse HEAD)" >> "$MAKE_LOG"
echo "make $*"
named() { case " $1 " in *" $2 "* | *" all "*) return 0 ;; esac; return 1; }
if named "\${MAKE_HANG:-}" "$1"; then exec sleep 30; fi
if named "\${MAKE_DIRTY:-}" "$1"; then echo left > left-behind.txt; fi
if named "\${MAKE_LOCK:-}" "$1"; then : > "$(git rev-parse --git-dir)/index.lock"; fi
result=passed stages='{"name":"unit","result":"passed","seconds":3}' code=0
if named "\${MAKE_NA:-}" "$1"; then result=not-applicable stages=; fi
if named "\${MAKE_FAIL:-}" "$1"; then result=failed stages= code=2; fi
[ "$1" = agent-check ] || printf '{"gate":"%s","result":"%s","seconds":3,"stages":[%s]}\\n' "$1" "$result" "$stages" > "$GATE_REPORT"
[ -z "\${MAKE_REPORT:-}" ] || printf '%s\\n' "$MAKE_REPORT" > "$GATE_REPORT"
exit $code
`;
function fixture(t, { list = tasks, base = 'main', branch = true, files = {} } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-local-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // `make`: 'pass', 'fail', or what the fake make does for which target: { fail, na, hang, dirty, lock, env }.
  const env = (make = {}) => ({
    ...process.env, AGENT_MAKE: path.join(dir, 'bin/make'), MAKE_LOG: path.join(dir, 'bin/make.log'), MAKE_FAIL: make === 'fail' ? 'all' : make.fail ?? '',
    MAKE_NA: make.na ?? '', MAKE_HANG: make.hang ?? '', MAKE_DIRTY: make.dirty ?? '', MAKE_LOCK: make.lock ?? '', ...(make.env ?? {}),
  });
  // A checkout of the repository: the main one, or a worktree.
  const checkout = at => {
    const write = (file, text, mode) => { fs.mkdirSync(path.dirname(path.join(at, file)), { recursive: true }); fs.writeFileSync(path.join(at, file), text, { mode }); };
    const git = (...args) => { const r = spawnSync('git', args, { cwd: at, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    const move = (from, to) => { fs.mkdirSync(path.dirname(path.join(at, to)), { recursive: true }); git('mv', from, to); };
    const commit = message => { git('add', '--all'); git('commit', '--quiet', '--message', message); return git('rev-parse', 'HEAD'); };
    const cli = (args, make = 'pass') => spawnSync(process.execPath, [path.join(at, 'scripts/agent-local.mjs'), ...args], { encoding: 'utf8', env: env(make) });
    // The task on its branch, here: its changes (one runtime file unless
    // `changes` says otherwise) and its completed plan, committed.
    const work = (id, changes) => {
      const task = list.find(candidate => candidate.id === id);
      if (git('rev-parse', '--abbrev-ref', 'HEAD') !== `task/${id.toLowerCase()}`) git('switch', '--quiet', `task/${id.toLowerCase()}`);
      for (const [file, text] of Object.entries(changes ?? { [`src/${task.slug}.js`]: 'export const id = 1;\n' })) write(file, text);
      move(`docs/plans/planned/${id}-${task.slug}.md`, `docs/plans/completed/${id}-${task.slug}.md`);
      return commit(id);
    };
    return { dir: at, write, git, move, commit, cli, work };
  };
  const main = checkout(dir);
  for (const script of ['agent-local.mjs', 'agent-workflow.mjs', 'agent-scope.mjs']) main.write(`scripts/${script}`, fs.readFileSync(fileURLToPath(new URL(`./${script}`, import.meta.url)), 'utf8'));
  main.write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', ...(base === 'main' ? {} : { base_branch: base }), tasks: list }));
  for (const task of list) main.write(`docs/plans/planned/${task.id}-${task.slug}.md`, plan(task));
  main.write('bin/make', fakeMake, 0o755);
  main.write('.gitignore', 'bin/\n');
  for (const [file, text] of Object.entries(files)) main.write(file, text);
  main.git('init', '--quiet', '--initial-branch', base);
  main.git('config', 'user.email', 'test@example.com'); main.git('config', 'user.name', 'Test');
  main.commit('plans');
  if (branch) main.git('branch', 'milestone1');
  // The first task implemented on its branch: a runtime file and the completed plan.
  const implement = () => { assert.equal(main.cli(['claim', 'CAP-001']).status, 0); return main.work('CAP-001'); };
  const made = () => fs.existsSync(path.join(dir, 'bin/make.log')) ? fs.readFileSync(path.join(dir, 'bin/make.log'), 'utf8').trim().split('\n').map(line => line.split(' @')) : [];
  const gates = path.join(dir, '.git/agent-gates');
  const records = () => fs.existsSync(gates) ? fs.readdirSync(gates).sort() : [];
  // A record without the time it was measured at.
  const record = (sha, gate) => { const { at, seconds, ...rest } = JSON.parse(fs.readFileSync(path.join(gates, `${sha}.${gate}`), 'utf8')); assert.ok(!Number.isNaN(Date.parse(at)) && Number.isInteger(seconds)); return rest; };
  const forge = (sha, gate, text) => { fs.mkdirSync(gates, { recursive: true }); fs.writeFileSync(path.join(gates, `${sha}.${gate}`), text); };
  const worktree = id => { const at = path.join(dir, `bin/wt-${id.toLowerCase()}`); main.git('worktree', 'add', '--quiet', at, `task/${id.toLowerCase()}`); return checkout(at); };
  // What a refusal must leave as it was: every branch, the gate records and the checkout.
  const snapshot = () => ({ refs: main.git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'), records: records(), head: main.git('rev-parse', '--abbrev-ref', 'HEAD'), commit: main.git('rev-parse', 'HEAD'), status: main.git('status', '--porcelain') });
  const events = () => fs.readFileSync(path.join(dir, '.git/agent-timings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { ...main, env, implement, makes: () => made().map(([call]) => call), madeAt: () => made().map(([, sha]) => sha), records, record, forge, worktree, snapshot, events };
}
// Three runtime tasks of one round, each delivered and gated on its branch;
// the checkout is back on main. `changes` replaces a task's runtime file.
function gatedRound(t, changes = {}, options = {}) {
  const f = fixture(t, { list: round, ...options });
  assert.equal(f.cli(['claim', ...three]).status, 0);
  for (const id of three) { f.work(id, changes[id]); assert.equal(f.cli(['gate']).status, 0); }
  f.git('switch', '--quiet', 'main');
  return f;
}
// A refused command: it failed, and nothing moved.
function refused(f, args, make) {
  const before = f.snapshot(), result = f.cli(args, make);
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(f.snapshot(), before, 'the integration branch, the gate records and the checkout are untouched');
  return result.stderr;
}
// A scenario waits on dozens of processes (Git, the helper, make) and takes a
// second or two; there are dozens of them. They run side by side, each in a
// worker thread that loads this file and runs that one scenario (see the end).
const scenarios = new Map();
const scenario = (name, body) => { assert.ok(!scenarios.has(name), `two scenarios named: ${name}`); scenarios.set(name, body); };

scenario('next lists what is ready, and a claim is a branch that only one agent gets', t => {
  const f = fixture(t);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-001: Identity\nWAIT CAP-002: needs CAP-001\n');
  assert.match(f.cli(['claim', 'CAP-002']).stderr, /CAP-002 is not ready: WAIT \(needs CAP-001\)/);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  assert.equal(f.git('rev-parse', 'task/cap-001'), f.git('rev-parse', 'milestone1'));
  assert.match(f.cli(['next']).stdout, /^CLAIMED CAP-001: task\/cap-001$/m);
  assert.match(f.cli(['claim', 'CAP-001']).stderr, /CAP-001 is not ready: CLAIMED/);
  assert.match(f.cli(['claim', 'CAP-099']).stderr, /Unknown task CAP-099/);
});
scenario('claim takes a round in one command: every task is READY before any branch exists, and all start from one revision', t => {
  const f = fixture(t, { list: round });
  assert.match(f.cli(['claim', 'CAP-001', 'CAP-004']).stderr, /CAP-004 is not ready: WAIT \(needs CAP-001, CAP-002, CAP-003\)/);
  assert.match(f.cli(['claim', 'CAP-001', 'CAP-099']).stderr, /Unknown task CAP-099/);
  assert.match(f.cli(['claim', 'CAP-001', 'CAP-001']).stderr, /Usage: node scripts\/agent-local\.mjs/);
  assert.equal(f.git('branch', '--list', 'task/*'), '', 'no branch for the ready task of a refused claim');
  const claimed = f.cli(['claim', ...three]);
  assert.equal(claimed.stdout, three.map(id => `Claimed ${id} on task/${id.toLowerCase()} (from milestone1). Work there: git switch task/${id.toLowerCase()}\n`).join(''));
  for (const id of three) assert.equal(f.git('rev-parse', `task/${id.toLowerCase()}`), f.git('rev-parse', 'milestone1'));
  assert.equal(f.cli(['next']).stdout, 'CLAIMED CAP-001: task/cap-001\nCLAIMED CAP-002: task/cap-002\nCLAIMED CAP-003: task/cap-003\nWAIT CAP-004: needs CAP-001, CAP-002, CAP-003\n');
  assert.match(f.cli(['claim', 'CAP-002', 'CAP-003']).stderr, /CAP-002 is not ready: CLAIMED/);
});
scenario('a branch that cannot be created claims none of the round', t => {
  const f = fixture(t, { list: round });
  // A branch below the name of the second task's branch: Git cannot create that one.
  f.git('branch', 'task/cap-002/elsewhere');
  const claimed = f.cli(['claim', 'CAP-001', 'CAP-002']);
  assert.equal(claimed.status, 1);
  assert.match(claimed.stderr, /task\/cap-002.*; nothing was claimed/);
  assert.equal(f.git('branch', '--list', 'task/cap-001'), '', 'the first task was not claimed alone');
  assert.equal(f.cli(['next']).stdout.split('\n')[0], 'READY CAP-001: Identity');
});
scenario('the usage names every command, and an unknown command or option gets it', t => {
  const f = fixture(t);
  const help = f.cli(['help']);
  assert.equal(help.status, 0);
  for (const command of ['next', 'base', 'start', 'claim <ID>... [--no-publish]', 'gate [task-check|pr-check|premerge-check] [--force]', 'finish <ID> [--no-publish]', 'integrate <ID>... [--no-publish]', 'publish', 'timings']) {
    assert.match(help.stdout, new RegExp(`^  ${command.replace(/[.[\]|]/g, '\\$&')}( |$)`, 'm'), command);
  }
  for (const args of [['release'], ['gate', '--no-publish'], ['claim', 'CAP-001', '--force'], ['next', '--verbose'], ['constructor']]) {
    const wrong = f.cli(args);
    assert.equal(wrong.status, 1, args.join(' '));
    assert.ok(wrong.stderr.startsWith('FAIL: Usage: node scripts/agent-local.mjs <command>\n') && wrong.stderr.includes(help.stdout.trim()), args.join(' '));
  }
  assert.equal(f.git('branch', '--list', 'task/*'), '', 'a refused option claims nothing');
});

scenario('finish puts a gated task on the integration branch and unblocks its dependants', t => {
  const f = fixture(t);
  const head = f.implement();
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed task-check covers/);
  assert.equal(f.git('rev-parse', 'milestone1'), f.git('rev-parse', 'main'), 'nothing integrated without a gate');
  const failed = f.cli(['gate'], 'fail');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /task-check failed/);
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed task-check covers/, 'a failed gate records nothing');
  const passed = f.cli(['gate']);
  assert.match(passed.stdout, /make task-check\n[\s\S]*task-check passed on [a-f0-9]{40} in \d+:\d\d; recorded\./);
  // The plan completed after the gate: documentation only.
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]) + '\nGate passed.\n');
  const final = f.commit('plan');
  assert.notEqual(final, head);
  const finished = f.cli(['finish', 'CAP-001']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /CAP-001 is on milestone1 at [a-f0-9]{40}\. Nothing was pushed\./);
  assert.equal(f.git('rev-parse', 'milestone1'), final);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-002: Freshness\n');
});
scenario('a runtime change after the gate needs the gate again', t => {
  const f = fixture(t);
  f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  f.write('src/identity.js', 'export const id = 2;\n');
  f.commit('fix');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed task-check covers/);
  assert.equal(f.cli(['gate']).status, 0);
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
});
scenario('a documentation-only task needs no gate', t => {
  const f = fixture(t);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  f.work('CAP-001', {});
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
  assert.deepEqual(f.makes(), []);
});
scenario('finish refuses an unfinished, foreign, dirty or outdated branch and a checked-out integration branch', t => {
  const f = fixture(t);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /Finish CAP-001 from its branch task\/cap-001/);
  f.git('switch', '--quiet', 'task/cap-001');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /Move the plan to docs\/plans\/completed\/CAP-001-identity\.md/);
  f.write('src/identity.js', 'export const id = 1;\n');
  assert.match(f.cli(['gate']).stderr, /Commit your work first/);
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /Commit your work first/);
  f.move('docs/plans/planned/CAP-001-identity.md', 'docs/plans/completed/CAP-001-identity.md');
  f.move('docs/plans/planned/CAP-002-freshness.md', 'docs/plans/active/CAP-002-freshness.md');
  f.commit('two tasks');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /also changes CAP-002; one task per branch/);
  f.move('docs/plans/active/CAP-002-freshness.md', 'docs/plans/planned/CAP-002-freshness.md');
  f.commit('one task');
  assert.equal(f.cli(['gate']).status, 0);
  // Another task reached the integration branch meanwhile.
  f.git('switch', '--quiet', 'milestone1');
  f.write('src/other.js', 'export const id = 1;\n');
  const moved = f.commit('other task');
  assert.match(f.cli(['gate', 'release-check']).stderr, /Unknown gate release-check/);
  f.git('switch', '--quiet', 'task/cap-001');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /milestone1 moved: merge it into task\/cap-001, then gate again/);
  f.git('merge', '--quiet', '--no-edit', 'milestone1');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed task-check covers/, 'the merge brought a runtime file the gate did not see');
  assert.equal(f.cli(['gate']).status, 0);
  f.git('worktree', 'add', '--quiet', path.join(f.dir, 'bin/other'), 'milestone1');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /milestone1 is checked out in a worktree/);
  assert.equal(f.git('rev-parse', 'milestone1'), moved);
  f.git('worktree', 'remove', path.join(f.dir, 'bin/other'));
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
  assert.equal(f.git('rev-parse', 'milestone1'), f.git('rev-parse', 'task/cap-001'));
});
scenario('finish refuses a task whose review is not recorded', t => {
  const f = fixture(t);
  f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]).replace('## Review\n\nText.', '## Review\n\nPending.'));
  f.commit('plan without a review');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /CAP-001 missing completion Review/);
  assert.equal(f.git('rev-parse', 'milestone1'), f.git('rev-parse', 'main'));
});
scenario('moving a runtime file into the documentation is still a runtime change', t => {
  const f = fixture(t);
  f.write('src/tool.js', 'export const tool = 1;\n');
  f.git('switch', '--quiet', 'milestone1'); f.commit('tool'); f.git('switch', '--quiet', 'main');
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  f.git('switch', '--quiet', 'task/cap-001');
  f.move('src/tool.js', 'docs/tool.js');
  f.move('docs/plans/planned/CAP-001-identity.md', 'docs/plans/completed/CAP-001-identity.md');
  f.commit('CAP-001');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed task-check covers/);
});
scenario('the task that completes the queue needs the full and the resilience gate, also when it changes documentation only', t => {
  const f = fixture(t);
  f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0, 'a task-check is enough while tasks remain');
  assert.equal(f.cli(['claim', 'CAP-002']).status, 0);
  const head = f.work('CAP-002', {});
  assert.equal(f.cli(['gate']).stdout, `task-check passed on ${f.git('rev-parse', 'task/cap-001')}; no runtime file changed since: reused.\n`, 'the gate of the first task covers this documentation');
  assert.equal(f.cli(['finish', 'CAP-002']).stderr, `FAIL: CAP-002 completes the queue: no passed pr-check covers ${head}. Run: node scripts/agent-local.mjs gate pr-check\n`);
  assert.match(f.cli(['gate', 'pr-check']).stdout, /^make pr-check\npr-check passed on [a-f0-9]{40} in \d+:\d\d; recorded\.\n$/);
  // The full gate alone does not finish the queue.
  assert.equal(f.cli(['finish', 'CAP-002']).stderr, `FAIL: CAP-002 completes the queue: no passed premerge-check covers ${head}. Run: node scripts/agent-local.mjs gate premerge-check\n`);
  assert.equal(f.git('rev-parse', 'milestone1'), f.git('rev-parse', 'task/cap-001'), 'nothing integrated under the full gate alone');
  assert.match(f.cli(['gate', 'premerge-check']).stdout, /^make premerge-check\npremerge-check passed on [a-f0-9]{40} in \d+:\d\d; recorded\.\n$/);
  assert.equal(f.cli(['finish', 'CAP-002']).status, 0);
  assert.equal(f.cli(['next']).stdout, '');
  assert.deepEqual(f.makes(), ['make task-check', 'make pr-check', 'make premerge-check']);
});
scenario('a gate that takes longer than its agreed budget passes and says so', t => {
  const f = fixture(t);
  f.write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', budgets: { task_gate_minutes: 0.01 }, tasks }));
  // A make that is not scripts/gate.sh and writes no report: the gate is recorded without stages.
  f.write('bin/make', '#!/bin/sh\nsleep 1\n', 0o755);
  const sha = f.commit('budget');
  const slow = f.cli(['gate']);
  assert.equal(slow.status, 0, slow.stderr);
  assert.match(slow.stdout, /WARN: task-check took \d+:\d\d, over its budget of 0\.01 minutes/);
  assert.deepEqual(f.record(sha, 'task-check'), { gate: 'task-check', result: 'passed', tooling: false, stages: [] });
  f.write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', budgets: { task_gate_minutes: 3, gate: 1 }, tasks }));
  f.commit('unknown budget');
  assert.match(f.cli(['gate']).stderr, /Invalid budget: gate/);
});
scenario('a report that is not the gate\'s own decides nothing: the exit status does', t => {
  const f = fixture(t);
  const head = f.implement();
  // Another gate's report (a stage that ran a gate of its own), a report without a stage list, and no JSON at all.
  for (const report of ['{"gate":"premerge-check","result":"not-applicable","seconds":0,"stages":[]}', '{"gate":"pr-check","result":"failed","seconds":0,"stages":[]}', '{"gate":"task-check","result":"not-applicable","seconds":0,"stages":"none"}', 'make: nothing to report']) {
    const passed = f.cli(['gate', '--force'], { env: { MAKE_REPORT: report } });
    assert.match(passed.stdout, new RegExp(`^make task-check\\ntask-check passed on ${head} in \\d+:\\d\\d; recorded\\.\\n$`), report);
    assert.deepEqual(f.record(head, 'task-check'), { gate: 'task-check', result: 'passed', tooling: false, stages: [] }, report);
  }
  // Its own report that says failed outweighs an exit status that says passed.
  assert.match(f.cli(['gate', '--force'], { env: { MAKE_REPORT: '{"gate":"task-check","result":"failed","seconds":0,"stages":[]}' } }).stderr, /task-check failed on/);
});
scenario('a gate that leaves the checkout changed records nothing', t => {
  const f = fixture(t);
  f.implement();
  assert.match(f.cli(['gate'], { dirty: 'task-check' }).stderr, /The checkout changed while task-check ran; nothing recorded/);
  assert.deepEqual(f.records(), []);
});

scenario('a product task runs make task-check once and never agent-check; a tooling change runs agent-check first, and its failure records nothing', t => {
  const f = fixture(t);
  const head = f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  assert.deepEqual(f.makes(), ['make task-check']);
  assert.deepEqual(f.record(head, 'task-check'), { gate: 'task-check', result: 'passed', tooling: false, stages: [{ name: 'unit', result: 'passed', seconds: 3 }] });
  for (const [file, text] of [['scripts/agent-scope.mjs', '// A change to the tooling.\n'], ['Makefile', 'check:\n\ttrue\n']]) {
    const g = fixture(t);
    assert.equal(g.cli(['claim', 'CAP-001']).status, 0);
    g.git('switch', '--quiet', 'task/cap-001');
    fs.appendFileSync(path.join(g.dir, file), text);
    const changed = g.commit(`change ${file}`);
    const failed = g.cli(['gate'], { fail: 'agent-check' });
    assert.equal(failed.status, 1, file);
    assert.match(failed.stderr, new RegExp(`agent-check failed on ${changed}; nothing recorded`));
    assert.deepEqual(g.makes(), ['make agent-check'], 'the task gate does not run after a failed agent-check');
    assert.deepEqual(g.records(), []);
    const passed = g.cli(['gate']);
    assert.match(passed.stdout, /^The agent tooling changed: running make agent-check first\.\nmake agent-check\nagent-check passed on [a-f0-9]{40} in \d+:\d\d\.\nmake task-check\ntask-check passed on/);
    assert.deepEqual(g.makes(), ['make agent-check', 'make agent-check', 'make task-check'], `${file}: agent-check before task-check`);
    assert.deepEqual(g.records(), [`${changed}.task-check`], 'agent-check has no record of its own');
    assert.equal(g.record(changed, 'task-check').tooling, true);
    // The full gate rests on that task gate, and its record says what it rests on.
    assert.equal(g.cli(['gate', 'pr-check']).status, 0);
    assert.deepEqual(g.makes().slice(3), ['make pr-check']);
    assert.equal(g.record(changed, 'pr-check').tooling, true);
  }
});
scenario('a passed gate is reused while only documentation changes; --force and a runtime change run it again', t => {
  const f = fixture(t);
  const head = f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  // The Review and the Completion Notes of the plan, and the owner's test document.
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]).replace('## Review\n\nText.', '## Review\n\nNo findings.') + '\nDelivered.\n');
  f.commit('review and completion notes');
  f.write('docs/product/milestone1-test.md', '# Milestone 1 test\n\n- [x] The owner accepted it.\n');
  const documented = f.commit('the test document');
  const reused = f.cli(['gate']);
  assert.equal(reused.status, 0);
  assert.equal(reused.stdout, `task-check passed on ${head}; no runtime file changed since: reused.\n`);
  assert.deepEqual(f.makes(), ['make task-check'], 'a reused gate runs no make');
  assert.deepEqual(f.records(), [`${head}.task-check`]);
  assert.match(f.cli(['gate', '--force']).stdout, new RegExp(`^make task-check\\ntask-check passed on ${documented} in`));
  assert.deepEqual(f.makes(), ['make task-check', 'make task-check']);
  f.write('src/identity.js', 'export const id = 2;\n');
  const fixed = f.commit('fix');
  assert.equal(f.cli(['finish', 'CAP-001']).stderr, `FAIL: No passed task-check covers ${fixed}. Run: node scripts/agent-local.mjs gate\n`);
  assert.match(f.cli(['gate']).stdout, new RegExp(`task-check passed on ${fixed} in`));
  assert.deepEqual(f.makes(), ['make task-check', 'make task-check', 'make task-check'], 'a runtime change is gated again');
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
});
scenario('pr-check runs only make pr-check over a covering task-check, and the task-check first where none covers', t => {
  const f = fixture(t);
  const head = f.implement();
  const first = f.cli(['gate', 'pr-check']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`^No task-check covers ${head}: running it first\\.\\nmake task-check\\ntask-check passed on ${head} in \\d+:\\d\\d; recorded\\.\\nmake pr-check\\npr-check passed on ${head} in \\d+:\\d\\d; recorded\\.\\n$`));
  assert.deepEqual(f.makes(), ['make task-check', 'make pr-check']);
  assert.deepEqual(f.records(), [`${head}.pr-check`, `${head}.task-check`]);
  // A new runtime state with its own task gate: the full gate adds the milestone stages only.
  f.write('src/identity.js', 'export const id = 2;\n');
  const second = f.commit('fix');
  assert.equal(f.cli(['gate']).status, 0);
  assert.match(f.cli(['gate', 'pr-check']).stdout, /^make pr-check\npr-check passed on/);
  assert.deepEqual(f.makes().slice(2), ['make task-check', 'make pr-check']);
  assert.deepEqual(f.record(second, 'pr-check'), { gate: 'pr-check', result: 'passed', tooling: false, stages: [{ name: 'unit', result: 'passed', seconds: 3 }] });
  // A failed task-check stops before the full gate.
  f.write('src/identity.js', 'export const id = 3;\n');
  const third = f.commit('another fix');
  const failed = f.cli(['gate', 'pr-check'], { fail: 'task-check' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, new RegExp(`task-check failed on ${third}; nothing recorded`));
  assert.deepEqual(f.makes().slice(4), ['make task-check'], 'no pr-check after a failed task-check');
  assert.ok(!f.records().some(name => name.startsWith(third)), 'nothing recorded');
  // A failed full gate keeps the task gate that passed before it, and has no record itself.
  assert.match(f.cli(['gate', 'pr-check'], { fail: 'pr-check' }).stderr, new RegExp(`pr-check failed on ${third}; nothing recorded`));
  assert.deepEqual(f.makes().slice(5), ['make task-check', 'make pr-check']);
  assert.deepEqual(f.records().filter(name => name.startsWith(third)), [`${third}.task-check`]);
});
scenario('a standalone feature: the gates pass, the owner accepts in documentation, the gates are reused and finish succeeds', t => {
  const f = fixture(t, { list: [tasks[0]] });
  const head = f.implement();
  for (const gate of [[], ['pr-check'], ['premerge-check']]) assert.equal(f.cli(['gate', ...gate]).status, 0);
  assert.deepEqual(f.makes(), ['make task-check', 'make pr-check', 'make premerge-check']);
  // The owner tests, and the acceptance and the completed plan are recorded: documentation.
  f.write('docs/product/feature-identity-test.md', `# Identity\n\nThe owner accepted it at ${head}.\n`);
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]) + '\nAccepted by the owner.\n');
  f.commit('acceptance');
  assert.equal(f.cli(['gate', 'pr-check']).stdout, `pr-check passed on ${head}; no runtime file changed since: reused.\n`);
  assert.equal(f.cli(['gate', 'premerge-check']).stdout, `premerge-check passed on ${head}; no runtime file changed since: reused.\n`);
  assert.deepEqual(f.makes(), ['make task-check', 'make pr-check', 'make premerge-check'], 'no make for the reused gates');
  const finished = f.cli(['finish', 'CAP-001']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.equal(f.git('rev-parse', 'milestone1'), f.git('rev-parse', 'HEAD'));
  assert.equal(f.cli(['next']).stdout, '');
});
scenario('a standalone feature: a runtime fix after the gates is refused until every gate ran again', t => {
  const f = fixture(t, { list: [tasks[0]] });
  f.implement();
  for (const gate of [[], ['pr-check'], ['premerge-check']]) assert.equal(f.cli(['gate', ...gate]).status, 0);
  f.write('src/identity.js', 'export const id = 2;\n');
  const fixed = f.commit('what the owner reported');
  const run = 'Run: node scripts/agent-local.mjs gate';
  assert.equal(refused(f, ['finish', 'CAP-001']), `FAIL: No passed task-check covers ${fixed}. ${run}\n`);
  assert.equal(f.cli(['gate']).status, 0);
  assert.equal(refused(f, ['finish', 'CAP-001']), `FAIL: CAP-001 completes the queue: no passed pr-check covers ${fixed}. ${run} pr-check\n`);
  assert.equal(f.cli(['gate', 'pr-check']).status, 0);
  assert.equal(refused(f, ['finish', 'CAP-001']), `FAIL: CAP-001 completes the queue: no passed premerge-check covers ${fixed}. ${run} premerge-check\n`);
  assert.equal(f.cli(['gate', 'premerge-check']).status, 0);
  assert.deepEqual(f.makes().slice(3), ['make task-check', 'make pr-check', 'make premerge-check'], 'each gate ran once more, the task gate not twice');
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
});
scenario('the resilience gate: a failure records nothing, and not applicable is recorded as such and accepted by finish', t => {
  const f = fixture(t);
  f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
  assert.equal(f.cli(['claim', 'CAP-002']).status, 0);
  const head = f.work('CAP-002', {});
  assert.equal(f.cli(['gate', 'pr-check']).status, 0);
  // As scripts/gate.sh fails for an empty stage list.
  const failed = f.cli(['gate', 'premerge-check'], { fail: 'premerge-check' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, new RegExp(`premerge-check failed on ${head}; nothing recorded`));
  assert.deepEqual(f.records().filter(name => name.endsWith('.premerge-check')), []);
  assert.match(refused(f, ['finish', 'CAP-002']), /CAP-002 completes the queue: no passed premerge-check covers/);
  // As scripts/gate.sh reports the single word none.
  const na = f.cli(['gate', 'premerge-check'], { na: 'premerge-check' });
  assert.equal(na.status, 0, na.stderr);
  assert.equal(na.stdout, `make premerge-check\npremerge-check is not applicable (its stage list is none) on ${head}; recorded.\n`);
  assert.deepEqual(f.record(head, 'premerge-check'), { gate: 'premerge-check', result: 'not-applicable', tooling: false, stages: [] });
  assert.equal(f.cli(['gate', 'premerge-check']).stdout, `premerge-check is not applicable, recorded on ${head}; no runtime file changed since: reused.\n`);
  assert.equal(f.cli(['finish', 'CAP-002']).status, 0);
  assert.equal(f.cli(['next']).stdout, '');
});
scenario('the task gate cannot be declared not applicable: a runtime change is always tested', t => {
  const f = fixture(t);
  const head = f.implement();
  const na = f.cli(['gate'], { na: 'task-check' });
  assert.equal(na.status, 1);
  assert.match(na.stderr, /task-check cannot be not applicable: give TASK_STAGES its stages in the Makefile; nothing recorded/);
  assert.deepEqual(f.records(), []);
  assert.match(refused(f, ['finish', 'CAP-001']), new RegExp(`No passed task-check covers ${head}`));
});
scenario('the gate records of the helper before this one, plain text, still cover', t => {
  const f = fixture(t);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  // A change to the tooling: the old task gate ran the tooling tests, and its record says so.
  const head = f.work('CAP-001', { 'src/identity.js': 'export const id = 1;\n', Makefile: 'check:\n\ttrue\n' });
  for (const text of ['not a record\n', '{"gate":"task-check","result":"failed","tooling":true}\n', '"passed"\n', '']) {
    f.forge(head, 'task-check', text);
    assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed task-check covers/, `a file that records no pass covers nothing: ${text}`);
  }
  f.forge(head, 'task-check', '2026-10-02T10:00:00.000Z 12s\n');
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]) + '\nDelivered.\n');
  f.commit('completion notes');
  assert.equal(f.cli(['gate']).stdout, `task-check passed on ${head}; no runtime file changed since: reused.\n`);
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
  // The old full gate repeated the task stages: its record covers a runtime change as a task gate does.
  assert.equal(f.cli(['claim', 'CAP-002']).status, 0);
  const last = f.work('CAP-002');
  f.forge(last, 'pr-check', '2026-10-02T11:00:00.000Z 185s\n');
  f.forge(last, 'premerge-check', '2026-10-02T11:05:00.000Z 40s\n');
  assert.equal(f.cli(['gate', 'pr-check']).stdout, `pr-check passed on ${last}; no runtime file changed since: reused.\n`);
  assert.equal(f.cli(['finish', 'CAP-002']).status, 0);
  assert.deepEqual(f.makes(), [], 'no gate ran: the old records were honoured');
});
scenario('a tooling change under a task-check that did not run the tooling tests is refused by finish and by integrate', t => {
  const record = JSON.stringify({ gate: 'task-check', at: '2026-10-03T10:00:00.000Z', seconds: 4, result: 'passed', tooling: false, stages: [] });
  const tooling = { 'src/identity.js': 'export const id = 1;\n', Makefile: 'check:\n\ttrue\n' };
  const lacks = /The task-check that covers [a-f0-9]{40} did not run the agent tooling tests, and this branch changes the agent tooling\. Run: node scripts\/agent-local\.mjs gate/;
  const f = fixture(t);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  const head = f.work('CAP-001', tooling);
  f.forge(head, 'task-check', `${record}\n`);
  assert.match(refused(f, ['finish', 'CAP-001']), lacks);
  // The gate is not reused either: it runs with the tooling tests.
  assert.equal(f.cli(['gate']).status, 0);
  assert.deepEqual(f.makes(), ['make agent-check', 'make task-check']);
  assert.equal(f.record(head, 'task-check').tooling, true);
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);

  const g = fixture(t, { list: round });
  assert.equal(g.cli(['claim', 'CAP-001']).status, 0);
  g.forge(g.work('CAP-001', tooling), 'task-check', `${record}\n`);
  g.git('switch', '--quiet', 'main');
  assert.match(refused(g, ['integrate', 'CAP-001']), lacks);
  assert.match(refused(g, ['integrate', 'CAP-001']), /^FAIL: CAP-001: The task-check/);
});

scenario('a round of three runtime tasks is integrated under one combined gate, in one step, and the checkout returns', t => {
  const f = fixture(t, { list: round });
  assert.equal(f.cli(['claim', ...three]).status, 0);
  // Each task in a worktree of its own, from the same revision.
  const heads = three.map(id => {
    const tree = f.worktree(id), head = tree.work(id);
    assert.equal(tree.cli(['gate']).status, 0);
    return head;
  });
  assert.deepEqual(f.makes(), ['make task-check', 'make task-check', 'make task-check']);
  const moves = () => f.git('reflog', 'show', '--format=%gs', 'milestone1').split('\n').length;
  const before = moves(), start = f.git('rev-parse', 'milestone1');
  const done = f.cli(['integrate', ...three]);
  assert.equal(done.status, 0, done.stderr);
  const acc = /^CAP-001, CAP-002, CAP-003 are on milestone1 at ([a-f0-9]{40})\. One combined task-check passed on it\. Nothing was pushed\.$/m.exec(done.stdout)?.[1];
  assert.ok(acc, done.stdout);
  assert.deepEqual(f.makes(), ['make task-check', 'make task-check', 'make task-check', 'make task-check'], 'three gates of the tasks and one combined gate');
  assert.deepEqual(f.madeAt(), [...heads, acc], 'the combined gate ran on the assembled commit');
  assert.ok(!/moved/.test(done.stdout + done.stderr), 'no task was sent back to merge and gate again');
  assert.equal(f.git('rev-parse', 'milestone1'), acc);
  assert.equal(moves(), before + 1, 'the integration branch advanced once');
  assert.equal(f.git('rev-parse', 'milestone1@{1}'), start);
  for (const head of heads) assert.equal(f.git('merge-base', head, 'milestone1'), head, 'every task is in the integration branch');
  assert.deepEqual(three.map(id => f.git('show', `milestone1:src/${round.find(task => task.id === id).slug}.js`)), ['export const id = 1;', 'export const id = 1;', 'export const id = 1;']);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-004: Acceptance\n', 'the three tasks are done');
  assert.deepEqual([f.git('rev-parse', '--abbrev-ref', 'HEAD'), f.git('status', '--porcelain')], ['main', ''], 'the checkout is back on its branch, clean');
  assert.deepEqual(f.record(acc, 'task-check'), { gate: 'task-check', result: 'passed', tooling: false, stages: [{ name: 'unit', result: 'passed', seconds: 3 }] });
  // The log of the round, and what `timings` makes of it.
  assert.deepEqual(f.events().map(e => e.event === 'gate' ? `gate ${e.gate} ${e.task} ${e.combined ? 'combined' : 'own'}` : e.event === 'claim' ? `claim ${e.task}` : `integrate ${e.tasks.join(' ')} ${e.sha === acc}`),
    ['claim CAP-001', 'claim CAP-002', 'claim CAP-003', 'gate task-check CAP-001 own', 'gate task-check CAP-002 own', 'gate task-check CAP-003 own', 'gate task-check null combined', 'integrate CAP-001 CAP-002 CAP-003 true']);
  const timings = f.cli(['timings']);
  assert.equal(timings.status, 0, timings.stderr);
  for (const id of three) assert.match(timings.stdout, new RegExp(`^${id}: \\d+:\\d\\d from claim to integration; implementation \\d+:\\d\\d; task gates 1, \\d+:\\d\\d; review and completion \\d+:\\d\\d$`, 'm'));
  assert.match(timings.stdout, /^CAP-004: nothing recorded\nCombined round gates: 1, \d+:\d\d\nFull gate \(pr-check\): not run\nResilience gate \(premerge-check\): not run\nGitHub publication: none\n$/m);
});
scenario('a round needs no combined gate where a recorded gate covers the assembled state: one task, or one runtime task among documentation', t => {
  const f = fixture(t, { list: round });
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  const head = f.work('CAP-001');
  assert.equal(f.cli(['gate']).status, 0);
  f.git('switch', '--quiet', 'main');
  assert.equal(f.cli(['integrate', 'CAP-001']).stdout, `CAP-001 is on milestone1 at ${head}. A recorded task-check covers the assembled runtime state: no combined gate was needed. Nothing was pushed.\n`);
  assert.equal(f.git('rev-parse', 'milestone1'), head, 'a single task is a fast-forward');
  // One runtime task and one documentation task: the runtime task's own gate covers the merge.
  assert.equal(f.cli(['claim', 'CAP-002', 'CAP-003']).status, 0);
  f.work('CAP-002');
  assert.equal(f.cli(['gate']).status, 0);
  f.work('CAP-003', { 'docs/product/search.md': '# Search\n' });
  f.git('switch', '--quiet', 'main');
  const done = f.cli(['integrate', 'CAP-003', 'CAP-002']);
  assert.match(done.stdout, /^CAP-002, CAP-003 are on milestone1 at [a-f0-9]{40}\. A recorded task-check covers the assembled runtime state: no combined gate was needed\. Nothing was pushed\.\n$/);
  assert.deepEqual(f.makes(), ['make task-check', 'make task-check'], 'the gates of the two runtime tasks, and no combined one');
  assert.deepEqual(f.git('show', '--format=%s', '--no-patch', 'milestone1'), 'Merge task/cap-003 into milestone1');
  assert.equal(f.git('show', 'milestone1:docs/product/search.md'), '# Search');
  assert.equal(f.cli(['next']).stdout, 'READY CAP-004: Acceptance\n');
  assert.deepEqual([f.git('rev-parse', '--abbrev-ref', 'HEAD'), f.git('status', '--porcelain')], ['main', '']);
});
scenario('a round of documentation tasks needs no gate at all', t => {
  const f = fixture(t, { list: round });
  assert.equal(f.cli(['claim', 'CAP-001', 'CAP-002']).status, 0);
  for (const id of ['CAP-001', 'CAP-002']) f.work(id, {});
  f.git('switch', '--quiet', 'main');
  assert.match(f.cli(['integrate', 'CAP-001', 'CAP-002']).stdout, /^CAP-001, CAP-002 are on milestone1 at [a-f0-9]{40}\. No runtime file changed: no gate was needed\. Nothing was pushed\.\n$/);
  assert.deepEqual(f.makes(), []);
});
scenario('a round that changes the agent tooling runs agent-check before its combined gate', t => {
  const f = gatedRound(t, { 'CAP-001': { Makefile: 'check:\n\ttrue\n' } });
  assert.deepEqual(f.makes(), ['make agent-check', 'make task-check', 'make task-check', 'make task-check']);
  const failed = refused(f, ['integrate', ...three], { fail: 'agent-check' });
  assert.match(failed, /agent-check failed on [a-f0-9]{40}; nothing recorded\. Nothing was moved/);
  assert.deepEqual(f.makes().slice(4), ['make agent-check']);
  const done = f.cli(['integrate', ...three]);
  assert.equal(done.status, 0, done.stderr);
  const acc = f.git('rev-parse', 'milestone1');
  assert.deepEqual(f.makes().slice(5), ['make agent-check', 'make task-check']);
  assert.deepEqual(f.madeAt().slice(5), [acc, acc]);
  assert.equal(f.record(acc, 'task-check').tooling, true);
});
scenario('round integration refuses a real conflict, names the task and the files, and says how to continue', t => {
  const f = gatedRound(t, { 'CAP-001': { 'src/shared.js': 'export const owner = "identity";\n' }, 'CAP-002': { 'src/shared.js': 'export const owner = "freshness";\n' } });
  const conflict = refused(f, ['integrate', ...three]);
  assert.equal(conflict, 'FAIL: CAP-002 conflicts with the tasks of the round merged before it, in src/shared.js. Nothing was moved. '
    + 'Integrate the others (node scripts/agent-local.mjs integrate CAP-001 CAP-003), then merge milestone1 into task/cap-002, gate, and node scripts/agent-local.mjs finish CAP-002\n');
  assert.equal(f.makes().length, 3, 'no gate for a round that does not merge');
  // The way the refusal names.
  assert.equal(f.cli(['integrate', 'CAP-001', 'CAP-003']).status, 0);
  f.git('switch', '--quiet', 'task/cap-002');
  assert.notEqual(spawnSync('git', ['merge', '--no-edit', 'milestone1'], { cwd: f.dir }).status, 0, 'the same conflict, now in the task\'s branch');
  f.write('src/shared.js', 'export const owner = "identity and freshness";\n');
  f.commit('merge milestone1');
  assert.equal(f.cli(['gate']).status, 0);
  assert.equal(f.cli(['finish', 'CAP-002']).status, 0);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-004: Acceptance\n');
});
scenario('round integration notes a file that two tasks changed and that merged cleanly', t => {
  const lines = change => Array.from({ length: 12 }, (_, i) => `export const v${i} = ${change[i] ?? i};\n`).join('');
  const f = gatedRound(t, { 'CAP-001': { 'src/shared.js': lines({ 0: '"identity"' }) }, 'CAP-002': { 'src/shared.js': lines({ 11: '"freshness"' }) } }, { files: { 'src/shared.js': lines({}) } });
  const done = f.cli(['integrate', ...three]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^NOTE: changed by more than one task and merged without a conflict: src\/shared\.js\. Read the result\.$/m);
  assert.match(done.stdout, /^CAP-001, CAP-002, CAP-003 are on milestone1 at [a-f0-9]{40}\. One combined task-check passed on it\./m);
  assert.equal(f.git('show', 'milestone1:src/shared.js'), lines({ 0: '"identity"', 11: '"freshness"' }).trim(), 'both changes are in the result');
  assert.equal(f.makes().length, 4);
});
scenario('round integration refuses a failed combined gate, moves nothing and returns the checkout', t => {
  const f = gatedRound(t);
  const failed = refused(f, ['integrate', ...three], { fail: 'task-check' });
  assert.match(failed, /^FAIL: task-check failed on [a-f0-9]{40}; nothing recorded\. Nothing was moved: finish the tasks one at a time \(node scripts\/agent-local\.mjs finish <ID>, from each branch\) to find the one that breaks the others\n$/);
  assert.equal(f.makes().length, 4);
  assert.ok(!three.map(id => f.git('rev-parse', `task/${id.toLowerCase()}`)).includes(f.madeAt()[3]) && f.madeAt()[3] !== f.git('rev-parse', 'main'), 'the gate ran on the assembled commit');
  assert.equal(f.cli(['next']).stdout.split('\n')[0], 'CLAIMED CAP-001: task/cap-001');
  // The same from a detached checkout: it returns to its commit.
  f.git('checkout', '--quiet', '--detach', 'main');
  refused(f, ['integrate', ...three], { fail: 'task-check' });
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'still detached');
  // And a gate that passes there integrates, and returns the same way.
  const main = f.git('rev-parse', 'main');
  assert.equal(f.cli(['integrate', ...three]).status, 0);
  assert.deepEqual([f.git('rev-parse', '--abbrev-ref', 'HEAD'), f.git('rev-parse', 'HEAD'), f.git('status', '--porcelain')], ['HEAD', main, '']);
});
scenario('an interrupted combined gate fails the round, moves nothing and still returns the checkout', async t => {
  const f = gatedRound(t);
  const before = f.snapshot();
  const child = spawn(process.execPath, [path.join(f.dir, 'scripts/agent-local.mjs'), 'integrate', ...three], { env: f.env({ hang: 'task-check' }) });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.on('close', resolve));
  for (let waited = 0; f.makes().length < 4; waited += 50) {
    assert.ok(waited < 20000, 'the combined gate never started');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  // To the helper alone, as a supervisor stops it: it passes the signal on to make.
  child.kill('SIGTERM');
  assert.equal(await closed, 1);
  assert.match(stderr, /task-check was interrupted \(SIGTERM\) on [a-f0-9]{40}; nothing recorded\. Nothing was moved/);
  assert.deepEqual(f.snapshot(), before);
});
scenario('a checkout that cannot return after the combined gate says how to recover it', t => {
  const f = gatedRound(t);
  const stuck = f.cli(['integrate', ...three], { lock: 'task-check' });
  fs.rmSync(path.join(f.dir, '.git/index.lock'));
  assert.equal(stuck.status, 1);
  assert.match(stuck.stderr, /^WARN: this checkout is still on the assembled commit: it could not return to main\. Run: git checkout main$/m);
  assert.match(stuck.stdout, /CAP-001, CAP-002, CAP-003 are on milestone1 at/, 'the gate passed: the round stands');
  f.git('checkout', '--quiet', 'main');
  assert.equal(f.git('status', '--porcelain'), '');
});
scenario('the combined gate never overwrites an ignored file of the checkout it borrows', t => {
  const f = fixture(t, { list: round, files: { '.gitignore': 'bin/\nlocal.cfg\n' } });
  assert.equal(f.cli(['claim', ...three]).status, 0);
  // The first task commits a file under a name the project ignores.
  f.git('switch', '--quiet', 'task/cap-001');
  f.write('local.cfg', 'committed by the task\n');
  f.git('add', '--force', 'local.cfg');
  for (const id of three) { f.work(id); assert.equal(f.cli(['gate']).status, 0); }
  f.git('switch', '--quiet', 'main');
  // The owner's own file of that name in the checkout that runs the round: ignored, so the tree is clean.
  f.write('local.cfg', 'the owner\'s own\n');
  assert.equal(f.git('status', '--porcelain'), '');
  const kept = refused(f, ['integrate', ...three]);
  assert.match(kept, /^FAIL: The assembled commit [a-f0-9]{40} could not be checked out here \(error: The following untracked working tree files would be overwritten by checkout: local\.cfg\)\. Nothing was moved: clear the way, or finish the tasks one at a time/);
  assert.equal(fs.readFileSync(path.join(f.dir, 'local.cfg'), 'utf8'), 'the owner\'s own\n');
  assert.equal(f.makes().length, 3, 'the combined gate did not run');
});
scenario('round integration refuses a task without a covering gate', t => {
  const f = gatedRound(t);
  f.git('switch', '--quiet', 'task/cap-003');
  f.write('src/search.js', 'export const id = 2;\n');
  const fixed = f.commit('fix after the gate');
  f.git('switch', '--quiet', 'main');
  assert.equal(refused(f, ['integrate', ...three]), `FAIL: CAP-003: No passed task-check covers ${fixed}. Run: node scripts/agent-local.mjs gate\n`);
});
scenario('round integration refuses a task whose branch does not start from the current integration branch', t => {
  const f = gatedRound(t);
  f.git('switch', '--quiet', 'task/cap-001');
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
  f.git('switch', '--quiet', 'main');
  assert.equal(refused(f, ['integrate', 'CAP-002', 'CAP-003']), `FAIL: CAP-002: task/cap-002 does not start from milestone1 at ${f.git('rev-parse', 'milestone1')}: merge it and gate again, or finish it on its own\n`);
});
scenario('round integration refuses a task whose completed plan is missing or unreviewed', t => {
  const f = fixture(t, { list: round });
  assert.equal(f.cli(['claim', ...three]).status, 0);
  for (const id of ['CAP-001', 'CAP-002']) { f.work(id); assert.equal(f.cli(['gate']).status, 0); }
  f.git('switch', '--quiet', 'task/cap-003');
  f.write('src/search.js', 'export const id = 1;\n');
  f.commit('CAP-003 without its plan');
  assert.equal(f.cli(['gate']).status, 0);
  f.git('switch', '--quiet', 'main');
  assert.equal(refused(f, ['integrate', ...three]), 'FAIL: CAP-003: Move the plan to docs/plans/completed/CAP-003-search.md first\n');
  f.git('switch', '--quiet', 'task/cap-003');
  f.move('docs/plans/planned/CAP-003-search.md', 'docs/plans/completed/CAP-003-search.md');
  f.write('docs/plans/completed/CAP-003-search.md', plan(round[2]).replace('## Review\n\nText.', '## Review\n\nPending.'));
  f.commit('a plan without its review');
  f.git('switch', '--quiet', 'main');
  assert.equal(refused(f, ['integrate', ...three]), 'FAIL: The assembled round fails the structure check: CAP-003 missing completion Review. Nothing was moved\n');
  assert.equal(f.makes().length, 3, 'no combined gate for a round that fails the structure check');
});
scenario('round integration refuses a dirty worktree that has a branch of the round checked out, and a dirty checkout of its own', t => {
  const f = gatedRound(t);
  const tree = f.worktree('CAP-002');
  tree.write('src/freshness.js', 'export const id = 2;\n');
  assert.equal(refused(f, ['integrate', ...three]), `FAIL: CAP-002: Commit your work first: task/cap-002 has uncommitted changes in ${tree.dir}\n`);
  assert.equal(fs.readFileSync(path.join(tree.dir, 'src/freshness.js'), 'utf8'), 'export const id = 2;\n', 'the uncommitted work is still there');
  tree.git('checkout', '--quiet', '--', 'src/freshness.js');
  f.write('notes.txt', 'mine\n');
  assert.match(refused(f, ['integrate', ...three]), /Commit your work first: a round is integrated from a clean checkout/);
  fs.rmSync(path.join(f.dir, 'notes.txt'));
  assert.equal(f.cli(['integrate', ...three]).status, 0);
  assert.equal(tree.git('rev-parse', '--abbrev-ref', 'HEAD'), 'task/cap-002', 'the worktree of a task is never touched');
});
scenario('round integration refuses a round that would complete the queue, a task that is not claimed, and a checked-out integration branch', t => {
  const f = gatedRound(t);
  assert.match(refused(f, ['integrate', 'CAP-001', 'CAP-004']), /^FAIL: CAP-004: not claimed \(WAIT\); a round integrates claimed tasks\n$/);
  assert.match(refused(f, ['integrate', 'CAP-001', 'CAP-099']), /Unknown task CAP-099/);
  assert.match(refused(f, ['integrate', 'CAP-001', 'CAP-001']), /Usage: node scripts\/agent-local\.mjs/);
  assert.match(refused(f, ['integrate']), /Usage: node scripts\/agent-local\.mjs/);
  f.git('worktree', 'add', '--quiet', path.join(f.dir, 'bin/other'), 'milestone1');
  assert.match(refused(f, ['integrate', ...three]), /milestone1 is checked out in a worktree; switch that worktree to another branch/);
  f.git('worktree', 'remove', path.join(f.dir, 'bin/other'));
  assert.equal(f.cli(['integrate', ...three]).status, 0);
  assert.match(refused(f, ['integrate', 'CAP-001']), /^FAIL: CAP-001: not claimed \(DONE\)/);
  // The last task: a round never finishes the queue, finish does, under the full gates.
  assert.equal(f.cli(['claim', 'CAP-004']).status, 0);
  const last = f.work('CAP-004', {});
  f.git('switch', '--quiet', 'main');
  assert.equal(refused(f, ['integrate', 'CAP-004']), 'FAIL: This round completes the queue: the last task is finished on its own, with the full gates. Integrate the others, then: node scripts/agent-local.mjs finish <ID>\n');
  f.git('switch', '--quiet', 'task/cap-004');
  assert.equal(refused(f, ['finish', 'CAP-004']), `FAIL: CAP-004 completes the queue: no passed pr-check covers ${last}. Run: node scripts/agent-local.mjs gate pr-check\n`);
});
scenario('whether a round completes the queue is decided by the manifest it assembles, not by the one of the checkout', t => {
  const f = gatedRound(t);
  // The third task drops the task that was to follow the round: its plan and its entry in the manifest.
  f.git('switch', '--quiet', 'task/cap-003');
  f.write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', tasks: round.slice(0, 3) }));
  f.git('rm', '--quiet', 'docs/plans/planned/CAP-004-acceptance.md');
  f.commit('CAP-004 is not needed');
  f.git('switch', '--quiet', 'main');
  assert.match(f.cli(['next']).stdout, /^WAIT CAP-004: needs CAP-001, CAP-002, CAP-003$/m, 'the checkout still lists a fourth task');
  assert.equal(refused(f, ['integrate', ...three]), 'FAIL: This round completes the queue: the last task is finished on its own, with the full gates. Integrate the others, then: node scripts/agent-local.mjs finish <ID>\n');
  // Without the task that ends the queue, the round is integrated.
  assert.equal(f.cli(['integrate', 'CAP-001', 'CAP-002']).status, 0);
});
scenario('a Git without merge-tree --write-tree fails the round and points at finish', t => {
  const f = gatedRound(t);
  const git = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  f.write('bin/old/git', `#!/bin/sh\nif [ "$1" = merge-tree ]; then echo "usage: git merge-tree <base-tree> <branch1> <branch2>" >&2; exit 129; fi\nexec "${git}" "$@"\n`, 0o755);
  const old = refused(f, ['integrate', ...three], { env: { PATH: `${path.join(f.dir, 'bin/old')}${path.delimiter}${process.env.PATH}` } });
  assert.match(old, /^FAIL: git merge-tree could not merge task\/cap-002 \(usage: git merge-tree <base-tree> <branch1> <branch2>\)\. It needs Git 2\.38 or newer; this is git version .*\. Integrate the tasks one at a time: node scripts\/agent-local\.mjs finish <ID>, from each branch\n$/);
});
scenario('serial delivery is unchanged: claim, gate and finish one task, then the next, and finish refuses when the integration branch moved', t => {
  const f = fixture(t, { list: round });
  for (const id of ['CAP-001', 'CAP-002']) {
    assert.equal(f.cli(['claim', id]).status, 0);
    const head = f.work(id);
    assert.match(f.cli(['gate']).stdout, new RegExp(`^make task-check\\ntask-check passed on ${head} in \\d+:\\d\\d; recorded\\.\\n$`));
    assert.equal(f.cli(['finish', id]).stdout, `${id} is on milestone1 at ${head}. Nothing was pushed.\n`);
    assert.equal(f.git('rev-parse', 'milestone1'), head);
  }
  assert.deepEqual(f.makes(), ['make task-check', 'make task-check']);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-003: Search\nWAIT CAP-004: needs CAP-003\n');
  // Two tasks claimed from one revision and finished one after the other: the second merges first.
  const g = gatedRound(t);
  g.git('switch', '--quiet', 'task/cap-001');
  assert.equal(g.cli(['finish', 'CAP-001']).status, 0);
  g.git('switch', '--quiet', 'task/cap-002');
  assert.match(refused(g, ['finish', 'CAP-002']), /^FAIL: milestone1 moved: merge it into task\/cap-002, then gate again\n$/);
  g.git('merge', '--quiet', '--no-edit', 'milestone1');
  assert.match(g.cli(['finish', 'CAP-002']).stderr, /No passed task-check covers/);
  assert.equal(g.cli(['gate']).status, 0);
  assert.equal(g.cli(['finish', 'CAP-002']).status, 0);
});

for (const base of ['main', 'trunk']) {
  scenario(`the base branch ${base}: base prints it, start creates and moves the integration branch from it, and the last task must contain it`, t => {
    const f = fixture(t, { base, branch: false });
    assert.equal(f.cli(['base']).stdout, `${base}\n`);
    assert.match(f.cli(['next']).stderr, /^FAIL: The integration branch milestone1 does not exist; create it: node scripts\/agent-local\.mjs start\n$/);
    const first = f.git('rev-parse', base);
    assert.equal(f.cli(['start']).stdout, `Created milestone1 from ${base} at ${first}.\n`);
    assert.equal(f.git('rev-parse', 'milestone1'), first);
    assert.equal(f.cli(['start']).stdout, `milestone1 is at ${base} (${first}): nothing to do.\n`);
    // Planning went on: the unclaimed integration branch follows the base branch.
    f.write('docs/product/vision.md', '# Vision\n');
    const second = f.commit('more planning');
    assert.equal(f.cli(['start']).stdout, `Moved milestone1 forward to ${base} at ${second}.\n`);
    assert.equal(f.git('rev-parse', 'milestone1'), second);
    // The base branch moves again; the integration branch no longer follows it.
    f.write('docs/product/vision.md', '# Vision\n\nMore.\n');
    f.commit('the base branch moves');
    f.git('worktree', 'add', '--quiet', path.join(f.dir, 'bin/other'), 'milestone1');
    assert.match(refused(f, ['start']), /^FAIL: milestone1 is checked out in a worktree; switch that worktree to another branch\n$/);
    f.git('worktree', 'remove', path.join(f.dir, 'bin/other'));
    assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
    assert.match(refused(f, ['start']), /^FAIL: milestone1 stays where it is: CAP-001 is claimed from it\n$/);
    f.work('CAP-001');
    assert.equal(f.cli(['gate']).status, 0);
    assert.equal(f.cli(['finish', 'CAP-001']).status, 0, 'a task that leaves the queue open needs no base branch');
    f.git('switch', '--quiet', base);
    assert.match(refused(f, ['start']), new RegExp(`^FAIL: milestone1 stays where it is: it holds work that ${base} lacks\\n$`));
    // The task that completes the queue is accepted on what the base branch will hold.
    assert.equal(f.cli(['claim', 'CAP-002']).status, 0);
    f.work('CAP-002', {});
    assert.equal(refused(f, ['finish', 'CAP-002']), `FAIL: ${base} has commits this branch lacks: merge it, so that the owner accepts what ${base} will hold\n`);
    f.git('merge', '--quiet', '--no-edit', base);
    assert.match(f.cli(['finish', 'CAP-002']).stderr, /CAP-002 completes the queue: no passed pr-check covers/, 'the base branch first, then the gates on what it brought');
    for (const gate of ['pr-check', 'premerge-check']) assert.equal(f.cli(['gate', gate]).status, 0);
    assert.deepEqual(f.makes(), ['make task-check', 'make pr-check', 'make premerge-check'], 'the merge brought documentation: the first task gate still covers');
    assert.equal(f.cli(['finish', 'CAP-002']).status, 0);
    assert.equal(f.git('merge-base', base, 'milestone1'), f.git('rev-parse', base), 'the integration branch contains the base branch');
  });
}
scenario('start refuses a base branch that does not exist', t => {
  const f = fixture(t, { base: 'trunk', branch: false });
  f.git('branch', '--move', 'trunk', 'main');
  assert.equal(f.cli(['base']).stdout, 'trunk\n');
  assert.match(f.cli(['start']).stderr, /^FAIL: The base branch trunk does not exist in this repository; name the project's base branch as base_branch in backlog\.json\n$/);
  assert.equal(f.git('branch', '--list', 'milestone1'), '');
});

scenario('without a GitHub repository nothing is deferred: --no-publish changes no sentence and leaves no marker', t => {
  const f = fixture(t);
  assert.equal(f.cli(['claim', 'CAP-001', '--no-publish']).stdout, 'Claimed CAP-001 on task/cap-001 (from milestone1). Work there: git switch task/cap-001\nNothing was pushed.\n');
  const head = f.work('CAP-001', {});
  assert.equal(f.cli(['finish', 'CAP-001', '--no-publish']).stdout, `CAP-001 is on milestone1 at ${head}. Nothing was pushed.\n`);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-002: Freshness\n');
  assert.equal(f.cli(['publish']).stdout, 'backlog.json names no repository: nothing to publish.\n');
});
scenario('timings reads the log: the phases, the gate runs with their agent-check, the stages of the last full gate, and nothing of an earlier milestone', t => {
  const f = fixture(t, { list: round });
  const at = minute => new Date(Date.UTC(2026, 9, 3, 10, minute)).toISOString();
  const gate = (name, task, minute, seconds, result, more = {}) => ({ event: 'gate', gate: name, task, sha: 'a'.repeat(40), at: at(minute), seconds, result, combined: false, stages: [], ...more });
  const log = [
    // Another milestone's lines, before the first claim of a task of this manifest.
    { event: 'publish', mode: 'full', at: at(-600), seconds: 9, push: 'pushed', sync: 'ok' },
    gate('pr-check', null, -500, 400, 'passed'),
    { event: 'claim', task: 'CAP-001', at: at(0) },
    { event: 'claim', task: 'CAP-002', at: at(0) },
    { event: 'publish', mode: 'targeted', at: at(0), seconds: 1.4, push: 'pushed', sync: 'ok' },
    gate('task-check', 'CAP-002', 20, 30, 'passed'),
    // A tooling task: a failed agent-check, a failed task-check after a passed one, then a run that passed.
    gate('agent-check', 'CAP-001', 30, 50, 'failed'),
    gate('agent-check', 'CAP-001', 40, 50, 'passed'),
    gate('task-check', 'CAP-001', 41, 20, 'failed'),
    gate('agent-check', 'CAP-001', 75, 60, 'passed'),
    gate('task-check', 'CAP-001', 76, 30, 'passed'),
    gate('task-check', null, 90, 45, 'passed', { combined: true }),
    { event: 'integrate', tasks: ['CAP-001', 'CAP-002'], sha: 'b'.repeat(40), at: at(91) },
    { event: 'publish', mode: 'targeted', at: at(91), seconds: 2.2, push: 'failed', sync: 'ok' },
    { event: 'claim', task: 'CAP-003', at: at(95) },
    gate('pr-check', 'CAP-004', 100, 200, 'failed', { stages: [{ name: 'bootstrap', result: 'passed', seconds: 65 }, { name: 'e2e', result: 'failed', seconds: 135 }, { name: 'contracts', result: 'not run', seconds: 0 }] }),
    gate('premerge-check', 'CAP-004', 110, 0, 'not-applicable'),
  ];
  fs.writeFileSync(path.join(f.dir, '.git/agent-timings.jsonl'), `${log.map(event => JSON.stringify(event)).join('\n')}\ncut off {"event":\n`);
  assert.equal(f.cli(['timings']).stdout, [
    'CAP-001: 1:31:00 from claim to integration; implementation 1:15:00; task gates 3 (2 failed), 3:30; review and completion 14:30',
    'CAP-002: 1:31:00 from claim to integration; implementation 20:00; task gates 1, 0:30; review and completion 1:10:30',
    'CAP-003: claimed 2026-10-03T11:35:00.000Z, not integrated',
    'CAP-004: nothing recorded',
    'Combined round gates: 1, 0:45',
    'Full gate (pr-check): 1 (1 failed), 3:20; last failed: bootstrap 1:05, e2e failed, contracts not run',
    'Resilience gate (premerge-check): 1, 0:00; last not applicable',
    'GitHub publication: 2 (1 pushed, 1 failed), 0:04',
    '',
  ].join('\n'));
});
scenario('a timing log that is missing, read-only or no file never fails a command', t => {
  const missing = fixture(t);
  assert.equal(missing.cli(['timings']).stdout, 'CAP-001: nothing recorded\nCAP-002: nothing recorded\nCombined round gates: none\nFull gate (pr-check): not run\nResilience gate (premerge-check): not run\nGitHub publication: none\n');
  for (const spoil of [log => fs.mkdirSync(log), log => { fs.writeFileSync(log, 'not JSON\n{"event":"gate"}\nnull\n'); fs.chmodSync(log, 0o444); }]) {
    const f = fixture(t);
    spoil(path.join(f.dir, '.git/agent-timings.jsonl'));
    f.implement();
    assert.equal(f.cli(['gate'], 'fail').status, 1);
    assert.equal(f.cli(['gate']).status, 0);
    assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
    const timings = f.cli(['timings']);
    assert.equal(timings.status, 0, timings.stderr);
    assert.match(timings.stdout, /^CAP-001: /);
    assert.equal(f.cli(['next']).stdout, 'READY CAP-002: Freshness\n');
  }
});

if (isMainThread) {
  describe('scripts/agent-local.mjs', { concurrency: os.availableParallelism() }, () => {
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
