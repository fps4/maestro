#!/usr/bin/env bash
# Checks that every relative Markdown link resolves to a file and, where an #anchor is given,
# that a heading with that GitHub-style slug exists in the target. Prints each failure; exits 1 if any.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

slug() {
  printf '%s\n' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[`*_]//g; s/[^a-z0-9 -]//g; s/ /-/g'
}

out="$(
git ls-files --cached --others --exclude-standard '*.md' | while IFS= read -r file; do
  grep -oE '\]\([^)]+\)' "$file" | sed -E 's/^\]\((.*)\)$/\1/' | while IFS= read -r target; do
    case "$target" in *://* | mailto:* | attachment:* | '#'*) continue ;; esac
    path="${target%%#*}"; anchor=""
    [[ "$target" == *"#"* ]] && anchor="${target#*#}"
    dir="$(dirname "$file")"
    if [ ! -e "$dir/$path" ]; then echo "BROKEN   $file -> $target"; continue; fi
    if [ -n "$anchor" ] && [ -f "$dir/$path" ]; then
      if ! grep -E '^#{1,6} ' "$dir/$path" | sed -E 's/^#{1,6} //' | while IFS= read -r h; do slug "$h"; done | grep -x "$anchor" >/dev/null; then
        echo "NOANCHOR $file -> $target"
      fi
    fi
  done
done
)"
if [ -n "$out" ]; then echo "$out"; exit 1; fi
echo "links ok"
