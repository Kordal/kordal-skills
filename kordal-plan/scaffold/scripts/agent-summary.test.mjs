import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSummary, dependencyLayers, markdown } from './agent-summary.mjs';

// A hook or "git rebase --exec" exports these, and the git of a fixture would then work in the caller's repository.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']) delete process.env[name];

// buildSummary on an in-memory backlog: one finished task and two unfinished
// ones, the second with a Flow, an ADR and a blocker.
const plan = (id, title, flow, goal = `Deliver ${title}.`) => `# ${id}: ${title}\n\n## Goal\n\n${goal}\n\n## Acceptance Criteria\n\n- [ ] Works\n- [x] Fails clearly\n\n${flow === null ? '' : `## Flow\n\n${flow}\n\n`}## Out of Scope\n\nText.\n`;
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
  assert.doesNotMatch(markup, /&(?!(?:amp|lt|gt|quot|#39);)/, `an "&" that starts none of the five references the generator writes ${source}`);
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
  assert.ok(reminders.includes('<details><summary>Out of scope and components</summary><h4>Out of Scope</h4><div class="md"><p>Text.</p></div><h4>Affected Components</h4><p class="note">Not stated.</p></details>'), 'the folded sections need no script: <details>');

  assert.ok(html.includes('<section><h2>Architecture decisions</h2><div class="card" id="adr-001-email"><div class="task-head"><h3>ADR-001: Email</h3><span class="pill warn">Proposed</span></div><div class="md"><ul><li><strong>Status:</strong> Proposed</li></ul>\n<h2>Context</h2>\n<p>Text.</p></div></div></section>'));
  assert.ok(html.includes('<nav><h2>Summary</h2><a href="#overview">Overview</a><a href="#scope">Scope</a><a href="#dependencies">Task dependencies</a><h2>Tasks</h2><a href="#CAP-002"><b>CAP-002</b>Say &quot;hello&quot;, the owner&#39;s way</a><a href="#CAP-003"><b>CAP-003</b>Reminders</a><h2>Decisions</h2><a href="#adr-001-email">ADR-001: Email</a></nav>'));
  for (const href of hrefs.filter(h => h.startsWith('#'))) assert.ok(html.includes(` id="${href.slice(1)}"`), `the page has the target of ${href}`);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.ok(html.includes('@media print { nav { display: none; } .layout { display: block; } details > * { display: block; } details::details-content { content-visibility: visible; } '),
    'print shows the folded sections: where a closed <details> hides its content by content-visibility, display alone does not');
});
test('a plan without a Flow shows its acceptance criteria alone, and no empty Flow column', () => {
  const given = input();
  given.plans = { ...given.plans, 'CAP-003': plan('CAP-003', 'Reminders', null) };
  const reminders = card(buildSummary(given), 'CAP-003');
  assert.ok(reminders.includes('</div><h4>Acceptance criteria</h4><div class="md"><ul>'), reminders);
  assert.ok(!reminders.includes('<h4>Flow</h4>') && !reminders.includes('class="cols"'));
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
  assert.equal(markdown('See https://example.com/search?q=1& for it. https://x.y/?a=1&; https://x.y/&&'),
    '<p>See <a href="https://example.com/search?q=1&amp;">https://example.com/search?q=1&amp;</a> for it. <a href="https://x.y/?a=1&amp;">https://x.y/?a=1&amp;</a>; <a href="https://x.y/&amp;&amp;">https://x.y/&amp;&amp;</a></p>',
    'the ";" of the "&amp;" a URL ends in is not sentence punctuation');
  assert.equal(markdown(`[a](b "c \\"d\\" e") [a](b 'c "d" e') [a](b "c "d" e") <https://a<https://b>`),
    '<p><a href="b">a</a> <a href="b">a</a> [a](b &quot;c &quot;d&quot; e&quot;) &lt;<a href="https://a">https://a</a><a href="https://b">https://b</a></p>',
    'a title ends at the first quote of its kind that is not escaped, and an autolink holds no "<"');

  const html = buildSummary({ ...input(), scope: '# M\n\n[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c]( data:text/html,x) [d](docs/x.md)\n' });
  assert.deepEqual(audit(html).hrefs.filter(href => !href.startsWith('#') && !href.includes('github.com')), ['docs/x.md']);
  assert.doesNotMatch(html, /href="\s*(?:javascript|data|vbscript):/i);
});
test('a relative link is written from the directory of the page, whichever document it is from', () => {
  const planned = 'docs/plans/planned/CAP-002-hello.md';
  assert.equal(markdown('[a](CAP-001-bootstrap.md) [b](../active/CAP-003-reminders.md#goal) [c](../../adr/001-email.md) [d](../../product/milestone2.md#outcome) [e](../../../Makefile) [f](../../product/) [g](#flow) [h](?raw=1#flow) ![i](flow.png)', planned),
    '<p><a href="../plans/planned/CAP-001-bootstrap.md">a</a> <a href="../plans/active/CAP-003-reminders.md#goal">b</a> <a href="../adr/001-email.md">c</a> <a href="milestone2.md#outcome">d</a> <a href="../../Makefile">e</a> <a href="./">f</a>'
    + ' <a href="../plans/planned/CAP-002-hello.md#flow">g</a> <a href="../plans/planned/CAP-002-hello.md?raw=1#flow">h</a> <a href="../plans/planned/flow.png">i</a></p>', 'a plan; a target without a path is the plan itself');
  assert.equal(markdown('[a](README.md#format) [b](../plans/planned/CAP-002-hello.md) [c](#context) [d](001-email.md#see/../x)', 'docs/adr/001-email.md'),
    '<p><a href="../adr/README.md#format">a</a> <a href="../plans/planned/CAP-002-hello.md">b</a> <a href="../adr/001-email.md#context">c</a> <a href="../adr/001-email.md#see/../x">d</a></p>', 'an ADR; what follows "#" is not a path');
  assert.equal(markdown('[a](vision.md) [b](./vision.md) [c](#task-dependencies) [d](../adr/001-email.md)', 'docs/product/milestone2.md'),
    '<p><a href="vision.md">a</a> <a href="vision.md">b</a> <a href="milestone2.md#task-dependencies">c</a> <a href="../adr/001-email.md">d</a></p>', 'the scope lies beside the page; its headings have no id there, so "#" leads to the scope');
  assert.equal(markdown('[a](https://example.com/a/../b) [b](mailto:owner@example.com) [c](/docs/a.md) <https://example.com/x> https://example.com/y', planned),
    '<p><a href="https://example.com/a/../b">a</a> <a href="mailto:owner@example.com">b</a> <a href="/docs/a.md">c</a> <a href="https://example.com/x">https://example.com/x</a> <a href="https://example.com/y">https://example.com/y</a></p>', 'only a relative target is rewritten');
  // ".." brings a later segment to the front, where a browser would read it as a scheme: the target is checked again once rewritten.
  for (const [file, source] of [[planned, '[a](../../product/javascript:alert(1))'], [planned, '[a](../../product/data:text/html,x)'], ['docs/adr/001-email.md', '[a](../product/JaVaScRiPt:alert(1))'], ['docs/adr/001-email.md', '![a](../product/vbscript:x)']]) {
    assert.equal(markdown(source, file), `<p>${source}</p>`, `no link: ${source}`);
  }
  assert.equal(auditMarkup(markdown('[a](x.md) [b](../y.md#z) [c](#f)', 'docs/adr/java\tscript:alert(1) "><b>/001.md'), 'a hostile file name').hrefs.length, 3);

  // In the page: the scope beside it, an ADR by its file, a plan by planFiles and, without that, as planned.
  const html = buildSummary({
    ...input(), scope: '# M\n\n[a](vision.md) [b](#outcome)\n',
    plans: { 'CAP-002': plan('CAP-002', 'x', 'None.', '[c](#goal)'), 'CAP-003': plan('CAP-003', 'Reminders', flow, '[d](CAP-002-hello.md) [e](#goal)') }, planFiles: { 'CAP-003': 'docs/plans/active/CAP-003-reminders.md' },
    adrs: [{ file: 'docs/adr/001-email.md', text: '# ADR-001: Email\n\n[f](../plans/active/CAP-003-reminders.md) [g](#context)\n' }],
  });
  const { hrefs } = audit(html);
  assert.deepEqual(hrefs.filter(href => !href.startsWith('#') && !href.includes('github.com')),
    ['vision.md', 'milestone2.md#outcome', '../plans/planned/CAP-002-hello.md#goal', '../plans/active/CAP-002-hello.md', '../plans/active/CAP-003-reminders.md#goal', '../plans/active/CAP-003-reminders.md', '../adr/001-email.md#context']);
  for (const href of hrefs.filter(h => h.startsWith('#'))) assert.ok(html.includes(` id="${href.slice(1)}"`), `the page has the target of ${href}`);
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
  assert.equal(markdown('a|b\n--|--   \n1|2'), '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>', 'spaces may follow the rule');
  assert.equal(markdown('a|b\n--|--\t\n1|2'), '<p>a|b\n--|--\n1|2</p>', 'a tab may not');
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
  assert.equal(markdown('# a ## ##\n#  ##\n# b\t##\n## c #  \n#\n# #\n###### six ######\n####### seven'),
    '<h1>a ##</h1>\n<h1>##</h1>\n<h1>b\t##</h1>\n<h2>c</h2>\n<h1></h1>\n<h1>#</h1>\n<h6>six</h6>\n<p>####### seven</p>', 'only "#"s that a space sets apart close a heading');
  assert.equal(markdown('**a****b** **a **b** c** __a__b__ ____a____ **a __b__ c**'),
    '<p><strong>a**</strong>b** <strong>a **b</strong> c** <strong>a__b</strong> <strong><strong>a</strong></strong> <strong>a <strong>b</strong> c</strong></p>', 'bold ends at its first closer');
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
  // A fixed seed: the same sources on every run. Each is rendered as written, as the text of a plan and as that of a file with a hostile name.
  let seed = 20261003;
  const random = n => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
  const files = [undefined, 'docs/plans/planned/CAP-001-a.md', 'docs/adr/java\tscript:x "><b>/data:y/001.md'];
  let links = 0;
  for (let run = 0; run < 20000; run++) {
    const source = Array.from({ length: 1 + random(16) }, () => pieces[random(pieces.length)]).join('');
    for (const file of files) links += auditMarkup(markdown(source, file), JSON.stringify([source, file])).hrefs.length;
  }
  assert.ok(links > 3000, 'the sources do reach the link rules');
});
test('nesting ends at a fixed depth: what is left is text, and nothing overflows the stack', () => {
  for (const [mark, count] of [['- ', 2000], ['1. ', 3000], ['> ', 5000], ['- > ', 20000]]) {
    const html = markdown(`${mark.repeat(count)}x <b>`), { text } = auditMarkup(html, mark);
    assert.equal(html.match(/<(?:ul|ol|blockquote)>/g).length, 33, `${count} x "${mark}" nests 33 deep`);
    assert.equal(decode(text).split(/\s+/).length, count * mark.trim().split(' ').length - 33 + 2, 'and every marker past that is text, with what follows it');
    assert.ok(text.endsWith('x &lt;b&gt;'));
  }
  // Emphasis nests too: "____a____" is bold in bold.
  for (const source of [`${'_'.repeat(100000)} x`, `${'__'.repeat(20000)}a${'__'.repeat(20000)}`]) {
    const html = markdown(source);
    assert.equal(html.match(/<strong>/g).length, 33);
    assert.equal(decode(auditMarkup(html).text).replace(/_/g, ''), source.replace(/_/g, ''));
  }
  assert.equal(markdown('- a\n  - b\n    > c\n    > - **d __e *f* e__ d**'), '<ul><li>a\n<ul><li>b\n<blockquote><p>c</p>\n<ul><li><strong>d <strong>e <em>f</em> e</strong> d</strong></li></ul></blockquote></li></ul></li></ul>', 'what a plan nests is far from the limit');
});
test('the work grows with the length of the text: a long line and thousands of openers without an end are read once', () => {
  // One text 32 times as long costs about as much as 32 texts; where a pattern starts again at every character it
  // costs 32 times as much. Both are timed in one process, one after the other, so the speed and the load of the
  // machine count for neither, and the long one is the best of three: a pause is not the renderer's. The process is
  // stopped at the limit: on the worst of these such a pattern takes minutes.
  const script = String.raw`
import { markdown, buildSummary } from ${JSON.stringify(new URL('./agent-summary.mjs', import.meta.url).href)};
const page = text => buildSummary({ manifest: { version: 1, milestone: 1, integration_branch: 'milestone1', tasks: [] }, scope: text, plans: {}, adrs: [{ file: 'docs/adr/001-a.md', text }], revision: 'r', date: 'd' });
const sources = {
  'a heading with a run of spaces': n => '## a' + ' '.repeat(n) + 'b',
  'a table rule with a run of spaces': n => 'a|b\n---' + ' '.repeat(n) + 'x',
  '"**" without a closer': n => '**a '.repeat(n / 4),
  '"__" without a closer': n => '__a '.repeat(n / 4),
  'link titles that end in no bracket': n => '[a](b "c" '.repeat(n / 10),
  'link titles without an end': n => '[x](a "'.repeat(n / 7),
  'autolinks without an end': n => '<https://a'.repeat(n / 10),
  'a list item and blank lines': n => '- a\n' + '\n'.repeat(n / 4) + '  b',
  'comments without an end': n => '<!--'.repeat(n / 4),
  'code spans without an end': n => '\\' + '\x60\x60\\'.repeat(n / 3),
};
const cost = (render, text) => { const start = performance.now(); render(text); return performance.now() - start; };
for (const [name, source] of Object.entries(sources)) for (const [through, render] of [['markdown()', markdown], ['the scope and an ADR', page]]) {
  process.stdout.write('\n' + name + ', through ' + through);
  let short = 0, long = Infinity;
  for (let n = 0; n < 8; n++) render(source(5000));
  for (let n = 0; n < 32; n++) short += cost(render, source(5000));
  for (let n = 0; n < 3 && long > 4 * short + 100; n++) long = Math.min(long, cost(render, source(160000)));
  if (long > 4 * short + 100) { process.stdout.write(': ' + Math.round(long) + ' ms for one text, ' + Math.round(short) + ' ms for 32 texts of a 32nd of its length'); process.exit(1); }
}`;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, `slower than the length of the text explains: ${run.stdout.split('\n').at(-1)}${run.signal ? ': stopped after 30 s' : ''} ${run.stderr}`);
});
test('code in the scope and in an ADR is content: "<!--" in it opens no comment, a "# " line in it is no title', () => {
  const page = (scope, adr = '# ADR-001: Email\n') => buildSummary({ ...input(), scope, adrs: [{ file: 'docs/adr/001-email.md', text: adr }] });
  const scopeOf = html => /<section id="scope"><h2>Scope<\/h2><div class="card"><div class="md">([^]*?)<\/div><\/div><\/section>/.exec(html)[1];
  const fenced = '<figure class="source"><figcaption>Mermaid source: rendered in the Markdown file on GitHub</figcaption><pre><code>flowchart TD\n  A --&gt; B</code></pre></figure>';
  assert.equal(scopeOf(page('# M\n\nPlans keep their `<!--` guidance.\n\n## Out of scope\n\n- Payments\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nAfter `-->`.\n')),
    `<p>Plans keep their <code>&lt;!--</code> guidance.</p>\n<h2>Out of scope</h2>\n<ul><li>Payments</li></ul>\n${fenced}\n<p>After <code>--&gt;</code>.</p>`, 'a code span: the arrow of the graph ends no comment');
  assert.equal(scopeOf(page('# M\n\n```html\n<!-- header -->\n<div></div>\n```\n\n- Step\n  ~~~\n  <!-- kept -->\n  ~~~\n')),
    '<pre><code>&lt;!-- header --&gt;\n&lt;div&gt;&lt;/div&gt;</code></pre>\n<ul><li>Step\n<pre><code>&lt;!-- kept --&gt;</code></pre></li></ul>', 'a fenced block, also inside a list');
  const untitled = page('## Outcome\n\n```sh\n# install\nmake x\n```\n');
  assert.ok(untitled.includes('<h1>Milestone 2</h1>'), 'a "# " line of a fenced block is not the title');
  assert.equal(scopeOf(untitled), '<h2>Outcome</h2>\n<pre><code># install\nmake x</code></pre>');
  for (const end of ['\n', '\r\n', '\r']) {
    const html = page('# Milestone 2: Reminders\n\n## Outcome\n\n~~~\n<!-- kept -->\n~~~\n\n<!-- hidden -->\n\nText.\n'.replaceAll('\n', end));
    assert.ok(html.includes('<h1>Milestone 2: Reminders</h1>'));
    assert.equal(scopeOf(html), '<h2>Outcome</h2>\n<pre><code>&lt;!-- kept --&gt;</code></pre>\n<p>Text.</p>', `the title line goes and the lines are read alike, whether they end in ${JSON.stringify(end)}`);
  }
  const last = page('## Outcome\n\nText.\n\n# Late title');
  assert.ok(last.includes('<h1>Late title</h1>'));
  assert.equal(scopeOf(last), '<h2>Outcome</h2>\n<p>Text.</p>', 'or in nothing');
  assert.equal(scopeOf(page('# M\n\nA stray ` tick.\n\n<!-- hidden ```\n# hidden\n` -->\n\nAnother ` tick, an \\<!-- escaped --> mark, and one <!-- left open.\n\n# Next\n')),
    '<p>A stray ` tick.</p>\n<p>Another ` tick, an &lt;!-- escaped --&gt; mark, and one &lt;!-- left open.</p>\n<h1>Next</h1>', 'a comment is still no content, whatever it holds; a code span ends with its paragraph');

  const adr = page('# M\n', '<!-- # hidden -->\n\n```sh\n# not the title\n```\n\n# ADR-001: Email\n\n- **Status:** Accepted\n\nKeep `<!--` and\n`-->` as written.\n');
  assert.ok(adr.includes('<h3>ADR-001: Email</h3><span class="pill">Accepted</span></div><div class="md"><pre><code># not the title</code></pre>\n<ul><li><strong>Status:</strong> Accepted</li></ul>\n<p>Keep <code>&lt;!--</code> and\n<code>--&gt;</code> as written.</p></div>'));
  assert.ok(page('# M\n', '```\n# code\n```\n').includes('<h3>docs/adr/001-email.md</h3>'), 'an ADR without a title is named by its file');
});
test('HTML comments of the scope and of an ADR are not content, as in a plan section', () => {
  const html = buildSummary({ ...input(), scope: '# M\n\n<!-- hidden\n<script>alert(1)</script> -->\n\nShown.\n', adrs: [{ file: 'docs/adr/001-email.md', text: '# ADR-001: Email\n\n<!-- hidden -->\n\n- **Status:** Accepted\n' }] });
  assert.ok(html.includes('<section id="scope"><h2>Scope</h2><div class="card"><div class="md"><p>Shown.</p></div></div></section>'));
  assert.ok(html.includes('<h3>ADR-001: Email</h3><span class="pill">Accepted</span></div><div class="md"><ul><li><strong>Status:</strong> Accepted</li></ul></div>'));
  assert.ok(!html.includes('hidden'));
});

// The real scripts/agent-summary.mjs in a project of its own: one finished
// task, one planned with an ADR, one active.
const sections = ['Goal', 'Acceptance Criteria', 'Flow', 'Out of Scope', 'Affected Components', 'Review', 'Notes'];
const tasks = [
  { id: 'CAP-001', title: 'Identity', slug: 'identity', issue: null, depends_on: [], adrs: [] },
  { id: 'CAP-002', title: 'Freshness', slug: 'freshness', issue: null, depends_on: ['CAP-001'], adrs: ['docs/adr/001-store.md'] },
  { id: 'CAP-003', title: 'Export', slug: 'export', issue: null, depends_on: ['CAP-001'], adrs: [] },
];
const fullPlan = task => `# ${task.id}: ${task.title}\n\nIssue: none\n\n`
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
test('every link of the written page leads to a file of the project or to a place on the page', t => {
  const f = project(t);
  const withGoal = (task, goal) => fullPlan(task).replace(`Goal of ${task.id}.`, goal);
  f.write('docs/plans/planned/CAP-002-freshness.md', withGoal(tasks[1], '[done](../completed/CAP-001-identity.md) [active](../active/CAP-003-export.md#goal) [ADR](../../adr/001-store.md#context) [scope](../../product/milestone1.md) [manifest](../backlog.json) [script](../../../scripts/agent-summary.mjs) [here](#flow)'));
  f.write('docs/plans/active/CAP-003-export.md', withGoal(tasks[2], '[planned](../planned/CAP-002-freshness.md) [here](#goal)'));
  f.write('docs/adr/001-store.md', '# ADR-001: Store\n\n- **Status:** Proposed\n\n## Context\n\n[plan](../plans/planned/CAP-002-freshness.md#goal) [scope](../product/milestone1.md) [here](#context)\n');
  f.write('docs/product/milestone1.md', '# Milestone 1: Figures\n\n## Outcome\n\n[plan](../plans/active/CAP-003-export.md) [ADR](../adr/001-store.md) [page](milestone1-summary.html) [here](#outcome)\n');
  const result = f.cli();
  assert.equal(result.status, 0, result.stderr);
  const out = path.join(f.dir, 'docs/product/milestone1-summary.html'), html = fs.readFileSync(out, 'utf8');
  const { hrefs } = audit(html);
  const targets = hrefs.filter(href => !href.startsWith('#')).map(href => fileURLToPath(Object.assign(new URL(href, pathToFileURL(out)), { hash: '', search: '' })));
  assert.deepEqual(targets.map(target => path.relative(f.dir, target).split(path.sep).join('/')), [
    'docs/plans/active/CAP-003-export.md', 'docs/adr/001-store.md', 'docs/product/milestone1-summary.html', 'docs/product/milestone1.md',
    'docs/plans/completed/CAP-001-identity.md', 'docs/plans/active/CAP-003-export.md', 'docs/adr/001-store.md', 'docs/product/milestone1.md', 'docs/plans/backlog.json', 'scripts/agent-summary.mjs', 'docs/plans/planned/CAP-002-freshness.md',
    'docs/plans/planned/CAP-002-freshness.md', 'docs/plans/active/CAP-003-export.md',
    'docs/plans/planned/CAP-002-freshness.md', 'docs/product/milestone1.md', 'docs/adr/001-store.md',
  ], 'the scope, the planned plan, the active plan, the ADR: each link names the file its document meant');
  for (const target of targets) assert.ok(fs.existsSync(target), `${target} exists`);
  for (const href of hrefs.filter(h => h.startsWith('#'))) assert.ok(html.includes(` id="${href.slice(1)}"`), `the page has the target of ${href}`);
});
