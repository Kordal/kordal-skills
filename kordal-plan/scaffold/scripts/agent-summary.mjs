import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { section, validateManifest } from './agent-workflow.mjs';

// The implementation summary of the milestone being planned
// (docs/agents/planning.md, stage 5): one HTML page for the owner, generated
// from the scope, the manifest, the unfinished tasks' plans and their ADRs.
// It is a view, never a source: regenerate it, do not edit it. The page is
// finished when it is written: static HTML and CSS, no script, and nothing
// loaded from a CDN or any other address. It opens without a connection, and
// no text of a plan, the manifest or an ADR can run in the owner's browser.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const folded = ['Scope', 'Out of Scope', 'Affected Components', 'Implementation Steps', 'Tests', 'Risks'];

// Every value goes through esc on its way into the page, as text and as an
// attribute value alike, so both quote characters are escaped.
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = text => String(text).replace(/[&<>"']/g, c => entities[c]);
const unesc = text => text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => Object.keys(entities).find(c => entities[c] === entity));
// An ID becomes id="..." and href="#...": only letters, digits, "-" and "_" survive.
const anchor = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

// Only http, https, mailto and targets without a scheme (relative paths,
// anchors) become links: a target whose first path segment holds a ":" or the
// "&" of a character reference is refused. A browser drops control characters
// and spaces around a URL, and tabs and newlines inside it, before it reads
// the scheme: they are dropped first, and the link carries exactly the string
// that was checked.
function safeHref(target) {
  const url = target.replace(/[\u0000-\u001f \u007f-\u009f]/g, '');
  return url && /^(?:https?:|mailto:|[^:&/?#]*(?:[/?#]|$))/i.test(url) ? url : null;
}
// The page lies in docs/product/, and a relative target is written from its own
// document: a plan in docs/plans/<phase>/, an ADR in docs/adr/. It is resolved
// against that document and written from the page's directory; a target
// without a path ("#goal") is the document itself. The result is checked
// again: ".." can bring a later segment to the front, where it would be read
// as a scheme ("../../product/javascript:x" in a plan).
const pageDir = 'docs/product';
function link(target, html, file) {
  let href = safeHref(unesc(target));
  if (href !== null && file && !/^(?:https?:|mailto:|\/)/i.test(href)) {
    const cut = href.search(/[?#]|$/), from = pageDir.split('/');
    const to = path.posix.join(path.posix.dirname(file), href.slice(0, cut) || path.posix.basename(file)).split('/').filter(part => part !== '.');
    let same = 0;
    while (same < from.length && to[same] === from[same]) same++;
    href = safeHref(([...from.slice(same).map(() => '..'), ...to.slice(same)].join('/') || './') + href.slice(cut));
  }
  return href === null ? null : `<a href="${esc(href)}">${html}</a>`;
}

// The Markdown of the plans, rendered here. The source is escaped once, before
// anything else, so every "<", ">" and quote of the result is one this
// renderer wrote: raw HTML in a plan is shown as text. It writes headings,
// paragraphs, lists (task checkboxes as disabled boxes), blockquotes, fenced
// code, tables, rules, code spans, bold, italic and links, and nothing else.
// Its work grows with the length of the text, not with its square: no pattern
// looks for its end again from every start on a long line. Lists, quotes and
// emphasis nest by recursion: past maxDepth what is left is written flat, so
// that a line of a thousand markers ends as text and not as a stack overflow.
const maxDepth = 32;
const punctuation = /[!-\/:-@\[-`{-~]/.source;
const token = new RegExp([
  /(?<!`)(`+)(?!`)([^]*?[^`])\1(?!`)/,                           // 1, 2: a code span
  new RegExp(`\\\\(&(?:amp|lt|gt|quot|#39);|${punctuation})`),   // 3: a backslash escape
  // 4, 5, 6: a link or an image. Its title ends at the first quote of its kind that is not escaped.
  /(!?)\[((?:[^\[\]\\]|\\[^]|\[[^\[\]]*\])*)\]\( *((?:[^\s()\\]|\\[^]|\([^\s()]*\))*)(?: +(?:&quot;(?:[^&\\]|\\[^]|&(?!quot;))*&quot;|&#39;(?:[^&\\]|\\[^]|&(?!#39;))*&#39;))? *\)/,
  /&lt;(https?:\/\/(?:[^\s&]|&(?![lg]t;))*)&gt;/,                // 7: an autolink, which holds no angle bracket
  /(?<![A-Za-z0-9])(https?:\/\/(?:[^\s&]|&amp;)+)/,              // 8: a bare URL
].map(part => part.source).join('|'), 'g');
const backslash = new RegExp(`\\\\(?=${punctuation})`, 'g');
// Punctuation that ends the sentence, and a bracket opened before the URL, are
// not part of it. The text is escaped by now: the ";" that closes the "&amp;"
// of a URL ending in "&" is part of it.
const trimUrl = url => {
  let end = url.length;
  for (let extra = url.split(')').length - url.split('(').length; (/[.,;:!?*_~]/.test(url[end - 1] ?? '') && !url.endsWith('&amp;', end)) || (url[end - 1] === ')' && extra-- > 0);) end--;
  return url.slice(0, end);
};
// Bold runs from its opener to the first closer after it. An opener without a
// closer ends the search, since no later opener has one either: a line of
// openers is read once, not once for each of them.
const stars = [/(?<!\*)\*\*(?=\**[^\s*])/g, /\S\*\*(?!\*)/g], underscores = [/(?<![A-Za-z0-9_])__(?=\S)/g, /\S__(?![A-Za-z0-9_])/g];
function bold(run, [open, close], write) {
  let out = '', from = 0;
  for (;;) {
    open.lastIndex = from;
    const opened = open.exec(run), start = open.lastIndex;
    close.lastIndex = start;
    const closed = opened && close.exec(run), end = close.lastIndex;
    if (!closed) return out + run.slice(from);
    out += run.slice(from, opened.index) + write(run.slice(opened.index, end), run.slice(start, closed.index + 1));
    from = end;
  }
}
// Whatever is written is kept aside behind a placeholder, so that a later rule
// sees text only and can neither rewrite a tag nor cross one. The source holds
// no NUL: markdown() removes control characters.
function inline(text, file, links = true) {
  const kept = [];
  const keep = html => `\u0000${kept.push(html) - 1}\u0000`;
  const restore = html => html.replace(/\u0000(\d+)\u0000/g, (_, n) => restore(kept[n]));
  // Emphasis holds emphasis ("____a____" is bold in bold), down to maxDepth.
  const wrap = (tag, depth) => (_, inner) => keep(`<${tag}>${depth < maxDepth ? emphasis(inner, depth + 1) : inner}</${tag}>`);
  // "_" marks emphasis only at the edge of a word: snake_case stays as written.
  const emphasis = (run, depth = 0) => bold(bold(run, stars, wrap('strong', depth)), underscores, wrap('strong', depth))
    .replace(/(?<!\*)\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, wrap('em', depth))
    .replace(/(?<![A-Za-z0-9_])_(?=[^\s_])([^_]*?[^\s_])_(?![A-Za-z0-9_])/g, wrap('em', depth));
  return restore(emphasis(text.replace(token, (match, ticks, code, escaped, image, label, target, auto, bare) => {
    if (ticks) return keep(`<code>${code.replace(/^ ([^]+) $/, '$1')}</code>`);
    if (escaped) return keep(escaped);
    if (label !== undefined) {
      // An image becomes a link named by its alternative text: the page loads
      // nothing. A target that is refused leaves the source as written.
      const name = inline(label, file, false);
      if (!links) return keep(name);
      return keep(link(target.replace(/^&lt;(.*)&gt;$/, '$1').replace(backslash, ''), name, file) ?? match);
    }
    if (!links) return keep(match);
    if (auto) return keep(link(auto, auto) ?? match);
    const url = trimUrl(bare);
    return keep(link(url, url) ?? url) + bare.slice(url.length);
  })));
}

// The end of a line is cut by hand: a pattern that ends in " *$" or "#+$"
// starts again at every space or "#" of a long line.
const cut = (text, char) => { let end = text.length; while (end && text[end - 1] === char) end--; return text.slice(0, end); };
const fence = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,}) *(\S*)/;
const heading = /^ {0,3}(#{1,6})(?: +|$)(.*)$/;
// The text of a heading ends before its closing "#"s, which a space sets apart.
const headingText = rest => { const text = cut(rest, ' '), open = cut(text, '#'); return open.endsWith(' ') ? cut(open, ' ') : text; };
const rule = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const quote = /^ {0,3}&gt; ?/;
const bullet = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;
// Of a line without the spaces it ends in (cut).
const tableRule = /^ {0,3}\|? *:?-+:? *(?:\| *:?-+:? *)*\|?$/;
const cells = row => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
const indent = line => line.search(/\S|$/);
// A Mermaid block (the Flow of a plan) is shown as its source: drawing it
// takes the Mermaid library, and the page loads nothing.
const codeBlock = (info, body) => /^mermaid$/i.test(info)
  ? `<figure class="source"><figcaption>Mermaid source: rendered in the Markdown file on GitHub</figcaption><pre><code>${body}</code></pre></figure>`
  : `<pre><code>${body}</code></pre>`;

// The blocks of escaped lines; `tight` writes a leading paragraph without its
// <p>, as the text of a list item beside its bullet or checkbox. A list item
// and a quote are blocks of their own, one call deeper: past maxDepth they
// are one paragraph.
function blocks(lines, file, depth = 0, tight = false) {
  if (depth > maxDepth) {
    const flat = inline(lines.map(line => line.trim()).filter(Boolean).join('\n'), file);
    return tight || !flat ? flat : `<p>${flat}</p>`;
  }
  const out = [];
  const tableAt = at => lines[at].includes('|') && tableRule.test(cut(lines[at + 1] ?? '', ' ')) && cells(lines[at]).length === cells(lines[at + 1]).length;
  // What ends a paragraph: a blank line or the start of another block.
  const starts = at => !lines[at].trim() || [fence, heading, rule, quote].some(block => block.test(lines[at])) || /^ {0,3}(?:[-*+]|1[.)]) +\S/.test(lines[at]) || tableAt(at);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    let m;
    if (!line.trim()) i++;
    else if ((m = fence.exec(line))) {
      // Closed by a fence of the same character, at least as long; an unclosed block runs to the end.
      const close = new RegExp(`^ {0,3}${m[2][0]}{${m[2].length},} *$`), body = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i].slice(Math.min(indent(lines[i]), m[1].length)));
      i++;
      out.push(codeBlock(m[3], body.join('\n')));
    } else if ((m = heading.exec(line))) {
      out.push(`<h${m[1].length}>${inline(headingText(m[2]), file)}</h${m[1].length}>`);
      i++;
    } else if (rule.test(line)) {
      out.push('<hr>');
      i++;
    } else if (quote.test(line)) {
      const quoted = [];
      for (; i < lines.length && quote.test(lines[i]); i++) quoted.push(lines[i].replace(quote, ''));
      out.push(`<blockquote>${blocks(quoted, file, depth + 1)}</blockquote>`);
    } else if (tableAt(i)) {
      const head = cells(line), rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      const row = (tag, values) => `<tr>${head.map((_, n) => `<${tag}>${inline(values[n] ?? '', file)}</${tag}>`).join('')}</tr>`;
      out.push(`<table><thead>${row('th', head)}</thead><tbody>${rows.map(values => row('td', values)).join('')}</tbody></table>`);
    } else if ((m = bullet.exec(line))) {
      const ordered = /\d/.test(m[2]), first = parseInt(m[2], 10), items = [];
      const sibling = at => { const s = bullet.exec(lines[at] ?? ''); return s && /\d/.test(s[2]) === ordered && !rule.test(lines[at]) ? s : null; };
      for (let s; (s = sibling(i));) {
        // An item holds what is indented to its text; its content is parsed as blocks of its own.
        const width = s[1].length + s[2].length + (s[3].length > 4 ? 1 : s[3].length || 1), item = [lines[i].slice(width)];
        let next = i;
        for (i++; i < lines.length; i++) {
          if (!lines[i].trim()) {
            // A blank line stays in the item only when indented content follows
            // it: the next line with text, looked up once for a run of blank lines.
            for (next = Math.max(next, i); next < lines.length && !lines[next].trim();) next++;
            if (next === lines.length || indent(lines[next]) < width) break;
            item.push('');
          } else if (indent(lines[i]) >= width) item.push(lines[i].slice(width));
          else if (starts(i) || bullet.test(lines[i])) break;
          else item.push(lines[i].trim());
        }
        items.push(item);
        while (i < lines.length && !lines[i].trim()) i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}${ordered && first !== 1 ? ` start="${first}"` : ''}>${items.map(([text, ...rest]) => {
        const box = /^\[([ xX])\](?: +|$)/.exec(text);
        return `<li>${box ? `<input type="checkbox" disabled${box[1] === ' ' ? '' : ' checked'}> ` : ''}${blocks([text.slice(box?.[0].length ?? 0), ...rest], file, depth + 1, true)}</li>`;
      }).join('')}</${tag}>`);
    } else {
      const text = [line.trim()];
      for (i++; i < lines.length && !starts(i); i++) text.push(lines[i].trim());
      out.push(tight && !out.length ? inline(text.join('\n'), file) : `<p>${inline(text.join('\n'), file)}</p>`);
    }
  }
  return out.join('\n');
}
// `file` names the document the text is from, as its path from the repository
// root: its relative links are then written as the page needs them (link).
// Without it they stay as written.
export function markdown(text, file) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/^\t+/gm, tabs => '    '.repeat(tabs.length));
  return blocks(esc(source).split('\n'), file);
}

// The unfinished tasks in layers by dependency depth, straight from the
// manifest: layer 1 can start now, each later layer needs the ones before it,
// and the tasks of one layer do not depend on each other, so they can run in
// parallel. A dependency that is not among the unfinished tasks is done.
export function dependencyLayers(unfinished) {
  const open = new Set(unfinished.map(task => task.id)), placed = new Set(), layers = [];
  while (placed.size < unfinished.length) {
    const layer = unfinished.filter(task => !placed.has(task.id) && task.depends_on.every(id => !open.has(id) || placed.has(id)));
    if (!layer.length) throw new Error(`Dependency cycle among ${unfinished.filter(task => !placed.has(task.id)).map(task => task.id).join(', ')}`);
    for (const task of layer) placed.add(task.id);
    layers.push(layer.map(task => ({ id: task.id, title: task.title, needs: task.depends_on.map(id => ({ id, done: !open.has(id) })) })));
  }
  return layers;
}

const md = (text, file) => text.trim() ? `<div class="md">${markdown(text, file)}</div>` : '<p class="note">Not stated.</p>';
// As in a plan section, the title line and HTML comments are not content.
// Code is, as written: in a fenced block or a code span a "# " line is no
// title and "<!--" opens no comment. Whichever opens first wins, a code span
// stays in its paragraph, and a comment that is never closed is text: the way
// tests/integration/check-docs.sh reads the same documents.
const listItem = /(?:[-*+]|\d+[.)])[ \t]/.source, fenceMark = /(`{3,}(?![^\n]*`)|~{3,})/.source;
const opener = new RegExp(`^(?:[ \\t>]|${listItem})*${fenceMark}|^# (.+)(?:\\n|$)|(?<!\\\\)<!--|(?<![\\\\\`])\`+`, 'gm');
const paragraphEnd = new RegExp(`^[ \\t>]*(?:$|\\||#{1,6}[ \\t]|${listItem}|${fenceMark})`, 'gm');
function prose(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n'), ticks = /`+/g;
  const find = (pattern, from) => { pattern.lastIndex = from; return pattern.exec(source); };
  const lineAfter = from => source.indexOf('\n', from) + 1 || source.length;
  let title = null, body = '', at = 0, stop = -1, closable = true;
  for (let open; (open = find(opener, at));) {
    const [mark, fenced, heading] = open, from = open.index + mark.length;
    // What the mark opens is kept up to `end`, or dropped; a mark that opens nothing is text.
    let end = from, drop = false, close;
    if (fenced) {
      // Closed by a fence of the same character, at least as long; an unclosed block runs to the end.
      close = find(new RegExp(`^[ \\t>]*${fenced[0]}{${fenced.length},}[ \\t]*$`, 'gm'), lineAfter(from));
      end = close ? close.index + close[0].length : source.length;
    } else if (heading !== undefined) {
      // The first "# " line is the title; a later one is a heading of the text.
      if (title === null) [title, drop] = [heading, true]; else end = open.index + 2;
    } else if (mark === '<!--') {
      // Once one comment has no end, no later one has: the rest is not searched again.
      close = closable ? source.indexOf('-->', from) : -1;
      if (close < 0) closable = false; else [end, drop] = [close + 3, true];
    } else {
      // A code span ends at the next run of as many backticks, in its own paragraph. Where that ends holds for
      // every span of it: looked up again only once passed.
      const next = lineAfter(from);
      if (stop < next) stop = find(paragraphEnd, next)?.index ?? source.length;
      for (ticks.lastIndex = from; (close = ticks.exec(source)) && close.index < stop && close[0].length !== mark.length;);
      if (close && close.index < stop) end = close.index + mark.length;
    }
    body += source.slice(at, drop ? open.index : end);
    at = end;
  }
  return { title, body: body + source.slice(at) };
}
const pill = (text, kind, href) => href ? `<a class="pill${kind && ` ${kind}`}" href="${esc(href)}">${esc(text)}</a>` : `<span class="pill${kind && ` ${kind}`}">${esc(text)}</span>`;

// `planFiles` names the file of a plan by task ID, for its relative links: a
// plan without one is taken as planned. The scope lies beside the page, and
// an ADR comes with its file.
export function buildSummary({ manifest, scope, plans, adrs, revision, date, planFiles = {} }) {
  const unfinished = manifest.tasks.filter(task => plans[task.id]);
  const open = new Set(unfinished.map(task => task.id));
  const blocked = unfinished.filter(task => task.external_blocker);
  const page = prose(scope), title = page.title ?? `Milestone ${manifest.milestone}`;
  const planFile = task => planFiles[task.id] ?? `docs/plans/planned/${task.id}-${task.slug}.md`;
  const decisions = adrs.map(({ file, text }) => {
    const parts = prose(text);
    return { id: path.basename(file, '.md'), file, title: parts.title ?? file, status: /\*\*Status:\*\* (\w+)/.exec(text)?.[1] ?? 'Unknown', text: parts.body };
  });
  // The issue link is written only for a repository and a number of the shape the manifest check accepts.
  const issueUrl = task => /^[\w.-]+\/[\w.-]+$/.test(manifest.repository ?? '') && Number.isInteger(task.issue) ? `https://github.com/${manifest.repository}/issues/${task.issue}` : null;
  // A finished task has no card on the page, so a finished dependency is text, not a link.
  const need = (id, text) => open.has(id) ? pill(text, 'plain', `#${anchor(id)}`) : pill(`${text} done`, 'plain done');
  const adrPill = file => { const id = path.basename(file, '.md'); return pill(`ADR ${id.slice(0, 3)}`, 'plain', decisions.some(adr => adr.id === id) && `#adr-${anchor(id)}`); };

  const nav = '<h2>Summary</h2><a href="#overview">Overview</a><a href="#scope">Scope</a><a href="#dependencies">Task dependencies</a><h2>Tasks</h2>'
    + unfinished.map(task => `<a href="#${anchor(task.id)}"><b>${esc(task.id)}</b>${esc(task.title)}</a>`).join('')
    + (decisions.length ? `<h2>Decisions</h2>${decisions.map(adr => `<a href="#adr-${anchor(adr.id)}">${esc(adr.title)}</a>`).join('')}` : '');
  const stat = (value, name) => `<div class="stat"><b>${esc(value)}</b><span>${name}</span></div>`;
  const header = `<header id="overview"><h1>${esc(title)}</h1>`
    + `<p>Implementation summary, generated ${esc(date)} from revision ${esc(revision)}. A view of the repository: the plans are the source.</p>`
    + `<div class="stats">${stat(unfinished.length, 'tasks to deliver')}${stat(decisions.length, 'architecture decisions')}${stat(blocked.length, 'blocked from outside')}${stat(manifest.integration_branch, 'integration branch')}</div></header>`;
  const layers = dependencyLayers(unfinished).map((layer, n) => `<li><div class="layer-name"><b>Layer ${n + 1}</b><span>${n ? `after layer ${n}` : 'can start now'}${layer.length > 1 ? `, ${layer.length} tasks in parallel` : ''}</span></div><ul>`
    + layer.map(task => `<li>${pill(task.id, '', `#${anchor(task.id)}`)} ${esc(task.title)}<div class="needs">${task.needs.length ? `needs ${task.needs.map(({ id }) => need(id, id)).join(' ')}` : 'no dependencies'}`
      + `${blocked.some(b => b.id === task.id) ? ` ${pill('blocked from outside', 'warn')}` : ''}</div></li>`).join('')
    + '</ul></li>');
  const dependencies = unfinished.length
    ? `<ol class="layers">${layers.join('')}</ol><p class="note">Generated from the manifest. The tasks of one layer do not depend on each other and can run in parallel; each later layer needs the ones before it. A finished dependency is marked done.</p>`
    : '<p class="note">No tasks yet.</p>';
  const card = task => {
    const part = name => md(section(plans[task.id], name), planFile(task));
    return `<div class="card" id="${anchor(task.id)}"><div class="task-head">${pill(task.id, '')}<h3>${esc(task.title)}</h3>${task.issue == null ? '' : pill(`#${task.issue}`, 'plain', issueUrl(task))}</div>`
      + `<div class="meta">${task.depends_on.length ? task.depends_on.map(id => need(id, `needs ${id}`)).join('') : pill('no dependencies', 'plain')}${task.adrs.map(adrPill).join('')}`
      + `${task.external_blocker ? pill(`Blocked: ${task.external_blocker}`, 'warn') : ''}</div>${part('Goal')}`
      + `<div class="cols"><div><h4>Acceptance criteria</h4>${part('Acceptance Criteria')}</div><div><h4>Flow</h4>${part('Flow')}</div></div>`
      + `<details><summary>Scope, components, steps, tests and risks</summary>${folded.map(name => `<h4>${name}</h4>${part(name)}`).join('')}</details></div>`;
  };
  const decision = adr => `<div class="card" id="adr-${anchor(adr.id)}"><div class="task-head"><h3>${esc(adr.title)}</h3>${pill(adr.status, adr.status === 'Accepted' ? '' : 'warn')}</div>${md(adr.text, adr.file)}</div>`;

  // The Content-Security-Policy is the second line of defence: markup that
  // slipped through the escaping could still load and run nothing.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: implementation summary</title>
<style>${style}</style>
</head>
<body>
<div class="layout">
<nav>${nav}</nav>
<main>${header}
<section id="scope"><h2>Scope</h2><div class="card">${md(page.body, `${pageDir}/milestone${manifest.milestone}.md`)}</div></section>
<section id="dependencies"><h2>Task dependencies</h2><div class="card">${dependencies}</div></section>
<section><h2>Tasks</h2>${unfinished.map(card).join('\n')}</section>
${decisions.length ? `<section><h2>Architecture decisions</h2>${decisions.map(decision).join('\n')}</section>` : ''}
</main>
</div>
</body>
</html>
`;
}

const style = `
:root { --bg: #f6f7f9; --card: #ffffff; --text: #1c2330; --muted: #5d6778; --line: #dfe3ea; --accent: #2f6fed; --soft: #eaf1ff; --warn: #b54708; --warn-soft: #fff4e5; }
@media (prefers-color-scheme: dark) { :root { --bg: #12151b; --card: #1b2029; --text: #e6e9ef; --muted: #9aa4b5; --line: #2c3340; --accent: #7aa7ff; --soft: #1f2b45; --warn: #f5b26b; --warn-soft: #3a2a15; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; padding: 24px 16px; border-right: 1px solid var(--line); background: var(--card); }
nav h2 { margin: 18px 8px 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
nav a { display: block; padding: 5px 8px; border-radius: 6px; color: var(--text); font-size: 14px; }
nav a:hover { background: var(--soft); text-decoration: none; }
nav a b { color: var(--accent); font-weight: 600; margin-right: 6px; }
main { padding: 32px 40px 80px; max-width: 1100px; }
header h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.2; }
header p { margin: 0; color: var(--muted); font-size: 14px; }
.stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0 8px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 18px; min-width: 120px; }
.stat b { display: block; font-size: 24px; } .stat span { color: var(--muted); font-size: 13px; }
section { margin-top: 40px; }
section > h2 { font-size: 21px; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; margin-bottom: 18px; overflow-x: auto; }
.task-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.task-head h3 { margin: 0; font-size: 19px; }
.pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: var(--soft); color: var(--accent); white-space: nowrap; }
.pill.plain { background: transparent; border: 1px solid var(--line); color: var(--muted); font-weight: 500; }
.pill.done { border-style: dashed; opacity: .75; }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 12px; }
.layers { list-style: none; margin: 0 0 14px; padding: 0; }
.layers > li { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px 18px; padding: 14px 0; border-top: 1px solid var(--line); }
.layers > li:first-child { border-top: 0; padding-top: 0; }
.layer-name b { display: block; } .layer-name span { color: var(--muted); font-size: 13px; }
.layers ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.layers ul li { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--bg); font-size: 14.5px; break-inside: avoid; }
.needs { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; margin-top: 6px; color: var(--muted); font-size: 13px; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
h4 { margin: 14px 0 6px; font-size: 12.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
.md h1 { font-size: 19px; margin: 24px 0 8px; } .md h2 { font-size: 17px; margin: 22px 0 8px; } .md h3 { font-size: 15px; margin: 18px 0 6px; }
.md ul, .md ol { padding-left: 22px; } .md li { margin: 3px 0; }
.md li:has(> input[type=checkbox]) { list-style: none; margin-left: -22px; }
.md input[type=checkbox] { margin-right: 8px; }
.md code { background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; font-size: 13.5px; }
.md pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; white-space: pre-wrap; }
.md pre code { border: 0; padding: 0; background: none; }
.md figure { margin: 0 0 12px; } .md figcaption { margin-bottom: 4px; color: var(--muted); font-size: 12.5px; } .md figure pre { margin: 0; }
.md blockquote { margin: 12px 0; padding: 2px 14px; border-left: 3px solid var(--line); color: var(--muted); }
.md hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
.md table { border-collapse: collapse; width: 100%; font-size: 14.5px; } .md th, .md td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
.md th { background: var(--bg); }
details { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px; }
summary { cursor: pointer; color: var(--accent); font-size: 14px; font-weight: 600; }
.note { color: var(--muted); font-size: 13px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); } main { padding: 20px 16px 60px; } .cols, .layers > li { grid-template-columns: 1fr; } }
@media print { nav { display: none; } .layout { display: block; } details > * { display: block; } details::details-content { content-visibility: visible; } .card { break-inside: avoid; } }
`;

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(read('docs/plans/backlog.json'));
    validateManifest(manifest);
    const plans = {}, planFiles = {};
    for (const task of manifest.tasks) {
      for (const phase of ['planned', 'active']) {
        const file = `docs/plans/${phase}/${task.id}-${task.slug}.md`, text = read(file);
        if (text !== null && plans[task.id] === undefined) [plans[task.id], planFiles[task.id]] = [text, file];
      }
    }
    const adrFiles = [...new Set(manifest.tasks.filter(task => plans[task.id]).flatMap(task => task.adrs))].sort();
    const scopeFile = `${pageDir}/milestone${manifest.milestone}.md`;
    const scope = read(scopeFile);
    if (scope === null) throw new Error(`${scopeFile} is missing: the summary describes the agreed scope`);
    let revision = 'uncommitted';
    try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* a repository without commits */ }
    const out = `${pageDir}/milestone${manifest.milestone}-summary.html`;
    fs.writeFileSync(path.join(root, out), buildSummary({ manifest, scope, plans, planFiles, adrs: adrFiles.map(file => ({ file, text: read(file) })), revision, date: new Date().toISOString().slice(0, 10) }));
    console.log(`Wrote ${out}: ${Object.keys(plans).length} tasks, ${adrFiles.length} ADRs`);
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
