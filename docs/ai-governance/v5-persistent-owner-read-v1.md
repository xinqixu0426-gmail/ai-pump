# P16-H Persistent Owner Read Operations

## Scope and authority

Normal production remains Legacy at `/Users/dan/pump-cost-accounting-system`, revision `12fee179b6074215cf359bcc1a789ce1a345b9ba`. It is not restarted or reconfigured by this rollout. Candidate remains frozen at `15091c9ec4c462b1a1906952d3fdd788502d2ece`, in `/Users/dan/pump-v5-candidate-15091c9-r4p`. The gateway is the unchanged P16-G implementation from `85e4b91461832102b8815ad24c4a0027057ed3dc`.

Only `POST /api/ai/owner-read-canary` is routed to the separate gateway. Existing internal/operator authentication, `x-pump-v5-use:true`, an approved `x-pump-v5-fact`, and the existing single-user-message contract remain mandatory. Shared ordinary JWTs or self-declared owner headers do not authorize Candidate. There is no automatic owner opt-in, sticky session, sampling, non-owner cohort, duplicated traffic, or write authority. No Web UI credential is embedded or changed.

The owner route is an intentional persistent operational exception; source defaults remain disabled. A complete validated Candidate response is required. Any non-success is discarded before a single real Legacy fallback. The frozen 60-second Candidate transport ceiling, no retry, and Legacy write-confirmation policy remain unchanged.

## Supervision

The dedicated operations directory is `/Users/dan/pump-v5-owner-ops-p16h` (owner-only directory). It contains deployed copies of `scripts/v5-owner-persistent-runtime.cjs`, the frozen gateway, `manage.cjs` (from `scripts/manage-v5-owner-persistent.cjs`), and a non-secret `runtime.json` with explicit `enabled:true`.

Two independent user LaunchAgents under `gui/501` run as `dan`, never root:

| Label | Bind | Role |
| --- | --- | --- |
| `org.pump.v5-owner-candidate` | `127.0.0.1:3102` | Frozen read-only Candidate |
| `org.pump.v5-owner-gateway` | `127.0.0.1:3103` | Frozen authenticated owner gateway |

Plists are in `/Users/dan/Library/LaunchAgents/`; `RunAtLoad=true`, `KeepAlive=true`, throttle 5 seconds. Neither replaces a system LaunchDaemon. This supervision is tied to the owner's GUI login domain: it is persistent while that user domain exists and starts at login, not a newly installed pre-login system service. Reboot-before-login availability was not certified. Existing production Legacy remains independently supervised.

Runtime credentials are read transiently from the existing Legacy `.env`; no secret is copied into a plist, runtime config, repository, or operational report. Existing dependencies and Node are reused. Candidate opens the production database through its already-certified native read-only startup path, with no migration, checkpoint, scheduling of mutation jobs, or write execution.

## Status and restart

Execute as the existing `dan` SSH identity; no sudo:

```sh
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs status'
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs restart-candidate'
```

`restart-candidate` sends SIGTERM to its launchd job; KeepAlive restores it. Verify a new Candidate PID, ready health, and unchanged Legacy PID. Do not restart Legacy to repair Candidate availability. `stop-candidate` bootouts only Candidate; `start-candidate` bootstraps its existing plist. This pair was tested against real owner fallback and subsequent V5 recovery.

## Complete rollback and restore

```sh
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs rollback'
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs status'
```

Rollback first removes only the exact owner ingress rule, preserving all other tunnel rules, then bootouts/disables gateway and Candidate labels. Ordinary production remains Legacy. No DB restore, business rollback, Legacy restart, sudoers change, or credential change is needed. If an ingress control call fails, stop and inspect the reported operation failure; do not assume rollback completed.

Restore the approved state, only after confirming both processes are healthy:

```sh
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs start'
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs status'
ssh macmini 'export PATH=/opt/homebrew/bin:/usr/bin:/bin; node /Users/dan/pump-v5-owner-ops-p16h/manage.cjs enable-route'
```

The management installer is explicit, Mac/user-specific, and refuses conflicting runtime config or existing plist replacement. It is not a general deployment platform. Initial provisioning used separate files only; no legacy source/env replacement occurred.

## Metadata and privacy

`candidate-metadata.json` and `gateway-metadata.json` retain at most 100 fixed-schema outcomes each, plus per-process counters and RSS/heap snapshots. Process restart resets the process-local counters; they are not lifetime totals. Status checks query actual health; stored `ready` is a startup/shutdown observation, not a substitute for liveness.

Candidate uses the existing Phoenix/OpenInference SDK with a local bounded metadata processor; no collector was installed or changed. Root/parent/task ownership is checked at completed root spans because the project's OpenInference wrapper populates root attributes after SDK `onStart`. No span attributes, request bodies, answer bodies, canonical IDs, facts, model reasoning, or credentials are persisted. Generic console/library output is suppressed; launchd stdout/stderr are `/dev/null`. This is a metadata-only operational recorder, not a retained full distributed-trace archive.

Memory figures are focused operational observations, not a leak-free long-duration proof. The owner route remains a narrow opt-in production capability; P16-I, general cutover, model tuning, and write enablement are not authorized by this document.
