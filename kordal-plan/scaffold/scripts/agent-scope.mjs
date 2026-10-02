// Fail toward the gate for every change outside the explicit documentation
// set. The files that define the gates (the Makefile, scripts/, the hosted
// workflows and their actions) are runtime: a change to them is proven only
// by running them, and `make pr-check` runs the agent tooling's own tests.
export function needsGate(files) {
  for (const file of files) {
    if (/^\.github\/(workflows|actions)\//.test(file)) return true;
    if (/^(docs\/|\.github\/)/.test(file)) continue;
    if (['AGENTS.md', 'CLAUDE.md', 'README.md'].includes(file)) continue;
    return true;
  }
  return false;
}
