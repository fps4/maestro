#!/usr/bin/env bash
# Checks out each public component at its tag and builds it, for the tenant pipeline (ADR-0017):
# $COMPONENTS is a JSON map of component to git ref, e.g. {"maestro":"spine-v0.1.2"}. Each
# fps4/<component> lands under components/<component>/; every package in it that has a lockfile
# (build-standards §3) gets `npm ci`, then `npm run build` and `npm run bundle` where those scripts
# exist. The tenant's root modules then reference components/<component>/... by path.
set -euo pipefail

components="${COMPONENTS:-{\}}"
command -v jq >/dev/null || { echo "checkout-components: jq is not on PATH" >&2; exit 1; }
command -v npm >/dev/null || { echo "checkout-components: npm is not on PATH" >&2; exit 1; }
jq -e 'type == "object"' <<<"$components" >/dev/null || { echo "checkout-components: COMPONENTS is not a JSON object" >&2; exit 1; }

while IFS=$'\t' read -r name ref; do
  [ -n "$name" ] || continue
  case "$name" in
    */* | .* | "") echo "checkout-components: bad component name: $name" >&2; exit 1 ;;
  esac
  dir="components/$name"
  if [ -d "$dir/.git" ]; then
    # The workflow checks maestro out first, with actions/checkout: it is where this script lives.
    echo "checkout-components: $dir is already checked out"
  else
    echo "checkout-components: fps4/$name at $ref -> $dir"
    rm -rf "$dir"
    git init -q "$dir"
    git -C "$dir" remote add origin "https://github.com/fps4/$name.git"
    # A tag, a branch or a commit: fetch by name, check out what arrived.
    git -C "$dir" fetch -q --depth 1 origin "$ref"
    git -C "$dir" checkout -q --detach FETCH_HEAD
  fi

  while IFS= read -r lock; do
    pkg="$(dirname "$lock")"
    # A lockfile is a package only beside its package.json; a stray one is not built.
    [ -f "$pkg/package.json" ] || { echo "checkout-components: $pkg has a lockfile but no package.json; skipped"; continue; }
    echo "checkout-components: build $pkg"
    (cd "$pkg" && npm ci --no-audit --no-fund --silent && npm run build --if-present && npm run bundle --if-present)
  done < <(find "$dir" -maxdepth 2 -name package-lock.json -not -path '*/node_modules/*' | sort)
done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' <<<"$components")
echo "checkout-components: done"
