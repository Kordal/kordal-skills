import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSummary, dependencyLayers, markdown } from './agent-summary.mjs';

// buildSummary on an in-memory backlog: one finished task and two unfinished
// ones, the second with a Flow, an ADR and a blocker.
const plan = (id, title, flow, goal = `Deliver ${title}.`) => `# ${id}: ${title}\n\n## Goal\n\n${goal}\n\n## Acceptance Criteria\n\n- [ ] Works\n- [x] Fails clearly\n\n## Flow\n\n${flow}\n\n## Scope\n\nText.\n`;
const flow = '```mermaid\nflowchart TD\n  A["Open"] --> B\n```';
const manifest = {
  version: 1, milestone: 2, integration_branch: 'milestone2', repository: 'owner/product',
  tasks: [
    { id: 'CAP-001', title: 'Bootstrap', slug: 'bootstrap', issue: 1, depends_on: [], adrs: [] },
    { id: 'CAP-002', title: 'Say "hello", the owner\'s way', slug: 'hello', issue: 2, depends_on: ['CAP-001'], adrs: [] },
    { id: 'CAP-003', title: 'Reminders', slug: 'reminders', issue: null, depends_on: ['CAP-002'], adrs: ['docs/adr/001-email.md'], external_blocker: 'SMTP credentials from the owner' },
  ],
};
const plans = {
  'CAP-002': plan('CAP-002', 'Say "hello", the owner\'s way', 'None: tooling only.'),
  'CAP-003': plan('CAP-003', 'Reminders', flow),
};
const input = () => ({ manifest, plans, scope: '# Milestone 2: Reminders\n\n## Outcome\n\nA freelancer sends a reminder.\n', adrs: [{ file: 'docs/adr/001-email.md', text: '# ADR-001: Email\n\n- **Status:** Proposed\n\n## Context\n\nText.\n' }], revision: 'abc1234', date: '2026-10-02' });
const esc = text => text.replace(/[&<>"']/g, c => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]);
const card = (html, id) => new RegExp(`<div class="card" id="${id}">[^]*?</details></div>`).exec(html)[0];

// What the generator may write: these elements with these attributes, every
// value in double quotes. Once its tags are taken out, what is left is text,
// and text without "<" and ">" opens neither an element nor an attribute.
// A link target is read as a browser reads it, by the URL parser.
const elements = {
  html: ['lang'], head: [], meta: ['charset', 'http-equiv', 'name', 'content'], title: [], style: [], body: [], nav: [], main: [], header: ['id'], section: ['id'],
  div: ['class', 'id'], p: ['class'], span: ['class'], a: ['class', 'href'], b: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: ['class', 'start'], li: [], input: ['type', 'disabled', 'checked'], details: [], summary: [], figure: ['class'], figcaption: [], pre: [], code: [],
  strong: [], em: [], blockquote: [], hr: [], table: [], thead: [], tbody: [], tr: [], th: [], td: [],
};
const protocol = href => { try { return new URL(href, 'https://base.example/docs/product/page.html').protocol; } catch { return 'no URL'; } };
function auditMarkup(markup, source = '') {
  const hrefs = [], open = [];
  const text = markup.replace(/<(\/?)([a-z][a-z0-9]*)((?: [a-z-]+(?:="[^"<>]*")?)*)>/g, (tag, closing, name, attributes) => {
    assert.ok(Object.hasOwn(elements, name), `an element the generator does not write: ${tag} ${source}`);
    for (const [, attribute, value] of attributes.matchAll(/ ([a-z-]+)(?:="([^"]*)")?/g)) {
      assert.ok(!closing && elements[name].includes(attribute), `an attribute the generator does not write: ${tag} ${source}`);
      if (attribute === 'id') assert.match(value, /^[A-Za-z0-9_-]+$/, tag);
      if (attribute === 'href') hrefs.push(decode(value));
    }
    if (closing) assert.equal(open.pop(), name, `tags close in the order they opened: ${tag} ${source}`);
    else if (!['meta', 'input', 'hr'].includes(name)) open.push(name);
    return '';
  });
  assert.deepEqual(open, [], `every element is closed ${source}`);
  assert.ok(!/[<>\u0000]/.test(text), `outside the generator's own tags every angle bracket is escaped: ${JSON.stringify(text)} ${source}`);
  for (const href of hrefs) {
    assert.ok(['http:', 'https:', 'mailto:', 'no URL'].includes(protocol(href)), `a link target of another scheme: ${JSON.stringify(href)} ${source}`);
    assert.ok(href && !/[\u0000-\u001f ]/.test(href), `a link target with a control character or a space: ${JSON.stringify(href)} ${source}`);
  }
  return { text, hrefs };
}
function audit(html) {
  assert.ok(html.startsWith('<!doctype html>\n'));
  return auditMarkup(html.slice('<!doctype html>\n'.length).replace(/<style>[^<]*<\/style>/, '<style></style>'));
}

test('the layers follow the dependency depth: a chain, a diamond, a finished dependency', () => {
  const task = (id, ...depends_on) => ({ id, title: `Title ${id}`, depends_on });
  const ids = layers => layers.map(layer => layer.map(entry => entry.id));
  assert.deepEqual(ids(dependencyLayers([task('A'), task('B', 'A'), task('C', 'B')])), [['A'], ['B'], ['C']]);
  assert.deepEqual(ids(dependencyLayers([task('D', 'B', 'C'), task('C', 'A'), task('B', 'A'), task('A'), task('E')])), [['A', 'E'], ['C', 'B'], ['D']], 'manifest order inside a layer; B and C can run in parallel');
  assert.deepEqual(dependencyLayers([task('B', 'A'), task('C', 'A', 'B')]), [
    [{ id: 'B', title: 'Title B', needs: [{ id: 'A', done: true }] }],
    [{ id: 'C', title: 'Title C', needs: [{ id: 'A', done: true }, { id: 'B', done: false }] }],
  ], 'a dependency that is not among the unfinished tasks is done and holds nothing back');
  assert.deepEqual(dependencyLayers([]), []);
  assert.throws(() => dependencyLayers([task('A', 'B'), task('B', 'A'), task('C')]), /Dependency cycle among A, B/);
});
test('the summary carries the scope, the unfinished tasks with their sections, and their ADRs', () => {
  const html = buildSummary(input());
  const { hrefs } = audit(html);
  assert.ok(html.includes('<title>Milestone 2: Reminders: implementation summary</title>'));
  assert.ok(html.includes('<header id="overview"><h1>Milestone 2: Reminders</h1><p>Implementation summary, generated 2026-10-02 from revision abc1234. '));
  for (const [value, name] of [[2, 'tasks to deliver'], [1, 'architecture decisions'], [1, 'blocked from outside'], ['milestone2', 'integration branch']]) assert.ok(html.includes(`<div class="stat"><b>${value}</b><span>${name}</span></div>`), name);
  assert.ok(html.includes('<section id="scope"><h2>Scope</h2><div class="card"><div class="md"><h2>Outcome</h2>\n<p>A freelancer sends a reminder.</p></div></div></section>'), 'the scope without its title line');
  assert.ok(!html.includes('id="CAP-001"'), 'a task without a planned or active plan is finished');

  const hello = card(html, 'CAP-002'), reminders = card(html, 'CAP-003');
  assert.ok(hello.includes('<span class="pill">CAP-002</span><h3>Say &quot;hello&quot;, the owner&#39;s way</h3><a class="pill plain" href="https://github.com/owner/product/issues/2">#2</a>'));
  assert.ok(hello.includes('<div class="meta"><span class="pill plain done">needs CAP-001 done</span></div><div class="md"><p>Deliver Say &quot;hello&quot;, the owner&#39;s way.</p></div>'), 'a finished dependency is text: it has no card to link to');
  assert.ok(hello.includes('<h4>Flow</h4><div class="md"><p>None: tooling only.</p></div>'));
  assert.ok(reminders.includes('<span class="pill">CAP-003</span><h3>Reminders</h3></div>'), 'no issue yet');
  assert.ok(reminders.includes('<div class="meta"><a class="pill plain" href="#CAP-002">needs CAP-002</a><a class="pill plain" href="#adr-001-email">ADR 001</a><span class="pill warn">Blocked: SMTP credentials from the owner</span></div><div class="md"><p>Deliver Reminders.</p></div>'));
  assert.ok(reminders.includes('<h4>Acceptance criteria</h4><div class="md"><ul><li><input type="checkbox" disabled> Works</li><li><input type="checkbox" disabled checked> Fails clearly</li></ul></div>'));
  assert.ok(reminders.includes('<details><summary>Scope, components, steps, tests and risks</summary><h4>Scope</h4><div class="md"><p>Text.</p></div><h4>Out of Scope</h4><p class="note">Not stated.</p><h4>Affected Components</h4>'), 'the folded sections need no script: <details>');
  for (const name of ['Implementation Steps', 'Tests', 'Risks']) assert.ok(reminders.includes(`<h4>${name}</h4>`), name);

  assert.ok(html.includes('<section><h2>Architecture decisions</h2><div class="card" id="adr-001-email"><div class="task-head"><h3>ADR-001: Email</h3><span class="pill warn">Proposed</span></div><div class="md"><ul><li><strong>Status:</strong> Proposed</li></ul>\n<h2>Context</h2>\n<p>Text.</p></div></div></section>'));
  assert.ok(html.includes('<nav><h2>Summary</h2><a href="#overview">Overview</a><a href="#scope">Scope</a><a href="#dependencies">Task dependencies</a><h2>Tasks</h2><a href="#CAP-002"><b>CAP-002</b>Say &quot;hello&quot;, the owner&#39;s way</a><a href="#CAP-003"><b>CAP-003</b>Reminders</a><h2>Decisions</h2><a href="#adr-001-email">ADR-001: Email</a></nav>'));
  for (const href of hrefs.filter(h => h.startsWith('#'))) assert.ok(html.includes(` id="${href.slice(1)}"`), `the page has the target of ${href}`);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /@media print \{ nav \{ display: none; \}/);
});
test('the dependency view shows the layers, what each task needs and what is done or blocked', () => {
  assert.ok(buildSummary(input()).includes('<section id="dependencies"><h2>Task dependencies</h2><div class="card"><ol class="layers">'
    + '<li><div class="layer-name"><b>Layer 1</b><span>can start now</span></div><ul><li><a class="pill" href="#CAP-002">CAP-002</a> Say &quot;hello&quot;, the owner&#39;s way<div class="needs">needs <span class="pill plain done">CAP-001 done</span></div></li></ul></li>'
    + '<li><div class="layer-name"><b>Layer 2</b><span>after layer 1</span></div><ul><li><a class="pill" href="#CAP-003">CAP-003</a> Reminders<div class="needs">needs <a class="pill plain" href="#CAP-002">CAP-002</a> <span class="pill warn">blocked from outside</span></div></li></ul></li></ol>'));
  const parallel = { ...manifest, tasks: [manifest.tasks[0], manifest.tasks[1], { ...manifest.tasks[2], depends_on: [] }] };
  const html = buildSummary({ ...input(), manifest: parallel });
  assert.ok(html.includes('<b>Layer 1</b><span>can start now, 2 tasks in parallel</span>'));
  assert.ok(html.includes('<div class="needs">no dependencies <span class="pill warn">blocked from outside</span></div>'));
  assert.ok(!html.includes('Layer 2'));
  assert.ok(buildSummary({ ...input(), plans: {} }).includes('<section id="dependencies"><h2>Task dependencies</h2><div class="card"><p class="note">No tasks yet.</p></div></section>'));
});
test('the page is complete as written: no script, nothing loaded, a restrictive policy', () => {
  const offline = buildSummary({ ...input(), manifest: { ...manifest, repository: null } });
  assert.doesNotMatch(offline, /<script/i);
  assert.doesNotMatch(offline, /https?:|\/\/|<link|<img|<iframe|<object|<embed|@import|url\(|\bsrc(?:set)?=/i, 'no address at all without a repository');
  assert.ok(offline.includes('<span class="pill plain">#2</span>'), 'without a repository the issue is text');
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`;
  assert.ok(offline.includes(policy) && offline.indexOf(policy) < offline.indexOf('<title>'), 'the policy precedes what it governs');
  const html = buildSummary(input());
  assert.deepEqual(audit(html).hrefs.filter(href => !href.startsWith('#')), ['https://github.com/owner/product/issues/2'], 'the only address is the link to an issue');
  assert.doesNotMatch(html.replace(/<a [^>]*>/g, ''), /https?:|<script/i, 'and it is a link, not something the page loads');
});
test('a Mermaid block is shown as labelled source and is never drawn', () => {
  const figure = '<figure class="source"><figcaption>Mermaid source: rendered in the Markdown file on GitHub</figcaption><pre><code>flowchart TD\n  A[&quot;Open&quot;] --&gt; B</code></pre></figure>';
  assert.equal(markdown(flow), figure);
  assert.equal(markdown(flow.replace('```mermaid', '~~~ Mermaid').replace(/```$/, '~~~')), figure);
  const html = buildSummary(input());
  assert.ok(card(html, 'CAP-003').includes(`<h4>Flow</h4><div class="md">${figure}</div>`));
  assert.ok(!/class="mermaid"|language-mermaid|mermaid\.|marked\.|jsdelivr/i.test(html), 'neither the libraries nor the classes they look for');
});
test('markup in the scope, a plan, the manifest or an ADR is shown as text and produces no element or attribute', () => {
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(2)>', '"><svg onload=alert(3)>', '\' onmouseover=\'alert(4)', '</title></style><script>alert(5)</script>', '<a href="javascript:alert(6)">x</a>', '<iframe src="data:text/html,x">'];
  const evil = payloads.join(' ');
  const hostile = {
    manifest: {
      version: 1, milestone: 2, integration_branch: evil, repository: `owner/product${evil}`,
      tasks: [
        { id: 'CAP-001', title: 'Bootstrap', slug: 'bootstrap', issue: 1, depends_on: [], adrs: [] },
        { id: `CAP-002${evil}`, title: evil, slug: 'hello', issue: `2${evil}`, depends_on: ['CAP-001', `CAP-009${evil}`], adrs: [`docs/adr/001-${evil}.md`, 'docs/adr/002-absent.md'], external_blocker: evil },
        { id: 'CAP-003', title: 'Reminders', slug: 'reminders', issue: 3, depends_on: [`CAP-002${evil}`], adrs: [] },
      ],
    },
    plans: {
      [`CAP-002${evil}`]: plan('CAP-002', 'x', `\`\`\`mermaid ${evil}\nflowchart TD\n  A["${evil}"] --> B\n\`\`\``, `${evil}\n\n- [ ] ${evil}\n\n| ${evil} |\n| --- |\n| ${evil} |\n\n> ${evil}\n\n### ${evil}\n\n**${evil}** \`${evil}\` [${evil}](https://example.com/${evil})`),
      'CAP-003': plan('CAP-003', 'Reminders', evil),
    },
    scope: `# Milestone 2 ${evil}\n\n${evil}\n`,
    adrs: [{ file: `docs/adr/001-${evil}.md`, text: `# ADR-001: ${evil}\n\n- **Status:** Proposed${evil}\n\n${evil}\n` }],
    revision: evil, date: evil,
  };
  const html = buildSummary(hostile);
  const { text } = audit(html);
  assert.doesNotMatch(html, /<script|<img|<svg|<iframe|<\/title>[^]*<\/title>|<\/style>[^]*<\/style>/i);
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/g)) assert.doesNotMatch(tag, /\son[a-z]+\s*=|javascript:|data:text/i, tag);
  for (const payload of payloads) assert.ok(text.split(esc(payload)).length > 12, `shown as text wherever it was written: ${payload}`);

  assert.ok(html.includes(`<title>Milestone 2 ${esc(evil)}: implementation summary</title>`));
  assert.ok(html.includes(`<h1>Milestone 2 ${esc(evil)}</h1><p>Implementation summary, generated ${esc(evil)} from revision ${esc(evil)}. `));
  assert.ok(html.includes(`<b>${esc(evil)}</b><span>integration branch</span>`));
  const id = `CAP-002${evil}`.replace(/[^A-Za-z0-9_-]/g, '_');
  assert.match(id, /^CAP-002_script_alert_1___script/);
  assert.ok(html.includes(`<a href="#${id}"><b>CAP-002${esc(evil)}</b>${esc(evil)}</a>`), 'the ID is sanitised in href="#" and escaped as text');
  assert.ok(html.includes(`<div class="card" id="${id}"><div class="task-head"><span class="pill">CAP-002${esc(evil)}</span><h3>${esc(evil)}</h3><span class="pill plain">#2${esc(evil)}</span></div>`), 'and in id=; an issue that is not a number is text');
  assert.ok(html.includes(`<span class="pill plain done">needs CAP-009${esc(evil)} done</span>`));
  assert.ok(html.includes(`<span class="pill warn">Blocked: ${esc(evil)}</span>`));
  assert.ok(html.includes('<span class="pill plain">ADR 002</span>'), 'an ADR that is not on the page is not a link');
  assert.ok(html.includes(`<a class="pill plain" href="#${id}">needs CAP-002${esc(evil)}</a>`));
  assert.ok(html.includes('<span class="pill plain">#3</span>'), 'a repository of another shape makes no link');
  assert.ok(!html.includes('github.com'));
  const adr = `adr-${path.basename(`docs/adr/001-${evil}.md`, '.md').replace(/[^A-Za-z0-9_-]/g, '_')}`;
  assert.ok(html.includes(`<div class="card" id="${adr}"><div class="task-head"><h3>ADR-001: ${esc(evil)}</h3><span class="pill warn">Proposed</span></div>`), 'the status is one word');
  assert.ok(html.includes(`<a href="#${adr}">ADR-001: ${esc(evil)}</a>`));
});
test('quotes in titles are HTML-escaped, never "#quot;"', () => {
  const html = buildSummary(input());
  assert.ok(html.includes('<h3>Say &quot;hello&quot;, the owner&#39;s way</h3>'));
  assert.ok(html.includes('<a class="pill" href="#CAP-002">CAP-002</a> Say &quot;hello&quot;, the owner&#39;s way<div class="needs">'), 'in the dependency view too');
  assert.ok(!html.includes('#quot;'));
  assert.doesNotMatch(audit(html).text, /["']/, 'no bare quote in the text of the page');
  assert.equal(markdown(`"double" and 'single'`), '<p>&quot;double&quot; and &#39;single&#39;</p>');
});
test('only http, https, mailto and relative targets become links', () => {
  const refused = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)', '\u0001javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\\\nscript:alert(1)', '\\ javascript:alert(1)',
    '&#x6A;avascript:alert(1)', 'javascript&colon;alert(1)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'DATA:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'x-custom:run'];
  for (const target of refused) {
    const html = markdown(`[click](${target}) [click](${target} "title") ![image](${target}) <${target}>`);
    assert.doesNotMatch(html, /<a|<img|href|src=/, JSON.stringify(target));
    assert.match(html, /^<p>\[click\]\(/, 'the source stays, as text');
  }
  assert.equal(markdown('[nowhere]()'), '<p>[nowhere]()</p>');
  assert.equal(markdown('[a](https://example.com/a?b=1&c=2 "Title") [b](HTTP://example.com) [c](mailto:owner@example.com) [d](../plans/x.md#goal) [e](#scope) [f](/docs/a_(b).md) [g](<a.md>)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2">a</a> <a href="HTTP://example.com">b</a> <a href="mailto:owner@example.com">c</a> <a href="../plans/x.md#goal">d</a> <a href="#scope">e</a> <a href="/docs/a_(b).md">f</a> <a href="a.md">g</a></p>');
  assert.equal(markdown(`[q](a"b'c.md) [**bold** \`code\`](x.md)`), '<p><a href="a&quot;b&#39;c.md">q</a> <a href="x.md"><strong>bold</strong> <code>code</code></a></p>', 'both quotes are escaped in the attribute');
  assert.equal(markdown('![diagram](https://example.com/d.png) [![badge](https://example.com/b.svg)](https://example.com/ci)'), '<p><a href="https://example.com/d.png">diagram</a> <a href="https://example.com/ci">badge</a></p>', 'an image is a link: the page loads nothing');
  assert.equal(markdown('<https://example.com/x> (see https://example.com/a_b_(c)?d=1&e=2). **https://example.com**'),
    '<p><a href="https://example.com/x">https://example.com/x</a> (see <a href="https://example.com/a_b_(c)?d=1&amp;e=2">https://example.com/a_b_(c)?d=1&amp;e=2</a>). <strong><a href="https://example.com">https://example.com</a></strong></p>');

  const html = buildSummary({ ...input(), scope: '# M\n\n[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c]( data:text/html,x) [d](docs/x.md)\n' });
  assert.deepEqual(audit(html).hrefs.filter(href => !href.startsWith('#') && !href.includes('github.com')), ['docs/x.md']);
  assert.doesNotMatch(html, /href="\s*(?:javascript|data|vbscript):/i);
});
test('fenced code is shown as written: backticks, tildes, inside a list, unclosed', () => {
  assert.equal(markdown('```js\nconst a = "<b>" && `x`;\n~~~\n```\nafter'), '<pre><code>const a = &quot;&lt;b&gt;&quot; &amp;&amp; `x`;\n~~~</code></pre>\n<p>after</p>');
  assert.equal(markdown('~~~~\n```\n# no heading\n- [ ] no list <script>alert(1)</script>\n~~~\n~~~~\n\n# Heading'), '<pre><code>```\n# no heading\n- [ ] no list &lt;script&gt;alert(1)&lt;/script&gt;\n~~~</code></pre>\n<h1>Heading</h1>', 'only a fence of the same character, at least as long, closes it');
  assert.equal(markdown('1. Step\n   ```sh\n   make x\n\n     make y\n   ```\n2. Next'), '<ol><li>Step\n<pre><code>make x\n\n  make y</code></pre></li><li>Next</li></ol>');
  assert.equal(markdown('```"><script>alert(1)</script>\nx\n```'), '<pre><code>x</code></pre>', 'the info string is not written');
  assert.equal(markdown('```\nunclosed *text*'), '<pre><code>unclosed *text*</code></pre>');
  assert.equal(markdown('a ```b``` c'), '<p>a <code>b</code> c</p>', 'a fence starts a line and holds no backtick after it');
});
test('a table needs its rule; cells are inline text', () => {
  assert.equal(markdown('| Case | Action |\n| --- | :-: |\n| `a \\| b` | **copy** |\n| <b>x</b> |\n| 1 | 2 | 3 |\n\nAfter.'),
    '<table><thead><tr><th>Case</th><th>Action</th></tr></thead><tbody><tr><td><code>a | b</code></td><td><strong>copy</strong></td></tr><tr><td>&lt;b&gt;x&lt;/b&gt;</td><td></td></tr><tr><td>1</td><td>2</td></tr></tbody></table>\n<p>After.</p>');
  assert.equal(markdown('Gate | Limit\n--- | ---\ntask | 2'), '<table><thead><tr><th>Gate</th><th>Limit</th></tr></thead><tbody><tr><td>task</td><td>2</td></tr></tbody></table>');
  assert.equal(markdown('a | b\nno rule below'), '<p>a | b\nno rule below</p>');
});
test('lists nest, number and carry task checkboxes as disabled boxes', () => {
  assert.equal(markdown('- [ ] Open\n- [x] Done\n- [X] Also `done`\n- plain\n  - [ ] nested\n  - second\n\n    Its paragraph.\n* [not a box]\n\n1. [ ] numbered'),
    '<ul><li><input type="checkbox" disabled> Open</li><li><input type="checkbox" disabled checked> Done</li><li><input type="checkbox" disabled checked> Also <code>done</code></li>'
    + '<li>plain\n<ul><li><input type="checkbox" disabled> nested</li><li>second\n<p>Its paragraph.</p></li></ul></li><li>[not a box]</li></ul>\n<ol><li><input type="checkbox" disabled> numbered</li></ol>');
  assert.equal(markdown('- [ ] a\n\n- [ ] b\ncontinued'), '<ul><li><input type="checkbox" disabled> a</li><li><input type="checkbox" disabled> b\ncontinued</li></ul>', 'a blank line between the items keeps the box beside its text');
  assert.equal(markdown('3. c\n4. d\n\nText\n- e'), '<ol start="3"><li>c</li><li>d</li></ol>\n<p>Text</p>\n<ul><li>e</li></ul>');
});
test('headings, paragraphs, quotes, rules and inline marks', () => {
  assert.equal(markdown('# One\n### Three ###\n\nA *b* **c** `d_e_f` g_h_i _j_ __k__ ***l*** 2 * 3\nnext line\n\n> quoted **text**\n> - item\n\n---\n* * *\n#no heading'),
    '<h1>One</h1>\n<h3>Three</h3>\n<p>A <em>b</em> <strong>c</strong> <code>d_e_f</code> g_h_i <em>j</em> <strong>k</strong> <strong><em>l</em></strong> 2 * 3\nnext line</p>\n<blockquote><p>quoted <strong>text</strong></p>\n<ul><li>item</li></ul></blockquote>\n<hr>\n<hr>\n<p>#no heading</p>');
  assert.equal(markdown('\\*no em\\* \\<b\\> \\[x\\](y) `a \\* b` `` a ` b ``'), '<p>*no em* &lt;b&gt; [x](y) <code>a \\* b</code> <code>a ` b</code></p>');
  assert.equal(markdown('`[x](javascript:alert(1))` `<script>` `**a**` **`b`**'), '<p><code>[x](javascript:alert(1))</code> <code>&lt;script&gt;</code> <code>**a**</code> <strong><code>b</code></strong></p>', 'a code span is text');
  assert.equal(markdown('<b>x</b> &amp; &lt; <!-- c --> <div onclick="a()">'), '<p>&lt;b&gt;x&lt;/b&gt; &amp;amp; &amp;lt; &lt;!-- c --&gt; &lt;div onclick=&quot;a()&quot;&gt;</p>', 'raw HTML and character references are text');
  assert.equal(markdown('a\r\n\r\n- b\r\n\tc\u0000\r\n'), '<p>a</p>\n<ul><li>b\nc</li></ul>');
  assert.equal(markdown(''), '');
  assert.equal(markdown(null), '');
});
test('whatever the source, the renderer writes only its own tags and only allowed link targets', () => {
  const pieces = ['<', '>', '"', '\'', '`', '```', '~~~', '*', '**', '_', '__', '[', ']', '(', ')', '](', '[a](', '[a]( ', '![a](', '[a](<', '>)', ' "t")', '!', '\\', '|', '| - |', '-', '- ', '1. ', '[ ] ', '# ', '> ', '---', '\n', '\n\n', ' ', '    ', '\t', '\r',
    'javascript:', 'JaVaScRiPt:', 'java', 'script:', 'data:', 'vbscript:', 'https://x.y/', 'http://', '<https://', 'mailto:', 'x.md', '../', '#frag', '%3A', ':', '/', '?', '&', ';', '&quot;', '&#39;', '&lt;', '&#x6A;', '&colon;', 'onerror=', 'alert(1)',
    '<script>', '</script>', '<img src=x>', 'mermaid', 'a', '0', '\u0000', '\u00000\u0000', '\u0001', '\u007f', String.fromCharCode(0x2028)];
  // A fixed seed: the same sources on every run.
  let seed = 20261003;
  const random = n => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
  let links = 0;
  for (let run = 0; run < 20000; run++) {
    const source = Array.from({ length: 1 + random(16) }, () => pieces[random(pieces.length)]).join('');
    links += auditMarkup(markdown(source), JSON.stringify(source)).hrefs.length;
  }
  assert.ok(links > 1000, 'the sources do reach the link rules');
});
test('HTML comments of the scope and of an ADR are not content, as in a plan section', () => {
  const html = buildSummary({ ...input(), scope: '# M\n\n<!-- hidden\n<script>alert(1)</script> -->\n\nShown.\n', adrs: [{ file: 'docs/adr/001-email.md', text: '# ADR-001: Email\n\n<!-- hidden -->\n\n- **Status:** Accepted\n' }] });
  assert.ok(html.includes('<section id="scope"><h2>Scope</h2><div class="card"><div class="md"><p>Shown.</p></div></div></section>'));
  assert.ok(html.includes('<h3>ADR-001: Email</h3><span class="pill">Accepted</span></div><div class="md"><ul><li><strong>Status:</strong> Accepted</li></ul></div>'));
  assert.ok(!html.includes('hidden'));
});

// The real scripts/agent-summary.mjs in a project of its own: one finished
// task, one planned with an ADR, one active.
const sections = ['Goal', 'Context', 'Task Contract', 'Scope', 'Out of Scope', 'Affected Components', 'Acceptance Criteria', 'Flow', 'Implementation Steps', 'Tests', 'Risks', 'Review', 'Completion Notes'];
const tasks = [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', issue: null, depends_on: ['CAP-001'], adrs: ['docs/adr/001-store.md'] },
  { id: 'CAP-003', title: 'Export', slug: 'export', issue: null, depends_on: ['CAP-001'], adrs: [] },
];
const fullPlan = task => `# ${task.id}: ${task.title}\n\nDependencies: ${task.depends_on.join(', ') || 'none'}\n\n`
  + sections.map(s => `## ${s}\n\n${s === 'Acceptance Criteria' ? '- [x] Works' : `${s} of ${task.id}.`}\n`).join('\n');
function project(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-summary-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  for (const script of ['agent-summary.mjs', 'agent-workflow.mjs']) write(`scripts/${script}`, fs.readFileSync(fileURLToPath(new URL(`./${script}`, import.meta.url)), 'utf8'));
  write('docs/plans/backlog.json', JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', tasks }));
  for (const [n, phase] of ['completed', 'planned', 'active'].entries()) write(`docs/plans/${phase}/${tasks[n].id}-${tasks[n].slug}.md`, fullPlan(tasks[n]));
  write('docs/adr/001-store.md', '# ADR-001: Store\n\n- **Status:** Proposed\n');
  // A repository without a commit: the revision is "uncommitted".
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: dir }).status, 0);
  return { dir, write, cli: () => spawnSync(process.execPath, [path.join(dir, 'scripts/agent-summary.mjs')], { encoding: 'utf8' }) };
}
test('the command writes the page of the milestone from the planned and active plans', t => {
  const f = project(t);
  const out = path.join(f.dir, 'docs/product/milestone1-summary.html');
  const missing = f.cli();
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, 'FAIL: docs/product/milestone1.md is missing: the summary describes the agreed scope\n');
  assert.ok(!fs.existsSync(out));

  f.write('docs/product/milestone1.md', '# Milestone 1: Figures\n\n## Outcome\n\nAn analyst exports a figure.\n');
  const result = f.cli();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Wrote docs/product/milestone1-summary.html: 2 tasks, 1 ADRs\n');
  const html = fs.readFileSync(out, 'utf8');
  audit(html);
  assert.match(html, /<h1>Milestone 1: Figures<\/h1><p>Implementation summary, generated \d{4}-\d\d-\d\d from revision uncommitted\. /);
  assert.ok(html.includes('<p>Goal of CAP-002.</p>') && html.includes('<p>Goal of CAP-003.</p>') && !html.includes('Goal of CAP-001.'));
  assert.ok(html.includes('<div class="card" id="adr-001-store">'));
  assert.ok(html.includes('<b>Layer 1</b><span>can start now, 2 tasks in parallel</span>'));
});
