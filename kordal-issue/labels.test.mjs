import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real labels.sh against a fake gh in a temporary directory: it logs the
// arguments of every call as one JSON line, answers `label list` with the
// names its state file holds, one per line as `--jq '.[].name'` prints them,
// and adds a created label to that file. Like gh it lists 30 labels unless
// --limit says otherwise. GH_FAIL names the subcommand ("list", or "create
// <name>") that fails as an unreachable GitHub does.
const here = path.dirname(fileURLToPath(import.meta.url));
const states = ['needs-review', 'needs-rework', 'needs-info', 'duplicate', 'already-implemented', 'ready-for-dev', 'in-development', 'needs-pr-review'];
const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), [noun, verb, name] = args, { GH_LOG, GH_LABELS, GH_FAIL } = process.env;
fs.appendFileSync(GH_LOG, JSON.stringify(args) + '\\n');
if (noun !== 'label' || !['list', 'create'].includes(verb)) { console.error('fake gh: unexpected ' + args.join(' ')); process.exit(2); }
if (GH_FAIL === verb || GH_FAIL === verb + ' ' + name) { console.error('error connecting to api.github.com'); process.exit(4); }
const labels = JSON.parse(fs.readFileSync(GH_LABELS, 'utf8'));
if (verb === 'list') {
  const at = args.indexOf('--limit'), shown = labels.slice(0, at < 0 ? 30 : Number(args[at + 1]));
  if (shown.length) console.log(shown.join('\\n'));
} else {
  if (labels.some(label => label.toLowerCase() === name.toLowerCase())) { console.error('label with name "' + name + '" already exists'); process.exit(1); }
  fs.writeFileSync(GH_LABELS, JSON.stringify([...labels, name]));
  console.log('https://github.com/owner/repo/labels/' + name);
}
`;

// A repository that has the given labels; run() runs labels.sh against it.
function fixture(t, labels) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'labels-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gh = path.join(dir, 'gh'), log = path.join(dir, 'log'), state = path.join(dir, 'labels.json');
  fs.writeFileSync(gh, fake, { mode: 0o755 });
  fs.writeFileSync(log, '');
  fs.writeFileSync(state, JSON.stringify(labels));
  const run = (extra = {}) => {
    const env = { ...process.env, GH: gh, GH_LOG: log, GH_LABELS: state, ...extra };
    for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
    return spawnSync('bash', [path.join(here, 'labels.sh')], { cwd: dir, encoding: 'utf8', env });
  };
  const calls = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  return {
    dir, run, calls, labels: () => JSON.parse(fs.readFileSync(state, 'utf8')),
    lists: () => calls().filter(args => args[1] === 'list'), creates: () => calls().filter(args => args[1] === 'create'),
  };
}
const created = names => names.map(name => `created  ${name}\n`).join('');

test('creates only the labels the repository lacks, each with a description', t => {
  const f = fixture(t, ['bug', 'needs-review', 'duplicate', 'enhancement']);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const missing = states.filter(name => !['needs-review', 'duplicate'].includes(name));
  assert.deepEqual(f.creates().map(args => args[2]), missing);
  for (const args of f.creates()) {
    assert.equal(args.length, 5, args.join(' '));
    assert.equal(args[3], '--description');
    assert.match(args[4], /\S/);
    assert.ok(args[4].length <= 100, `GitHub limits a description to 100 characters: ${args[4]}`);
  }
  assert.equal(result.stdout, created(missing));
  assert.deepEqual(f.labels(), ['bug', 'needs-review', 'duplicate', 'enhancement', ...missing]);
});

test('creates nothing when every state label exists', t => {
  const f = fixture(t, ['bug', ...states]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.creates(), []);
  assert.equal(f.calls().length, 1);
  assert.equal(result.stdout, 'labels   every state label exists\n');
  assert.deepEqual(f.labels(), ['bug', ...states]);
});

test('lists the labels once, whatever it has to create', t => {
  const f = fixture(t, []);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.lists().length, 1);
  assert.deepEqual(f.calls()[0].slice(0, 2), ['label', 'list']);
  assert.deepEqual(f.creates().map(args => args[2]), states);
  assert.equal(result.stdout, created(states));
  // A second run finds them all: one more list, no further create.
  assert.equal(f.run().status, 0);
  assert.equal(f.lists().length, 2);
  assert.equal(f.creates().length, states.length);
});

test('sees a state label beyond the 30 labels gh lists by default', t => {
  const f = fixture(t, [...Array.from({ length: 40 }, (_, i) => `area-${i}`), ...states]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.creates(), []);
});

test('takes a label that differs only in case as existing, as GitHub does', t => {
  const f = fixture(t, ['Duplicate', 'Needs-Review']);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.creates().map(args => args[2]), states.filter(name => !['needs-review', 'duplicate'].includes(name)));
});

test('fails and creates nothing when gh cannot list the labels', t => {
  const f = fixture(t, []);
  const result = f.run({ GH_FAIL: 'list' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /error connecting to api\.github\.com/);
  assert.match(result.stderr, /FAIL +gh label list failed/);
  assert.equal(result.stdout, '');
  assert.deepEqual(f.creates(), []);
});

test('fails at the first label gh cannot create and says which', t => {
  const f = fixture(t, []);
  const result = f.run({ GH_FAIL: 'create needs-info' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAIL +gh label create needs-info failed/);
  assert.equal(result.stdout, created(['needs-review', 'needs-rework']));
  assert.deepEqual(f.creates().map(args => args[2]), ['needs-review', 'needs-rework', 'needs-info']);
  assert.deepEqual(f.labels(), ['needs-review', 'needs-rework']);
});

test('calls the gh of the PATH when GH is not set', t => {
  const f = fixture(t, states.slice(1));
  const result = f.run({ GH: undefined, PATH: `${f.dir}${path.delimiter}${process.env.PATH}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, created(['needs-review']));
});
