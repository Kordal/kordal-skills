import test from 'node:test';
import assert from 'node:assert/strict';
import { baseBranch, section, validateManifest } from './agent-workflow.mjs';

// A hook or `git rebase --exec` exports these: the fixture's Git would then write into the caller's repository.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']) delete process.env[name];

// validateManifest against an in-memory repository: two tasks, the second
// depending on the first and owning an ADR.
const sections = ['Goal', 'Context', 'Task Contract', 'Scope', 'Out of Scope', 'Affected Components', 'Acceptance Criteria', 'Flow', 'Implementation Steps', 'Tests', 'Risks', 'Review', 'Completion Notes'];
const adr = 'docs/adr/001-storage.md';
const body = (task, heading, done) => {
  if (heading === 'Task Contract') return `Issue: ${task.issue ? `#${task.issue}` : 'none'}\n\nDependencies: ${task.depends_on.join(', ') || 'none'}\n`;
  if (heading === 'Acceptance Criteria') return `- [${done ? 'x' : ' '}] Works`;
  return ['Review', 'Completion Notes'].includes(heading) && !done ? 'Pending.' : 'Text.';
};
const plan = (task, done = false) => `# ${task.id}: ${task.title}\n\n` + sections.map(s => `## ${s}\n\n${body(task, s, done)}\n`).join('\n');
function fixture() {
  const tasks = [
    { id: 'CAP-001', title: 'Identity', slug: 'identity', issue: null, depends_on: [], adrs: [] },
    { id: 'CAP-002', title: 'Freshness', slug: 'freshness', issue: 7, depends_on: ['CAP-001'], adrs: [adr] },
  ];
  const files = { [adr]: '# ADR-001: Storage\n\n- **Status:** Proposed\n- **Owning task:** CAP-002\n' };
  for (const task of tasks) files[`docs/plans/planned/${task.id}-${task.slug}.md`] = plan(task);
  const manifest = { version: 1, milestone: 1, integration_branch: 'milestone1', repository: 'owner/product', tasks };
  return { manifest, tasks, files, check: () => validateManifest(manifest, file => files[file] ?? null) };
}
const complete = (f, task) => {
  delete f.files[`docs/plans/planned/${task.id}-${task.slug}.md`];
  f.files[`docs/plans/completed/${task.id}-${task.slug}.md`] = plan(task, true);
};

test('a mapped backlog passes, and so does an empty one', () => {
  fixture().check();
  validateManifest({ version: 1, milestone: 1, integration_branch: 'milestone1', tasks: [] }, () => null);
});
test('the manifest names its milestone and integration branch', () => {
  const f = fixture();
  f.manifest.integration_branch = '';
  assert.throws(f.check, /names no integration_branch/);
  f.manifest.integration_branch = 7;
  assert.throws(f.check, /names no integration_branch/, 'a branch name is a string');
  f.manifest.integration_branch = 'milestone1'; f.manifest.milestone = undefined;
  assert.throws(f.check, /names no milestone number/);
});
test('the base branch is main unless the manifest names another branch, which is not the integration branch', () => {
  const f = fixture();
  f.check();
  assert.equal(baseBranch(f.manifest), 'main', 'a manifest without base_branch keeps working');
  f.manifest.base_branch = null;
  f.check();
  assert.equal(baseBranch(f.manifest), 'main');
  for (const branch of ['master', 'release/2-x', 'Main', 'release-1.x', 'feature_x']) {
    f.manifest.base_branch = branch;
    f.check();
    assert.equal(baseBranch(f.manifest), branch);
  }
  for (const invalid of ['', 'release 1', '-main', '../main', 'a..b', 'main/', 'a//b', 'main.lock', 'main.', 'x;rm', '$(x)', 7, true, ['main']]) {
    f.manifest.base_branch = invalid;
    assert.throws(f.check, /Invalid base_branch/, JSON.stringify(invalid));
  }
  f.manifest.base_branch = 'milestone1';
  assert.throws(f.check, /base_branch must differ from integration_branch/);
});
test('task IDs, issues and dependencies are well formed and acyclic', () => {
  let f = fixture(); f.tasks[1].id = 'CAP-001';
  assert.throws(f.check, /Invalid\/duplicate task ID: CAP-001/);
  f = fixture(); f.tasks[0].issue = 7; f.files['docs/plans/planned/CAP-001-identity.md'] = plan(f.tasks[0]);
  assert.throws(f.check, /Invalid\/duplicate issue: CAP-002/);
  f = fixture(); f.manifest.repository = undefined;
  assert.throws(f.check, /Invalid\/duplicate issue: CAP-002/, 'an issue needs a repository');
  f = fixture(); f.manifest.repository = 'product';
  assert.throws(f.check, /Invalid repository/);
  f = fixture(); f.tasks[1].depends_on = ['CAP-009']; f.files['docs/plans/planned/CAP-002-freshness.md'] = plan(f.tasks[1]);
  assert.throws(f.check, /Unknown dependency CAP-009/);
  f = fixture(); f.tasks[0].depends_on = ['CAP-002']; f.files['docs/plans/planned/CAP-001-identity.md'] = plan(f.tasks[0]);
  assert.throws(f.check, /Dependency cycle at CAP-001/);
});
test('every task has one plan that agrees with the manifest', () => {
  let f = fixture(); delete f.files['docs/plans/planned/CAP-001-identity.md'];
  assert.throws(f.check, /CAP-001 must have exactly one plan/);
  f = fixture(); f.files['docs/plans/active/CAP-001-identity.md'] = plan(f.tasks[0]);
  assert.throws(f.check, /CAP-001 must have exactly one plan/);
  f = fixture(); f.tasks[0].title = 'Renamed';
  assert.throws(f.check, /CAP-001 plan title differs from manifest/);
  f = fixture(); f.tasks[1].depends_on = [];
  assert.throws(f.check, /CAP-002 plan dependencies differ from manifest/);
  f = fixture(); f.tasks[1].issue = 8;
  assert.throws(f.check, /CAP-002 plan issue differs from manifest/);
});
test('a plan fills every section; a comment is not content', () => {
  const f = fixture();
  f.files['docs/plans/planned/CAP-001-identity.md'] = plan(f.tasks[0]).replace('## Risks\n\nText.', '## Risks\n\n<!-- Known risks. -->');
  assert.throws(f.check, /CAP-001 missing section: Risks/);
  assert.equal(section('## A\n\n<!-- hint -->\n\n## B\n\nText.\n', 'A'), '');
});
test('a completed task has met criteria, a recorded review, completion notes and Accepted ADRs', () => {
  let f = fixture(); complete(f, f.tasks[0]);
  f.check();
  f.files['docs/plans/completed/CAP-001-identity.md'] = plan(f.tasks[0], true).replace('- [x] Works', '- [x] Works\n- [ ] Fails safely');
  assert.throws(f.check, /CAP-001 has incomplete acceptance criteria/);
  f.files['docs/plans/completed/CAP-001-identity.md'] = plan(f.tasks[0], true).replace('## Completion Notes\n\nText.', '## Completion Notes\n\nPending.');
  assert.throws(f.check, /CAP-001 missing completion Completion Notes/);
  f.files['docs/plans/completed/CAP-001-identity.md'] = plan(f.tasks[0], true).replace('## Review\n\nText.', '## Review\n\nPending.');
  assert.throws(f.check, /CAP-001 missing completion Review/, 'an unreviewed task is not complete');
  f = fixture(); complete(f, f.tasks[0]); complete(f, f.tasks[1]);
  assert.throws(f.check, /CAP-002 requires Accepted docs\/adr\/001-storage\.md/);
  f.files[adr] = f.files[adr].replace('Proposed', 'Accepted');
  f.check();
  delete f.files[adr];
  assert.throws(f.check, /CAP-002 missing ADR/);
});
test('the command fails on an invalid manifest, also when run through a symlink, and passes one that names its base branch', async t => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { spawnSync } = await import('node:child_process'), { fileURLToPath } = await import('node:url');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workflow-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'project/scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'project/docs/plans'), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('./agent-workflow.mjs', import.meta.url)), path.join(dir, 'project/scripts/agent-workflow.mjs'));
  fs.writeFileSync(path.join(dir, 'project/docs/plans/backlog.json'), JSON.stringify({ version: 2 }));
  fs.symlinkSync(path.join(dir, 'project'), path.join(dir, 'link'));
  for (const root of ['project', 'link']) {
    const result = spawnSync(process.execPath, [path.join(dir, root, 'scripts/agent-workflow.mjs'), 'check'], { encoding: 'utf8' });
    assert.equal(result.status, 1, root);
    assert.match(result.stderr, /FAIL: Unsupported manifest version/);
  }
  // A named base branch is validated and changes nothing in what a pass prints.
  const check = base_branch => {
    fs.writeFileSync(path.join(dir, 'project/docs/plans/backlog.json'), JSON.stringify({ version: 1, milestone: 1, integration_branch: 'milestone1', base_branch, tasks: [] }));
    return spawnSync(process.execPath, [path.join(dir, 'project/scripts/agent-workflow.mjs'), 'check'], { encoding: 'utf8' });
  };
  assert.equal(check('master').stdout, 'PASS: 0 task contracts, plans, ADR references and dependency graph\n');
  assert.match(check('milestone1').stderr, /FAIL: base_branch must differ from integration_branch/);
});
