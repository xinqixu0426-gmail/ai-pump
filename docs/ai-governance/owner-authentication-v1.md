# Dedicated owner authentication v1 — P16-I-R2

## Authority and defaults

Existing login/check contracts are maintained in [API reference](../api-reference.md#3-认证). There is no user table, new business capability, write authority, account lifecycle or UI change. `ownerAuthentication.cjs` is the sole new owner identity primitive. It verifies JWTs using the existing `jsonwebtoken` dependency, accepts only HS256 and checks expiration. `isAuthenticatedOwner` only accepts a frozen context created by signature verification, never a request object or decoded-but-unverified payload. Admin role alone cannot grant owner.

`PUMP_OWNER_ACCESS_PASSWORD` and `PUMP_OWNER_SUBJECT` default UNSET; `AI_V5_OWNER_SUBJECTS` defaults `[]`. The single-owner MVP requires exactly one allowlisted subject equal to the configured opaque subject (16–128 ASCII identifier characters). The password must be a 32–512 character string distinct from the existing shared password. Provisioning generates 32 cryptographically random bytes, encoded base64url; subject is a generated UUID. Exact credential comparison uses fixed-size digest timing-safe comparison, with no digest persistence. Invalid config or password collision disables owner authentication; Legacy shared authentication remains available.

## Additive deployment

Mac mini installation: `/Users/dan/pump-owner-auth-p16ir2`, operator-only parent directory. `scripts/start-owner-authentication.cjs` listens only on `127.0.0.1:3104`. User LaunchAgent `org.pump.owner-authentication` runs as uid 501, using existing Legacy dependencies. It does not import API startup or open SQLite. Like P16-H, persistence is within the operator's logged-in GUI launchd domain; it is not a pre-login system boot guarantee.

Only exact Cloudflare ingress paths for existing login and check are directed here. All other ingress, including P16-H, is preserved. Shared login and every check use the live Legacy auth endpoints; the owner branch issues a JWT with the existing secret/role/expiry and stable `sub`, plus `authn=owner_credential_v1`. Logout and normal middleware remain Legacy. Production Cookie: `token`, HttpOnly, Secure, SameSite=Strict, Path=/, 15 days. No token is returned in JSON. Existing access rights and existing sessions remain unchanged.

The gateway requires a loopback trusted connector, uses the established one-proxy trust topology and 5/minute/IP rate limit, bounds JSON to 32 KiB, bounds the fixed upstream response to 32 KiB and upstream inactivity to 5 seconds. Client owner/sub/header values cannot choose identity. It has no business/AI forwarding route, tool access or model call. Identity changes do not enable default V5 routing.

## Secure configuration and handoff

Existing production `.env` remains the authority, owned by uid 501 with mode 0600 and no symlink. The gateway reads it per request so disabling the allowlist takes effect without Legacy restart. Only the three approved owner keys are added; existing keys are preserved. Never print `.env`, the handoff file, JWTs, password hashes or credentials into diagnostics.

The operator handoff file is `/Users/dan/pump-owner-auth-p16ir2/private/owner-login-credential.txt`, outside all repositories, mode 0600 under a mode 0700 directory. Retrieve privately through the existing authenticated operator SSH workflow. No password appears in Git, reports or normal logs. The gateway has no content logger; launchd stdout/stderr go to `/dev/null`. Certification persists only boolean/status metadata.

## Operator actions and rollback

Use `/opt/homebrew/bin/node /Users/dan/pump-owner-auth-p16ir2/scripts/manage-owner-authentication.cjs <command>` as dan. `provision` is single-use and refuses existing owner keys/handoff; `install` refuses an existing plist. Never rerun provisioning to test or rotate credentials implicitly.

- `disable`: empty the exact owner allowlist. New owner login unavailable; existing owner JWT is no longer owner; shared login continues. No process restart required.
- `enable`: restore the one configured subject to the allowlist. Only use with operator approval.
- `disable-route`: remove only the two auth ingress rules, returning login/check entirely to Legacy. P16-H ingress is unaffected. Old owner JWT remains an ordinary valid admin token until its existing expiry; this is not global token revocation.
- To retire the separate process after route rollback, boot out `gui/501/org.pump.owner-authentication`; never restart/stop Legacy or the P16-H Candidate for this change.

No database restore, migration, business write or alias repair is involved. The owner-default V5 rollout remains a separate Supervisor decision.
