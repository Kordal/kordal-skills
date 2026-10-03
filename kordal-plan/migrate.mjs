#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Renames a project that was scaffolded when the unit of planning was called
// an MVP: run in the project root before `/kordal-plan-update` applies the
// scaffold's changes, whose scripts read "milestone".
//
//   - docs/plans/backlog.json: "mvp" becomes "milestone", the integration
//     branch mvp<N> becomes milestone<N>;
//   - docs/product/mvp<N>*: renamed to milestone<N>*, and every Markdown link
//     to them follows;
//   - the branch is renamed locally and on GitHub, and the GitHub milestone
//     "MVP <N>" becomes "Milestone <N>".
//
// GitHub is changed first: a failure there leaves the project untouched and
// the run can be repeated. Nothing is committed. It refuses a dirty tree, a
// task in progress and an integration branch that the checkout does not
// contain: the rename belongs between two milestones, on the base branch
// (main, or the manifest's "base_branch", which the migration keeps as it is).
// AGENT_GH is the gh to run.
const root = process.cwd();
const manifestPath = 'docs/plans/backlog.json';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
const exists = ref => tryGit('rev-parse', '--verify', '--quiet', ref) !== null;
function gh(endpoint, method, data) {
  const args = ['api', endpoint, ...(method ? ['-X', method, '--input', '-'] : [])];
  return JSON.parse(execFileSync(process.env.AGENT_GH ?? 'gh', args, { cwd: root, encoding: 'utf8', input: data ? JSON.stringify(data) : '', stdio: ['pipe', 'pipe', 'pipe'] }) || 'null');
}
const renamed = name => name.replace(/^mvp(\d+)/, 'milestone$1');

try {
  assert(fs.existsSync(path.join(root, manifestPath)), `${manifestPath} is missing: run this in the project root`);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
  if (!('mvp' in manifest)) {
    console.log('Nothing to migrate: backlog.json has no "mvp".');
    process.exit(0);
  }
  assert(!('milestone' in manifest), 'backlog.json has both "mvp" and "milestone": resolve that by hand');
  assert(!git('status', '--porcelain'), 'Commit or stash your changes first: the migration should be a commit of its own');
  const branch = manifest.integration_branch, newBranch = renamed(branch);
  const done = task => tryGit('cat-file', '-e', `${branch}:docs/plans/completed/${task.id}-${task.slug}.md`) !== null;
  const inProgress = manifest.tasks.filter(task => exists(`refs/heads/task/${task.id.toLowerCase()}`) && !done(task)).map(task => task.id);
  assert(!inProgress.length, `Finish the tasks in progress first: ${inProgress.join(', ')}`);
  assert(!exists(`refs/heads/${branch}`) || tryGit('merge-base', '--is-ancestor', branch, 'HEAD') !== null, `${branch} holds work this checkout lacks: merge its pull request first, then migrate on the base branch`);

  if (manifest.repository) {
    const repo = `repos/${manifest.repository}`;
    for (const milestone of gh(`${repo}/milestones?state=all&per_page=100`)) {
      const match = /^MVP (\d+)$/.exec(milestone.title);
      if (!match) continue;
      gh(`${repo}/milestones/${milestone.number}`, 'PATCH', { title: `Milestone ${match[1]}` });
      console.log(`github   milestone "${milestone.title}" is now "Milestone ${match[1]}"`);
    }
    if (newBranch !== branch && tryGit('ls-remote', '--exit-code', '--heads', 'origin', branch) !== null) {
      gh(`${repo}/branches/${branch}/rename`, 'POST', { new_name: newBranch });
      console.log(`github   branch ${branch} is now ${newBranch}`);
    }
  }
  if (newBranch !== branch && exists(`refs/heads/${branch}`)) {
    git('branch', '-m', branch, newBranch);
    if (manifest.repository) { tryGit('fetch', '--quiet', '--prune', 'origin'); tryGit('branch', '--quiet', `--set-upstream-to=origin/${newBranch}`, newBranch); }
    console.log(`branch   ${branch} is now ${newBranch}`);
  }

  const product = path.join(root, 'docs/product');
  for (const file of fs.existsSync(product) ? fs.readdirSync(product) : []) {
    if (!/^mvp\d+/.test(file)) continue;
    git('mv', `docs/product/${file}`, `docs/product/${renamed(file)}`);
    console.log(`renamed  docs/product/${file} to ${renamed(file)}`);
  }
  let relinked = 0;
  for (const file of git('-c', 'core.quotePath=false', 'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md').split('\n').filter(Boolean)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const next = text.replace(/\bmvp(\d+)((?:-[a-z]+)?\.(?:md|html))/g, 'milestone$1$2');
    if (next !== text) { fs.writeFileSync(path.join(root, file), next); relinked += 1; }
  }
  console.log(`links    ${relinked} Markdown file(s) now point to the renamed documents`);

  const migrated = Object.fromEntries(Object.entries(manifest).map(([key, value]) => key === 'mvp' ? ['milestone', value] : key === 'integration_branch' ? [key, newBranch] : [key, value]));
  fs.writeFileSync(path.join(root, manifestPath), `${JSON.stringify(migrated, null, 2)}\n`);
  console.log(`manifest "mvp" is now "milestone"; integration_branch is ${newBranch}`);
  console.log('Migrated. Review the changes and commit them, then apply the scaffold update.');
} catch (error) {
  console.error(`FAIL: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
  process.exitCode = 1;
}
