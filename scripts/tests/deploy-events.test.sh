#!/usr/bin/env bash
# Deploy events (docs/signals.md): after an apply, one `maestro.deploy` per application whose Lambda
# functions the plan created or changed — none for a function the plan left alone, none for an
# application it did not touch, none without a map. Against a fake terraform and a fake aws.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
command -v jq >/dev/null || { echo "skip: jq is not installed"; exit 0; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/root"
touch "$tmp/root/tfplan"

cat >"$tmp/bin/terraform" <<'TF'
#!/usr/bin/env bash
case "$*" in
  *"show -json tfplan"*) cat <<'JSON'
{"resource_changes":[
 {"address":"module.specs.aws_lambda_function.api","type":"aws_lambda_function","change":{"actions":["update"],"after":{"source_code_hash":"AAA="}}},
 {"address":"module.specs.aws_lambda_function.relay","type":"aws_lambda_function","change":{"actions":["no-op"],"after":{"source_code_hash":"BBB="}}},
 {"address":"module.work.aws_lambda_function.intake[0]","type":"aws_lambda_function","change":{"actions":["create"],"after":{"source_code_hash":"CCC="}}},
 {"address":"module.work.aws_sqs_queue.signals[0]","type":"aws_sqs_queue","change":{"actions":["create"],"after":{}}},
 {"address":"module.identity.aws_lambda_function.service","type":"aws_lambda_function","change":{"actions":["no-op"],"after":{"source_code_hash":"DDD="}}}
]}
JSON
  ;;
  *) exit 0 ;;
esac
TF
cat >"$tmp/bin/aws" <<'AWS'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do [ "$1" = "--entries" ] && { printf '%s\n' "$2" >> "$AWS_LOG"; }; shift; done
echo 0
AWS
chmod +x "$tmp/bin/terraform" "$tmp/bin/aws"
export PATH="$tmp/bin:$PATH" AWS_LOG="$tmp/aws.log" GITHUB_SHA=abc123
: >"$AWS_LOG"

fail() { echo "FAIL: $*" >&2; exit 1; }

# No map: an apply puts nothing.
scripts/deploy.sh apply --root "$tmp/root" >/dev/null
[ ! -s "$AWS_LOG" ] || fail "an apply with no deploy-events.json put events"

cat >"$tmp/root/deploy-events.json" <<'JSON'
{ "specs-service": { "module": "module.specs", "environment": "production" },
  "work-service": { "module": "module.work", "environment": "production" },
  "identity-service": { "module": "module.identity", "environment": "production" } }
JSON
touch "$tmp/root/tfplan"
out="$(scripts/deploy.sh apply --root "$tmp/root")"

[ "$(wc -l <"$AWS_LOG" | tr -d ' ')" = 2 ] || fail "expected two events, got: $(cat "$AWS_LOG")"
detail() { jq -r --arg a "$1" '.[0].Detail | fromjson | select(.application == $a)' "$AWS_LOG"; }
[ "$(jq -rs '[.[][0].Source] | unique | join(",")' "$AWS_LOG")" = "maestro.deploy" ] || fail "wrong source"
[ "$(detail specs-service | jq -r .environment)" = production ] || fail "specs-service not deployed"
[ "$(detail specs-service | jq -r .commit)" = abc123 ] || fail "the commit is not carried"
[ -n "$(detail work-service)" ] || fail "a created function is a deploy"
[ -z "$(detail identity-service)" ] || fail "an application whose functions did not change was deployed"
hash() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }
expected="sha256:$(printf 'module.specs.aws_lambda_function.api=AAA=\n' | hash | cut -d' ' -f1)"
[ "$(detail specs-service | jq -r .digest)" = "$expected" ] || fail "digest $(detail specs-service | jq -r .digest) != $expected"
grep -q "put maestro.deploy specs-service/production" <<<"$out" || fail "the put is not reported"
echo "deploy events: ok"
