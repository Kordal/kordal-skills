import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real scripts/agent-local.mjs in a real Git repository: two tasks, the
// second depending on the first, both planned on main and on the integration
// branch mvp1. `make` is a fake that passes or fails as GATE_RESULT says.
const sections = ['Goal', 'Context', 'Task Contract', 'Scope', 'Out of Scope', 'Affected Components', 'Acceptance Criteria', 'Flow', 'Implementation Steps', 'Tests', 'Risks', 'Evidence', 'Review', 'Completion Notes'];
const tasks = [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', depends_on: ['CAP-001'], adrs: [] },
];
const plan = task => `# ${task.id}: ${task.title}\n\nDependencies: ${task.depends_on.join(', ') || 'none'}\n\n`
  + sections.map(s => `## ${s}\n\n${s === 'Acceptance Criteria' ? '- [x] Works' : 'Text.'}\n`).join('\n');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-local-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text, { mode }); };
  const git = (...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  for (const script of ['agent-local.mjs', 'agent-workflow.mjs', 'agent-scope.mjs']) write(`scripts/${script}`, fs.readFileSync(fileURLToPath(new URL(`./${script}`, import.meta.url)), 'utf8'));
  write('docs/plans/backlog.json', JSON.stringify({ version: 1, mvp: 1, integration_branch: 'mvp1', tasks }));
  for (const task of tasks) write(`docs/plans/planned/${task.id}-${task.slug}.md`, plan(task));
  write('bin/make', '#!/bin/sh\necho "make $1"\n[ "$GATE_RESULT" = pass ]\n', 0o755);
  write('.gitignore', 'bin/\n');
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  const move = (from, to) => { fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true }); git('mv', from, to); };
  const commit = message => { git('add', '--all'); git('commit', '--quiet', '--message', message); return git('rev-parse', 'HEAD'); };
  commit('plans');
  git('branch', 'mvp1');
  const cli = (args, gate = 'pass') => spawnSync(process.execPath, [path.join(dir, 'scripts/agent-local.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, AGENT_MAKE: path.join(dir, 'bin/make'), GATE_RESULT: gate } });
  // The first task implemented on its branch: a runtime file and the completed plan.
  const implement = () => {
    assert.equal(cli(['claim', 'CAP-001']).status, 0);
    git('switch', '--quiet', 'task/cap-001');
    write('src/identity.js', 'export const id = 1;\n');
    move('docs/plans/planned/CAP-001-identity.md', 'docs/plans/completed/CAP-001-identity.md');
    return commit('CAP-001');
  };
  return { dir, write, git, move, commit, cli, implement };
}

test('next lists what is ready, and a claim is a branch that only one agent gets', t => {
  const f = fixture(t);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-001: Identity\nWAIT CAP-002: needs CAP-001\n');
  assert.match(f.cli(['claim', 'CAP-002']).stderr, /CAP-002 is not ready: WAIT \(needs CAP-001\)/);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  assert.equal(f.git('rev-parse', 'task/cap-001'), f.git('rev-parse', 'mvp1'));
  assert.match(f.cli(['next']).stdout, /^CLAIMED CAP-001: task\/cap-001$/m);
  assert.match(f.cli(['claim', 'CAP-001']).stderr, /CAP-001 is not ready: CLAIMED/);
  assert.match(f.cli(['claim', 'CAP-099']).stderr, /Unknown task CAP-099/);
});
test('finish puts a gated task on the integration branch and unblocks its dependants', t => {
  const f = fixture(t);
  const head = f.implement();
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed pr-check covers/);
  assert.equal(f.git('rev-parse', 'mvp1'), f.git('rev-parse', 'main'), 'nothing integrated without a gate');
  const failed = f.cli(['gate'], 'fail');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /pr-check failed/);
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed pr-check covers/, 'a failed gate records nothing');
  const passed = f.cli(['gate']);
  assert.match(passed.stdout, /make pr-check\n[\s\S]*pr-check passed on [a-f0-9]{40}; recorded\./);
  // Evidence recorded after the gate: documentation only.
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]) + '\nGate passed.\n');
  const final = f.commit('evidence');
  assert.notEqual(final, head);
  const finished = f.cli(['finish', 'CAP-001']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /CAP-001 is on mvp1 at [a-f0-9]{40}\. Nothing was pushed\./);
  assert.equal(f.git('rev-parse', 'mvp1'), final);
  assert.equal(f.cli(['next']).stdout, 'READY CAP-002: Freshness\n');
});
test('a runtime change after the gate needs the gate again', t => {
  const f = fixture(t);
  f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  f.write('src/identity.js', 'export const id = 2;\n');
  f.commit('fix');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed pr-check covers/);
  assert.equal(f.cli(['gate']).status, 0);
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
});
test('a documentation-only task needs no gate', t => {
  const f = fixture(t);
  assert.equal(f.cli(['claim', 'CAP-001']).status, 0);
  f.git('switch', '--quiet', 'task/cap-001');
  f.move('docs/plans/planned/CAP-001-identity.md', 'docs/plans/completed/CAP-001-identity.md');
  f.commit('CAP-001');
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
});
test('finish refuses an unfinished, foreign, dirty or outdated branch and a checked-out integration branch', t => {
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
  f.git('switch', '--quiet', 'mvp1');
  f.write('src/other.js', 'export const id = 1;\n');
  const moved = f.commit('other task');
  assert.match(f.cli(['gate', 'release-check']).stderr, /Unknown gate release-check/);
  f.git('switch', '--quiet', 'task/cap-001');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /mvp1 moved: merge it into task\/cap-001, then gate again/);
  f.git('merge', '--quiet', '--no-edit', 'mvp1');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /No passed pr-check covers/, 'the merge is a new commit after the gate');
  assert.equal(f.cli(['gate']).status, 0);
  f.git('worktree', 'add', '--quiet', path.join(f.dir, 'bin/other'), 'mvp1');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /mvp1 is checked out in a worktree/);
  assert.equal(f.git('rev-parse', 'mvp1'), moved);
  f.git('worktree', 'remove', path.join(f.dir, 'bin/other'));
  assert.equal(f.cli(['finish', 'CAP-001']).status, 0);
  assert.equal(f.git('rev-parse', 'mvp1'), f.git('rev-parse', 'task/cap-001'));
});
test('finish refuses a task whose review is not recorded', t => {
  const f = fixture(t);
  f.implement();
  assert.equal(f.cli(['gate']).status, 0);
  f.write('docs/plans/completed/CAP-001-identity.md', plan(tasks[0]).replace('## Review\n\nText.', '## Review\n\nPending.'));
  f.commit('evidence without a review');
  assert.match(f.cli(['finish', 'CAP-001']).stderr, /CAP-001 missing completion Review/);
  assert.equal(f.git('rev-parse', 'mvp1'), f.git('rev-parse', 'main'));
});
