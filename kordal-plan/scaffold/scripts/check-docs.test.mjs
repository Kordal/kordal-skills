import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The real tests/integration/check-docs.sh in a Git repository of its own.
const script = fileURLToPath(new URL('../tests/integration/check-docs.sh', import.meta.url));
function fixture(t, files, prepare = () => {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  write('tests/integration/check-docs.sh', fs.readFileSync(script, 'utf8'));
  for (const [file, text] of Object.entries(files)) write(file, text);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: dir }).status, 0);
  prepare(dir);
  return spawnSync('bash', [path.join(dir, 'tests/integration/check-docs.sh')], { encoding: 'utf8' });
}
const md = (...lines) => `${lines.join('\n')}\n`;
// Exactly these failures, in any order: a link that must stay unscanned would add one.
function fails(result, ...patterns) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const pattern of patterns) assert.match(result.stderr, pattern);
  assert.match(result.stderr, new RegExp(`\\n${patterns.length} documentation check\\(s\\) failed`));
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
test('a tracked file deleted from the working tree is not read, and a link to it fails', t => {
  const result = fixture(t, { 'README.md': '[a](docs/gone.md)\n', 'docs/gone.md': '# Gone\n' }, dir => {
    assert.equal(spawnSync('git', ['add', '--all'], { cwd: dir }).status, 0);
    fs.rmSync(path.join(dir, 'docs/gone.md'));
  });
  fails(result, /README\.md: link to docs\/gone\.md: docs\/gone\.md does not exist/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test('a fenced block is not scanned: tildes, an info string, a longer fence around a shorter one, in a list item and a quote, unclosed', t => {
  const result = fixture(t, {
    'README.md': md(
      '~~~', '[a](missing.md)', '~~~', '',
      '```sh title="x"', '[b](missing.md)', '```', '',
      '~~~ `text` with backticks', '[c](missing.md)', '~~~', '',
      '````markdown', '```', '[d](missing.md)', '```', '[e](missing.md)', '````', '',
      '~~~~', '~~~', '[f](missing.md)', '~~~~', '',
      // Neither a fence with an info string nor the other character closes a block.
      '```', '``` sh', '[g](missing.md)', '~~~', '[h](missing.md)', '```', '',
      '1. A step:', '', '    ```sh', '    [i](missing.md)', '    ```', '',
      '- ```', '  [j](missing.md)', '  ```', '',
      '> ```', '> [k](missing.md)', '> ```', '',
      '   ~~~', '   [l](missing.md)', '   ~~~', '',
      '[real](docs/guide.md)',
    ),
    'docs/guide.md': md('# Guide', '', '```', '[m](missing.md)'),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  1 relative links in 2 Markdown files/);
});
test('a fence closes on its own character, at least as long, and what follows it is scanned again', t => {
  fails(fixture(t, {
    'README.md': md(
      '```', '~~~', '```', '[a](after-backticks.md)', '',
      '~~~~', '~~~', '[x](inside.md)', '~~~~', '[b](after-tildes.md)', '',
      '````', '```', '[y](inside.md)', '````', '[c](after-long.md)', '',
      // Backticks in the info string: a code span, which opens no block.
      '```one``` [d](after-span.md)',
    ),
  }), /after-backticks\.md does not exist/, /after-tildes\.md does not exist/, /after-long\.md does not exist/, /after-span\.md does not exist/);
});
test('a heading inside a fenced block or a comment is no anchor; a heading with a code span is', t => {
  fails(fixture(t, {
    'README.md': '[a](docs/guide.md#guide) [b](docs/guide.md#in-tildes) [c](docs/guide.md#in-backticks) [d](docs/guide.md#in-a-comment) [e](docs/guide.md#the-make-lint-ax-target)\n',
    'docs/guide.md': md('# Guide', '', '~~~', '# In tildes', '~~~', '', '```sh', '# In backticks', '```', '', '<!--', '# In a comment', '-->', '', '## The `make lint a[x]` target'),
  }), /no heading "#in-tildes" in docs\/guide\.md/, /no heading "#in-backticks" in docs\/guide\.md/, /no heading "#in-a-comment" in docs\/guide\.md/);
});

test('a code span of any number of backticks is not scanned, also wrapped onto the next line', t => {
  const result = fixture(t, {
    'README.md': md(
      '``[a](missing.md)`` and `` `[b](missing.md)` `` and ```[c](missing.md)```.',
      'A span that wraps: `[d](missing.md)',
      'and ends here` [e](docs/guide.md).',
      'A lone `` is no span: [f](docs/guide.md) and [`code` in the text](docs/guide.md#guide).', '',
      '- In a list item: `[g](missing.md)', '  and ends here`.', '',
      '> In a quote: `[h](missing.md)', '> and ends here`.',
    ),
    'docs/guide.md': '# Guide\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  3 relative links in 2 Markdown files/);
});
test('a code span ends at its own run of backticks, and a stray backtick hides nothing beyond its block', t => {
  fails(fixture(t, {
    'README.md': md(
      '``a ` b ``` c`` [a](after-double.md)',
      '`one` [b](between.md) `two`',
      '\\` [c](escaped.md) \\`', '',
      '- a stray ` in one item', '- [d](next-item.md) and `code`', '',
      '| a stray ` in one row |', '| [e](next-row.md) and `code` |', '',
      'A stray ` before a heading', '## A [f](heading.md) with `code`', '',
      'A stray ` before a fenced block', '```', 'code ` here', '```', '[g](after-block.md) and `code`', '',
      'A stray ` in a paragraph', '',
      '[h](next-paragraph.md) and `code`',
    ),
  }), /after-double\.md does not exist/, /between\.md does not exist/, /escaped\.md does not exist/, /next-item\.md does not exist/, /next-row\.md does not exist/,
  /heading\.md does not exist/, /after-block\.md does not exist/, /next-paragraph\.md does not exist/);
});
test('CRLF line endings read the same', t => {
  const result = fixture(t, {
    'README.md': ['`[a](missing.md)', 'wrapped', 'twice` [b](docs/guide.md#guide)', '~~~', '[c](missing.md)', '~~~', '[text][ref]', '', '[ref]: docs/guide.md', ''].join('\r\n'),
    'docs/guide.md': '# Guide\r\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  2 relative links in 2 Markdown files/);
});

test('an HTML comment is not scanned: on a line, behind a checkbox, in a sentence, over several lines', t => {
  const result = fixture(t, {
    'README.md': md(
      '<!-- [a](missing.md) -->',
      '- [ ] <!-- [b](missing.md) -->',
      'Text <!-- [c](missing.md) --> and [d](docs/guide.md).',
      'A comment joins nothing: [i]<!-- c -->(missing.md).',
      '<!--', '[e](missing.md)', '```', '[f][undefined] and a stray `', '[g]: missing.md', '-->',
      '[h](docs/guide.md)',
    ),
    'docs/guide.md': '# Guide\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  2 relative links in 2 Markdown files/);
});
test('what a comment or code holds opens nothing: the text after it is scanned', t => {
  fails(fixture(t, {
    'README.md': md(
      '<!--', '```', '-->', '[a](after-comment.md)', '',
      '```html', '<!--', '```', '[b](after-block.md)', '',
      '`<!--` [c](after-span.md)', '',
      '<!--> [e](after-empty-comment.md)', '',
      // The placeholder of docs/plans/template.md.
      '<!-- A Mermaid flowchart (a ```mermaid block) of the journey. -->', '[d](after-placeholder.md)',
    ),
  }), /after-comment\.md does not exist/, /after-block\.md does not exist/, /after-span\.md does not exist/, /after-empty-comment\.md does not exist/, /after-placeholder\.md does not exist/);
});

test('reference definitions with existing targets pass: titles, angle brackets, an anchor, indented, quoted, any case', t => {
  const result = fixture(t, {
    'README.md': md(
      '[guide]: docs/guide.md',
      '[titled]: docs/guide.md "The guide"',
      '[single]: docs/guide.md \'The guide\'',
      '[paren]: docs/guide.md (The guide)',
      '[angle]: <docs/my file.md>',
      '[both]: <docs/guide.md#guide> "The guide"',
      '[self]: #top',
      '[encoded]: docs/my%20file.md',
      '[external]: https://example.com/missing.md',
      '   [Mixed  Case]: docs/guide.md',
      '> [quoted]: docs/guide.md', '',
      '# Top', '',
      '[text][guide], [titled][], [text][MIXED case], ![image][angle], [text][quoted], [text][external] and',
      '[a text that', 'wraps][both].',
    ),
    'docs/guide.md': '# Guide\n', 'docs/my file.md': '# File\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  10 relative links in 3 Markdown files/);
});
test('a reference definition fails like an inline link: a missing file, a missing heading, an ignored file, with a title and in angle brackets', t => {
  fails(fixture(t, {
    'README.md': md('[a]: docs/missing.md', '[b]: docs/guide.md#nowhere "t"', '[c]: <secret.md>', '[d]: <docs/not here.md> \'title\''),
    'docs/guide.md': '# Guide\n', 'secret.md': '# Secret\n', '.gitignore': 'secret.md\n',
  }), /README\.md: link to docs\/missing\.md: docs\/missing\.md does not exist/, /no heading "#nowhere" in docs\/guide\.md/, /secret\.md is ignored by Git/, /docs\/not here\.md does not exist/);
});
test('a reference to a label with no definition in the file fails: full, collapsed, image, wrapped', t => {
  fails(fixture(t, {
    'README.md': md('[text][nope], [Gone][] and ![image][lost]. [A text that', 'wraps][wrapped].', '[text][defined] and [elsewhere][] are fine here.', '', '[defined]: docs/guide.md', '[elsewhere]: docs/guide.md'),
    // A definition in another file defines nothing here.
    'docs/guide.md': md('# Guide', '', '[text][elsewhere]'),
  }), /README\.md: reference to \[nope\]: no definition "\[nope\]: <target>" in this file/, /README\.md: reference to \[Gone\]: no definition/, /README\.md: reference to \[lost\]: no definition/,
  /README\.md: reference to \[wrapped\]: no definition/, /docs\/guide\.md: reference to \[elsewhere\]: no definition/);
});
test('what only looks like a reference is not flagged: a shortcut, a task-list checkbox, a footnote, an escape, code', t => {
  const result = fixture(t, {
    'README.md': md(
      'See [shortcut] and [another one].', '',
      '- [ ] an open task', '- [x] a done task', '- [ ] [shortcut] in a task', '- [ ] <!-- criterion -->', '',
      'A note[^1][^2], [^1][shortcut], [shortcut][^2], \\[a\\]\\[b\\], \\[a][b], `[c][d]`, [][] and [[wiki]].', '',
      '[^1]: Footnote.', '[^2]: Another.', '',
      // A label needs a character, and a definition one target.
      '[ ]: open', '', '[Note]: two words', '',
      '~~~', '[e][f]', '[g]: missing.md', '~~~', '',
      // Counts as defined; its target is not read.
      'A definition with its target on the next line: [text][late].', '', '[late]:', '  docs/guide.md',
    ),
    'docs/guide.md': '# Guide\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  0 relative links in 2 Markdown files/);
});
