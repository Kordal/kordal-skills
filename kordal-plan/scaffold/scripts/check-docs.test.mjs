import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real tests/integration/check-docs.sh in a Git repository of its own.
const script = fileURLToPath(new URL('../tests/integration/check-docs.sh', import.meta.url));
function fixture(t, files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  write('tests/integration/check-docs.sh', fs.readFileSync(script, 'utf8'));
  for (const [file, text] of Object.entries(files)) write(file, text);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: dir }).status, 0);
  return spawnSync('bash', [path.join(dir, 'tests/integration/check-docs.sh')], { encoding: 'utf8' });
}

test('links to existing files and headings pass: titles, encoded and non-ASCII paths, repeated headings', t => {
  const result = fixture(t, {
    'README.md': '[a](docs/guide.md "The guide") [b](docs/my%20file.md) [c](docs/zażółć.md#setup-1) [d](#top) [e](https://example.com/x.md)\n\n# Top\n',
    'docs/guide.md': '# Guide\n', 'docs/my file.md': '# File\n', 'docs/zażółć.md': '# Setup\n\n## Setup\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  4 relative links in 4 Markdown files/);
});
test('a missing file, a missing heading and an ignored file fail, also behind a title', t => {
  const result = fixture(t, {
    'README.md': '[a](docs/missing.md "t") [b](docs/guide.md#nowhere) [c](secret.md)\n',
    'docs/guide.md': '# Guide\n', 'secret.md': '# Secret\n', '.gitignore': 'secret.md\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/missing\.md does not exist/);
  assert.match(result.stderr, /no heading "#nowhere" in docs\/guide\.md/);
  assert.match(result.stderr, /secret\.md is ignored by Git/);
  assert.match(result.stderr, /3 documentation check\(s\) failed/);
});
test('a link inside a code block or code span is not a link', t => {
  const result = fixture(t, { 'README.md': '`[a](missing.md)`\n\n```\n[b](missing.md)\n```\n' });
  assert.equal(result.status, 0, result.stderr);
});
