# P16-L-R1 — Conversation Context Transport Foundation

## Result and scope

PASS. Start: `bcd6a939bfd0ec42d0e2894f7ef5b35c3263699f`, master. P16-L resume foundation is ready; no pagination, collection, count, detail, query state or continuation token was implemented. P17 remains paused.

## Identity and lifecycle

The frontend already creates and persists a technical chat conversation before sending messages. Reuse that existing positive safe-integer ID, encoded as `chat-<id>` in the request. This is a non-business opaque handle (not a random UUID or secret). No new persistence, database schema, account session or message-content-derived ID is introduced. Reloading/opening the same persisted conversation retains its ID. Different persisted conversations, including separate tabs, have different IDs; two tabs deliberately opening the same conversation share its identity.

`conversation-context.ts` validates the existing ID before transport. `ai-view.tsx` passes the actual active/just-created conversation ID to `streamAiChat`. Other callers without a persisted conversation remain compatible by omitting the optional field; they cannot obtain a conversation namespace.

## Trust boundary

The existing stable-owner authentication remains the sole permission source. Only `verifyAuthentication` plus `isAuthenticatedOwner` permits gateway namespace creation. The server computes an HMAC over a versioned, unambiguous tuple of verified subject and conversation ID, then signs the internal envelope. Client-provided internal context headers are never forwarded. Another principal with the same conversation ID and the same principal with another conversation ID produce different namespace keys.

Candidate verifies the envelope and holds the frozen context only in request-local AsyncLocalStorage. It is not a member of the model/Interpreter/Tool/Resolver input or outcome. Missing context remains null. Malformed client IDs fail closed for Candidate admission and are stripped before Legacy fallback. Invalid internal envelopes fail before the business pipeline. No global last query exists.

The ID does not authenticate, prove ownership of a chat history record, authorize a business entity, or act as a cursor. Future P16-L must bind its own server-issued query state to this namespace and validate lifetime/query identity. Transport context itself holds no continuation state and grants no reusable execution permission.

## Compatibility

Legacy backend code is unchanged. The gateway strips only `conversationId` and preserves the remaining Legacy body and original caller authentication. Existing single-message Candidate admission stays frozen: history/pageContext/turnState requests still fall back, rather than silently losing history. R1 is not a multi-turn Interpreter change. Explicit internal canary without an authenticated owner retains its old read behavior without creating an owner namespace. Existing SSE content/done remains unchanged.

Formal contract is consolidated under the owner gateway section of `docs/api-reference.md`. No new business capability, Tool or Business API was added.

## Verification

- Conversation tests: 5/5, including stable persisted identity/reload/tab mapping, malformed IDs, signature tamper, cross-principal and cross-conversation isolation, 10 concurrent request-local contexts, HTTP owner/shared/anonymous/fallback isolation, and no context values in the actual Candidate risk-model input or outcome.
- Existing owner authentication/default/canary tests: 28/28.
- Candidate runtime and native read-only mutation-guard tests: 5/5. Fixture setup writes are test setup, never Candidate writes.
- API contract suite: 26/26. The static authentication assertion was updated to reflect the same verified context now reused for namespace signing.
- Final full deterministic suite: 2252/2253. Sole failure: existing missing `.guardian/config.yaml` in business terminology test. It was not repaired or hidden.
- Local Next build and isolated Mac mini Next build: PASS.
- Additional Deep API check: NOT PASS; stopped in existing MCP `get_copper_price` due external `fetch failed`. This was not the earlier copperBase comparison race and is not claimed as a successful gate. No copper-price code was changed; no unrelated repair performed.

## Independent production delivery

Prepared a clean archive of the starting committed tree, overlaid only stage runtime/frontend files, and built under `/Users/dan/pump-p16lr1-transport/source`. No user dirty source entered the artifact. Candidate and gateway now load from that separate tree using their existing non-root supervisor. Their authentication/semantic dependencies remain the committed versions. Runtime file hashes were compared against local stage files.

Web and API have separate installed services. Only the Web `.next` build was switched and its own child stopped for its existing KeepAlive supervisor to recover. Previous Web build is retained at `/Users/dan/pump-p16lr1-transport/previous-next`; original Candidate/gateway directory configuration is retained in the private `before.json`. The stage operator script supports independent rollback; it never calls the ordinary combined deploy script or signals the Legacy API. Production Web source/backend Git checkout was not replaced.

- Legacy revision before/after: `12fee179b6074215cf359bcc1a789ce1a345b9ba`.
- Legacy API PID before/after: `59155`; healthy both times.
- Web PID: `56972` → `77817`; independent built artifact installed.
- Candidate ready after restart: true; read-only guard unchanged.
- Public JS artifact containing the conversation transport code: HTTP 200, exact SHA-256 match with deployed build.
- Existing production untracked file preserved; no source modifications in Legacy checkout.

## One-shot production transport acceptance

Normal public owner read with conversation context: HTTP 200, validated V5 final. Shared admin with the same submitted conversation ID: HTTP 200 Legacy, Candidate attempts zero. Unauthenticated request: HTTP 401, Candidate attempts zero. Explicit canary: HTTP 200, validated V5 final. No business request or answer bodies were saved in certification artifacts.

Production activation and acceptance each verified unchanged DB hash, mtime, size and backup count. Legacy PID unchanged. Owner-default gate remains ON. Metadata counters: orphan spans zero, cross-request contamination zero, private-value leakage zero. No raw context IDs or signed envelopes are logged. V5 writes, allowWrite enabling calls, business mutation calls and Candidate DB mutation successes remain zero.

## Handoff

P16_L_RESUME_READY=YES. No P16-L collection work is started automatically. The additional Deep API external-dependency failure and known Guardian failure remain disclosed test limitations, not changes to read authority. This stage certifies transport and namespace isolation; it does not certify future continuation-token security or broader multi-turn V5 admission.
