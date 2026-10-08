# Development commands.

.DEFAULT_GOAL := help

# The stages of the gates, in order; each is a .PHONY make target with a
# recipe: the gate refuses a stage make has nothing to run for. Tasks add the
# product's own stages here (docs/agents/orchestration.md, "Gates"):
#   TASK_STAGES       every task: what runs in a minute or two with nothing started
#   MILESTONE_STAGES  once, when the milestone is complete: the slow suites
#   RESILIENCE_STAGES once, with them: operations, backup/restore, upgrade, release build
# A gate with no stages fails. The task that bootstraps the development
# platform gives each empty list its stages, or the single word `none`, which
# declares that gate not applicable to this product (scripts/gate.sh).
TASK_STAGES       := lint structure-check test
MILESTONE_STAGES  :=
RESILIENCE_STAGES :=

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_.-]+:.*## ' "$(firstword $(MAKEFILE_LIST))" | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-16s %s\n", $$1, $$2}'

.PHONY: structure-check
structure-check: ## Validate the backlog: task contracts, plans, ADR references, dependencies (local Node.js)
	node scripts/agent-workflow.mjs check

# Not a task stage. It runs where the tooling itself is at stake: with the task
# gate of a branch that changes the agent tooling (scripts/agent-local.mjs
# gate), in the hosted check of the pull request, and by hand after a scaffold
# update. It names every tooling test of scripts/ (agent-*.test.mjs,
# check-docs.test.mjs, gate.test.mjs).
.PHONY: agent-check
agent-check: structure-check ## The structure check and the agent tooling's own tests (local Node.js)
	node --test scripts/agent-workflow.test.mjs scripts/agent-local.test.mjs scripts/agent-issues.test.mjs scripts/agent-summary.test.mjs scripts/check-docs.test.mjs scripts/gate.test.mjs

.PHONY: lint
lint: ## Check the documentation links; the product's linters join this target
	@if command -v node >/dev/null 2>&1; then ./tests/integration/check-docs.sh; else echo "check-docs.sh skipped: it needs a local Node.js"; fi

.PHONY: test
test: ## Run the tests that need nothing running
	@echo "FAIL  no product tests yet: the first runtime task puts its tests in this target"; exit 1

.PHONY: task-check
task-check: ## The gate of every task: lint, the structure check and the fast tests
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh task-check $(TASK_STAGES)

# The milestone stages only. The fast stages are not repeated here:
# `node scripts/agent-local.mjs gate pr-check` makes sure a task-check covers
# the commit before it runs this.
.PHONY: pr-check
pr-check: ## The full gate, once the milestone is complete: the slow suites only, the task gate is not repeated
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh pr-check $(MILESTONE_STAGES)

.PHONY: premerge-check
premerge-check: ## The resilience gate, once the milestone is complete
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh premerge-check $(RESILIENCE_STAGES)
