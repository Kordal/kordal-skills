#!/usr/bin/env bash
# Documentation checks, part of `make lint`. For every Markdown file of the
# repository (tracked, or new and not ignored):
#
#   - every relative link points to a file that exists and that Git does not
#     ignore (an ignored file would be missing from a clone);
#   - a link with an anchor to a Markdown file names a heading of that file,
#     and a bare #anchor a heading of its own file;
#   - a reference link, [text][label] or [label][], names a label that the
#     same file defines.
#
# The targets checked are those of an inline link or image, [text](target)
# with or without a title, and of a reference definition written on one line:
# "[label]: target", the target optionally in <angle brackets> and followed by
# a title. External links (http, https, mailto) are not fetched.
#
# Not read, for links, references or headings:
#   - a fenced code block: from a line of three or more backticks or tildes,
#     with or without an info string, to a line of the same character at least
#     as long, or to the end of the file. A fence may be indented and stand
#     behind a block-quote or list marker;
#   - an HTML comment (the scaffold's placeholders are comments);
#   - a code span of one or more backticks, which may wrap inside its paragraph.
# Not checked either: a path named in running text, and a shortcut reference,
# [text] alone, which is also what a task-list checkbox and a footnote look
# like.
#
# This is not a Markdown parser: an indented code block reads as prose, only
# "#" headings give anchors, and a definition spread over several lines counts
# as defined without its target being checked.
#
# Needs git and a local Node.js: `make lint` skips it, saying so, when there is
# none. The task gate (`make task-check`) fails without Node.js all the same,
# at its structure-check stage. The tests of this script,
# scripts/check-docs.test.mjs, belong to `make agent-check`, which is no stage
# of the task gate: `node scripts/agent-local.mjs gate` runs it when the branch
# changes the agent tooling, and the hosted Agent structure workflow runs it on
# the pull request.
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

// The index still lists a file that was deleted and not yet staged: there is nothing to read, and a link to it fails below.
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter((file) => file && fs.existsSync(file));
let failures = 0;
let links = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL  ${message}`);
};

// What is read as Markdown: a file without its fenced code blocks and HTML
// comments, and with no bracket left in its code spans. A span keeps its text,
// which a heading's anchor and a reference label are made of, and loses what
// reads as a link. Whichever opens first wins: a fence line inside a comment
// opens nothing, and "<!--" inside code opens no comment.
const ITEM = "(?:[-*+]|\\d+[.)])[ \\t]";
// A backtick fence has no backtick in its info string: ```x``` is a code span.
const FENCE = "(`{3,}(?![^\\n]*`)|~{3,})";
// A fence stands behind indentation, block-quote and list markers. Any depth, not CommonMark's three spaces: those count
// from the enclosing list item, which nothing here tracks, and a fence that is missed turns its code into prose.
const OPENER = new RegExp("^(?:[ \\t>]|" + ITEM + ")*" + FENCE + "|(?<!\\\\)(?:<!--|`+)", "gm");
// A code span may wrap inside its paragraph. It never crosses a blank line or the start of another block (a list item,
// a table row, a heading, a fence), so that one stray backtick cannot hide the rest of a list.
const BREAK = new RegExp("^[ \\t>]*(?:$|\\||#{1,6}[ \\t]|" + ITEM + "|" + FENCE + ")", "gm");
const prose = new Map();
const proseOf = (file) => {
  if (prose.has(file)) return prose.get(file);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  const find = (pattern, from) => {
    pattern.lastIndex = from;
    return pattern.exec(text);
  };
  const lineAfter = (from) => text.indexOf("\n", from) + 1 || text.length + 1;
  let out = "", at = 0, stop = -1;
  for (let open; (open = find(OPENER, at)); ) {
    const [mark, fence] = open, from = open.index + mark.length;
    // An unclosed fence or comment runs to the end of the file; an unclosed run of backticks is just backticks.
    let end = text.length, kept = "";
    if (fence) {
      const close = find(new RegExp("^[ \\t>]*" + fence[0] + "{" + fence.length + ",}[ \\t]*$", "gm"), lineAfter(from));
      if (close) end = close.index + close[0].length;
    } else if (mark === "<!--") {
      const close = text.indexOf("-->", open.index + 2);
      if (close >= 0) end = close + 3;
      kept = " "; // not nothing: "[a]<!-- -->(b)" is no link
    } else {
      // Where the paragraph ends holds for every span of it: looked up again only once passed.
      const next = lineAfter(from);
      if (stop < next) stop = find(BREAK, next)?.index ?? text.length;
      const close = new RegExp("(?<!`)" + mark + "(?!`)").exec(text.slice(from, stop));
      end = close ? from + close.index + mark.length : from;
      kept = close ? text.slice(open.index, end).replace(/[\[\]]/g, "") : mark;
    }
    out += text.slice(at, open.index) + kept;
    at = end;
  }
  prose.set(file, out + text.slice(at));
  return prose.get(file);
};
// GitHub's heading anchors: lower case, punctuation removed, spaces to hyphens.
const slug = (heading) =>
  heading.trim().toLowerCase().replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
const anchors = new Map();
const anchorsOf = (file) => {
  if (!anchors.has(file)) {
    // A repeated heading gets -1, -2, ... as GitHub numbers it.
    const seen = new Map();
    anchors.set(file, new Set([...proseOf(file).matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => {
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
// Labels match whatever their spacing and, lower-cased where they are compared, their case.
const label = (text) => text.trim().replace(/\s+/g, " ");

for (const file of files) {
  const text = proseOf(file);
  const check = (link) => {
    let target = link;
    try { target = decodeURIComponent(target); } catch { /* not percent-encoded */ }
    if (/^(https?:|mailto:)/.test(target)) return;
    links += 1;
    const [relative, anchor] = target.split("#");
    const resolved = relative === "" ? file : path.normalize(path.join(path.dirname(file), relative));
    if (!fs.existsSync(resolved)) return fail(`${file}: link to ${target}: ${resolved} does not exist`);
    if (ignored(resolved)) fail(`${file}: link to ${target}: ${resolved} is ignored by Git and would be missing from a clone`);
    if (anchor && resolved.endsWith(".md") && !anchorsOf(resolved).has(anchor)) fail(`${file}: link to ${target}: no heading "#${anchor}" in ${resolved}`);
  };
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) check(match[1]);
  // "[^note]: text" is a footnote. Any other line that starts with "[label]:" defines its label, also in a form whose
  // target is not read here (on the next line): an unread definition must not fail the references to it.
  const defined = new Set();
  for (const match of text.matchAll(/^[ \t>]*\[(?!\^|[ \t]*\])([^\[\]\n]+)\]:[ \t]*(.*)$/gm)) {
    defined.add(label(match[1]).toLowerCase());
    const target = /^(?:<([^<>]+)>|([^\s<>]+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/.exec(match[2]);
    if (target) check(target[1] ?? target[2]);
  }
  for (const match of text.matchAll(/(?<!\\)\[(?!\^)([^\[\]]*)\]\[(?!\^)([^\[\]]*)\]/g)) {
    const name = label(match[2]) || label(match[1]);
    if (name && !defined.has(name.toLowerCase())) fail(`${file}: reference to [${name}]: no definition "[${name}]: <target>" in this file`);
  }
}
if (failures > 0) {
  console.error(`\n${failures} documentation check(s) failed`);
  process.exit(1);
}
console.log(`PASS  ${links} relative links in ${files.length} Markdown files point to existing, tracked files and headings`);
NODE
