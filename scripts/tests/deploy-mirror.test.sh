#!/usr/bin/env bash
# The mirror's retention rule (ADR-0017 §4), against a fake terraform and a throwaway age key:
# a mirror is written encrypted, mode 0600; mirrors older than seven days are pruned on the next
# run; the newest is never pruned, whatever its age; nothing is written without a recipient.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v age >/dev/null || ! command -v age-keygen >/dev/null; then
  echo "skip: age is not installed (brew install age / apt install age)"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/root"
touch "$tmp/root/backend.hcl"

# Only `state pull` matters; everything else the script asks of terraform is a no-op here.
cat >"$tmp/bin/terraform" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"state pull"*) printf '{"version":4,"serial":7,"lineage":"test"}\n' ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$tmp/bin/terraform"
export PATH="$tmp/bin:$PATH"

age-keygen -o "$tmp/key.txt" 2>/dev/null
export MAESTRO_TENANT="aannemer-x"
export MAESTRO_STATE_RECIPIENT
MAESTRO_STATE_RECIPIENT="$(age-keygen -y "$tmp/key.txt")"
export MAESTRO_STATE_DIR="$tmp/state"
dir="$MAESTRO_STATE_DIR/$MAESTRO_TENANT"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# YYYYMMDDhhmm, n days ago — BSD date first, GNU date second.
days_ago() {
  date -v-"$1"d +%Y%m%d%H%M 2>/dev/null || date -d "-$1 days" +%Y%m%d%H%M
}

# A backdated mirror: its name carries the time, its mtime carries the age.
backdated() {
  local stamp="$1" name
  name="$dir/${stamp:0:8}T${stamp:8:4}00Z.tfstate.age"
  mkdir -p "$dir"
  printf 'old\n' >"$name"
  touch -t "$stamp" "$name"
  echo "$name"
}

listing() {
  find "$dir" -maxdepth 1 -name '*.tfstate.age' | sort | xargs -n1 basename 2>/dev/null | paste -sd' ' -
}

newest_mirror() {
  find "$dir" -maxdepth 1 -name '*.tfstate.age' | sort | tail -n 1
}

mirror() {
  scripts/deploy.sh mirror --root "$tmp/root" >"$tmp/out.txt" 2>&1 || {
    cat "$tmp/out.txt"
    fail "mirror exited non-zero"
  }
}

# --- refusals -----------------------------------------------------------------------------------

if MAESTRO_STATE_RECIPIENT='' scripts/deploy.sh mirror --root "$tmp/root" >/dev/null 2>&1; then
  fail "mirror ran without a recipient"
fi
[ ! -e "$dir" ] || fail "something was written without a recipient"
if MAESTRO_STATE_DIR=relative/dir scripts/deploy.sh mirror --root "$tmp/root" >/dev/null 2>&1; then
  fail "mirror accepted a relative MAESTRO_STATE_DIR"
fi
if MAESTRO_STATE_RECIPIENT=not-a-key scripts/deploy.sh mirror --root "$tmp/root" >/dev/null 2>&1; then
  fail "mirror accepted a recipient that is not an age public key"
fi
echo "ok: refuses to write without a recipient, a key, or an absolute directory"

# --- run 1: the 8-day-old newest survives; older ones go ------------------------------------------

a="$(backdated "$(days_ago 30)")"
b="$(backdated "$(days_ago 9)")"
c="$(backdated "$(days_ago 8)")"
mirror
n1="$(newest_mirror)"
[ ! -e "$a" ] || fail "30-day-old mirror was not pruned"
[ ! -e "$b" ] || fail "9-day-old mirror was not pruned"
[ -e "$c" ] || fail "8-day-old mirror was pruned although it was the newest"
[ "$n1" != "$c" ] || fail "no new mirror was written"
echo "ok: run 1 — $(listing)"

[ "$(stat -f %Lp "$n1" 2>/dev/null || stat -c %a "$n1")" = "600" ] || fail "mirror is not mode 0600"
[ "$(stat -f %Lp "$dir" 2>/dev/null || stat -c %a "$dir")" = "700" ] || fail "directory is not mode 0700"
age -d -i "$tmp/key.txt" "$n1" | grep -q '"serial":7' || fail "mirror does not decrypt to the pulled state"
! grep -q serial "$n1" || fail "mirror holds plaintext"
echo "ok: encrypted to the recipient, 0600 in a 0700 directory"

# --- run 2: once superseded, the 8-day-old mirror goes; a 3-day-old one stays ---------------------

sleep 1
d="$(backdated "$(days_ago 3)")"
mirror
n2="$(newest_mirror)"
[ ! -e "$c" ] || fail "8-day-old mirror survived a run in which it was no longer the newest"
[ -e "$d" ] || fail "3-day-old mirror was pruned"
[ -e "$n1" ] || fail "the previous run's mirror was pruned"
[ "$n2" != "$n1" ] || fail "no new mirror was written"
echo "ok: run 2 — $(listing)"

# --- run 3: everything old but the newest goes, whatever the newest's age --------------------------

sleep 1
touch -t "$(days_ago 20)" "$d"
touch -t "$(days_ago 10)" "$n1"
touch -t "$(days_ago 8)" "$n2"
mirror
n3="$(newest_mirror)"
[ ! -e "$d" ] || fail "20-day-old mirror was not pruned"
[ ! -e "$n1" ] || fail "10-day-old mirror was not pruned"
[ -e "$n2" ] || fail "8-day-old newest mirror was pruned"
[ "$n3" != "$n2" ] || fail "no new mirror was written"
[ "$(listing | wc -w | tr -d ' ')" = "2" ] || fail "expected exactly two mirrors, got: $(listing)"
echo "ok: run 3 — $(listing)"

echo "deploy-mirror: all checks passed"
