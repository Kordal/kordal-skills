#!/usr/bin/env bash
# Documentation checks, part of `make lint`. For every Markdown file of the
# repository (tracked, or new and not ignored):
#
#   - every relative link points to a file that exists and that Git does not
#     ignore (an ignored file would be missing from a clone);
#   - a link with an anchor to a Markdown file names a heading of that file.
#
# Only inline links — [text](target), with or without a title — are checked; a path named in running
# text or in a code span is not. External links (http, https, mailto) are not
# fetched. Needs git and a local Node.js: `make lint` skips it, saying so,
# when there is none; the gate (`make pr-check`) runs `make agent-check`, which requires it.
set -euo pipefail

cd "$(dirname "$0")/../.."

list=$(mktemp)
trap 'rm -f "$list"' EXIT
files=$(git -c core.quotePath=false ls-files --cached --others --exclude-standard -- '*.md')
printf '%s\n' "$files" >"$list"
if [ -z "$files" ]; then
	echo "FAIL  check-docs.sh found no Markdown files: not the repository root, or git failed"
	exit 1
fi

node - "$list" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
let failures = 0;
let links = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL  ${message}`);
};
// GitHub's heading anchors: lower case, punctuation removed, spaces to hyphens.
const slug = (heading) =>
  heading.trim().toLowerCase().replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
const anchors = new Map();
const anchorsOf = (file) => {
  if (!anchors.has(file)) {
    const text = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    // A repeated heading gets -1, -2, ... as GitHub numbers it.
    const seen = new Map();
    anchors.set(file, new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => {
      const base = slug(match[1]), count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    })));
  }
  return anchors.get(file);
};
const ignored = (file) => {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

for (const file of files) {
  const text = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    let target = match[1];
    try { target = decodeURIComponent(target); } catch { /* not percent-encoded */ }
    if (/^(https?:|mailto:)/.test(target)) continue;
    links += 1;
    const [relative, anchor] = target.split("#");
    const resolved = relative === "" ? file : path.normalize(path.join(path.dirname(file), relative));
    if (!fs.existsSync(resolved)) {
      fail(`${file}: link to ${target}: ${resolved} does not exist`);
      continue;
    }
    if (ignored(resolved)) fail(`${file}: link to ${target}: ${resolved} is ignored by Git and would be missing from a clone`);
    if (anchor && resolved.endsWith(".md") && !anchorsOf(resolved).has(anchor)) fail(`${file}: link to ${target}: no heading "#${anchor}" in ${resolved}`);
  }
}
if (failures > 0) {
  console.error(`\n${failures} documentation check(s) failed`);
  process.exit(1);
}
console.log(`PASS  ${links} relative links in ${files.length} Markdown files point to existing, tracked files and headings`);
NODE
