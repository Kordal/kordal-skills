import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, dependencyGraph } from './agent-summary.mjs';

// buildSummary on an in-memory backlog: one finished task and two unfinished
// ones, the second with a Flow and an ADR.
const plan = (id, title, flow) => `# ${id}: ${title}\n\n## Goal\n\nDeliver ${title}.\n\n## Acceptance Criteria\n\n- [ ] Works\n\n## Flow\n\n${flow}\n\n## Scope\n\nText.\n`;
const manifest = {
  version: 1, mvp: 2, integration_branch: 'mvp2', repository: 'owner/product',
  tasks: [
    { id: 'CAP-001', title: 'Bootstrap', slug: 'bootstrap', issue: 1, depends_on: [], adrs: [] },
    { id: 'CAP-002', title: 'Say "hello"', slug: 'hello', issue: 2, depends_on: ['CAP-001'], adrs: [] },
    { id: 'CAP-003', title: 'Reminders', slug: 'reminders', issue: null, depends_on: ['CAP-002'], adrs: ['docs/adr/001-email.md'], external_blocker: 'SMTP credentials from the owner' },
  ],
};
const plans = {
  'CAP-002': plan('CAP-002', 'Say "hello"', 'None: tooling only.'),
  'CAP-003': plan('CAP-003', 'Reminders', '```mermaid\nflowchart TD\n  A --> B\n```'),
};
const input = () => ({ manifest, plans, scope: '# MVP 2: Reminders\n\n## Outcome\n\nA freelancer sends a reminder. </script><b>x</b>\n', adrs: [{ file: 'docs/adr/001-email.md', text: '# ADR-001: Email\n\n- **Status:** Proposed\n\n## Context\n\nText.\n' }], revision: 'abc1234', date: '2026-10-02' });
const dataOf = html => JSON.parse(/<script id="data" type="application\/json">(.*)<\/script>/.exec(html)[1]);

test('the graph has one node per unfinished task and one edge per dependency of the manifest', () => {
  assert.equal(dependencyGraph(manifest, manifest.tasks.slice(1)), [
    'flowchart LR',
    '  CAP_002["CAP-002<br/>Say #quot;hello#quot;"]',
    '  CAP_001 --> CAP_002',
    '  CAP_003["CAP-003<br/>Reminders"]',
    '  CAP_002 --> CAP_003',
    '  CAP_001["CAP-001<br/>done"]:::done',
    '  classDef done stroke-dasharray: 4 3,opacity:0.6',
  ].join('\n'));
});
test('the summary carries the scope, the unfinished tasks with their sections, and their ADRs', () => {
  const html = buildSummary(input());
  const data = dataOf(html);
  assert.match(html, /<title>MVP 2: Reminders: implementation summary<\/title>/);
  assert.deepEqual(data.tasks.map(task => task.id), ['CAP-002', 'CAP-003'], 'a task without a planned or active plan is finished');
  assert.equal(data.tasks[1].sections.Goal, 'Deliver Reminders.');
  assert.match(data.tasks[1].sections.Flow, /^```mermaid\nflowchart TD/);
  assert.equal(data.tasks[1].blocker, 'SMTP credentials from the owner');
  assert.deepEqual(data.tasks[1].adrs, ['001-email']);
  assert.deepEqual(data.adrs.map(adr => [adr.id, adr.title, adr.status]), [['001-email', 'ADR-001: Email', 'Proposed']]);
  assert.match(data.scope, /^\n## Outcome/);
  assert.deepEqual([data.revision, data.date, data.repository, data.integration], ['abc1234', '2026-10-02', 'owner/product', 'mvp2']);
});
test('content cannot end the data element', () => {
  const html = buildSummary(input());
  assert.equal(html.match(/<\/script>/g).length, 4, 'the page\'s own four script elements only');
  assert.match(dataOf(html).scope, /<\/script><b>x<\/b>/, 'the text survives as data');
});
