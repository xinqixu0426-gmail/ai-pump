# P16-I-R2 — Dedicated Owner Credential + Stable Principal

## Executive result

PASS. Dedicated server-controlled owner authentication is deployed additively without restarting Legacy. Shared admin remains non-owner. The exact owner primitive has a real verified stable subject. P16-I may resume only under a separate Supervisor decision; this stage does not enable owner-default V5 routing.

Start: `671c813e2cbcbb5576bd152785ad01523b782c48`, branch `master`. User-owned dirty work is excluded from the stage commit. Production Legacy revision stays `12fee179b6074215cf359bcc1a789ce1a345b9ba`, PID 59155 before/after. Candidate remains the frozen `15091c9ec4c462b1a1906952d3fdd788502d2ece` runtime.

## Implementation and authority

`ownerAuthentication.cjs` implements exact owner credential matching, JWT issuance and server-verified owner classification. Owner config defaults UNSET/empty. Shared credentials are still validated and issued by Legacy, not reimplemented. Owner-only issuance uses existing `jsonwebtoken`, existing signature secret, role, cookie security and expiry. Client fields/headers cannot select identity. No account DB, schema, business capability, tool, model, V4 or Candidate modification.

The standalone gateway is limited to login/check. It preserves the five-attempt login limit, no-store responses and safe request IDs. It never routes `/api/ai/chat` or any business endpoint. Runtime and operational contract: [owner authentication v1](../owner-authentication-v1.md). Existing API authority was updated in place, not replaced with a parallel API definition.

## Local certification

Eight deterministic/HTTP tests cover unset config, shared admin without sub, stable owner sub, wrong credential, same role/different principal, forged header, forged/unsigned/wrong-algorithm/expired JWT, empty/wildcard/duplicate allowlist, wrong subject, password collision, malformed config, immediate owner rollback, real existing Legacy middleware, cookie/logout compatibility, per-IP rate limiting and absence of business routing.

P16-H gateway/runtime regression: 22/22. API governance: 26/26. Focused ESLint and Next build PASS. Full tests: 2217/2218, sole failure remains missing `.guardian/config.yaml`. Deep API reproduces the previously attributed `search_coils.copperBase` versus formal API mismatch; no coil/shared business code was changed, and no repair is included. These known repository failures are not reported as passing.

## Production certification

Remote certification provisioned a random dedicated password and stable opaque subject into the existing protected `.env`, preserving all existing keys. Handoff file is outside Git, operator-readable only. Neither credentials, JWTs nor subject values appear in this report or dataset.

Public shared login: HTTP 200, admin with no sub, owner false. Public owner login: HTTP 200, stable signed subject, owner true. Wrong credential rejected; forged JWT rejected; valid JWT with unknown subject remains non-owner. Forged owner header did not elevate shared admin. Secure/HttpOnly/Strict cookie and request ID verified.

Disable allowlist: existing owner token checks owner false; shared login remains 200; owner credential rejected. Re-enable: previous valid owner token checks owner true. No Legacy restart or DB restore. The rollback revokes owner classification, not ordinary admin token validity; existing JWT expiry/logout semantics are unchanged.

Owner and non-owner requests to the ordinary authenticated AI health route both returned 200 through Legacy, with zero Candidate attempt increments. This is an ingress/authentication check, not a new full AI corpus evaluation. The explicit P16-H route rejected missing authentication and completed one authorized read-only canary successfully. Automatic owner/non-owner routing remains absent.

Gateway was subsequently restarted alone to apply the API request-ID header convention; public shared and owner checks passed again. Final auth gateway PID 76055; Legacy remains PID 59155. Candidate and Legacy health passed. No production Legacy/Candidate source revision changes.

## Data, privacy and limits

Production certification compared DB SHA-256, mtime, size and complete backup filename list before/after: all identical. No business mutation or V5 write was requested; Candidate's existing read-only boundary was untouched. Existing production environment keys compared equal; only the authorized three owner keys were added. Handoff is mode 0600 beneath mode 0700, owned by operator uid 501. Runtime has no content logger and LaunchAgent streams go to `/dev/null`.

This is a single-owner exact allowlist, not multi-user authentication management. User LaunchAgent persistence has the same logged-in operator-session boundary as P16-H. Gateway unavailability affects only the two auth ingress paths; disabling those exact rules restores Legacy authentication without touching P16-H or business routes. No automatic routing, broad authentication redesign, credential rotation or global logout is included.

Safe evidence: [certification dataset](../data/p16-i-r2-owner-authentication.json). Credential handoff location is documented in the runbook; no credential content is persisted in governance artifacts.

## Gate

`P16_I_RESUME_READY=YES`. Current unique identity blocker: NONE. Owner-default read route remains LEGACY. STOP for Supervisor review.
