# ADR-0030 · Agent runs: a Fargate task per run, Opus 5.5 at an effort per kind, a GitHub App that cannot merge, transcripts under their own key

**Status:** proposed · 2026-09-28 · supersedes [ADR-0008](0008-agent-service-record-half-first.md)'s runner (GitHub Actions); keeps its record half, its run-event contract and its rule that a plan comes before the first act

## Context

Acceptance scenarios A1–A5 are the last of the MVP's before use case 1 (U1, U2). They need a runner, a model, a way onto a repository, a place for transcripts, and a review floor:

- **A1.** A red bump is claimed by a `bump` run, which makes the test pass. Every step, the plan and the next human touchpoint are visible while it runs. Afterwards the transcript is readable by the reader role only.
- **A2.** A green patch-level bump on an N2 application merges under the agent's ceiling.
- **A3.** A run that attempts an act outside its ceiling records `ActionRefused`, naming the check.
- **A4.** The runner's state is dropped; every run's history reads back from the archive and the transcript store.
- **A5.** One run in N lands in a person's review queue; the floor cannot be set to zero.

[ADR-0008](0008-agent-service-record-half-first.md) put the runner in a GitHub Actions workflow per run kind in the application's repository. It rejected Lambda, whose fifteen minutes do not fit an analysis.

The architect decided on 2026-09-28 that runs execute in the tenant's own AWS account, on ECS Fargate, rather than in GitHub Actions:

- **Custody.** Every other part of maestro runs in the tenant's account, and a run reads the tenant's logs and alarms. With the runner there, the tenant's AWS credentials never enter a repository's secrets.
- **No time limit.** Fargate has no fifteen-minute limit, unlike Lambda.

## Decision

### 1. A run is one Fargate task, started and stopped by agent-service

**Starting a run.** work-service decides a run is due (an item a construct claims). agent-service then:
- resolves the run's authority: `accountable`, seat, oversight and onboarding level, and the ceiling;
- records `RunStarted`;
- starts one task with `ecs:RunTask`, passing the run id and nothing else.

**The task.** It is maestro's runner image, published with the release and pinned by digest in the tenant repository: Claude Code, git and Node.
- **At start.** It fetches its run envelope from agent-service with the agent principal's credentials (identity-service client credentials, [ADR-0008](0008-agent-service-record-half-first.md)).
- **Its work.** It clones the one repository the run is about into its ephemeral storage and does the work.
- **Recording.** It posts run events against the contract, and uploads its transcript before `run.ended`.

**Isolation.**
- **No inbound path.** One task per run in the tenant's VPC, with public subnets, egress only, and a security group with no inbound rule. There is no NAT gateway to pay for.
- **Its role can do three things:**
  - read its own secrets (the model API key, the agent principal's credentials);
  - write its run's prefix in the transcript bucket;
  - write its logs.

  Nothing else in AWS. What a run reads of the tenant's telemetry, it reads through maestro's services, which check its seat.

**The ceiling's wall clock is agent-service's to enforce.** When `wall_clock` passes, agent-service stops the task (`ecs:StopTask`) and closes the run `exhausted`. It does not rely on the task to stop itself. Steps and cost are enforced where the run events arrive: an event past the ceiling is answered `refused`, and the runner stops.

### 2. One model, Opus 5.5, with effort set by the run's kind

The runner drives **Claude Opus 5.5** (`claude-opus-5-5`). What varies is effort, set by the construct for its kind and recorded on the run:

| Kind | Effort | Why |
|---|---|---|
| `bump` | low | a failing test after a version change; narrow, checked by CI |
| `explain` | low | reads and summarises; proposes nothing |
| `fix` | medium | changes code for a SEV item; a person merges |
| `rca` | high | a cause analysis a person accepts on a phone (U2); being wrong is expensive |

A construct may raise its kind's effort; nothing lowers it below this table. A second model enters only by a new decision.

### 3. One GitHub App per tenant for runs, which cannot merge

The tenant's GitHub App for runs is installed on the repositories of the applications maestro onboards. Its permissions:
- **write:** contents and pull requests;
- **read:** checks, commit statuses, Actions and Dependabot alerts;
- **none:** workflows, administration, secrets.

**Who holds the key.** agent-service holds the App's private key (Secrets Manager). It mints **one installation token per run**, narrowed at minting to the run's one repository, and hands it to the task in the envelope. The token expires within the hour; a longer run asks agent-service for a new one.

**Why the runner cannot merge.** The default branch of every onboarded repository carries a ruleset:
- changes arrive by pull request only;
- required checks must pass;
- **one approving review is required**;
- the runs App is not on the bypass list.

A run can push a branch and open a pull request, and cannot land it.

**A2's merge is not the runner's.** A green patch-level bump on an N2 application is merged by agent-service itself when the ceiling allows it. It uses a **second App, for merges only**:
- its only write is pull requests (merge);
- it is on the ruleset's bypass list;
- its key is held by agent-service and never reaches a task.

The merge is recorded on the run as agent-service's act, with the check that allowed it.

### 4. Transcripts in S3, under a key only the reader role can use

One S3 bucket per tenant for transcripts (`<tenant>-maestro-transcripts-<account>`), one object per run: `<workspace>/<run_id>.jsonl`.

- **Encryption.** Objects are encrypted with a **KMS key of their own**. Its `Decrypt` is granted only to agent-service's transcript route. The task's role may `Encrypt` (via `GenerateDataKey`) and never `Decrypt`, and no other role may do either. "Readable only by the reader role" is then enforced by the key, not only by the API.
- **Digest.** The object's SHA-256 is carried on `RunClosed` (`transcript_digest`), so a transcript read back later is checked against the record.
- **Retention.** Retention is policy: 400 days by default, then deleted by lifecycle. There is no object lock, because a transcript names people and must be erasable. Erasure deletes the object and leaves the digest on the record.
- **Classification.** `internal-personal`, as [the run](../components/agent-service.md#the-run) says.

This is the recommended improvement on plain S3: the same bucket and object layout, with the key as the second lock. A transcript store outside S3 (a database or a log service) was not considered further. A transcript is written once and read rarely, which is what S3 is for.

### 5. The review floor: every run of a new construct, then one in five decaying to one in twenty, never less

Sampling is per seat and construct digest:

| State | Runs reviewed |
|---|---|
| A construct digest's first 10 runs | every one |
| After that | 1 in 5 |
| After 20 consecutive reviews that agree | 1 in 10 |
| After 20 more that agree | 1 in 20: **the floor** |
| A review that disagrees | back to 1 in 5 for that seat and construct |

- **The floor is enforced by the definition's schema,** which refuses a rate below 1 in 50 for any tenant. A tenant may set its floor between 1 in 50 and 1 in 1; the default is 1 in 20.
- **Selection is decided when a run closes,** so a run cannot be steered into or out of review.
- **A sampled run** raises a `review` item in work-service for a person of the seat's oversight.
- **The finding** (agrees · disagrees, with a note) is recorded against the seat and the construct digest.

## Asked

1. **The merge App** (§3), a second App for A2's merges, rather than one App whose tokens could merge.
   - *Recommended:* two. With one App on the bypass list, any run's token could land its own pull request, and "the runner cannot merge" would rest on the runner's good behaviour.
2. **Effort per kind** (§2).
   - *Recommended:* as tabled; raised by a construct, never lowered.
3. **The review floor** (§5).
   - *Recommended:* the first 10 runs of a construct digest reviewed; then 1 in 5, decaying to 1 in 20; the schema's minimum 1 in 50.
4. **Transcript retention** (§4).
   - *Recommended:* 400 days, a tenant policy value.

## Consequences

- agent-service is built as the other services are: Lambda for its API, DynamoDB, the spine. Beside them it has an ECS cluster (Fargate only), a task definition, the transcript bucket and its key.
- The tenant repository gains the runner image's digest and the VPC the tasks run in. The two Apps' keys go into Secrets Manager; the tenant creates the Apps.
- Onboarding an application's repository for runs means:
  - installing both Apps on it;
  - applying the default-branch ruleset (maestro ships it as a script and checks it at onboarding).
- [ADR-0008](0008-agent-service-record-half-first.md)'s runner section no longer holds. The rest of ADR-0008 still holds: the record half, the contract, and the plan before the first act. [agent-service.md](../components/agent-service.md)'s runner section is rewritten when this is accepted.
- A run costs a Fargate task for its duration (cents) plus the model's tokens, which the ceiling's `cost_eur` bounds.

## What would reopen it

A run kind that needs something a task cannot hold, such as a GPU or a browser against a staging site. Or a tenant whose repositories live somewhere a GitHub App cannot reach.
