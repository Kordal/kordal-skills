# AGENTS.md

Canonical instructions for every agent working in this repository. Nested `AGENTS.md` files add directory-specific rules: read the one closest to the files you change; the more specific file wins where they conflict.

## Purpose

<!-- Planning stage 1: one sentence from docs/product/vision.md saying what the product is and for whom. -->

## Product scope

<!-- Planning stage 3, updated at every later milestone's stage 3: the current milestone in one sentence, linked to docs/product/milestone<N>.md; completed milestones linked to their scope and limitations. -->

Implement only the scope of the selected task; proposals outside that scope remain follow-up work.

## Stack

<!-- Planning stage 4: the technologies the Proposed ADRs name, on one line; their owning tasks confirm them. -->

Introduce another technology only when the active task requires it, with an ADR.

## Architecture principle

<!-- Planning stage 4: the one sentence every design choice is tested against, and the two or three consequences that follow from it. -->

## Rules

1. **Architecture changes** require an ADR in `docs/adr/` (see [docs/adr/README.md](docs/adr/README.md)).
2. **Tests** accompany every piece of functionality; a change is done when its tests pass. `make lint` and `make test` need nothing running and are all a task runs: its runtime change is integrated only under a recorded task gate, `node scripts/agent-local.mjs gate`. The full gate and the resilience gate run once, when the milestone is complete, with every slower test the tasks wrote: [Gates](docs/agents/workflow.md#gates).
3. **Stay on task.** Implement only the selected task. Move its plan from `docs/plans/planned/` to `active/` when work starts and to `completed/` before the task is integrated. Record unrelated follow-up work in Completion Notes.

<!-- Planning stage 4 and later ADRs add the product's own rules here: data ownership, communication between components, public contracts, migrations. -->

## Communication style

- Answer short and straight to the point. Lead with the answer; skip preamble, recaps and filler.
- Never invent facts, results or sources. If you don't know or haven't verified something, say so plainly.
- If my approach is wrong or there is a better one, say so directly and propose the alternative before doing what I asked.
- Be blunt. No flattery, no hedging, no softening.

## How work enters

Route a request before acting on it:

| Level | Command | Use when |
| --- | --- | --- |
| QUICK | `/kordal-quick <request>` | One clear, localized, low-risk change that follows an existing pattern. Ends at a pull request. No plan, task or issue |
| FEATURE | `/kordal-plan-feature <idea>` | A small planned product addition: one to three tasks, no new architecture decision. Also whatever fails a QUICK condition but fits these limits |
| MILESTONE | `/kordal-plan` | A substantial outcome: several coordinated changes, more than three tasks, or a new architecture decision |
| BUG | `/kordal-bug <report>` | Behaviour that departs from what the product already promises |
| ISSUE | `/kordal-issue` → `/kordal-issue-review` → `/kordal-issue-code` | Only when the owner asks for an issue, wants the work handed off for later, or the repository is managed through reviewed GitHub issues. Never chosen for a direct request to build something |
| QUESTION | `/kordal-improve <question>` | "What should we improve?": findings and proposals, no code |

QUICK → FEATURE → MILESTONE is one ladder: each level takes what the level below must refuse.

During an active milestone (the integration branch holds work the base branch lacks): a QUICK change that touches no file the milestone has changed (`git diff --name-only <base>...<integration>`) is still QUICK, from the base branch; anything else joins the milestone: a feature through `/kordal-plan-feature` (its tasks join the queue), a bug through `/kordal-bug` (it becomes a task), a reviewed issue through `/kordal-plan-feature <number>`. Larger work waits for the next milestone's planning.

## Agent workflow

| Before | Read |
| --- | --- |
| delivering a task: selecting, implementing, resuming or integrating it | [docs/agents/workflow.md](docs/agents/workflow.md) |
| the acceptance task, a standalone feature's acceptance, or the pull request | [docs/agents/acceptance.md](docs/agents/acceptance.md) |
| planning a milestone or a feature, or changing an agreed outcome or scope | [docs/agents/planning.md](docs/agents/planning.md) |

What holds without opening them:

- **One task, one branch.** The [backlog manifest](docs/plans/backlog.json) maps task IDs to plans, dependencies and ADRs, and names the integration branch. `node scripts/agent-local.mjs next` lists the queue; `claim <ID>` creates `task/<id>`.
- **Never commit to the integration branch or check it out.** A task reaches it through the helper's `finish` or `integrate`.
- **Push only through the helper.** Where the manifest names a GitHub repository, `claim`, `finish`, `integrate` and `publish` push the integration branch and update the issues; any other push is a step those documents or a command above names.
- **No pull request per task.** The base branch (`node scripts/agent-local.mjs base`) receives one pull request, when the whole milestone is done, and the owner merges it. Pull requests outside the milestone: `/kordal-quick` at any time, for an independent low-risk change; `/kordal-issue-code` and `/kordal-bug` between milestones.

## Repository map

| Path | Contents |
| --- | --- |
| `docs/product/` | Vision, milestone scope, research notes, the owner's test lists and, under `improvements/`, improvement reports |
| `docs/adr/` | Architecture Decision Records |
| `docs/plans/` | Backlog manifest and task plans (`planned/`, `active/`, `completed/`) |
| `docs/agents/` | The agent workflow: task delivery (`workflow.md`), acceptance and the pull request (`acceptance.md`), planning (`planning.md`) |
| `scripts/` | Agent delivery tooling, the GitHub issue mirror and the gate runner |
| `tests/` | Cross-component checks |

<!-- Add the product's directories as tasks create them. -->
