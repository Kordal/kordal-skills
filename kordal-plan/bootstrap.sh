#!/usr/bin/env bash
# Copies the agent scaffold into a project that has none yet, and brings a
# scaffolded project up to date with later versions of the scaffold.
#
#   bootstrap.sh [dir]           copy the scaffold; an existing file is kept,
#                                never overwritten, nothing is created through
#                                a symbolic link, and the report says which;
#                                a directory that is not a Git repository
#                                becomes one, on branch main, and one that lies
#                                inside a repository without being its root is
#                                refused; a base branch other than main is
#                                recorded as "base_branch" in the manifest this
#                                run created, where the manifest takes its name
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
#             the other holds in its own form, or the project reaches the file
#             through a symbolic link, or Git does not track it there: the
#             project's file is untouched
#
# A file the scaffold did not change is neither touched nor listed, whatever
# the project made of it. The update needs a recorded version that is a commit
# of this repository, holds the scaffold where it lies now and is contained in
# the checkout (an older checkout would undo what the project already has),
# and a clean project tree, so that it is a diff to review and to revert.
# Without a conflict it records the new version and exits 0; with one it
# records nothing and exits 1: resolve, then --stamp, the one step that
# follows. An --update repeated before it merges from the old version again:
# it leaves alone a file that an earlier run wrote conflict markers into and
# that has changed since (the project's Git directory holds the note of it
# until the version is recorded), and raises every other conflict again.
set -euo pipefail
# cd prints the directory it finds through CDPATH, and $(cd ... && pwd) would hold it twice.
unset CDPATH

skill="$(cd "$(dirname "$0")" && pwd)"
scaffold="$skill/scaffold"
mode=copy
case "${1:-}" in --diff | --stamp | --update) mode=${1#--}; shift ;; esac
dest="$(cd "${1:-.}" && pwd)"
stamp="docs/agents/scaffold-version"
manifest="docs/plans/backlog.json"

version() { git -C "$skill" rev-parse HEAD 2>/dev/null || echo unversioned; }
files() { (cd "$scaffold" && find . -type f ! -name .DS_Store | sed 's|^\./||' | sort); }
# The version the project records, without the carriage return a CRLF checkout adds to it.
recorded() {
	local line=
	[ ! -f "$dest/$stamp" ] || IFS= read -r line <"$dest/$stamp" || true
	echo "${line//[[:space:]]/}"
}
# Whether $from is a version to compare with: a commit of this repository that
# holds the scaffold where it lies now, at $prefix. Otherwise $why says which
# of the two it lacks, or that the project records none.
based() {
	why=
	if [ -z "$from" ] || [ "$from" = unversioned ]; then
		why=none
	elif ! git -C "$skill" cat-file -e "$from^{commit}" 2>/dev/null; then
		why=unknown
	else
		prefix=$(git -C "$scaffold" rev-parse --show-prefix)
		git -C "$skill" cat-file -e "$from:${prefix%/}" 2>/dev/null || why=moved
	fi
	[ -z "$why" ]
}
# Whether the project reaches the file through a symbolic link: the file
# itself, or a directory above it. Nothing is written through one: it may lead
# out of the project, where Git shows no change, or to another scaffold file.
linked() {
	local rest=$1 at=$dest
	while :; do
		at="$at/${rest%%/*}"
		[ ! -L "$at" ] || return 0
		case $rest in */*) rest=${rest#*/} ;; *) return 1 ;; esac
	done
}
# Where --update notes the files it wrote conflict markers into: in the
# project's Git directory, until the version is recorded.
notes() {
	local file
	file=$(git -C "$dest" rev-parse --git-path kordal-scaffold-conflicts 2>/dev/null) || return 0
	case $file in /*) echo "$file" ;; *) echo "$dest/$file" ;; esac
}
write_stamp() {
	local was noted
	was=$(recorded) noted=$(notes)
	if [ -n "$(git -C "$scaffold" status --porcelain -- . 2>/dev/null)" ]; then
		echo "WARN     the scaffold has uncommitted changes: the recorded version does not include them"
	fi
	# A version that another checkout recorded and this one lacks is the newer one, as a rule.
	if [ -n "$was" ] && [ "$was" != unversioned ] && ! git -C "$skill" merge-base --is-ancestor "$was" HEAD 2>/dev/null; then
		echo "WARN     the project recorded $was, which this checkout of $skill does not contain: unless its history was rewritten, the version recorded now is an older one"
	fi
	mkdir -p "$dest/$(dirname "$stamp")"
	version >"$dest/$stamp"
	[ -z "$noted" ] || [ ! -e "$noted" ] || rm -f "$noted"
	echo "version  $(version)"
}
# The branch a milestone starts from and returns to, where the repository
# answers by itself: origin/HEAD where it leads to a branch that is there,
# else main, then master. The full ref is read: its short form is another name
# beside a tag or a branch called origin/<name>.
known_base() {
	local head
	if head=$(git -C "$dest" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) && [ "${head#refs/remotes/origin/}" != "$head" ] && git -C "$dest" show-ref --verify --quiet "$head"; then
		echo "${head#refs/remotes/origin/}"
	elif git -C "$dest" show-ref --verify --quiet refs/heads/main; then
		echo main
	elif git -C "$dest" show-ref --verify --quiet refs/heads/master; then
		echo master
	fi
}
# ... and else the branch the checkout is on, which in a repository this run
# created is main. A detached HEAD is on none: no answer.
base_branch() {
	local name
	name=$(known_base)
	[ -n "$name" ] || name=$(git -C "$dest" symbolic-ref --quiet HEAD 2>/dev/null || true)
	echo "${name#refs/heads/}"
}
# A name the manifest takes as "base_branch", as scripts/agent-workflow.mjs
# checks it. In the C locale, where a-z is those 26 letters and no other.
ordinary() ( LC_ALL=C; case $1 in '' | [!A-Za-z0-9]* | *[!A-Za-z0-9._/-]* | *..* | *//* | */ | *. | *.lock) exit 1 ;; esac )
integration() { sed -n '/.*"integration_branch"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/{s//\1/p;q;}' "$dest/$manifest"; }
# Says why the manifest cannot name the branch as its base, where it cannot:
# a manifest that named it would fail the project's own structure check.
unnamed() {
	if ! ordinary "$1"; then
		echo "WARN     the base branch $1 is not recorded: \"base_branch\" takes a name of letters, digits, \".\", \"_\", \"/\" and \"-\" that starts with a letter or a digit and holds no \"..\" or \"//\", and no \"/\", \".\" or \".lock\" at its end. Until the branch has such a name, the workflow takes main for the base"
	elif [ "$1" = "$(integration)" ]; then
		echo "WARN     the base branch $1 is not recorded: it is the manifest's integration_branch. Give the milestone's branch another name in $manifest, then add \"base_branch\": \"$1\" to it by hand"
	else
		return 1
	fi
}

if [ "$mode" = stamp ]; then
	write_stamp
	exit 0
fi

if [ "$mode" = diff ]; then
	from=$(recorded)
	if based; then
		if ! git -C "$skill" merge-base --is-ancestor "$from" HEAD; then
			echo "WARN     the checkout of $skill does not contain the recorded version $from: unless its history was rewritten, update it first; the changes below lead back to an older scaffold"
		fi
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
		case $why in
			none) echo "No recorded scaffold version: comparing every file with the scaffold at $(version)" ;;
			unknown) echo "The recorded scaffold version $from is no commit of this checkout of $skill: comparing every file with the scaffold at $(version), which may be older than the project's" ;;
			moved) echo "The recorded scaffold version $from holds no scaffold at $prefix: comparing every file with the scaffold at $(version)" ;;
		esac
		files | while IFS= read -r file; do
			if [ ! -e "$dest/$file" ]; then
				echo "missing  $file"
			# A CRLF checkout of the same text does not differ.
			elif ! cmp -s "$scaffold/$file" "$dest/$file" && ! tr -d '\r' <"$dest/$file" | cmp -s "$scaffold/$file" -; then
				echo "differs  $file"
			fi
		done
	fi
	exit 0
fi

if [ "$mode" = update ]; then
	from=$(recorded)
	if ! based; then
		case $why in
			none) echo "FAIL  $dest records no scaffold version that is a commit of $skill (recorded: ${from:-none}), so there is no base to merge from: compare with --diff, apply the changes by hand, then --stamp" ;;
			unknown) echo "FAIL  $dest records the scaffold version $from, which this checkout of $skill does not have, so there is no base to merge from: where a newer checkout recorded it, update this one (git pull) and run --update again; only where that commit is nowhere to be had, compare with --diff, apply the changes by hand, then --stamp" ;;
			moved) echo "FAIL  $dest records the scaffold version $from, which holds no scaffold at $prefix, so there is no base to merge from: compare with --diff, apply the changes by hand, then --stamp" ;;
		esac
		exit 1
	fi
	if ! git -C "$skill" merge-base --is-ancestor "$from" HEAD; then
		echo "FAIL  $dest records the scaffold version $from, which the checkout of $skill (at $(version)) does not contain: it is older than the project's scaffold, or on another branch, and an update would undo changes the project already has. Update the skills checkout (git pull, or switch to the branch that holds that version) and run --update again; only where its history was rewritten (a squash merge, a rebase), compare with --diff, apply the changes by hand, then --stamp"
		exit 1
	fi
	if ! changes=$(git -C "$dest" status --porcelain 2>/dev/null) || [ -n "$changes" ]; then
		echo "FAIL  $dest is not a clean Git checkout: commit or stash your changes first, so that the update is a diff you can review and revert"
		exit 1
	fi
	tmp=$(mktemp -d)
	trap 'rm -rf "$tmp"' EXIT
	base="$tmp/base" to=$(version) noted=$(notes)
	# -z: the names as they are, where a line would quote some. A file's base is <version>:<prefix><file>.
	git -C "$scaffold" ls-tree -r -z "$from" | tr '\0' '\n' >"$tmp/tree"
	cut -f2- "$tmp/tree" | { grep -Ev '(^|/)\.DS_Store$' || true; } >"$tmp/was"
	{ grep '^100755 ' "$tmp/tree" || true; } | cut -f2- >"$tmp/was-executable"
	{ files; cat "$tmp/was"; } | sort -u >"$tmp/files"

	listed() { grep -Fxq -e "$1" "$2"; }
	# The chmod mode that gives another file the executable bit of this one. The
	# bit itself, as Git records it: [ -x ] asks whether the file may run here,
	# which a noexec mount denies to a file that has the bit.
	xbit() { if [ -n "$(find -L "$1" -prune -perm -100)" ]; then echo +x; else echo a-x; fi; }
	# The same file: the same content and the same executable bit.
	same() { cmp -s "$1" "$2" && [ "$(xbit "$1")" = "$(xbit "$2")" ]; }
	# A change to a file that Git does not track in the project, an ignored one, is no diff to review or to revert.
	tracked() { git -C "$dest" --literal-pathspecs ls-files --error-unmatch -- "$file" >/dev/null 2>&1; }
	sum() { git -C "$dest" hash-object --stdin <"$1"; }
	# The project's file with this content and this executable bit, and the line endings it had.
	write() {
		if [ -n "$crlf" ]; then sed $'s/$/\r/' "$1" >"$ours"; else cat "$1" >"$ours"; fi
		chmod "$2" "$ours"
	}
	added=0 updated=0 merged=0 removed=0 kept=0 conflicts=0
	conflict() { echo "CONFLICT $file ($1)"; conflicts=$((conflicts + 1)); }

	while IFS= read -r file; do
		ours="$dest/$file" theirs="$scaffold/$file" was=
		if listed "$file" "$tmp/was"; then
			was=1
			git -C "$skill" show "$from:$prefix$file" >"$base"
			if listed "$file" "$tmp/was-executable"; then chmod +x "$base"; else chmod a-x "$base"; fi
			if [ -e "$theirs" ] && same "$base" "$theirs"; then continue; fi
		fi
		if linked "$file"; then
			if [ ! -e "$theirs" ]; then
				[ ! -e "$ours" ] && [ ! -L "$ours" ] || conflict "removed from the scaffold, and the project reaches it through a symbolic link: left as it is; delete it, or keep it as the project's own"
			elif [ ! -e "$ours" ] || ! same "$ours" "$theirs"; then
				conflict "the project reaches it through a symbolic link, and nothing is written through one: left as it is; bring the link's target up to $theirs by hand"
			fi
			continue
		fi
		# A checkout with CRLF line endings is compared and merged as the text Git
		# holds, without them; not a file that has them in the scaffold itself.
		mine=$ours crlf= text=$theirs
		[ -e "$text" ] || text=$base
		if [ -f "$ours" ] && grep -Iq $'\r$' "$ours" && ! grep -Iq $'\r$' "$text"; then
			mine="$tmp/mine" crlf=1
			tr -d '\r' <"$ours" >"$mine"
			chmod "$(xbit "$ours")" "$mine"
		fi
		if [ -z "$was" ]; then
			if [ ! -e "$ours" ]; then
				mkdir -p "$(dirname "$ours")"
				cp -p "$theirs" "$ours"
				echo "added    $file"; added=$((added + 1))
			elif ! same "$mine" "$theirs"; then
				conflict "new in the scaffold, and the project has its own: left as it is; merge it by hand with $theirs"
			fi
		elif [ ! -e "$theirs" ]; then
			if [ ! -e "$ours" ]; then
				:
			elif ! same "$mine" "$base"; then
				conflict "removed from the scaffold, but the project changed it: left as it is; delete it, or keep it as the project's own"
			elif ! tracked; then
				conflict "removed from the scaffold, and Git does not track it in the project: left as it is; delete it, or keep it as the project's own"
			else
				rm "$ours"
				echo "removed  $file"; removed=$((removed + 1))
			fi
		elif [ ! -e "$ours" ]; then
			echo "kept     $file (the project deleted it: it stays deleted, the scaffold's change is not applied)"; kept=$((kept + 1))
		elif same "$mine" "$theirs"; then
			:
		elif ! tracked; then
			conflict "the scaffold changed it, and Git does not track it in the project: left as it is; merge it by hand with $theirs"
		elif same "$mine" "$base"; then
			write "$theirs" "$(xbit "$theirs")"
			echo "updated  $file"; updated=$((updated + 1))
		else
			# Markers of an earlier update, committed unresolved, would be merged into nested ones.
			if grep -q '^<<<<<<< project$' "$mine"; then
				conflict "it still holds the conflict markers of an earlier update: resolve them"
				continue
			fi
			status=0
			git merge-file -p --diff3 -L project -L "scaffold ${from:0:12}" -L "scaffold ${to:0:12}" "$mine" "$base" "$theirs" >"$tmp/merged" 2>/dev/null || status=$?
			# Above 127 is not a count of conflicts: Git could not merge, a binary file for one.
			if [ "$status" -gt 127 ]; then
				conflict "both changed it and Git cannot merge it: left as it is; merge it by hand with $theirs"
				continue
			fi
			# The project's mode stays, unless the scaffold alone changed it.
			x=$(xbit "$ours")
			[ "$x" != "$(xbit "$base")" ] || x=$(xbit "$theirs")
			# An update repeated before --stamp finds a clean merge already in the project's file.
			if [ "$status" -eq 0 ] && cmp -s "$tmp/merged" "$mine" && [ "$x" = "$(xbit "$ours")" ]; then continue; fi
			if [ "$status" -gt 0 ]; then
				# ... and a conflict resolved by hand: the same merge wrote markers into the
				# file before, and the file is not what it was then. One that is, after the
				# update was reverted, gets them again.
				note="$from $(sum "$theirs") $file" before=$(sum "$ours")
				if [ -n "$noted" ] && [ -e "$noted" ] && listed "$note" "$noted" && ! listed "$before $note" "$noted"; then
					conflict "an earlier update wrote conflict markers into it, and it has changed since: taken as resolved by hand and left as it is; where it is not, merge it by hand with $theirs"
					continue
				fi
				[ -z "$noted" ] || printf '%s\n' "$note" "$before $note" 2>/dev/null >>"$noted" || true
			fi
			write "$tmp/merged" "$x"
			if [ "$status" -eq 0 ]; then
				echo "merged   $file"; merged=$((merged + 1))
			else
				conflict "both changed the same lines: conflict markers written"
			fi
		fi
	done <"$tmp/files"

	# A project scaffolded before its manifest named the base: the update writes
	# no manifest, the project's own file, and says what to add to it.
	if [ -e "$dest/$manifest" ] && ! grep -q '"base_branch"' "$dest/$manifest"; then
		named=$(known_base)
		if [ -z "$named" ]; then
			echo "WARN     $manifest names no \"base_branch\" and the repository has no origin/HEAD, main or master: add \"base_branch\": \"<the base branch>\" to it by hand"
		elif [ "$named" != main ] && ! unnamed "$named"; then
			echo "WARN     the base branch is $named and $manifest names none: add \"base_branch\": \"$named\" to it by hand"
		fi
	fi
	if [ "$conflicts" -eq 0 ]; then
		write_stamp
	else
		# %q: a command to paste, also where a path holds a space.
		printf 'FAIL     the version is not recorded. Resolve each CONFLICT above (edit out the markers; merge, delete or keep the other files by hand), then run --stamp, not --update again, which would merge from the old version once more: bash %q --stamp %q\n' "$skill/bootstrap.sh" "$dest"
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
# The prefix, not the top level against $dest: the two differ where a symbolic link leads to the project.
elif [ -n "$(git -C "$dest" rev-parse --show-prefix)" ]; then
	echo "FAIL  $dest lies inside the Git repository at $(git -C "$dest" rev-parse --show-toplevel) and is not its root, where the scaffold's scripts look for docs/ and scripts/: run this at that root, or make the directory a repository of its own (git init) first"
	exit 1
fi
# A manifest the project already has is kept below, and is the project's to edit.
kept_manifest=
[ ! -e "$dest/$manifest" ] || kept_manifest=1

files | while IFS= read -r file; do
	if [ -e "$dest/$file" ]; then
		echo "kept     $file"
	elif linked "$file"; then
		echo "kept     $file (a symbolic link of the project leads there, and nothing is created through one)"
	else
		mkdir -p "$dest/$(dirname "$file")"
		cp -p "$scaffold/$file" "$dest/$file"
		echo "created  $file"
	fi
done

base=$(base_branch)
# main is the default, and a kept manifest that names its base needs no edit.
if [ "$base" != main ] && [ -e "$dest/$manifest" ] && ! { [ -n "$kept_manifest" ] && grep -q '"base_branch"' "$dest/$manifest"; }; then
	if [ -z "$base" ]; then
		echo "WARN     the base branch could not be detected (a detached HEAD, and no origin/HEAD, main or master): add \"base_branch\": \"<the base branch>\" to $manifest by hand"
	elif unnamed "$base"; then
		:
	elif [ -n "$kept_manifest" ]; then
		echo "WARN     the base branch is $base and $manifest was kept: add \"base_branch\": \"$base\" to it by hand"
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
