import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { needsGate, toolingChange } from './agent-scope.mjs';

// The real scripts/gate.sh with a fake make: a stage named fail-<n> exits <n>,
// slow sleeps a second, hang sleeps until killed, report-env prints the
// GATE_REPORT it was given; every stage is logged.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(root, 'scripts/gate.sh');
const fakeMake = `#!/bin/sh
echo "$1" >> "$GATE_LOG"
case "$1" in
  fail-*) echo "stage output of $1"; exit "\${1#fail-}" ;;
  slow) sleep 1 ;;
  hang) sleep 60 ;;
  report-env) echo "GATE_REPORT=\${GATE_REPORT-unset}" ;;
esac
`;
// GATE_REPORT is always the fixture's own: these tests also run inside a gate
// (`make agent-check` under scripts/agent-local.mjs), whose report they must not write.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'make'), fakeMake, { mode: 0o755 });
  const env = { ...process.env, GATE_MAKE: path.join(dir, 'make'), GATE_LOG: path.join(dir, 'log'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'), GATE_REPORT: path.join(dir, 'report.json') };
  const ran = () => fs.existsSync(env.GATE_LOG) ? fs.readFileSync(env.GATE_LOG, 'utf8').trim().split('\n') : [];
  const summary = () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  // The JSON report without its measured seconds, which are whole numbers.
  const json = () => {
    const text = fs.readFileSync(env.GATE_REPORT, 'utf8');
    assert.match(text, /^\{.*\}\n$/, 'one object on one line');
    const { seconds, stages, ...rest } = JSON.parse(text);
    for (const timed of [{ seconds }, ...stages]) assert.ok(Number.isInteger(timed.seconds) && timed.seconds >= 0, text);
    return { ...rest, stages: stages.map(({ seconds, ...stage }) => stage) };
  };
  return { dir, env, ran, summary, json, run: (...stages) => spawnSync(gate, ['demo-gate', ...stages], { encoding: 'utf8', env }) };
}
// The report rows after the "durations" heading: [stage, result, duration].
const report = stdout => stdout.split('== demo-gate: durations\n')[1].trim().split('\n').map(line => line.trim().split(/\s{2,}|\s(?=\d+:\d\d$|-$)/));

test('a passing gate runs every stage in order and reports each duration', t => {
  const f = fixture(t);
  const result = f.run('lint', 'slow', 'verify');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.ran(), ['lint', 'slow', 'verify']);
  const rows = report(result.stdout);
  assert.deepEqual(rows.map(r => r.slice(0, 2)), [['lint', 'passed'], ['slow', 'passed'], ['verify', 'passed'], ['demo-gate', 'passed']]);
  assert.match(rows[0][2], /^0:0[01]$/);
  assert.match(rows[1][2], /^0:0[12]$/, 'the measured second of the slow stage');
  assert.match(rows[3][2], /^0:0[1-3]$/, 'the total');
  assert.match(f.summary(), /### demo-gate: passed in 0:0[1-3]\n\n\| Stage \| Result \| Duration \|\n\| --- \| --- \| --- \|\n\| `lint` \| passed \| 0:0[01] \|\n\| `slow` \| passed \| 0:0[12] \|/);
  assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'passed', stages: [{ name: 'lint', result: 'passed' }, { name: 'slow', result: 'passed' }, { name: 'verify', result: 'passed' }] });
  const measured = JSON.parse(fs.readFileSync(f.env.GATE_REPORT, 'utf8'));
  assert.deepEqual(Object.keys(measured), ['gate', 'result', 'seconds', 'stages']);
  assert.deepEqual(Object.keys(measured.stages[1]), ['name', 'result', 'seconds']);
  assert.ok(measured.stages[1].seconds >= 1 && measured.seconds >= 1, 'the measured second of the slow stage, in seconds');
});
test('the first failing stage stops the gate, decides its exit status and is still timed', t => {
  const f = fixture(t);
  const result = f.run('lint', 'fail-7', 'verify', 'release-build');
  assert.equal(result.status, 7);
  assert.deepEqual(f.ran(), ['lint', 'fail-7'], 'no stage runs after the failure');
  assert.match(result.stdout, /stage output of fail-7/);
  assert.deepEqual(report(result.stdout).map(r => r.slice(0, 2)), [['lint', 'passed'], ['fail-7', 'FAILED'], ['verify', 'not run'], ['release-build', 'not run'], ['demo-gate', 'FAILED']]);
  assert.match(report(result.stdout)[1][2], /^0:0[01]$/);
  assert.match(f.summary(), /### demo-gate: FAILED in[\s\S]*\| `fail-7` \| FAILED \| 0:0[01] \|\n\| `verify` \| not run \| - \|/);
  assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'failed', stages: [{ name: 'lint', result: 'passed' }, { name: 'fail-7', result: 'failed' }, { name: 'verify', result: 'not run' }, { name: 'release-build', result: 'not run' }] });
});
test('an interrupted gate reports the stage it was in and fails', async t => {
  const f = fixture(t);
  // Its own process group, as a cancelled CI step: the signal reaches the stage too.
  const child = spawn(gate, ['demo-gate', 'lint', 'hang', 'verify'], { env: f.env, detached: true });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  while (!f.ran().includes('hang')) await new Promise(resolve => setTimeout(resolve, 50));
  process.kill(-child.pid, 'SIGTERM');
  const status = await new Promise(resolve => child.on('close', code => resolve(code)));
  assert.equal(status, 143);
  assert.deepEqual(f.ran(), ['lint', 'hang']);
  assert.deepEqual(report(stdout).map(r => r.slice(0, 2)), [['lint', 'passed'], ['hang', 'FAILED'], ['verify', 'not run'], ['demo-gate', 'FAILED']]);
  assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'failed', stages: [{ name: 'lint', result: 'passed' }, { name: 'hang', result: 'failed' }, { name: 'verify', result: 'not run' }] });
});
test('a gate without stages fails and says how to decide: name stages or declare none', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /gate\.sh: demo-gate has no stages: name its make targets in the Makefile, or declare the gate not applicable with the single word `none`/);
  assert.deepEqual(f.ran(), []);
  assert.deepEqual(report(result.stdout).map(r => r.slice(0, 2)), [['demo-gate', 'FAILED']]);
  assert.match(f.summary(), /### demo-gate: FAILED in/);
  assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'failed', stages: [] });
});
test('the single word none declares a gate not applicable: nothing runs, it is reported as n/a and exits 0', t => {
  const f = fixture(t);
  const result = f.run('none');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.ran(), [], 'none is not a stage: make is not called');
  assert.match(result.stdout, /^== demo-gate: not applicable \(its stage list is `none`\)$/m);
  assert.deepEqual(report(result.stdout), [['demo-gate', 'n/a', '-']]);
  assert.equal(f.summary(), '### demo-gate: n/a\n\nNot applicable: its stage list is `none`.\n\n');
  assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'not-applicable', stages: [] });
});
test('none beside other stages is an error, wherever it stands', t => {
  for (const stages of [['none', 'lint'], ['lint', 'none'], ['none', 'none']]) {
    const f = fixture(t);
    const result = f.run(...stages);
    assert.equal(result.status, 2, stages.join(' '));
    assert.match(result.stdout, /gate\.sh: demo-gate mixes `none` with stages: `none` stands alone/);
    assert.deepEqual(f.ran(), [], 'no stage runs');
    assert.deepEqual(report(result.stdout).map(r => r.slice(0, 2)), [['demo-gate', 'FAILED']]);
    assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'failed', stages: [] });
  }
});
test('a name that is not a make target is rejected before anything runs, and the report stays valid JSON', t => {
  for (const name of ['bad"name', 'two words', 'path/target', 'back\\slash', 'zażółć', '']) {
    const f = fixture(t);
    const result = f.run('lint', name);
    assert.equal(result.status, 2, name);
    assert.ok(result.stdout.includes(`gate.sh: demo-gate: "${name}" is not a stage`), result.stdout);
    assert.deepEqual(f.ran(), []);
    assert.deepEqual(f.json(), { gate: 'demo-gate', result: 'failed', stages: [] });
  }
  const f = fixture(t);
  for (const args of [[], ['bad"gate', 'lint']]) {
    const result = spawnSync(gate, args, { encoding: 'utf8', env: f.env });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /^Usage: gate\.sh <gate name> <make target>\.\.\./);
  }
  assert.deepEqual(f.ran(), []);
  assert.ok(!fs.existsSync(f.env.GATE_REPORT), 'no report under a name that would break it');
  assert.equal(f.run('unit.test_2-b').status, 0, 'letters, digits, ".", "_" and "-" are a name');
});
test('the JSON report is the gate\'s own and optional: a stage does not inherit it, and an unwritable file changes no verdict', t => {
  const f = fixture(t);
  assert.match(f.run('report-env').stdout, /^GATE_REPORT=unset$/m);
  assert.equal(f.json().gate, 'demo-gate');
  const run = (GATE_REPORT, ...stages) => spawnSync(gate, ['demo-gate', ...stages], { encoding: 'utf8', env: { ...f.env, GATE_REPORT } });
  const missing = path.join(f.dir, 'missing/report.json');
  assert.equal(run(missing, 'lint').status, 0);
  assert.equal(run(missing, 'fail-7').status, 7);
  assert.equal(run(missing, 'none').status, 0);
  fs.rmSync(f.env.GATE_REPORT);
  assert.equal(run('', 'lint').status, 0);
  assert.ok(!fs.existsSync(f.env.GATE_REPORT), 'no report without GATE_REPORT');
});


// The gates as the real Makefile defines them: `make -n` runs gate.sh (its
// recipe line names $(MAKE)), and each stage prints its recipe without running
// it. A stage list given on the command line replaces the Makefile's, so that
// these hold in a project whose tasks have filled the lists. The make that runs
// these tests (`make agent-check`) hands down neither its flags nor its level,
// and the gates write to no summary or report of the run they are part of.
const { MAKEFLAGS, MFLAGS, MAKELEVEL, ...outside } = process.env;
const makeEnv = { ...outside, GITHUB_STEP_SUMMARY: '', GATE_REPORT: '' };
function dryRun(target, ...variables) {
  const result = spawnSync('make', ['-n', target, ...variables], { cwd: root, encoding: 'utf8', env: makeEnv });
  return { ...result, stages: [...result.stdout.matchAll(new RegExp(`^== ${target}: stage (\\S+)$`, 'gm'))].map(m => m[1]) };
}
test('the gate of every task keeps lint, the structure check and the tests, and leaves the tooling tests out', () => {
  const task = dryRun('task-check');
  assert.equal(task.status, 0, task.stderr);
  for (const stage of ['lint', 'structure-check', 'test']) assert.ok(task.stages.includes(stage), `task-check: ${stage}`);
  assert.ok(!task.stages.includes('agent-check'), 'agent-check is not a task stage');
  assert.ok(!/node --test .*scripts\/gate\.test\.mjs/.test(task.stdout), 'no stage of the task gate runs the tooling tests');
});
test('the full gate and the resilience gate run their own stages only: no task stage is repeated', () => {
  const task = dryRun('task-check').stages;
  for (const [gate, list] of [['pr-check', 'MILESTONE_STAGES'], ['premerge-check', 'RESILIENCE_STAGES']]) {
    const own = dryRun(gate, `${list}=help`);
    assert.equal(own.status, 0, own.stderr);
    assert.deepEqual(own.stages, ['help'], `${gate} runs $(${list}) and nothing else`);
    // The lists as the Makefile has them, whatever a project put there.
    for (const stage of dryRun(gate).stages) assert.ok(!task.includes(stage), `${gate} repeats the task stage ${stage}`);
  }
});
test('every gate of the Makefile fails on an empty stage list and is not applicable on none', () => {
  for (const [gate, list] of [['task-check', 'TASK_STAGES'], ['pr-check', 'MILESTONE_STAGES'], ['premerge-check', 'RESILIENCE_STAGES']]) {
    const empty = dryRun(gate, `${list}=`);
    assert.equal(empty.status, 2, `${gate} without stages`);
    assert.match(empty.stdout, new RegExp(`gate\\.sh: ${gate} has no stages: .* the single word \`none\``));
    const none = dryRun(gate, `${list}=none`);
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, new RegExp(`^${gate} +n/a +-$`, 'm'));
    assert.equal(dryRun(gate, `${list}=none help`).status, 2, `${gate}: none beside a stage`);
  }
});
test('agent-check is the structure check and every tooling test of scripts/', () => {
  const structure = dryRun('structure-check');
  assert.equal(structure.stdout, 'node scripts/agent-workflow.mjs check\n');
  const agent = dryRun('agent-check');
  assert.equal(agent.status, 0, agent.stderr);
  assert.ok(agent.stdout.startsWith(structure.stdout), 'the structure check comes first');
  const run = agent.stdout.split('\n').find(line => line.startsWith('node --test ')).split(' ');
  const tests = fs.readdirSync(path.join(root, 'scripts')).filter(file => file.endsWith('.test.mjs')).map(file => `scripts/${file}`);
  assert.ok(tests.includes('scripts/gate.test.mjs'));
  for (const file of tests) assert.ok(run.includes(file), `agent-check does not run ${file}`);
  for (const file of run.filter(word => word.endsWith('.mjs'))) assert.ok(fs.existsSync(path.join(root, file)), `agent-check names ${file}, which does not exist`);
});
test('make help lists the structure check beside the gates', () => {
  const help = spawnSync('make', ['help'], { cwd: root, encoding: 'utf8', env: makeEnv });
  assert.equal(help.status, 0, help.stderr);
  for (const target of ['structure-check', 'agent-check', 'lint', 'test', 'task-check', 'pr-check', 'premerge-check']) assert.match(help.stdout, new RegExp(`^  make ${target} +\\S`, 'm'));
});


// scripts/agent-scope.mjs: what needs a gate, and what needs the tooling tests with it.
const toolingFiles = ['scripts/gate.sh', 'scripts/gate.test.mjs', 'scripts/check-docs.test.mjs', 'tests/integration/check-docs.sh', 'Makefile', '.github/workflows/agent-workflow.yml',
  ...fs.readdirSync(path.join(root, 'scripts')).filter(file => /^agent-.*\.mjs$/.test(file)).map(file => `scripts/${file}`)];
test('a change outside the documentation set needs a gate', () => {
  assert.equal(needsGate([]), false);
  assert.equal(needsGate(['docs/agents/workflow.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', '.github/pull_request_template.md']), false);
  for (const file of ['src/app.js', 'Makefile', 'scripts/gate.sh', '.github/workflows/ci.yml', '.github/actions/setup/action.yml', 'src/README.md', 'package.json']) {
    assert.equal(needsGate(['docs/product/vision.md', file]), true, file);
  }
});
test('a change to the agent tooling is named as one, and every tooling file is a runtime file', () => {
  for (const file of ['scripts/agent-local.mjs', 'scripts/agent-scope.mjs', 'scripts/agent-workflow.test.mjs', 'scripts/agent-issues.fake-gh.mjs']) assert.ok(toolingFiles.includes(file), `${file} is part of the scaffold`);
  for (const file of toolingFiles) {
    assert.equal(toolingChange([file]), true, file);
    assert.equal(toolingChange(['docs/agents/workflow.md', 'src/app.js', file]), true, `${file} among other files`);
    assert.equal(needsGate([file]), true, `${file} is a runtime file`);
  }
  assert.equal(toolingChange([]), false);
  // Runtime or documentation, but not the tooling: the task gate alone proves these.
  for (const file of ['src/app.js', 'scripts/deploy.sh', 'scripts/agent-notes.md', 'scripts/tools/agent-x.mjs', 'src/scripts/agent-local.mjs', 'src/Makefile', 'tests/integration/api.sh',
    '.github/workflows/ci.yml', '.github/pull_request_template.md', 'docs/agents/workflow.md', 'AGENTS.md']) {
    assert.equal(toolingChange([file]), false, file);
  }
});
