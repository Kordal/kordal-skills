# The checks of this repository: the skills, their scripts, and the scaffold
# that kordal-plan/bootstrap.sh copies into a project. `make check` is what
# .github/workflows/ci.yml runs; it needs bash, git, make and Node.js, and no
# GitHub: every test that speaks to GitHub runs against a fake gh.

.DEFAULT_GOAL := help

# One suite at a time, also under -j: the suites time their stages in whole
# seconds and start dozens of processes each, and three interleaved reports
# name no culprit.
.NOTPARALLEL:

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-z-]+:.*## ' "$(firstword $(MAKEFILE_LIST))" | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-16s %s\n", $$1, $$2}'

.PHONY: check
check: syntax test smoke ## Everything, as CI runs it: the shell syntax, every test, the bootstrap smoke test

# bash -n runs nothing: it finds the syntax error of a branch no test reaches,
# and on macOS the construct that bash 3.2 does not know.
.PHONY: syntax
syntax: ## Parse every shell script of the repository (bash -n)
	@scripts=$$(find . -name .git -prune -o -type f -name '*.sh' -print | LC_ALL=C sort); \
	[ -n "$$scripts" ] || { echo "FAIL  no shell script found: not the repository root, or find failed"; exit 1; }; \
	printf '%s\n' "$$scripts" | { status=0; while IFS= read -r script; do \
		if bash -n "$$script"; then echo "ok    $${script#./}"; else echo "FAIL  $${script#./}"; status=1; fi; \
	done; exit $$status; }

# The scaffold's tests run where a project runs them: in the scaffold's root.
.PHONY: test
test: ## Run the tests of the skills' scripts, of this repository and of the scaffold's tooling
	node --test kordal-plan/*.test.mjs kordal-issue/*.test.mjs tests/*.test.mjs
	cd kordal-plan/scaffold && node --test scripts/*.test.mjs

# What a new project gets, as bootstrap.sh hands it over: the copy, with its
# file modes and its own Makefile, has to pass the checks that planning ends
# with. The temporary project is removed however the recipe ends; a signal
# becomes an exit, so that the same trap runs. Without a directory from mktemp
# nothing starts: `cd ""` stays where it is in bash, and the trap would remove
# this repository.
#
# The project's make is this one under another name: a recipe that names
# $(MAKE) itself also runs under `make -n`, and a dry run would bootstrap a
# project and report that it passed.
project_make := $(MAKE)
.PHONY: smoke
smoke: ## Bootstrap a temporary project and run its structure check, documentation check and tooling tests
	@dir=$$(mktemp -d) && dir=$$(cd "$$dir" && pwd -P) && [ -n "$$dir" ] || exit 1; \
	trap 'rm -rf "$$dir"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM; \
	set -e; \
	bash kordal-plan/bootstrap.sh "$$dir"; \
	$(project_make) -C "$$dir" structure-check; \
	(cd "$$dir" && bash tests/integration/check-docs.sh); \
	$(project_make) -C "$$dir" agent-check; \
	echo "PASS  a bootstrapped project passes its structure check, its documentation check and its tooling tests"
