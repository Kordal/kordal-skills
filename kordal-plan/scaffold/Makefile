# Development commands.

.DEFAULT_GOAL := help

# The stages of the gates, in order; each is a make target. Tasks add the
# product's own stages here (docs/agents/workflow.md, "Gates").
FAST_STAGES       := lint agent-check test
RESILIENCE_STAGES :=

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-z-]+:.*## ' "$(firstword $(MAKEFILE_LIST))" | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-16s %s\n", $$1, $$2}'

.PHONY: agent-check
agent-check: ## Validate agent task contracts and run workflow gate tests (local Node.js)
	node scripts/agent-workflow.mjs check
	node --test scripts/agent-workflow.test.mjs scripts/agent-local.test.mjs scripts/agent-issues.test.mjs scripts/agent-summary.test.mjs scripts/gate.test.mjs

.PHONY: lint
lint: ## Check the documentation links; the product's linters join this target
	./tests/integration/check-docs.sh

.PHONY: test
test: ## Run the tests that need nothing running
	@echo "FAIL  no product tests yet: the first runtime task puts its tests in this target"; exit 1

.PHONY: pr-check
pr-check: ## The gate of every task: lint, agent structure and tests
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh pr-check $(FAST_STAGES)

.PHONY: premerge-check
premerge-check: ## The resilience gate of the integration branch before it is pushed
	@GATE_MAKE="$(MAKE)" ./scripts/gate.sh premerge-check $(RESILIENCE_STAGES)
