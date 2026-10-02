#!/usr/bin/env node
import fs from 'node:fs';

// A stand-in for `gh api` in scripts/agent-issues.test.mjs: the endpoints
// agent-issues.mjs uses, with GitHub's response shapes, kept in the JSON file
// GH_STATE names. Every write is logged in `writes`. GH_FAIL makes it fail
// as an unreachable GitHub does.
if (process.env.GH_FAIL) { console.error('error connecting to api.github.com'); process.exit(1); }
const file = process.env.GH_STATE;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { labels: [], milestones: [], issues: [], comments: [], writes: [] };
const [, endpoint, , method] = process.argv.slice(2);
const data = method ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
const [route, query = ''] = endpoint.split('?');
const parts = route.split('/').slice(3);
if (method) state.writes.push(`${method} ${parts.join('/')}`);

let out;
if (parts[0] === 'labels') {
  if (method) state.labels.push({ name: data.name });
  out = method ? data : state.labels;
} else if (parts[0] === 'milestones') {
  if (method) state.milestones.push({ number: state.milestones.length + 1, title: data.title });
  out = method ? state.milestones.at(-1) : state.milestones;
} else if (parts.length === 1) {
  if (method) state.issues.push({ number: state.issues.length + 1, state: 'open', title: data.title, body: data.body ?? '', labels: [], milestone: null });
  out = method ? state.issues.at(-1) : state.issues;
} else if (parts[2] === 'comments') {
  state.comments.push({ issue: Number(parts[1]), body: data.body });
  out = {};
} else {
  out = state.issues[Number(parts[1]) - 1];
  if (data.labels) out.labels = data.labels.map(name => ({ name }));
  if (data.milestone) out.milestone = { number: data.milestone };
  for (const key of ['title', 'body', 'state']) if (data[key] !== undefined) out[key] = data[key];
}
if (!method && Number(new URLSearchParams(query).get('page') ?? 1) > 1) out = [];
fs.writeFileSync(file, JSON.stringify(state));
console.log(JSON.stringify(out));
