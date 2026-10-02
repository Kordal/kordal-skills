import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The structure check of the backlog (docs/agents/planning.md, stage 6):
// docs/plans/backlog.json against the plans and ADRs it names. It validates
// structure, not product acceptance.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/plans/backlog.json';
const phases = ['planned', 'active', 'completed'];
const requiredSections = ['Goal', 'Context', 'Task Contract', 'Scope', 'Out of Scope', 'Affected Components', 'Acceptance Criteria', 'Flow', 'Implementation Steps', 'Tests', 'Risks', 'Evidence', 'Review', 'Completion Notes'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const planPath = (task, phase) => `docs/plans/${phase}/${task.id}-${task.slug}.md`;
const readLocal = (file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
// A section runs from its heading to the next heading of the same or a higher
// level; HTML comments do not count as content.
export function section(text, heading) {
  let fenced = false;
  const lines = (text ?? '').split(/\r?\n/).map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return { line }; }
    const match = fenced ? null : /^(#{1,6}) +(.*?)\s*$/.exec(line);
    return { line, level: match?.[1].length, title: match?.[2] };
  });
  const start = lines.findIndex(l => l.title === heading);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.level <= lines[start].level);
  return lines.slice(start + 1, end < 0 ? undefined : end).map(l => l.line).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
}

export function validateManifest(manifest, read = readLocal) {
  assert(manifest?.version === 1, 'Unsupported manifest version');
  assert(Number.isInteger(manifest.mvp) && manifest.mvp > 0, 'backlog.json names no mvp number');
  assert(/^[a-z0-9][a-z0-9/-]*$/.test(manifest.integration_branch ?? ''), 'backlog.json names no integration_branch');
  assert(Array.isArray(manifest.tasks), 'backlog.json has no tasks list');
  // The GitHub repository whose issues mirror the tasks; optional.
  assert(manifest.repository == null || /^[\w.-]+\/[\w.-]+$/.test(manifest.repository), 'Invalid repository; use owner/name');
  const ids = new Set(), issues = new Set();
  for (const task of manifest.tasks) {
    assert(/^[A-Z]+-\d{3}$/.test(task.id) && !ids.has(task.id), `Invalid/duplicate task ID: ${task.id}`);
    assert(typeof task.title === 'string' && task.title.trim(), `Missing title: ${task.id}`);
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.slug), `Invalid plan slug: ${task.id}`);
    // scripts/agent-issues.mjs creates the issue; a recorded one is a real, unique number of the repository.
    assert(task.issue == null || (manifest.repository && Number.isInteger(task.issue) && task.issue > 0 && !issues.has(task.issue)), `Invalid/duplicate issue: ${task.id}`);
    assert(Array.isArray(task.depends_on) && new Set(task.depends_on).size === task.depends_on.length, `Invalid dependencies: ${task.id}`);
    assert(Array.isArray(task.adrs), `Invalid ADR list: ${task.id}`);
    assert(task.external_blocker == null || (typeof task.external_blocker === 'string' && task.external_blocker.trim()), `Invalid external blocker: ${task.id}`);
    ids.add(task.id);
    if (task.issue != null) issues.add(task.issue);
    const files = phases.map(phase => ({ phase, text: read(planPath(task, phase)) })).filter(p => p.text !== null);
    assert(files.length === 1, `${task.id} must have exactly one plan across planned/active/completed`);
    const { phase, text } = files[0];
    assert(text.startsWith(`# ${task.id}: ${task.title}\n`), `${task.id} plan title differs from manifest`);
    if (task.issue != null) assert(new RegExp(`(#|/issues/)${task.issue}\\b`).test(section(text, 'Task Contract')), `${task.id} plan issue differs from manifest`);
    assert(text.includes(`Dependencies: ${task.depends_on.join(', ') || 'none'}\n`), `${task.id} plan dependencies differ from manifest`);
    for (const heading of requiredSections) assert(section(text, heading), `${task.id} missing section: ${heading}`);
    assert(/^- \[[ x]\] .+/m.test(section(text, 'Acceptance Criteria')), `${task.id} needs acceptance checkboxes`);
    if (phase === 'completed') {
      assert(!/^- \[ \]/m.test(section(text, 'Acceptance Criteria')), `${task.id} has incomplete acceptance criteria`);
      for (const heading of ['Evidence', 'Review', 'Completion Notes']) assert(!/^Pending\b/i.test(section(text, heading)), `${task.id} missing completion ${heading}`);
    }
    for (const adr of task.adrs) {
      assert(/^docs\/adr\/\d{3}-[a-z0-9-]+\.md$/.test(adr), `${task.id} invalid ADR path`);
      const decision = read(adr);
      assert(decision !== null, `${task.id} missing ADR ${adr}`);
      if (phase === 'completed') assert(/\*\*Status:\*\* Accepted\b/.test(decision), `${task.id} requires Accepted ${adr}`);
    }
  }
  const visiting = new Set(), done = new Set();
  function visit(id) {
    assert(ids.has(id), `Unknown dependency ${id}`);
    assert(!visiting.has(id), `Dependency cycle at ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of manifest.tasks.find(t => t.id === id).depends_on) visit(dependency);
    visiting.delete(id); done.add(id);
  }
  for (const id of ids) visit(id);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert((process.argv[2] ?? 'check') === 'check', 'Usage: agent-workflow.mjs check');
    const text = readLocal(manifestPath);
    assert(text !== null, `${manifestPath} is missing`);
    const manifest = JSON.parse(text);
    validateManifest(manifest);
    console.log(`PASS: ${manifest.tasks.length} task contracts, plans, ADR references and dependency graph`);
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
