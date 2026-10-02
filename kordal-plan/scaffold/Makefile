# Development commands.

.DEFAULT_GOAL := help

# The stages of the gates, in order; each is a make target. Tasks add the
# product's own stages here (docs/agents/workflow.md, "Gates"):
#   TASK_STAGES       every task: what runs in a minute or two with nothing started
#   MILESTONE_STAGES  once, when the milestone is complete: the slow suites
#   RESILIENCE_STAGES once, with them: operations, backup/restore, upgrade, release build
TASK_STAGES       := lint agent-check test
MILESTONE_STAGES  :=
RESILIENCE_STAGES :=

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-z-]+:.*## ' "$(firstword $(MAKEFILE_LIST))" | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-16s %s\n", $$1, $$2}'

.PHONY: agent-check
agent-check: ## Validate agent task contracts and run workflow gate tests (local Node.js)
	node scripts/agent-workflow.mjs check
	node --test scripts/agent-workflow.test.mjs scripts/agent-local.test.mjs scripts/agent-issues.test.mjs scripts/agent-summary.test.mjs scripts/check-docs.test.mjs scripts/gate.test.mjs

.PHONY: lint
lint: ## Check the documentation links; the product's linters join this target
	@if command -v node >/dev/null 2>&1; then ./tests/integration/check-docs.sh; else echo "check-docs.sh skipped: it needs a local Node.js"; fi

.PHONY: test
test: ## Run the tests that need nothing running
	@echo "FAIL  no product tests yet: the first runtime task puts its tests in this target"; exit 1

.PHONY: task-check
task-check: ## The gate of every task: lint, agent structure and the fast tests
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh task-check $(TASK_STAGES)

.PHONY: pr-check
pr-check: ## The full gate, once the milestone is complete: the task gate and the slow suites
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh pr-check $(TASK_STAGES) $(MILESTONE_STAGES)

.PHONY: premerge-check
premerge-check: ## The resilience gate, once the milestone is complete
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh premerge-check $(RESILIENCE_STAGES)
