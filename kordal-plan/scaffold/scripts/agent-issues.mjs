import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { section, validateManifest } from './agent-workflow.mjs';
import { stateOf } from './agent-local.mjs';

// The GitHub mirror of the backlog (docs/agents/workflow.md, "GitHub
// mirror"). The repository is the source of truth; this script makes the
// issues of the manifest's `repository` match it and never reads a decision
// from them:
//   - one issue per task, titled "<ID>: <title>", its body generated from
//     the plan, in the GitHub milestone "Milestone <n>";
//   - exactly one status label, derived from the same state `next` shows;
//   - closed when the task's completed plan is on the integration branch.
// `sync` is idempotent: it changes only what differs. `sync --check` changes
// nothing and fails on any difference. `sync --only <ID>,<ID>` is the targeted
// sync of `claim`, `finish` and `integrate`: the named tasks and the tasks
// that depend on them directly, one read and at most one write per issue, and
// no list of labels, milestones or issues. AGENT_GH is the gh to run
// (default: gh).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/plans/backlog.json';
const statusLabels = { WAIT: 'waiting', BLOCKED: 'blocked', READY: 'ready', CLAIMED: 'in-progress', DONE: 'done' };
const labelColors = { waiting: 'cfd3d7', blocked: 'd73a4a', ready: '0e8a16', 'in-progress': 'fbca04', done: '6f42c1' };
const generated = '<!-- Generated from the plan by scripts/agent-issues.mjs: edit the plan, not this issue. -->';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const planFile = task => `${task.id}-${task.slug}.md`;

function gh(endpoint, method, data) {
  const args = ['api', endpoint, ...(method ? ['-X', method, '--input', '-'] : [])];
  try {
    return JSON.parse(execFileSync(process.env.AGENT_GH ?? 'gh', args, { cwd: root, encoding: 'utf8', input: data ? JSON.stringify(data) : '', stdio: ['pipe', 'pipe', 'pipe'] }) || 'null');
  } catch (error) {
    throw new Error(`GitHub ${method ?? 'GET'} ${endpoint} failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
  }
}
function list(endpoint) {
  const all = [];
  for (let page = 1; ; page++) {
    const items = gh(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) return all;
  }
}

// The plan as the integration branch holds it for a finished task, as this
// checkout holds it otherwise.
function workingPlan(task) {
  for (const phase of ['planned', 'active', 'completed']) {
    const file = path.join(root, 'docs/plans', phase, planFile(task));
    if (fs.existsSync(file)) return file;
  }
  return null;
}
function planText(manifest, task, state) {
  if (state === 'DONE') return git('show', `${manifest.integration_branch}:docs/plans/completed/${planFile(task)}`);
  const file = workingPlan(task);
  assert(file, `${task.id} has no plan in this checkout`);
  return fs.readFileSync(file, 'utf8');
}
// The criteria are ticked when the task is done, whatever the plan of the
// checkout at hand says meanwhile; the rest of the body is that plan's text.
export function issueBody(manifest, task, state, text) {
  const criteria = section(text, 'Acceptance Criteria').split('\n').filter(l => /^- \[[ x]\] /.test(l)).map(l => `- [${state === 'DONE' ? 'x' : ' '}] ${l.slice(6)}`);
  const dependencies = task.depends_on.map(id => { const issue = manifest.tasks.find(t => t.id === id).issue; return issue ? `#${issue} (${id})` : id; });
  return [
    section(text, 'Goal'), '',
    `**Plan:** \`${planFile(task)}\` under \`docs/plans/\``, '',
    `**Depends on:** ${dependencies.join(', ') || 'none'}`,
    ...(task.external_blocker ? ['', `**Blocked by:** ${task.external_blocker}`] : []),
    '', '### Acceptance criteria', '', ...criteria, '', generated,
  ].join('\n');
}
const normal = text => (text ?? '').replace(/\r\n/g, '\n').trim();

// `only` is the targeted sync: these tasks, each against its own issue. It
// reconciles what a change of state changes (the state, the status label and
// the body) and the title, and leaves the GitHub milestone, which needs a
// list, to the full sync: an issue that is in no milestone yet makes the sync
// a full one.
function sync(manifest, check, only) {
  const repo = `repos/${manifest.repository}`;
  const problems = [];
  const fix = (message, apply) => { problems.push(message); if (!check) apply(); };
  const reconcile = (task, issue, milestone) => {
    const { state } = stateOf(manifest, task);
    const want = {
      title: `${task.id}: ${task.title}`,
      body: issueBody(manifest, task, state, planText(manifest, task, state)),
      state: state === 'DONE' ? 'closed' : 'open',
      labels: [...issue.labels.map(l => l.name).filter(n => !(n in labelColors) && !n.startsWith('status:')), statusLabels[state]].sort(),
      // A finished task keeps the GitHub milestone it was delivered in.
      milestone: state === 'DONE' && issue.milestone ? issue.milestone.number : milestone,
    };
    const patch = {};
    if (issue.title !== want.title) patch.title = want.title;
    if (normal(issue.body) !== normal(want.body)) patch.body = want.body;
    if (issue.state !== want.state) Object.assign(patch, { state: want.state }, want.state === 'closed' ? { state_reason: 'completed' } : {});
    if (JSON.stringify(issue.labels.map(l => l.name).sort()) !== JSON.stringify(want.labels)) patch.labels = want.labels;
    if (!only && (issue.milestone?.number ?? null) !== (want.milestone ?? null)) patch.milestone = want.milestone;
    if (Object.keys(patch).length) fix(`${task.id} #${task.issue}: ${Object.keys(patch).filter(k => k !== 'state_reason').join(', ')} differ${patch.labels ? ` (wanted ${statusLabels[state]})` : ''}`, () => gh(`${repo}/issues/${task.issue}`, 'PATCH', patch));
  };
  if (only) {
    // The issues API answers for a pull request too, and would rewrite and close it.
    const live = only.map(task => {
      const issue = gh(`${repo}/issues/${task.issue}`);
      assert(!issue.pull_request, `${task.id}: #${task.issue} is a pull request of ${manifest.repository}, not an issue`);
      return [task, issue];
    });
    if (live.every(([, issue]) => issue.milestone)) {
      for (const [task, issue] of live) reconcile(task, issue);
      return problems;
    }
    only = null;
  }

  const labels = new Set(list(`${repo}/labels`).map(l => l.name));
  for (const [name, color] of Object.entries(labelColors)) {
    if (!labels.has(name)) fix(`label ${name} is missing`, () => gh(`${repo}/labels`, 'POST', { name, color }));
  }
  const title = `Milestone ${manifest.milestone}`;
  let milestone = list(`${repo}/milestones?state=all`).find(m => m.title === title)?.number;
  if (!milestone) fix(`milestone ${title} is missing`, () => { milestone = gh(`${repo}/milestones`, 'POST', { title }).number; });

  // Create what is missing first, so that every body can name its
  // dependencies' issues. An issue left by an interrupted run is found by title.
  const live = new Map(list(`${repo}/issues?state=all`).filter(i => !i.pull_request).map(i => [i.number, i]));
  for (const task of manifest.tasks) {
    if (task.issue != null) continue;
    const issueTitle = `${task.id}: ${task.title}`;
    fix(`${task.id} has no issue`, () => {
      const issue = [...live.values()].find(i => i.title === issueTitle) ?? gh(`${repo}/issues`, 'POST', { title: issueTitle, body: generated });
      live.set(issue.number, { labels: [], milestone: null, state: 'open', ...issue });
      task.issue = issue.number;
      fs.writeFileSync(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
      const file = workingPlan(task);
      if (file) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^Issue: .*$/m, `Issue: #${issue.number}`));
    });
  }
  for (const task of manifest.tasks) {
    if (task.issue == null) continue;
    const issue = live.get(task.issue);
    assert(issue, `${task.id}: issue #${task.issue} does not exist in ${manifest.repository}`);
    reconcile(task, issue, milestone);
  }
  return problems;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const usage = 'Usage: agent-issues.mjs sync [--check | --only <ID>,<ID>] | comment <ID> <file>';
    assert(['sync', 'comment'].includes(command), usage);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
    validateManifest(manifest);
    if (!manifest.repository) {
      console.log(`backlog.json names no repository: nothing to ${command}.`);
    } else if (command === 'comment') {
      const task = manifest.tasks.find(t => t.id === rest[0]);
      assert(task?.issue, `No issue for task ${rest[0] ?? ''}`);
      assert(rest[1] && fs.existsSync(rest[1]), 'Usage: agent-issues.mjs comment <ID> <file>');
      gh(`repos/${manifest.repository}/issues/${task.issue}/comments`, 'POST', { body: fs.readFileSync(rest[1], 'utf8') });
      console.log(`Commented on ${task.id} #${task.issue}.`);
    } else {
      const check = rest.includes('--check'), at = rest.indexOf('--only');
      assert(rest.every((arg, i) => arg === '--check' || arg === '--only' || (at >= 0 && i === at + 1)), usage);
      const named = at < 0 ? null : (rest[at + 1] ?? '').split(',').filter(Boolean);
      assert(!named || !check, '--check compares the whole mirror: it takes no --only');
      assert(!named || named.length, usage);
      for (const id of named ?? []) assert(manifest.tasks.some(t => t.id === id), `Unknown task ${id}; use an ID of backlog.json`);
      // A task without an issue needs the full sync, which creates the issue and records its number.
      const targeted = named && manifest.tasks.every(t => t.issue != null);
      const only = targeted ? manifest.tasks.filter(t => t.issue != null && (named.includes(t.id) || t.depends_on.some(id => named.includes(id)))) : null;
      const problems = sync(manifest, check, only);
      for (const problem of problems) console.log(`${check ? 'DRIFT' : 'fixed'} ${problem}`);
      assert(!check || !problems.length, `${problems.length} difference(s) between GitHub and the repository. Run: node scripts/agent-local.mjs publish`);
      const fixed = problems.length ? ` (${problems.length} fixed)` : '';
      console.log(only ? `PASS: the issues of ${only.map(t => t.id).join(', ')} in ${manifest.repository} match the repository${fixed}` : `PASS: ${manifest.tasks.length} issues of ${manifest.repository} match the repository${fixed}`);
    }
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
