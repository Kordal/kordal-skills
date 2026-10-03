import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This repository against itself. The skills, the agents, the scaffold and the
// README name each other's commands, files, sections, make targets and flags,
// and no script fails when such a name goes stale: an agent then follows an
// instruction to something that is not there. Every check reads the working
// tree, not Git, and its message names the file to fix.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scaffold = 'kordal-plan/scaffold';
const at = file => path.join(root, file);
const read = file => fs.readFileSync(at(file), 'utf8');
const exists = file => fs.existsSync(at(file));
// Every file of the working tree, as a path from the root. Of the dot
// directories only .github is the repository's: .git and whatever an editor or
// an agent keeps beside it are not.
function walk(dir = '') {
  return fs.readdirSync(at(dir), { withFileTypes: true }).flatMap(entry => {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return (entry.name.startsWith('.') && entry.name !== '.github') || entry.name === 'node_modules' ? [] : walk(file);
    return entry.name === '.DS_Store' ? [] : [file];
  }).sort();
}
const files = walk();
const inScaffold = file => file.startsWith(`${scaffold}/`);
const markdown = files.filter(file => file.endsWith('.md'));
// What is written to be followed: everything but the tests, which build old and broken projects on purpose, and the license.
const written = files.filter(file => !file.endsWith('.test.mjs') && file !== 'LICENSE');
const skills = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('kordal-')).map(entry => entry.name).sort();
const skillFile = skill => `${skill}/SKILL.md`;
const agents = files.filter(file => /^agents\/[^/]+\.md$/.test(file)).map(file => path.basename(file, '.md'));
// Every finding of a check at once, each naming its file: one run shows all there is to fix.
const none = (problems, what) => assert.equal(problems.length, 0, `${what}:\n  ${problems.join('\n  ')}`);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// What a Markdown file says as code, one piece per line: its fenced blocks and its code spans.
const code = text => [...text.matchAll(/^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$|`([^`\n]+)`/gm)].map(match => match[2] ?? match[3]).join('\n');
const spans = text => [...text.matchAll(/`([^`\n]+)`/g)].map(match => match[1]);
// The lines of a section: from its heading to the next heading of the same or a higher level.
function sectionOf(file, heading) {
  const lines = read(file).split('\n'), start = lines.indexOf(heading);
  assert.ok(start >= 0, `${file}: no heading "${heading}"`);
  const level = /^#+/.exec(heading)[0].length, end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}
// The rows of the first table of a section, without its two header lines: the cells of each row.
function tableOf(file, heading) {
  const lines = sectionOf(file, heading), start = lines.findIndex(line => line.startsWith('|')), end = lines.findIndex((line, i) => i > start && !line.startsWith('|'));
  assert.ok(start >= 0, `${file}: no table under "${heading}"`);
  return lines.slice(start + 2, end < 0 ? undefined : end).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}
// The frontmatter of a skill or an agent: `key: value` lines between two `---`
// lines. A value that YAML would not read as plain text (it starts with an
// indicator, or holds ": " or " #") stands in double quotes.
function frontmatter(file) {
  const block = /^---\n([\s\S]*?)\n---\n+\S/.exec(read(file));
  assert.ok(block, `${file}: no frontmatter between two "---" lines at its top, followed by its text`);
  const pairs = block[1].split('\n').map(line => {
    const [, key, value] = /^([a-z][a-z-]*): (\S.*)$/.exec(line) ?? [];
    assert.ok(key, `${file}: the frontmatter line "${line}" is not "key: value"`);
    const quoted = /^"(?:[^"\\]|\\.)*"$/.test(value);
    assert.ok(quoted || !/^[-\[\]{}&*!|>'"%@`#,?]|: | #/.test(value), `${file}: the value of "${key}" needs double quotes to be valid YAML: ${value}`);
    return [key, quoted ? JSON.parse(value) : value];
  });
  assert.equal(new Set(pairs.map(([key]) => key)).size, pairs.length, `${file}: a frontmatter key stands twice`);
  return Object.fromEntries(pairs);
}
// The targets of a Makefile.
const targets = file => [...read(file).matchAll(/^([a-z][a-z-]*):/gm)].map(match => match[1]);
// make as a test needs it: neither the flags nor the level of the make that runs these tests (`make check`).
const { MAKEFLAGS, MFLAGS, MAKELEVEL, ...outside } = process.env;
const make = (cwd, args, env = {}) => spawnSync('make', args, { cwd, encoding: 'utf8', env: { ...outside, ...env } });
// A directory of its own, removed when the test ends.
function temporary(t, name) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };


// The skills and the agents.
test('every kordal-* directory is a skill and every skill is such a directory: a SKILL.md whose frontmatter names it', () => {
  assert.ok(skills.length > 0, 'no kordal-* directory: this is not the repository root');
  const found = files.filter(file => path.basename(file) === 'SKILL.md'), expected = skills.map(skillFile);
  none([...expected.filter(file => !found.includes(file)).map(file => `${file} is missing: every kordal-* directory of the root is a skill`),
    ...found.filter(file => !expected.includes(file)).map(file => `${file}: a SKILL.md that is not in a kordal-* directory of the root`)], 'The skills and the kordal-* directories differ');
  for (const skill of skills) {
    const file = skillFile(skill), meta = frontmatter(file);
    assert.equal(meta.name, skill, `${file}: its name is not its directory`);
    assert.ok(meta.description?.length >= 20 && meta.description.length <= 1024, `${file}: its description is missing, or not between 20 and 1024 characters`);
    assert.ok(['true', 'false'].includes(meta['disable-model-invocation']), `${file}: disable-model-invocation is neither true nor false`);
  }
});
test('only /kordal-build-ship waits for the owner to type it: disable-model-invocation is true there and false in every other skill', () => {
  for (const skill of skills) {
    const file = skillFile(skill), expected = String(skill === 'kordal-build-ship');
    assert.equal(frontmatter(file)['disable-model-invocation'], expected, `${file}: disable-model-invocation must be ${expected}; the pull request of a milestone is opened on the owner's command alone`);
  }
});
test('a wrapper skill keeps its form: it names a parent that exists and a mode that the parent has', () => {
  // A wrapper is a mode of another skill under a name of its own: <parent>-<the last word of the mode>.
  const form = /^This command is `\/(kordal-[a-z-]+)` in its mode `([^`]+)`\. Read `\$\{CLAUDE_SKILL_DIR\}\/\.\.\/(kordal-[a-z-]+)\/SKILL\.md` in full and follow it with `([^`]+)` as its arguments\.$/m;
  const wrappers = skills.filter(skill => skills.some(parent => skill.startsWith(`${parent}-`) && read(skillFile(skill)).includes(`/../${parent}/SKILL.md`)));
  assert.ok(wrappers.length > 0, 'no wrapper skill found: /kordal-build-all and its like read their parent\'s SKILL.md');
  for (const skill of wrappers) {
    const file = skillFile(skill), [, command, mode, parent, args] = form.exec(read(file)) ?? [];
    assert.ok(command, `${file}: not in the form "This command is \`/<parent>\` in its mode \`<mode>\`. Read \`\${CLAUDE_SKILL_DIR}/../<parent>/SKILL.md\` in full and follow it with \`<arguments>\` as its arguments."`);
    assert.equal(command, parent, `${file}: it is a mode of /${command} and reads the skill of ${parent}`);
    assert.ok(skills.includes(parent), `${file}: its parent ${parent} is no skill`);
    assert.equal(skill, `${parent}-${mode.split(' ').at(-1)}`, `${file}: its name is not its parent's with the mode "${mode}"`);
    assert.ok(args === mode || args === `${mode} $ARGUMENTS`, `${file}: it passes "${args}", not its mode "${mode}"`);
    const row = new RegExp(`^\\| \`${mode}[\` ]`, 'm');
    assert.match(read(skillFile(parent)), row, `${file}: ${skillFile(parent)} has no row for the mode \`${mode}\` in its table of arguments`);
  }
});
test('every ${CLAUDE_SKILL_DIR} path a skill names exists', () => {
  const problems = [];
  for (const skill of skills) {
    for (const [whole, rest] of read(skillFile(skill)).matchAll(/\$\{CLAUDE_SKILL_DIR\}((?:\/[\w.-]+)*)/g)) {
      if (!exists(path.posix.join(skill, rest))) problems.push(`${skillFile(skill)}: ${whole} does not exist`);
    }
  }
  none(problems, 'A skill names a file beside it that is not there');
});
test('every agent is defined under its file\'s name, dispatched by a skill and listed in the README; no document names an agent or a skill directory that does not exist', () => {
  assert.ok(agents.length > 0, 'no agent in agents/');
  const dispatched = skills.map(skill => read(skillFile(skill))).join('\n');
  for (const agent of agents) {
    const file = `agents/${agent}.md`, meta = frontmatter(file);
    assert.equal(meta.name, agent, `${file}: its name is not its file's`);
    assert.ok(meta.description?.length >= 20, `${file}: its description is missing`);
    assert.ok(dispatched.includes(`\`${agent}\``), `${file}: no skill dispatches the agent \`${agent}\``);
  }
  const listed = tableOf('README.md', '## Agents').map(([agent]) => agent.replace(/`/g, ''));
  assert.ok(same(listed, agents), `README.md: its Agents table lists ${listed.join(', ')}; agents/ holds ${agents.join(', ')}`);
  // A name without a slash before it is an agent or a directory of this repository; with one it is a command, checked below.
  const known = new Set([...agents, ...skills, 'kordal-skills']), problems = [];
  for (const file of markdown) {
    for (const [name] of read(file).matchAll(/(?<![\w/.-])kordal-[a-z]+(?:-[a-z]+)*(?![\w-])/g)) if (!known.has(name)) problems.push(`${file}: ${name} is neither an agent of agents/ nor a skill directory`);
  }
  none(problems, 'A document names an agent or a skill directory that does not exist');
});
test('every /kordal-… command named anywhere is a skill', () => {
  const problems = [];
  for (const file of files) {
    for (const [, name] of read(file).matchAll(/(?<![\w.}])\/(kordal-[a-z]+(?:-[a-z]+)*)/g)) if (!skills.includes(name)) problems.push(`${file}: /${name} is no skill of this repository`);
  }
  none(problems, 'A file names a command that does not exist (renamed or removed?)');
});


// The README.
test('the README\'s command table lists every skill, and only skills', () => {
  const listed = [...new Set(tableOf('README.md', '## Commands').map(([command]) => /^`\/(kordal-[a-z-]+)[ `]/.exec(command)?.[1] ?? command))];
  assert.ok(same(listed, skills), `README.md: its Commands table and the skill directories differ: only in the table: ${listed.filter(name => !skills.includes(name)).join(', ') || 'none'}; only as a directory: ${skills.filter(name => !listed.includes(name)).join(', ') || 'none'}`);
});
test('the routing is one text: the README and the scaffold\'s AGENTS.md hold the same table and the same rule for an active milestone', () => {
  const guide = `${scaffold}/AGENTS.md`, here = tableOf('README.md', '## Which command'), there = tableOf(guide, '## How work enters');
  assert.deepEqual(here.map(([level]) => level), ['QUICK', 'FEATURE', 'MILESTONE', 'BUG', 'ISSUE', 'QUESTION'], 'README.md: the levels of its routing table');
  here.forEach((row, n) => assert.deepEqual(row, there[n], `README.md "Which command" and ${guide} "How work enters" differ in the row ${row[0]}`));
  assert.equal(there.length, here.length, `${guide}: its routing table has rows the README lacks`);
  for (const [level, command] of here) assert.match(command, /^`\/kordal-/, `README.md: the ${level} row names no command`);
  const rule = (file, heading) => sectionOf(file, heading).filter(line => /^(QUICK → FEATURE → MILESTONE|During an active milestone)/.test(line));
  assert.equal(rule('README.md', '## Which command').length, 2, 'README.md: "Which command" lacks the ladder sentence or the paragraph "During an active milestone"');
  assert.deepEqual(rule('README.md', '## Which command'), rule(guide, '## How work enters'), `README.md "Which command" and ${guide} "How work enters" word the ladder or the active milestone differently`);
});
test('the README\'s table of what a project gets covers every scaffold file, and names nothing the scaffold lacks', () => {
  const rows = tableOf('README.md', '## What a project gets').map(([paths, contents]) => ({ paths: spans(paths), contents: spans(contents) }));
  const under = (name, file) => name.endsWith('/') ? file.startsWith(name) : new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(file);
  const copied = files.filter(inScaffold).map(file => file.slice(scaffold.length + 1)), named = rows.flatMap(row => row.paths);
  none(named.filter(name => !copied.some(file => under(name, file))).map(name => `README.md: \`${name}\` is not in ${scaffold}/`), 'The table names what the scaffold does not hold');
  none(copied.filter(file => !named.some(name => under(name, file))).map(file => `README.md: no row covers ${scaffold}/${file}`), 'The scaffold holds what the table leaves out');
  const row = name => rows.find(({ paths }) => paths.includes(name))?.contents ?? [];
  const documents = copied.filter(file => /^docs\/agents\/[^/]+\.md$/.test(file)).map(file => path.basename(file));
  assert.ok(same(row('docs/agents/').filter(name => name.endsWith('.md')), documents), `README.md: the row of docs/agents/ names ${row('docs/agents/').join(', ')}; the scaffold holds ${documents.join(', ')}`);
  assert.ok(same(row('scripts/agent-local.mjs'), Object.keys(helper().commands)), `README.md: the row of scripts/agent-local.mjs names ${row('scripts/agent-local.mjs').join(', ')}; the script has ${Object.keys(helper().commands).join(', ')}`);
  const gates = targets(`${scaffold}/Makefile`).filter(target => target !== 'help');
  assert.ok(same(row('Makefile'), gates), `README.md: the row of the Makefile names ${row('Makefile').join(', ')}; the scaffold's Makefile has ${gates.join(', ')}`);
});
test('the README\'s label table lists the state labels that kordal-issue/labels.sh creates', () => {
  const states = [...read('kordal-issue/labels.sh').matchAll(/^(?:labels=')?([a-z][a-z-]+)\|/gm)].map(match => match[1]);
  assert.equal(states.length, 8, `kordal-issue/labels.sh: ${states.length} state labels read from it, not eight`);
  const listed = tableOf('README.md', '## From an issue to a pull request').flatMap(([labels]) => spans(labels));
  assert.ok(same(listed, states), `README.md: its label table lists ${listed.join(', ')}; kordal-issue/labels.sh creates ${states.join(', ')}`);
});
test('the README lists the status labels that scripts/agent-issues.mjs sets', () => {
  const file = `${scaffold}/scripts/agent-issues.mjs`, status = [...(/const statusLabels = \{([^}]*)\}/.exec(read(file))?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map(match => match[1]);
  assert.equal(status.length, 5, `${file}: ${status.length} status labels read from it, not five`);
  const listed = spans(sectionOf('README.md', '## GitHub').find(line => line.includes('status label')) ?? '');
  assert.ok(same(listed, status), `README.md: "GitHub" lists the status labels ${listed.join(', ')}; ${file} sets ${status.join(', ')}`);
});
test('every skill the README says this repository does not ship is one a skill or an agent calls', () => {
  const callers = [...skills.map(skillFile), ...agents.map(agent => `agents/${agent}.md`)].map(read).join('\n');
  const external = sectionOf('README.md', '## Install').filter(line => /skills? this repository does not ship/.test(line)).flatMap(spans).filter(name => /^[a-z][a-z-]+$/.test(name));
  assert.ok(external.length > 0, 'README.md: "Install" no longer says which skills this repository does not ship');
  none(external.filter(name => !callers.includes(`\`${name}\``)).map(name => `README.md: no skill or agent calls the skill \`${name}\``), 'The README lists an external skill nothing calls');
});


// The scaffold, as the skills, the agents and the documents name it.
test('every scaffold file a skill, an agent, a document or a script names exists', () => {
  // A path in the places only the scaffold fills, written without a placeholder or a glob.
  const named = /(?<![\w./${}*-])((?:docs\/agents|scripts|tests\/integration|\.github)\/[\w./-]*[\w/])(?![\w/<*-])/g;
  // bootstrap.sh writes the version there: the one file of docs/agents/ that is not copied.
  const stamp = /^stamp="([^"]+)"$/m.exec(read('kordal-plan/bootstrap.sh'))?.[1];
  assert.ok(stamp, 'kordal-plan/bootstrap.sh: no stamp="..." line names the version file');
  const problems = [];
  for (const file of written) {
    // The scaffold's files and what instructs an agent speak of the project; what lies in the root may speak of this repository.
    const ofRoot = !file.includes('/') || file.startsWith('.github/');
    for (const [name] of read(file).matchAll(named)) {
      if (name !== stamp && !exists(`${scaffold}/${name}`) && !(ofRoot && exists(name))) problems.push(`${file}: ${name} is not in ${scaffold}/`);
    }
  }
  none(problems, 'A file names a scaffold file that does not exist (renamed or removed?)');
});
test('the sections of the scaffold\'s documents that other files point to exist under their exact headings', () => {
  const kept = {
    'docs/agents/workflow.md': ['Sources of truth', 'Deliver one task', 'Gates', 'A parallel round', 'Add a task during delivery', 'First look', 'GitHub mirror', 'Timings'],
    'docs/agents/acceptance.md': ['The acceptance task', 'A standalone feature', 'Open the pull request'],
    'docs/agents/planning.md': ['1. Establish the baseline', '2. Choose one user outcome', '3. Map the journey and agree scope', '4. Resolve major uncertainties', '5. Prepare the delivery backlog', '6. Check readiness and hand off', 'Plan a feature'],
    'AGENTS.md': ['How work enters'],
  };
  const headings = file => read(`${scaffold}/${file}`).split('\n').filter(line => /^#{2,6} /.test(line)).map(line => line.replace(/^#+ /, ''));
  for (const [file, titles] of Object.entries(kept)) {
    for (const title of titles) assert.ok(read(`${scaffold}/${file}`).split('\n').includes(`## ${title}`), `${scaffold}/${file}: the heading "## ${title}" is gone; skills and documents refer to it by that name`);
  }
  // "Deliver one task" of `docs/agents/workflow.md`, the workflow's "First look", "A parallel round" of the workflow.
  const references = [
    [/"([^"\n]+)"(?: section)? (?:of|in) `(docs\/agents\/[a-z]+\.md)`/g, match => [match[2], match[1]]],
    [/workflow's "([^"\n]+)"/g, match => ['docs/agents/workflow.md', match[1]]],
    [/"([^"\n]+)" of the workflow\b/g, match => ['docs/agents/workflow.md', match[1]]],
  ];
  const problems = [];
  let found = 0;
  for (const file of markdown.filter(file => !inScaffold(file))) {
    for (const [pattern, target] of references) {
      for (const match of read(file).matchAll(pattern)) {
        const [document, title] = target(match);
        found += 1;
        if (!exists(`${scaffold}/${document}`) || !headings(document).includes(title)) problems.push(`${file}: "${title}" is no section of ${scaffold}/${document}`);
      }
    }
  }
  assert.ok(found >= 5, `only ${found} references to a section of a scaffold document were read: the skills word them differently now, and this check reads none`);
  none(problems, 'A skill or an agent sends its reader to a section that does not exist');
});
test('the scaffold\'s agent-check names every scripts/*.test.mjs, and only files that exist', () => {
  const file = `${scaffold}/Makefile`, recipe = /^agent-check:.*\n((?:\t.*\n)+)/m.exec(read(file))?.[1] ?? '';
  const named = recipe.split(/\s+/).filter(word => word.endsWith('.mjs')), present = files.filter(name => inScaffold(name) && /\/scripts\/[^/]+\.test\.mjs$/.test(name)).map(name => name.slice(scaffold.length + 1));
  assert.ok(present.length > 0, `${scaffold}/scripts holds no test`);
  none([...present.filter(name => !named.includes(name)).map(name => `${file}: agent-check does not run ${name}`), ...named.filter(name => !present.includes(name)).map(name => `${file}: agent-check names ${name}, which does not exist`)], 'The test list of agent-check and scripts/ differ');
});

// The commands of scripts/agent-local.mjs with the flags of each, and its
// gates, read from its usage text; the option table it checks its arguments
// against has to say the same. Read, never run: `start` would create a branch
// in this repository.
function helper() {
  const file = `${scaffold}/scripts/agent-local.mjs`, source = read(file);
  const usage = /const usage = `([^`]*)`/.exec(source)?.[1], options = /const options = \{([^}]*)\}/.exec(source)?.[1], gates = /const gateNames = \[([^\]]*)\]/.exec(source)?.[1];
  assert.ok(usage && options && gates, `${file}: its usage text, its option table or its gate names are no longer where this test reads them`);
  const commands = Object.fromEntries([...usage.matchAll(/^  ([a-z]+)\b(.*)$/gm)].map(([, name, rest]) => [name, rest.match(/--[a-z-]+/g) ?? []]));
  const checked = Object.fromEntries([...options.matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, name, flags]) => [name, flags.match(/--[a-z-]+/g) ?? []]));
  assert.deepEqual(commands, checked, `${file}: its usage text and its option table name different commands or flags`);
  return { commands, gates: gates.match(/[a-z]+-check/g) };
}
// The commands of scripts/agent-issues.mjs with their flags, from its usage line: `sync [--check | --only <ID>,<ID>] | comment <ID> <file>`.
function mirror() {
  const file = `${scaffold}/scripts/agent-issues.mjs`, source = read(file);
  const usage = /'Usage: agent-issues\.mjs ([^']*)'/.exec(source)?.[1], accepted = /assert\(\[([^\]]*)\]\.includes\(command\)/.exec(source)?.[1];
  assert.ok(usage && accepted, `${file}: its usage line or its command check is no longer where this test reads it`);
  const commands = Object.fromEntries(usage.match(/(?:\[[^\]]*\]|[^|])+/g).map(part => [part.trim().split(' ')[0], part.match(/--[a-z-]+/g) ?? []]));
  assert.deepEqual(Object.keys(commands), accepted.match(/[a-z]+/g), `${file}: its usage line and its command check name different commands`);
  return commands;
}
// A script's name followed by a word, up to the end of its code span or its line, is a call: a name alone stands in a span of its own.
const calls = (text, script) => [...text.matchAll(new RegExp(`${script.replace('.', '\\.')} ([a-z][a-z-]*)([^\`\\n]*)`, 'g'))].map(([, command, rest]) => ({ command, rest }));
const flagsOf = text => text.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? [];
test('every node scripts/agent-local.mjs command, gate and flag named in a Markdown file is one the script has', () => {
  const { commands, gates } = helper(), problems = [];
  let found = 0;
  for (const file of markdown) {
    const text = read(file);
    const wrong = (command, rest, shown) => {
      for (const flag of flagsOf(rest)) if (!commands[command].includes(flag)) problems.push(`${file}: \`${shown}\`: ${command} takes no ${flag}`);
      if (command === 'gate') for (const gate of rest.match(/[a-z]+-check/g) ?? []) if (!gates.includes(gate)) problems.push(`${file}: \`${shown}\`: ${gate} is no gate of the helper (${gates.join(', ')})`);
    };
    for (const { command, rest } of calls(text, 'agent-local.mjs')) {
      found += 1;
      if (!Object.hasOwn(commands, command)) problems.push(`${file}: agent-local.mjs ${command}: the script has no such command (${Object.keys(commands).join(', ')})`);
      else wrong(command, rest, `agent-local.mjs ${command}${rest}`);
    }
    // The short form, a span that opens with a command: `gate pr-check`, `claim <ID>... --no-publish`.
    for (const span of spans(text)) {
      const [command, ...rest] = span.split(' ');
      if (Object.hasOwn(commands, command) && rest.length) wrong(command, rest.join(' '), span);
    }
  }
  assert.ok(found >= 20, `only ${found} calls of the helper were read from the Markdown files: this check reads none of the others`);
  none(problems, 'A document names a command, a gate or a flag that scripts/agent-local.mjs does not have');
});
test('every agent-issues.mjs command and flag named in a Markdown file is one the script has', () => {
  const commands = mirror(), problems = [];
  let found = 0;
  for (const file of markdown) {
    for (const { command, rest } of calls(read(file), 'agent-issues.mjs')) {
      found += 1;
      if (!Object.hasOwn(commands, command)) problems.push(`${file}: agent-issues.mjs ${command}: the script has no such command (${Object.keys(commands).join(', ')})`);
      else for (const flag of flagsOf(rest)) if (!commands[command].includes(flag)) problems.push(`${file}: agent-issues.mjs ${command}${rest}: ${command} takes no ${flag}`);
    }
  }
  assert.ok(found >= 5, `only ${found} calls of the mirror were read from the Markdown files`);
  none(problems, 'A document names a command or a flag that scripts/agent-issues.mjs does not have');
});
// The modes of bootstrap.sh beside its copy mode, from the case that reads its first argument.
function bootstrapModes() {
  const modes = /case "\$\{1:-\}" in ([^)]+)\)/.exec(read('kordal-plan/bootstrap.sh'))?.[1].split('|').map(mode => mode.trim());
  assert.ok(modes?.length, 'kordal-plan/bootstrap.sh: its modes are no longer read from `case "${1:-}" in --a | --b)`');
  return modes;
}
test('every bootstrap.sh flag named in a Markdown file is a mode of bootstrap.sh', () => {
  const modes = bootstrapModes(), problems = [];
  let found = 0;
  for (const file of markdown) {
    // A flag right behind the script's name, or alone in a span of a line that names the script: "then `--stamp`".
    for (const line of read(file).split('\n').filter(line => line.includes('bootstrap.sh'))) {
      const flags = [...[...line.matchAll(/bootstrap\.sh((?: +--[a-z-]+)+)/g)].flatMap(match => flagsOf(match[1])), ...spans(line).filter(span => /^--[a-z-]+$/.test(span))];
      found += flags.length;
      for (const flag of flags) if (!modes.includes(flag)) problems.push(`${file}: bootstrap.sh has no mode ${flag} (${modes.join(', ')})`);
    }
  }
  assert.ok(found >= 4, `only ${found} flags of bootstrap.sh were read from the Markdown files`);
  none(problems, 'A document names a mode that kordal-plan/bootstrap.sh does not have');
});
test('a flag that stands alone in the README or in a scaffold document is one of the helper, the mirror or bootstrap.sh', () => {
  const known = new Set([...Object.values(helper().commands).flat(), ...Object.values(mirror()).flat(), ...bootstrapModes()]), problems = [];
  for (const file of markdown.filter(file => file === 'README.md' || inScaffold(file))) {
    for (const span of spans(read(file))) if (/^--[a-z-]+$/.test(span) && !known.has(span)) problems.push(`${file}: \`${span}\` is a flag of no script of this repository`);
  }
  none(problems, 'A document names a flag that no script has');
});
test('every make target a document, a skill, an agent or a workflow names is a target of the Makefile it speaks of', () => {
  const project = targets(`${scaffold}/Makefile`), repository = targets('Makefile'), problems = [];
  for (const target of ['structure-check', 'agent-check', 'lint', 'test', 'task-check', 'pr-check', 'premerge-check']) assert.ok(project.includes(target), `${scaffold}/Makefile: no target ${target}`);
  let found = 0;
  for (const file of markdown) {
    // The README speaks of both Makefiles; everything else of the project's, which is the scaffold's. A call
    // opens its code span, its line or its part of a command line: "make the chat" inside an example request is none.
    const known = file === 'README.md' ? [...project, ...repository] : project;
    for (const [, target] of code(read(file)).matchAll(/(?:^|[;&|(])[ \t]*make ([a-z][a-z-]*)/gm)) {
      found += 1;
      if (!known.includes(target)) problems.push(`${file}: \`make ${target}\` is no target of ${file === 'README.md' ? 'either Makefile' : `${scaffold}/Makefile`}`);
    }
  }
  assert.ok(found >= 20, `only ${found} make targets were read from the Markdown files`);
  for (const [file, known] of [[`${scaffold}/.github/workflows/agent-workflow.yml`, project], ['.github/workflows/ci.yml', repository]]) {
    const run = [...read(file).matchAll(/^\s*- run: make ([a-z][a-z-]*)$/gm)].map(match => match[1]);
    assert.ok(run.length > 0, `${file}: it runs no make target`);
    for (const target of run) if (!known.includes(target)) problems.push(`${file}: it runs \`make ${target}\`, which is no target of the Makefile beside it`);
  }
  none(problems, 'A file names a make target that does not exist (renamed or removed?)');
});
test('nothing names what the workflow dropped: docs/agents/claude.md, a branch moved by hand, a status: label', () => {
  const dropped = [
    [/(?<![\w-])claude\.md/, 'docs/agents/claude.md is gone, and a case-insensitive file system loads a file of that name as a CLAUDE.md: task delivery is docs/agents/workflow.md, acceptance docs/agents/acceptance.md'],
    [/git branch (?:-f|--force)\b/, 'the integration branch is created and moved by `node scripts/agent-local.mjs start`'],
    [/status:(?:waiting|blocked|ready|in-progress|done)\b/, 'the status labels carry no "status:" prefix'],
  ];
  assert.ok(!exists(`${scaffold}/docs/agents/claude.md`), `${scaffold}/docs/agents/claude.md is back`);
  const problems = [];
  for (const file of written) {
    const text = read(file);
    for (const [pattern, why] of dropped) if (pattern.test(text)) problems.push(`${file}: names "${pattern.exec(text)[0]}": ${why}`);
  }
  none(problems, 'A skill, a document or a script still names what was removed');
});
test('the scaffold loads nothing from a CDN: no file of it names one, and none writes a tag that loads from an address', () => {
  const host = /jsdelivr|unpkg|cdnjs|cloudflare|esm\.sh|skypack|jspm|googleapis|gstatic|bootstrapcdn|(?<![\w-])cdn\.[a-z]/i;
  const load = /<script\b|<link\b|<iframe\b|@import\b|\bsrc\s*=|import\s*\(\s*['"`]https?:|\bfrom\s+['"]https?:/i;
  const problems = [];
  for (const file of written.filter(inScaffold)) {
    const text = read(file);
    for (const pattern of [host, load]) if (pattern.test(text)) problems.push(`${file}: "${pattern.exec(text)[0]}"`);
  }
  none(problems, 'The summary page and every other file of the scaffold work without a connection; one of them names a CDN or loads from an address');
});
test('the repository\'s Markdown passes the scaffold\'s own documentation check: every link, anchor and reference resolves', t => {
  const dir = temporary(t, 'repo-docs');
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.copyFileSync(at(file), path.join(dir, file)); }
  // The check reads the repository it lies in, at tests/integration/.
  write(dir, 'tests/integration/check-docs.sh', read(`${scaffold}/tests/integration/check-docs.sh`));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: dir }).status, 0);
  const result = spawnSync('bash', [path.join(dir, 'tests/integration/check-docs.sh')], { encoding: 'utf8' });
  assert.equal(result.status, 0, `A Markdown file of this repository has a link that leads nowhere:\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, new RegExp(`^PASS  \\d+ relative links in ${markdown.length} Markdown files`), 'every Markdown file was read');
});


// The checks of this repository: the Makefile and the workflow that runs it.
test('make help is the default goal and lists check, syntax, test and smoke; check is those three, in that order', () => {
  const help = make(root, ['help']);
  assert.equal(help.status, 0, help.stderr);
  for (const target of ['check', 'syntax', 'test', 'smoke']) assert.match(help.stdout, new RegExp(`^  make ${target} +\\S`, 'm'), `Makefile: make help does not list ${target}`);
  assert.equal(make(root, []).stdout, help.stdout, 'Makefile: make without a target prints the help');
  assert.match(read('Makefile'), /^check: syntax test smoke ## /m, 'Makefile: check is no longer syntax, then test, then smoke');
  assert.match(read('Makefile'), /^\.NOTPARALLEL:$/m, 'Makefile: the suites may run side by side under -j');
});
test('make test runs every test file of the repository: the scaffold\'s in the scaffold, the others from the root', () => {
  const dry = make(root, ['-n', 'test']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(dry.stdout.trim().split('\n'), ['node --test kordal-plan/*.test.mjs kordal-issue/*.test.mjs tests/*.test.mjs', `cd ${scaffold} && node --test scripts/*.test.mjs`], 'Makefile: make test no longer runs these two commands');
  const run = ['kordal-plan', 'kordal-issue', 'tests', `${scaffold}/scripts`];
  none(files.filter(file => /\.test\.[cm]?js$/.test(file) && !run.includes(path.posix.dirname(file))).map(file => `${file}: no command of make test runs it`), 'A test that make check never runs');
});
test('make syntax parses every shell script, names the one that does not parse, and fails where it finds none', t => {
  const real = make(root, ['syntax']);
  assert.equal(real.status, 0, real.stdout + real.stderr);
  const scripts = files.filter(file => file.endsWith('.sh'));
  assert.ok(scripts.length >= 4, 'the shell scripts of the repository');
  assert.deepEqual(real.stdout.trim().split('\n'), scripts.map(file => `ok    ${file}`));
  const dir = temporary(t, 'repo-syntax');
  write(dir, 'Makefile', read('Makefile'));
  const empty = make(dir, ['syntax']);
  assert.notEqual(empty.status, 0, 'a tree without a shell script is not the repository');
  assert.match(empty.stdout, /^FAIL  no shell script found/);
  write(dir, 'a/good.sh', 'if true; then echo ok; fi\n');
  write(dir, 'b/broken.sh', 'if true; then echo unfinished\n');
  write(dir, 'c/good too.sh', 'echo "a name with a space"\n');
  write(dir, '.git/hooks/sample.sh', 'if then\n');
  const broken = make(dir, ['syntax']);
  assert.notEqual(broken.status, 0, 'a script that does not parse fails the target');
  assert.deepEqual(broken.stdout.trim().split('\n'), ['ok    a/good.sh', 'FAIL  b/broken.sh', 'ok    c/good too.sh'], 'every script is parsed and named, and nothing under .git');
  assert.match(broken.stderr, /b\/broken\.sh: line \d+: syntax error/);
  fs.rmSync(path.join(dir, 'b'), { recursive: true });
  assert.equal(make(dir, ['syntax']).status, 0);
});

// The Makefile beside a bootstrap.sh that records where it was sent and leaves
// a project whose three checks log themselves; SMOKE_FAIL names the one that
// fails, SMOKE_HANG the one that waits to be interrupted.
function smoke(t) {
  const dir = temporary(t, 'repo-smoke'), log = path.join(dir, 'log'), seen = path.join(dir, 'seen');
  write(dir, 'Makefile', read('Makefile'));
  write(dir, 'kordal-plan/bootstrap.sh', `echo "$1" > "$SMOKE_SEEN"
[ "\${SMOKE_FAIL:-}" != bootstrap ] || exit 3
mkdir -p "$1/tests/integration"
printf 'structure-check agent-check:\\n\\t@echo $@ >> "$(SMOKE_LOG)"; [ "$(SMOKE_HANG)" != $@ ] || sleep 30; [ "$(SMOKE_FAIL)" != $@ ]\\n' > "$1/Makefile"
echo 'echo "check-docs in $PWD" >> "$SMOKE_LOG"; [ "\${SMOKE_FAIL:-}" != check-docs ]' > "$1/tests/integration/check-docs.sh"
`);
  const env = extra => ({ ...outside, SMOKE_LOG: log, SMOKE_SEEN: seen, SMOKE_FAIL: '', SMOKE_HANG: '', ...extra });
  const ran = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { dir, env, ran, project: () => fs.readFileSync(seen, 'utf8').trim(), reset: () => { fs.rmSync(log, { force: true }); fs.rmSync(seen, { force: true }); } };
}
test('make smoke bootstraps a temporary project, runs its three checks in order and removes it, also when one of them fails', t => {
  const f = smoke(t);
  const passed = make(f.dir, ['smoke'], f.env());
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  const project = f.project();
  assert.ok(path.isAbsolute(project) && !project.startsWith(f.dir), 'the project is a directory of its own, outside the repository');
  assert.deepEqual(f.ran(), ['structure-check', `check-docs in ${project}`, 'agent-check'], 'the structure check, the documentation check in the project, the tooling tests');
  assert.match(passed.stdout, /^PASS  a bootstrapped project passes /m);
  assert.ok(!fs.existsSync(project), 'the temporary project is removed');
  f.reset();
  const dry = make(f.dir, ['-n', 'smoke'], f.env());
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /bash kordal-plan\/bootstrap\.sh /, 'a dry run prints the recipe');
  assert.ok(!fs.existsSync(path.join(f.dir, 'seen')) && f.ran().length === 0, 'a dry run bootstraps nothing and runs no check');
  for (const [stage, ran] of [['bootstrap', 0], ['structure-check', 1], ['check-docs', 2], ['agent-check', 3]]) {
    f.reset();
    const failed = make(f.dir, ['smoke'], f.env({ SMOKE_FAIL: stage }));
    assert.notEqual(failed.status, 0, `a failing ${stage} fails the smoke test`);
    assert.equal(f.ran().length, ran, `nothing runs after a failing ${stage}`);
    assert.doesNotMatch(failed.stdout, /^PASS /m);
    assert.ok(!fs.existsSync(f.project()), `the temporary project is removed after a failing ${stage}`);
  }
  // Without a temporary directory there is nothing to bootstrap into, and nothing the recipe may remove.
  f.reset();
  write(f.dir, 'bin/mktemp', '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(f.dir, 'bin/mktemp'), 0o755);
  const nowhere = make(f.dir, ['smoke'], f.env({ PATH: `${path.join(f.dir, 'bin')}${path.delimiter}${process.env.PATH}` }));
  assert.notEqual(nowhere.status, 0, 'a failing mktemp fails the smoke test');
  assert.ok(!fs.existsSync(path.join(f.dir, 'seen')), 'nothing is bootstrapped without a temporary directory');
  assert.ok(fs.existsSync(path.join(f.dir, 'Makefile')) && fs.existsSync(path.join(f.dir, 'kordal-plan/bootstrap.sh')), 'the repository is still there after a failing mktemp');
});
test('make smoke removes the temporary project when it is interrupted', async t => {
  const f = smoke(t);
  // Its own process group, as a cancelled CI step: the signal reaches make, the recipe and the check that hangs.
  const child = spawn('make', ['smoke'], { cwd: f.dir, env: f.env({ SMOKE_HANG: 'agent-check' }), detached: true, stdio: 'ignore' });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* it ended, as it should */ } });
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve(code ?? signal)));
  const wait = async (until, what) => { for (let n = 0; !until(); n++) { assert.ok(n < 200, what); await new Promise(resolve => setTimeout(resolve, 50)); } };
  await wait(() => f.ran().includes('agent-check'), 'the smoke test never reached its last check');
  const project = f.project();
  assert.ok(fs.existsSync(project), 'the project exists while its checks run');
  process.kill(-child.pid, 'SIGTERM');
  assert.notEqual(await closed, 0, 'an interrupted smoke test fails');
  // The recipe's shell removes the project as it exits, which make does not wait for.
  await wait(() => !fs.existsSync(project), 'the temporary project is still there after the interruption');
});
test('the CI workflow runs make check on pull requests and on pushes to main, read-only, with the scaffold\'s action pins', () => {
  const file = '.github/workflows/ci.yml', text = read(file), theirs = read(`${scaffold}/.github/workflows/agent-workflow.yml`);
  const uses = source => source.split('\n').filter(line => /^\s*- uses: /.test(line)).map(line => line.trim());
  assert.ok(uses(text).length >= 2, `${file}: it checks out the repository and sets up Node.js`);
  for (const line of uses(text)) {
    assert.match(line, /^- uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+/, `${file}: "${line}" is not pinned to a commit, with its version as a comment`);
    assert.ok(uses(theirs).includes(line), `${file}: "${line}" is not pinned as ${scaffold}/.github/workflows/agent-workflow.yml pins it: ${uses(theirs).join('; ')}`);
  }
  const node = /^\s*node-version: .*$/m;
  assert.equal(node.exec(text)?.[0].trim(), node.exec(theirs)[0].trim(), `${file}: not the Node.js version of the scaffold's workflow`);
  assert.match(text, /^on:\n  pull_request:\n  push:\n    branches: \[main\]\n/m, `${file}: it runs on pull requests and on pushes to main`);
  assert.match(text, /^permissions:\n  contents: read\n(?! )/m, `${file}: its permissions are contents: read and nothing else`);
  assert.doesNotMatch(text, /\bwrite\b|secrets\.|_TOKEN\b/, `${file}: it needs no write permission, secret or token: GitHub is a fake gh in every test`);
  assert.match(text, /^concurrency:\n  group: \S/m, `${file}: no concurrency group`);
  assert.match(text, /^    timeout-minutes: \d+$/m, `${file}: no timeout`);
  assert.match(text, /^          persist-credentials: false$/m, `${file}: the checkout keeps its credentials`);
  assert.deepEqual(text.split('\n').filter(line => /^\s*- run: /.test(line)).map(line => line.trim()), ['- run: make check'], `${file}: it runs make check and nothing else`);
});
