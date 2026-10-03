// Fail toward the gate for every change outside the explicit documentation
// set. The files that define the gates (the Makefile, scripts/, the hosted
// workflows and their actions) are runtime: a change to them is proven only
// by running them. Under .github/ only Markdown and the issue and pull
// request templates are documentation: a script or a configuration there runs.
export function needsGate(files) {
  for (const file of files) {
    if (/^\.github\/(workflows|actions)\//.test(file)) return true;
    if (/^docs\//.test(file)) continue;
    if (/^\.github\/(.*\.md|(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\/.*)$/i.test(file)) continue;
    if (['AGENTS.md', 'CLAUDE.md', 'README.md'].includes(file)) continue;
    return true;
  }
  return false;
}

// The agent tooling itself: a branch that changes one of these runs `make
// agent-check` with its task gate, whose stages no longer include the
// tooling's own tests. Every one of them is a runtime file for needsGate.
const tooling = ['scripts/gate.sh', 'scripts/gate.test.mjs', 'scripts/check-docs.test.mjs', 'tests/integration/check-docs.sh', 'Makefile', '.github/workflows/agent-workflow.yml'];
export function toolingChange(files) {
  return [...files].some(file => /^scripts\/agent-[^/]+\.mjs$/.test(file) || tooling.includes(file));
}
