import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { section, validateManifest } from './agent-workflow.mjs';

// The implementation summary of the MVP being planned
// (docs/agents/planning.md, stage 5): one HTML page for the owner, generated
// from the scope, the manifest, the unfinished tasks' plans and their ADRs.
// It is a view, never a source: regenerate it, do not edit it. The page
// renders its Markdown and Mermaid in the browser with two libraries from
// cdn.jsdelivr.net; without a connection it shows the same content as text.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const taskSections = ['Goal', 'Acceptance Criteria', 'Flow', 'Scope', 'Out of Scope', 'Affected Components', 'Implementation Steps', 'Tests', 'Risks'];
const node = id => id.replace(/[^A-Za-z0-9]/g, '_');
const label = text => text.replace(/"/g, '#quot;');

// One node per unfinished task and one edge per depends_on entry, straight
// from the manifest; a finished dependency is drawn as done.
export function dependencyGraph(unfinished) {
  const open = new Set(unfinished.map(t => t.id));
  const lines = ['flowchart LR'], done = new Set();
  for (const task of unfinished) {
    lines.push(`  ${node(task.id)}["${task.id}<br/>${label(task.title)}"]`);
    for (const id of task.depends_on) {
      if (!open.has(id)) done.add(id);
      lines.push(`  ${node(id)} --> ${node(task.id)}`);
    }
  }
  for (const id of done) lines.push(`  ${node(id)}["${id}<br/>done"]:::done`);
  if (done.size) lines.push('  classDef done stroke-dasharray: 4 3,opacity:0.6');
  return lines.join('\n');
}

export function buildSummary({ manifest, scope, plans, adrs, revision, date }) {
  const unfinished = manifest.tasks.filter(task => plans[task.id]);
  const data = {
    mvp: manifest.mvp,
    title: /^# (.+)$/m.exec(scope ?? '')?.[1] ?? `MVP ${manifest.mvp}`,
    repository: manifest.repository ?? null,
    integration: manifest.integration_branch,
    revision, date,
    scope: (scope ?? '').replace(/^# .+\n/m, ''),
    graph: dependencyGraph(unfinished),
    tasks: unfinished.map(task => ({
      id: task.id, title: task.title, issue: task.issue ?? null, dependsOn: task.depends_on, blocker: task.external_blocker ?? null,
      adrs: task.adrs.map(file => path.basename(file, '.md')),
      sections: Object.fromEntries(taskSections.map(heading => [heading, section(plans[task.id], heading)])),
    })),
    adrs: adrs.map(({ file, text }) => ({
      id: path.basename(file, '.md'),
      title: /^# (.+)$/m.exec(text)?.[1] ?? file,
      status: /\*\*Status:\*\* (\w+)/.exec(text)?.[1] ?? 'Unknown',
      text: text.replace(/^# .+\n/m, ''),
    })),
  };
  // "</script>" inside the data must not end the script element.
  return template.replace('__TITLE__', () => data.title.replace(/[<>&]/g, '')).replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'));
}

const template = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__: implementation summary</title>
<style>
:root { --bg: #f6f7f9; --card: #ffffff; --text: #1c2330; --muted: #5d6778; --line: #dfe3ea; --accent: #2f6fed; --soft: #eaf1ff; --warn: #b54708; --warn-soft: #fff4e5; }
@media (prefers-color-scheme: dark) { :root { --bg: #12151b; --card: #1b2029; --text: #e6e9ef; --muted: #9aa4b5; --line: #2c3340; --accent: #7aa7ff; --soft: #1f2b45; --warn: #f5b26b; --warn-soft: #3a2a15; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; padding: 24px 16px; border-right: 1px solid var(--line); background: var(--card); }
nav h2 { margin: 18px 8px 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
nav a { display: block; padding: 5px 8px; border-radius: 6px; color: var(--text); font-size: 14px; }
nav a:hover { background: var(--soft); text-decoration: none; }
nav a b { color: var(--accent); font-weight: 600; margin-right: 6px; }
main { padding: 32px 40px 80px; max-width: 1100px; }
header h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.2; }
header p { margin: 0; color: var(--muted); font-size: 14px; }
.stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0 8px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 18px; min-width: 120px; }
.stat b { display: block; font-size: 24px; } .stat span { color: var(--muted); font-size: 13px; }
section { margin-top: 40px; }
section > h2 { font-size: 21px; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; margin-bottom: 18px; overflow-x: auto; }
.task-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.task-head h3 { margin: 0; font-size: 19px; }
.pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: var(--soft); color: var(--accent); white-space: nowrap; }
.pill.plain { background: transparent; border: 1px solid var(--line); color: var(--muted); font-weight: 500; }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 12px; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
h4 { margin: 14px 0 6px; font-size: 12.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
.md h2 { font-size: 17px; margin: 22px 0 8px; } .md h3 { font-size: 15px; margin: 18px 0 6px; }
.md ul, .md ol { padding-left: 22px; } .md li { margin: 3px 0; }
.md li:has(> input[type=checkbox]) { list-style: none; margin-left: -22px; }
.md input[type=checkbox] { margin-right: 8px; }
.md code { background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; font-size: 13.5px; }
.md pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; white-space: pre-wrap; }
.md pre code { border: 0; padding: 0; background: none; }
.md table { border-collapse: collapse; width: 100%; font-size: 14.5px; } .md th, .md td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
.md th { background: var(--bg); }
.mermaid { text-align: center; background: none; border: 0; }
details { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px; }
summary { cursor: pointer; color: var(--accent); font-size: 14px; font-weight: 600; }
.note { color: var(--muted); font-size: 13px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); } main { padding: 20px 16px 60px; } .cols { grid-template-columns: 1fr; } }
@media print { nav { display: none; } .layout { display: block; } details > * { display: block; } .card { break-inside: avoid; } }
</style>
</head>
<body>
<div class="layout">
<nav id="nav"></nav>
<main id="main"></main>
</div>
<script id="data" type="application/json">__DATA__</script>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var esc = function (text) { return String(text).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // Without the libraries (no connection) the Markdown is shown as text.
  var md = function (text) {
    if (!text) return '<p class="note">Not stated.</p>';
    return '<div class="md">' + (window.marked ? window.marked.parse(text) : '<pre>' + esc(text) + '</pre>') + '</div>';
  };
  var diagram = function (source) { return '<pre class="mermaid">' + esc(source) + '</pre>'; };
  var issueLink = function (task) {
    if (!task.issue) return '';
    var text = '#' + task.issue;
    return data.repository ? '<a class="pill plain" href="https://github.com/' + data.repository + '/issues/' + task.issue + '">' + text + '</a>' : '<span class="pill plain">' + text + '</span>';
  };

  var nav = '<h2>Summary</h2><a href="#overview">Overview</a><a href="#scope">Scope</a><a href="#dependencies">Task dependencies</a><h2>Tasks</h2>';
  data.tasks.forEach(function (task) { nav += '<a href="#' + task.id + '"><b>' + task.id + '</b>' + esc(task.title) + '</a>'; });
  if (data.adrs.length) { nav += '<h2>Decisions</h2>'; data.adrs.forEach(function (adr) { nav += '<a href="#adr-' + adr.id + '">' + esc(adr.title) + '</a>'; }); }
  document.getElementById('nav').innerHTML = nav;

  var blocked = data.tasks.filter(function (task) { return task.blocker; }).length;
  var html = '<header id="overview"><h1>' + esc(data.title) + '</h1>'
    + '<p>Implementation summary, generated ' + esc(data.date) + ' from revision ' + esc(data.revision) + '. A view of the repository: the plans are the source.</p>'
    + '<div class="stats"><div class="stat"><b>' + data.tasks.length + '</b><span>tasks to deliver</span></div>'
    + '<div class="stat"><b>' + data.adrs.length + '</b><span>architecture decisions</span></div>'
    + '<div class="stat"><b>' + blocked + '</b><span>blocked from outside</span></div>'
    + '<div class="stat"><b>' + esc(data.integration) + '</b><span>integration branch</span></div></div></header>';
  html += '<section id="scope"><h2>Scope</h2><div class="card">' + md(data.scope) + '</div></section>';
  html += '<section id="dependencies"><h2>Task dependencies</h2><div class="card">' + (data.tasks.length ? diagram(data.graph) : '<p class="note">No tasks yet.</p>') + '<p class="note">Generated from the manifest: an arrow points from a task to the task that needs it.</p></div></section>';

  html += '<section><h2>Tasks</h2>';
  data.tasks.forEach(function (task) {
    var s = task.sections;
    html += '<div class="card" id="' + task.id + '"><div class="task-head"><span class="pill">' + task.id + '</span><h3>' + esc(task.title) + '</h3>' + issueLink(task) + '</div><div class="meta">';
    html += task.dependsOn.length ? task.dependsOn.map(function (id) { return '<a class="pill plain" href="#' + id + '">needs ' + id + '</a>'; }).join('') : '<span class="pill plain">no dependencies</span>';
    task.adrs.forEach(function (id) { html += '<a class="pill plain" href="#adr-' + id + '">ADR ' + esc(id.slice(0, 3)) + '</a>'; });
    if (task.blocker) html += '<span class="pill warn">Blocked: ' + esc(task.blocker) + '</span>';
    html += '</div>' + md(s['Goal']);
    html += '<div class="cols"><div><h4>Acceptance criteria</h4>' + md(s['Acceptance Criteria']) + '</div><div><h4>Flow</h4>' + md(s['Flow']) + '</div></div>';
    html += '<details><summary>Scope, components, steps, tests and risks</summary>';
    ['Scope', 'Out of Scope', 'Affected Components', 'Implementation Steps', 'Tests', 'Risks'].forEach(function (heading) { html += '<h4>' + heading + '</h4>' + md(s[heading]); });
    html += '</details></div>';
  });
  html += '</section>';

  if (data.adrs.length) {
    html += '<section><h2>Architecture decisions</h2>';
    data.adrs.forEach(function (adr) {
      html += '<div class="card" id="adr-' + adr.id + '"><div class="task-head"><h3>' + esc(adr.title) + '</h3><span class="pill ' + (adr.status === 'Accepted' ? '' : 'warn') + '">' + esc(adr.status) + '</span></div>' + md(adr.text) + '</div>';
    });
    html += '</section>';
  }
  document.getElementById('main').innerHTML = html;

  // Mermaid blocks of the Markdown become diagrams; task lists stay read-only.
  document.querySelectorAll('code.language-mermaid').forEach(function (code) {
    var pre = document.createElement('pre');
    pre.className = 'mermaid';
    pre.textContent = code.textContent;
    code.parentNode.replaceWith(pre);
  });
  if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'neutral' });
    window.mermaid.run({ querySelector: '.mermaid' });
  }
})();
</script>
</body>
</html>
`;

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(read('docs/plans/backlog.json'));
    validateManifest(manifest);
    const plans = {};
    for (const task of manifest.tasks) {
      const text = read(`docs/plans/planned/${task.id}-${task.slug}.md`) ?? read(`docs/plans/active/${task.id}-${task.slug}.md`);
      if (text !== null) plans[task.id] = text;
    }
    const adrFiles = [...new Set(manifest.tasks.filter(task => plans[task.id]).flatMap(task => task.adrs))].sort();
    const scopeFile = `docs/product/mvp${manifest.mvp}.md`;
    const scope = read(scopeFile);
    if (scope === null) throw new Error(`${scopeFile} is missing: the summary describes the agreed scope`);
    let revision = 'uncommitted';
    try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* a repository without commits */ }
    const out = `docs/product/mvp${manifest.mvp}-summary.html`;
    fs.writeFileSync(path.join(root, out), buildSummary({ manifest, scope, plans, adrs: adrFiles.map(file => ({ file, text: read(file) })), revision, date: new Date().toISOString().slice(0, 10) }));
    console.log(`Wrote ${out}: ${Object.keys(plans).length} tasks, ${adrFiles.length} ADRs`);
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
