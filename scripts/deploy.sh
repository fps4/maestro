#!/usr/bin/env bash
# The tenant pipeline as one script (ADR-0017): plan, apply, mirror — the same on a laptop, on ds1
# and on a GitHub-hosted runner. The reusable workflow calls this; so can a person holding the role.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/deploy.sh <plan|apply|mirror|local-up|local-down> [--root <dir>]

  plan         init (with backend.hcl when the root has one), fmt -check, validate, plan -out=tfplan
  apply        apply the plan this run made, then mirror
  mirror       terraform state pull, encrypted with age, to $MAESTRO_STATE_DIR/<tenant>/<utc>.tfstate.age
  local-up     start LocalStack on localhost:4566 for a deploy/local root
  local-down   stop it

  --root <dir> the root module (default deploy/aws). A root with backend.hcl is the tenant's account
               and its state is mirrored; one without (deploy/local) keeps local, disposable state.

  mirror reads MAESTRO_TENANT, MAESTRO_STATE_RECIPIENT (an age public key) and MAESTRO_STATE_DIR
  (default /srv/maestro/state). Mirrors older than seven days are pruned, never the newest.
EOF
}

die() {
  echo "deploy: $*" >&2
  exit 1
}

# --- arguments -----------------------------------------------------------------------------------

verb="${1:-}"
[ $# -eq 0 ] || shift
root="deploy/aws"
while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      [ $# -ge 2 ] || die "--root needs a directory"
      root="$2"
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [ -z "$verb" ]; then
  usage >&2
  exit 2
fi
case "$verb" in
  --help | -h)
    usage
    exit 0
    ;;
esac

# --- terraform -----------------------------------------------------------------------------------

require_root() {
  [ -d "$root" ] || die "no such root: $root"
  command -v terraform >/dev/null || die "terraform is not on PATH"
}

has_backend() {
  [ -f "$root/backend.hcl" ]
}

tf() {
  terraform -chdir="$root" "$@"
}

do_plan() {
  require_root
  if has_backend; then
    echo "deploy: init $root against the backend named in backend.hcl"
    tf init -input=false -backend-config=backend.hcl >/dev/null
  else
    echo "deploy: init $root with local state (no backend.hcl)"
    tf init -input=false >/dev/null
  fi
  tf fmt -check -recursive >/dev/null || die "terraform fmt -check failed in $root; run terraform fmt -recursive"
  tf validate >/dev/null || die "terraform validate failed in $root"
  echo "deploy: plan $root"
  # One command writes the plan file apply consumes and prints the text a reviewer reads (ADR-0016).
  tf plan -input=false -no-color -out=tfplan
  echo "deploy: plan written to $root/tfplan"
}

do_apply() {
  require_root
  [ -f "$root/tfplan" ] || die "no plan in $root; run 'deploy.sh plan' first, in this same run"
  # A mirror that cannot be written is found out before the apply, not after it.
  if has_backend; then mirror_preflight; fi
  echo "deploy: apply $root/tfplan"
  tf apply -input=false -no-color tfplan
  # A plan applies once: the state has moved on, and the next apply comes from the next plan.
  rm -f "$root/tfplan"
  do_mirror
}

# --- the mirror (ADR-0017 §4) --------------------------------------------------------------------

# The state names everything the tenant's inputs name. It is written outside any checkout,
# encrypted to a recipient whose private key is not on this host, mode 0600 in a 0700 directory.
# Mirrors older than seven days are pruned before the new one is written, except the newest,
# whatever its age: it is the recovery point, and it survives the run that supersedes it.
mirror_preflight() {
  tenant="${MAESTRO_TENANT:-}"
  recipient="${MAESTRO_STATE_RECIPIENT:-}"
  state_dir="${MAESTRO_STATE_DIR:-/srv/maestro/state}"
  [ -n "$tenant" ] || die "MAESTRO_TENANT is unset; the mirror is written under <dir>/<tenant>/"
  [ -n "$recipient" ] || die "MAESTRO_STATE_RECIPIENT is unset; state is never written in plaintext"
  case "$recipient" in age1*) ;; *) die "MAESTRO_STATE_RECIPIENT is not an age public key (age1...)" ;; esac
  case "$state_dir" in /*) ;; *) die "MAESTRO_STATE_DIR must be absolute, outside any checkout: $state_dir" ;; esac
  command -v age >/dev/null || die "age is not on PATH (https://age-encryption.org)"
}

do_mirror() {
  require_root
  if ! has_backend; then
    echo "deploy: $root has no backend.hcl; local state is disposable and is not mirrored"
    return 0
  fi
  mirror_preflight
  local dir newest pruned state file tmp
  dir="$state_dir/$tenant"
  (umask 077 && mkdir -p "$dir")
  chmod 0700 "$dir"

  # Names carry the UTC time of the write, so the newest sorts last; age is the file's mtime.
  newest="$(find "$dir" -maxdepth 1 -name '*.tfstate.age' | sort | tail -n 1)"
  pruned=0
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    [ "$old" = "$newest" ] && continue
    rm -f "$old"
    echo "deploy: pruned $old"
    pruned=$((pruned + 1))
  done < <(find "$dir" -maxdepth 1 -name '*.tfstate.age' -mmin +10080 | sort)
  [ -z "$newest" ] || echo "deploy: $pruned pruned, kept $newest"

  state="$(tf state pull)"
  [ -n "$state" ] || die "terraform state pull returned nothing; no mirror written"
  file="$dir/$(date -u +%Y%m%dT%H%M%SZ).tfstate.age"
  tmp="$file.part"
  # Plaintext goes from the pull into age and nowhere else.
  (umask 077 && printf '%s\n' "$state" | age -r "$recipient" -o "$tmp")
  chmod 0600 "$tmp"
  mv "$tmp" "$file"
  echo "deploy: mirror written to $file"
}

# --- LocalStack (ADR-0017 §3) ----------------------------------------------------------------------

# 4.4.0 is the last Community image that starts without an auth token; later tags need
# LOCALSTACK_AUTH_TOKEN. The Docker socket is mounted because LocalStack creates a Lambda function
# by preparing a container for it.
localstack_image="${MAESTRO_LOCALSTACK_IMAGE:-localstack/localstack:4.4.0}"
localstack_name="maestro-localstack"

wait_healthy() {
  local tries=60
  while [ "$tries" -gt 0 ]; do
    if curl -fsS localhost:4566/_localstack/health >/dev/null 2>&1; then
      echo "deploy: localstack listening on http://localhost:4566"
      return 0
    fi
    sleep 2
    tries=$((tries - 1))
  done
  die "localstack did not become healthy in 120s; see docker logs $localstack_name"
}

do_local_up() {
  command -v docker >/dev/null || die "docker is not on PATH"
  if [ -n "$(docker ps -q -f "name=^${localstack_name}$")" ]; then
    echo "deploy: $localstack_name is already running"
  else
    docker rm -f "$localstack_name" >/dev/null 2>&1 || true
    echo "deploy: starting $localstack_image as $localstack_name"
    docker run -d --name "$localstack_name" -p 4566:4566 \
      -v /var/run/docker.sock:/var/run/docker.sock "$localstack_image" >/dev/null
  fi
  wait_healthy
}

do_local_down() {
  command -v docker >/dev/null || die "docker is not on PATH"
  if docker rm -f "$localstack_name" >/dev/null 2>&1; then
    echo "deploy: $localstack_name removed"
  else
    echo "deploy: $localstack_name was not running"
  fi
}

# --- dispatch ------------------------------------------------------------------------------------

case "$verb" in
  plan) do_plan ;;
  apply) do_apply ;;
  mirror) do_mirror ;;
  local-up) do_local_up ;;
  local-down) do_local_down ;;
  *) die "unknown verb: $verb (plan | apply | mirror | local-up | local-down)" ;;
esac
