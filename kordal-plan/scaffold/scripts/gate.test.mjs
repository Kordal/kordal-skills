import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real scripts/gate.sh with a fake make: a stage named fail-<n> exits <n>,
// slow sleeps a second, hang sleeps until killed; every stage is logged.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(root, 'scripts/gate.sh');
const fakeMake = `#!/bin/sh
echo "$1" >> "$GATE_LOG"
case "$1" in
  fail-*) echo "stage output of $1"; exit "\${1#fail-}" ;;
  slow) sleep 1 ;;
  hang) sleep 60 ;;
esac
`;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'make'), fakeMake, { mode: 0o755 });
  const env = { ...process.env, GATE_MAKE: path.join(dir, 'make'), GATE_LOG: path.join(dir, 'log'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') };
  const ran = () => fs.existsSync(env.GATE_LOG) ? fs.readFileSync(env.GATE_LOG, 'utf8').trim().split('\n') : [];
  const summary = () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  return { env, ran, summary, run: (...stages) => spawnSync(gate, ['demo-gate', ...stages], { encoding: 'utf8', env }) };
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
});
test('a gate without stages fails', t => {
  assert.equal(fixture(t).run().status, 2);
});


// The gates as the real Makefile defines them: `make -n` runs gate.sh (its
// recipe line names $(MAKE)), and each stage prints its recipe without running it.
function dryRun(target) {
  const result = spawnSync('make', ['-n', target], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(result.status, 0, result.stderr);
  return [...result.stdout.matchAll(new RegExp(`^== ${target}: stage (\\S+)$`, 'gm'))].map(m => m[1]);
}
test('the gate of every task keeps lint, the agent structure check and the tests', () => {
  const stages = dryRun('pr-check');
  for (const stage of ['lint', 'agent-check', 'test']) assert.ok(stages.includes(stage), stage);
});
