#!/usr/bin/env bash
# Copies the agent scaffold into a project that has none yet, and brings a
# scaffolded project up to date with later versions of the scaffold.
#
#   bootstrap.sh [dir]           copy the scaffold; an existing file is kept,
#                                never overwritten, and the report says which;
#                                a directory that is not a Git repository
#                                becomes one, on branch main; a base branch
#                                other than main is recorded as "base_branch"
#                                in the manifest this run created
#   bootstrap.sh --diff [dir]    print what changed in the scaffold since the
#                                version the project records, and the scaffold
#                                files the project lacks; changes nothing
#   bootstrap.sh --update [dir]  apply what changed in the scaffold since that
#                                version, file by file, as a three-way merge
#   bootstrap.sh --stamp [dir]   record the current scaffold version
#
# The version is the commit of this skill's own Git repository, recorded in
# the project's docs/agents/scaffold-version. dir defaults to the current
# directory.
#
# --update compares, per file, the scaffold at the recorded version (base),
# the project's file (ours) and the scaffold now (theirs), and reports:
#
#   updated   the scaffold changed it and the project had not: the new file
#   merged    both changed it, in different places: both changes
#   added     new in the scaffold
#   removed   removed from the scaffold, and the project had not changed it
#   kept      the scaffold changed a file the project deleted: stays deleted
#   CONFLICT  both changed the same lines: the file now holds both versions
#             between conflict markers; or one side added or removed a file
#             the other holds in its own form: the project's file is untouched
#
# A file the scaffold did not change is neither touched nor listed, whatever
# the project made of it. The update needs a recorded version that is a commit
# of this repository, and a clean project tree, so that it is a diff to review
# and to revert. Without a conflict it records the new version and exits 0;
# with one it records nothing and exits 1: resolve, then --stamp.
set -euo pipefail

skill="$(cd "$(dirname "$0")" && pwd)"
scaffold="$skill/scaffold"
mode=copy
case "${1:-}" in --diff | --stamp | --update) mode=${1#--}; shift ;; esac
dest="$(cd "${1:-.}" && pwd)"
stamp="docs/agents/scaffold-version"
manifest="docs/plans/backlog.json"

version() { git -C "$skill" rev-parse HEAD 2>/dev/null || echo unversioned; }
files() { (cd "$scaffold" && find . -type f ! -name .DS_Store | sed 's|^\./||' | sort); }
write_stamp() {
	if [ -n "$(git -C "$scaffold" status --porcelain -- . 2>/dev/null)" ]; then
		echo "WARN     the scaffold has uncommitted changes: the recorded version does not include them"
	fi
	mkdir -p "$dest/$(dirname "$stamp")"
	version >"$dest/$stamp"
	echo "version  $(version)"
}
# The branch a milestone starts from and returns to. origin/HEAD is the
# repository's own answer; without it main, then master, then the branch the
# checkout is on, which in a repository this run created is main.
base_branch() {
	local head
	if head=$(git -C "$dest" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
		echo "${head#origin/}"
	elif git -C "$dest" show-ref --verify --quiet refs/heads/main; then
		echo main
	elif git -C "$dest" show-ref --verify --quiet refs/heads/master; then
		echo master
	else
		git -C "$dest" symbolic-ref --quiet --short HEAD 2>/dev/null || echo main
	fi
}

if [ "$mode" = stamp ]; then
	write_stamp
	exit 0
fi

if [ "$mode" = diff ]; then
	from=$(cat "$dest/$stamp" 2>/dev/null || true)
	if [ -n "$from" ] && git -C "$skill" cat-file -e "$from^{commit}" 2>/dev/null; then
		if git -C "$scaffold" diff --quiet "$from" HEAD -- .; then
			echo "The scaffold has not changed since $from"
		else
			echo "Scaffold changes from $from to $(version):"
			git -C "$scaffold" --no-pager diff --relative "$from" HEAD -- .
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

if [ "$mode" = update ]; then
	from=$(cat "$dest/$stamp" 2>/dev/null || true)
	if [ -z "$from" ] || ! git -C "$skill" cat-file -e "$from^{commit}" 2>/dev/null; then
		echo "FAIL  $dest records no scaffold version that is a commit of $skill (recorded: ${from:-none}), so there is no base to merge from: compare with --diff, apply the changes by hand, then --stamp"
		exit 1
	fi
	if ! changes=$(git -C "$dest" status --porcelain 2>/dev/null) || [ -n "$changes" ]; then
		echo "FAIL  $dest is not a clean Git checkout: commit or stash your changes first, so that the update is a diff you can review and revert"
		exit 1
	fi
	tmp=$(mktemp -d)
	trap 'rm -rf "$tmp"' EXIT
	base="$tmp/base" to=$(version)
	# Where the scaffold sits in this repository: a file's base is <version>:<prefix><file>.
	prefix=$(git -C "$scaffold" rev-parse --show-prefix)
	# -z: the names as they are, where a line would quote some.
	git -C "$scaffold" ls-tree -r -z "$from" | tr '\0' '\n' >"$tmp/tree"
	cut -f2- "$tmp/tree" | { grep -Ev '(^|/)\.DS_Store$' || true; } >"$tmp/was"
	{ grep '^100755 ' "$tmp/tree" || true; } | cut -f2- >"$tmp/was-executable"
	{ files; cat "$tmp/was"; } | sort -u >"$tmp/files"

	listed() { grep -Fxq -e "$1" "$2"; }
	# The chmod mode that gives another file the executable bit of this one.
	xbit() { if [ -x "$1" ]; then echo +x; else echo a-x; fi; }
	# The same file: the same content and the same executable bit.
	same() { cmp -s "$1" "$2" && [ "$(xbit "$1")" = "$(xbit "$2")" ]; }
	added=0 updated=0 merged=0 removed=0 kept=0 conflicts=0
	conflict() { echo "CONFLICT $file ($1)"; conflicts=$((conflicts + 1)); }

	while IFS= read -r file; do
		ours="$dest/$file" theirs="$scaffold/$file"
		if ! listed "$file" "$tmp/was"; then
			if [ ! -e "$ours" ]; then
				mkdir -p "$(dirname "$ours")"
				cp -p "$theirs" "$ours"
				echo "added    $file"; added=$((added + 1))
			elif ! same "$ours" "$theirs"; then
				conflict "new in the scaffold, and the project has its own: left as it is; merge it by hand with $theirs"
			fi
			continue
		fi
		git -C "$skill" show "$from:$prefix$file" >"$base"
		if listed "$file" "$tmp/was-executable"; then chmod +x "$base"; else chmod a-x "$base"; fi
		if [ ! -e "$theirs" ]; then
			if [ ! -e "$ours" ]; then
				:
			elif same "$ours" "$base"; then
				rm "$ours"
				echo "removed  $file"; removed=$((removed + 1))
			else
				conflict "removed from the scaffold, but the project changed it: left as it is; delete it, or keep it as the project's own"
			fi
		elif same "$base" "$theirs"; then
			:
		elif [ ! -e "$ours" ]; then
			echo "kept     $file (the project deleted it: it stays deleted, the scaffold's change is not applied)"; kept=$((kept + 1))
		elif same "$ours" "$theirs"; then
			:
		elif same "$ours" "$base"; then
			cp -p "$theirs" "$ours"
			echo "updated  $file"; updated=$((updated + 1))
		else
			# Markers of an earlier update, committed unresolved, would be merged into nested ones.
			if grep -q '^<<<<<<< project$' "$ours"; then
				conflict "it still holds the conflict markers of an earlier update: resolve them"
				continue
			fi
			status=0
			git merge-file -p --diff3 -L project -L "scaffold ${from:0:12}" -L "scaffold ${to:0:12}" "$ours" "$base" "$theirs" >"$tmp/merged" 2>/dev/null || status=$?
			# Above 127 is not a count of conflicts: Git could not merge, a binary file for one.
			if [ "$status" -gt 127 ]; then
				conflict "both changed it and Git cannot merge it: left as it is; merge it by hand with $theirs"
				continue
			fi
			# The project's mode stays, unless the scaffold alone changed it.
			x=$(xbit "$ours")
			[ "$x" != "$(xbit "$base")" ] || x=$(xbit "$theirs")
			# An update repeated before --stamp finds the scaffold's change already in the project's file.
			if [ "$status" -eq 0 ] && cmp -s "$tmp/merged" "$ours" && [ "$x" = "$(xbit "$ours")" ]; then continue; fi
			cat "$tmp/merged" >"$ours"
			chmod "$x" "$ours"
			if [ "$status" -eq 0 ]; then
				echo "merged   $file"; merged=$((merged + 1))
			else
				conflict "both changed the same lines: conflict markers written"
			fi
		fi
	done <"$tmp/files"

	if [ "$conflicts" -eq 0 ]; then
		write_stamp
	else
		echo "FAIL     the version is not recorded. Resolve each CONFLICT above (edit out the markers; merge, delete or keep the other files by hand), then run: bash $skill/bootstrap.sh --stamp $dest"
	fi
	echo "summary  ${from:0:12} to ${to:0:12}: $added added, $updated updated, $merged merged, $removed removed, $kept kept, $conflicts conflicts"
	exit $((conflicts > 0))
fi

if [ -e "$dest/docs/agents/planning.md" ]; then
	echo "FAIL  $dest already has docs/agents/planning.md: follow it, or bring it up to date with --update"
	exit 1
fi
if ! git -C "$dest" rev-parse --git-dir >/dev/null 2>&1; then
	git -C "$dest" init --quiet --initial-branch main
	echo "init     Git repository on main"
fi
# A manifest the project already has is kept below, and is the project's to edit.
kept_manifest=
[ ! -e "$dest/$manifest" ] || kept_manifest=1

files | while IFS= read -r file; do
	if [ -e "$dest/$file" ]; then
		echo "kept     $file"
	else
		mkdir -p "$dest/$(dirname "$file")"
		cp -p "$scaffold/$file" "$dest/$file"
		echo "created  $file"
	fi
done

base=$(base_branch)
if [ "$base" != main ] && [ -e "$dest/$manifest" ]; then
	if [ -n "$kept_manifest" ]; then
		grep -q '"base_branch"' "$dest/$manifest" || echo "WARN     the base branch is $base and $manifest was kept: add \"base_branch\": \"$base\" to it by hand"
	elif command -v node >/dev/null 2>&1; then
		node -e '
const fs = require("node:fs"), [file, base] = process.argv.slice(1), manifest = {};
for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) {
  manifest[key] = value;
  if (key === "integration_branch") manifest.base_branch = base;
}
manifest.base_branch = base;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);' "$dest/$manifest" "$base"
		echo "base     $base"
	else
		echo "WARN     the base branch is $base and there is no node to record it: add \"base_branch\": \"$base\" to $manifest by hand"
	fi
fi
write_stamp
