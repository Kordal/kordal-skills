# kordal-skills

Three Claude Code skills that plan and deliver a product with agents: `/kordal-plan` decides what to build, `/kordal-build` builds it, `/kordal-improve` finds what is worth improving. The repository of the project is the source of truth; GitHub issues mirror it.

## Install

```bash
git clone git@github.com:Kordal/kordal-skills.git ~/Development/kordal-skills
mkdir -p ~/.claude/skills ~/.claude/agents
for skill in ~/Development/kordal-skills/kordal-*/; do ln -sfn "${skill%/}" ~/.claude/skills/; done
for agent in ~/Development/kordal-skills/agents/*.md; do ln -sfn "$agent" ~/.claude/agents/; done
```

Needs `git`, `node`, `make` and, for the GitHub mirror, `gh` logged in. The skills load in Claude Code sessions started after the install.

Every skill and agent runs on the model you choose for the session; none of them sets a model or an effort level. To pin one, add `model:` and `effort:` to the frontmatter of a skill or an agent.

`/kordal-plan-feature`, `/kordal-plan-update`, `/kordal-build-all`, `/kordal-build-serial` and `/kordal-build-ship` are commands of their own that run the matching mode of `/kordal-plan` or `/kordal-build`.

## Commands

| Command | Does |
| --- | --- |
| `/kordal-plan` | Plans the next milestone. In a new folder it scaffolds the project first. Resumes interrupted planning |
| `/kordal-plan <idea>` | The same, starting from the idea |
| `/kordal-plan-feature <idea>` | Plans a small addition: at most three tasks, no new architecture decision |
| `/kordal-plan-update` | Brings a project's scaffold up to date with this repository |
| `/kordal-improve <question>` | Investigates a question about the product or its code; returns evidenced findings and ranked proposals. Changes no code |
| `/kordal-build` | Delivers the next ready task, or resumes the unfinished one |
| `/kordal-build <ID>` | Delivers that task |
| `/kordal-build-all` | Delivers the whole queue, one agent per task; up to five independent tasks in parallel, each in its own worktree |
| `/kordal-build-serial` | The same, one task at a time |
| `/kordal-build-ship` | Opens the pull request of the accepted milestone or feature, then stops the dev servers, emulators and containers the milestone started. The owner merges |

## Planning a milestone

Six stages; a stage closes only with evidence. The owner decides at the stages in bold.

| # | Stage | Output |
| --- | --- | --- |
| 1 | Baseline: what exists, what users need, what existing solutions do better (web search) | `docs/product/vision.md`, `milestone<N>-research.md` |
| 2 | **One user outcome**: "A [user] can [job], demonstrated by [result]" | `docs/product/milestone<N>.md` |
| 3 | **Journey and scope**: capabilities, exclusions, acceptance scenarios, test budget; a prototype at real size for anything the user sees | `milestone<N>.md` completed |
| 4 | Uncertainties: research, prototypes, architecture decisions (**only if a finding changes the scope**) | Proposed ADRs in `docs/adr/` |
| 5 | Backlog: few, large tasks (about an hour of work at least), cut along components; one plan per task with acceptance criteria and a flow diagram | `docs/plans/planned/`, `backlog.json`, `milestone<N>-summary.html` |
| 6 | Handoff: issues created, integration branch `milestone<N>`, structure checks | First ready task |

`milestone<N>-summary.html` is a generated page for the owner: scope, task dependency graph, every task with its criteria and flow, and the decisions.

## Planning a feature

`/kordal-plan-feature <idea>`: clarify the sentence, check that it fits (three tasks at most, no new ADR, not excluded), write the plans, get the owner's approval, register the tasks. A feature joins the work in progress when there is any; otherwise it gets its own branch `feature/<slug>` and its own pull request.

## Asking an improvement question

`/kordal-improve Check if we can make the chat experience more human-like`: Claude turns the question into checkable criteria you confirm, uses the running product, and has a separate agent read the code and search how others solve it. You get findings with evidence and at most seven ranked proposals, and give each a verdict: now, later or no. The report is saved under `docs/product/improvements/`; a "now" that fits a feature continues with `/kordal-plan-feature`.

## Delivering

Per task: claim, implement, gate, review, finish, report.

- **Gate.** `make task-check`, the fast gate, on the task's commit; a runtime change after it needs the gate again. The full gate, `make pr-check` with the slow suites, runs once: `finish` demands it of the task that completes the queue.
- **Review.** The diff on two axes, Standards and Spec, in one pass by the `kordal-task-reviewer` agent, in a context that has not seen the implementation, read-only. The milestone review uses two reviewers, one per axis. Recorded in the plan; an unreviewed task cannot be finished.
- **No slow testing per task.** A task runs lint and unit tests only. Browser, device and end-to-end tests are written in the task and run once, at the end.
- **Report.** What was added, what was verified, how to try it, what is next; also posted on the task's issue.

- **First look.** The first task that changes what a user sees ends with a stop: the owner looks at the running product on the target devices before the rest is built on it.
- **Budget.** The scope names the test data size and how long the gates may take; `gate` reports its duration and says when it went over.

A milestone ends with its acceptance task: the full check (every slow suite and a walk through the whole product on each target device), a review of the whole milestone, then a test list for the owner in `docs/product/milestone<N>-test.md`. Each failure the owner reports becomes a task. Only after the owner accepts does `/kordal-build-ship` open the pull request.

## GitHub

Optional, asked once when a project is scaffolded. With it:

- one issue per task in the GitHub milestone `Milestone <N>`, generated from the plan;
- one status label per issue: `status:waiting`, `status:blocked`, `status:ready`, `status:in-progress`, `status:done`;
- `claim` and `finish` push the integration branch and sync the issues; an issue closes when its task is integrated;
- `node scripts/agent-issues.mjs sync --check` fails on any difference; `node scripts/agent-local.mjs publish` repairs it after working offline.

Main receives one pull request per milestone or feature. A push of the integration branch starts no hosted check.

## What a project gets

`kordal-plan/scaffold/` is copied into a new project once; after that the files belong to the project.

| Path | Contents |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Instructions for every agent: rules, communication style, delivery commands |
| `docs/agents/` | `planning.md`, `workflow.md`, `claude.md`: the sources of truth for planning and delivery |
| `docs/product/` | Vision, scope, research, summary page, test lists |
| `docs/adr/` | Architecture Decision Records |
| `docs/plans/` | `backlog.json`, the plan template, plans in `planned/`, `active/`, `completed/` |
| `scripts/agent-local.mjs` | The queue: `next`, `claim`, `gate`, `finish`, `publish` |
| `scripts/agent-workflow.mjs` | Validates the backlog against plans and ADRs |
| `scripts/agent-issues.mjs` | The GitHub mirror: `sync`, `sync --check`, `comment` |
| `scripts/agent-summary.mjs` | Generates the summary page |
| `scripts/agent-scope.mjs`, `scripts/gate.sh` | Which changes need the gate; the gate runner |
| `tests/integration/check-docs.sh` | Checks Markdown links |
| `Makefile` | `lint`, `test`, `agent-check`, `task-check`, `pr-check`, `premerge-check` |

A new project has no product checks: `make test` fails until the first task adds tests, and `make premerge-check` fails until a task gives it stages.

## Changing the scaffold

Commit every change under `kordal-plan/scaffold/`. A project records the scaffold commit it was created from in `docs/agents/scaffold-version`, and `/kordal-plan-update` diffs against it.

```bash
bash kordal-plan/bootstrap.sh <dir>          # copy the scaffold into a project
bash kordal-plan/bootstrap.sh --diff <dir>   # what changed since the project's version
bash kordal-plan/bootstrap.sh --stamp <dir>  # record the current version
```

Before committing, bootstrap a throwaway project and run `make agent-check` and `bash tests/integration/check-docs.sh` in it.

`kordal-plan/migrate.mjs` renames a project scaffolded when the unit was called an MVP (`"mvp"`, `mvp<N>`, "MVP <N>") to milestones; `/kordal-plan-update` runs it first. Its tests: `node --test kordal-plan/migrate.test.mjs`.

## Status

The scripts are covered by their own tests. The two slash commands have not yet been run end to end on a real project, and the GitHub mirror has written only to a fake `gh` in tests.
