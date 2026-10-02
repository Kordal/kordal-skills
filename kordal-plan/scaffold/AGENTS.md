# AGENTS.md

Canonical instructions for every agent working in this repository. Nested `AGENTS.md` files may add directory-specific rules; the more specific file wins where they conflict.

## Purpose

<!-- Planning stage 1: one sentence from docs/product/vision.md saying what the product is and for whom. -->

## Product scope

<!-- Planning stage 3, updated at every stage 6: the current MVP in one sentence, linked to docs/product/mvp<N>.md; completed MVPs linked to their scope and limitations. -->

Implement only the scope of the selected task; proposals outside that scope remain follow-up work.

## Stack

<!-- Planning stage 4: the technologies the ADRs chose, on one line. -->

Introduce another technology only when the active task requires it, with an ADR.

## Architecture principle

<!-- Planning stage 4: the one sentence every design choice is tested against, and the two or three consequences that follow from it. -->

## Rules

1. **Architecture changes** require an ADR in `docs/adr/` (see [docs/adr/README.md](docs/adr/README.md)).
2. **Tests** accompany every piece of functionality; a change is done when its tests pass. `make lint` and `make test` need nothing running; `make pr-check` is the gate of every task and `make premerge-check` the gate of the integration branch before it is pushed.
3. **Stay on task.** Implement only the selected task. Move its plan from `docs/plans/planned/` to `active/` when work starts and to `completed/` before the task is integrated. Record unrelated follow-up work in Completion Notes.

<!-- Planning stage 4 and later ADRs add the product's own rules here: data ownership, communication between components, public contracts, migrations. -->

## Communication style

- Answer short and straight to the point. Lead with the answer; skip preamble, recaps and filler.
- Never invent facts, results or sources. If you don't know or haven't verified something, say so plainly.
- If my approach is wrong or there is a better one, say so directly and propose the alternative before doing what I asked.
- Be blunt. No flattery, no hedging, no softening.

## Agent delivery workflow

**Before planning a new MVP or changing an agreed MVP's outcome or scope, read [the planning workflow](docs/agents/planning.md).**

**Before selecting, implementing, resuming or integrating work, read [the agent workflow](docs/agents/workflow.md).** The [backlog manifest](docs/plans/backlog.json) maps task IDs to plans, dependencies and ADRs, and names the integration branch.

An MVP is delivered locally: **no push, no pull request and no reviewer's approval per task.** The remote receives the integration branch once, when the whole MVP is done.

One task, one branch. `node scripts/agent-local.mjs next` lists the queue; `claim <ID>` creates `task/<id>` from the integration branch; `gate` runs `make pr-check` and records the pass; `finish <ID>` puts the task on the integration branch. Do not push, and do not commit to the integration branch directly. Read your [role instructions](docs/agents/claude.md) before acting.

## Repository map

| Path | Contents |
| --- | --- |
| `docs/product/` | Vision, MVP scope, research notes and the owner's test lists |
| `docs/adr/` | Architecture Decision Records |
| `docs/plans/` | Backlog manifest and task plans (`planned/`, `active/`, `completed/`) |
| `docs/agents/` | Planning workflow, delivery workflow, role instructions |
| `docs/evidence/` | Screenshots that prove completed tasks, one directory per task |
| `scripts/` | Agent delivery tooling and the gate runner |
| `tests/` | Cross-component checks |

<!-- Add the product's directories as tasks create them. -->
