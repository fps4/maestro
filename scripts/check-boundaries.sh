#!/usr/bin/env bash
# The services live in one repository but stay apart (ADR-0020): code under specs/ or work/
# imports from its own tree, or from a package by name (the spine from npm, the rest over HTTP) —
# never by a relative path into another component's source. Prints each crossing; exits 1 if any.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

out="$(
git ls-files --cached --others --exclude-standard -- 'specs/*' 'work/*' \
  | grep -E '\.(ts|tsx|mts|cts|js|mjs|cjs)$' | grep -v '/node_modules/' \
  | while IFS= read -r file; do
      service="${file%%/*}"
      grep -noE "(from|import|require)[[:space:]]*\(?[[:space:]]*['\"]\.{1,2}/[^'\"]*['\"]" "$file" \
        | while IFS= read -r hit; do
            line="${hit%%:*}"
            spec="$(printf '%s' "${hit#*:}" | sed -E "s/^[^'\"]*['\"]//; s/['\"]$//")"
            # Resolve the path lexically against the importing file's directory.
            resolved="$(dirname "$file")/$spec"
            parts=(); IFS=/ read -ra segs <<<"$resolved"
            for s in "${segs[@]}"; do
              case "$s" in
                '' | .) ;;
                ..) [ ${#parts[@]} -gt 0 ] && unset 'parts[${#parts[@]}-1]' ;;
                *) parts+=("$s") ;;
              esac
            done
            [ "${parts[0]:-}" = "$service" ] || echo "CROSSES  $file:$line -> $spec"
          done
    done
)"
if [ -n "$out" ]; then echo "$out"; exit 1; fi
echo "boundaries ok"
