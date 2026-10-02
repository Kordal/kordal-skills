#!/usr/bin/env bash
# Copies the agent scaffold into a project that has none yet, and keeps a
# scaffolded project comparable with later versions of the scaffold.
#
#   bootstrap.sh [dir]          copy the scaffold; an existing file is kept,
#                               never overwritten, and the report says which;
#                               a directory that is not a Git repository
#                               becomes one, on branch main
#   bootstrap.sh --diff [dir]   print what changed in the scaffold since the
#                               version the project records, and the scaffold
#                               files the project lacks; changes nothing
#   bootstrap.sh --stamp [dir]  record the current scaffold version
#
# The version is the commit of this skill's own Git repository, recorded in
# the project's docs/agents/scaffold-version. dir defaults to the current
# directory.
set -euo pipefail

skill="$(cd "$(dirname "$0")" && pwd)"
scaffold="$skill/scaffold"
mode=copy
case "${1:-}" in --diff | --stamp) mode=${1#--}; shift ;; esac
dest="$(cd "${1:-.}" && pwd)"
stamp="docs/agents/scaffold-version"

version() { git -C "$skill" rev-parse HEAD 2>/dev/null || echo unversioned; }
files() { (cd "$scaffold" && find . -type f ! -name .DS_Store | sed 's|^\./||' | sort); }
write_stamp() {
	if [ -n "$(git -C "$skill" status --porcelain -- scaffold 2>/dev/null)" ]; then
		echo "WARN     the scaffold has uncommitted changes: the recorded version does not include them"
	fi
	mkdir -p "$dest/$(dirname "$stamp")"
	version >"$dest/$stamp"
	echo "version  $(version)"
}

if [ "$mode" = stamp ]; then
	write_stamp
	exit 0
fi

if [ "$mode" = diff ]; then
	from=$(cat "$dest/$stamp" 2>/dev/null || true)
	if [ -n "$from" ] && git -C "$skill" cat-file -e "$from^{commit}" 2>/dev/null; then
		if git -C "$skill" diff --quiet "$from" HEAD -- scaffold; then
			echo "The scaffold has not changed since $from"
		else
			echo "Scaffold changes from $from to $(version):"
			git -C "$skill" --no-pager diff --relative=scaffold/ "$from" HEAD -- scaffold
		fi
		files | while IFS= read -r file; do
			[ -e "$dest/$file" ] || echo "missing  $file"
		done
	else
		echo "No recorded scaffold version: comparing every file with the scaffold at $(version)"
		files | while IFS= read -r file; do
			if [ ! -e "$dest/$file" ]; then
				echo "missing  $file"
			elif ! cmp -s "$scaffold/$file" "$dest/$file"; then
				echo "differs  $file"
			fi
		done
	fi
	exit 0
fi

if [ -e "$dest/docs/agents/planning.md" ]; then
	echo "FAIL  $dest already has docs/agents/planning.md: follow it, or compare with --diff"
	exit 1
fi
if ! git -C "$dest" rev-parse --git-dir >/dev/null 2>&1; then
	git -C "$dest" init --quiet --initial-branch main
	echo "init     Git repository on main"
fi

files | while IFS= read -r file; do
	if [ -e "$dest/$file" ]; then
		echo "kept     $file"
	else
		mkdir -p "$dest/$(dirname "$file")"
		cp -p "$scaffold/$file" "$dest/$file"
		echo "created  $file"
	fi
done
write_stamp
