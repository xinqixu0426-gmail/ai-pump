# Delivery Policy

Project policy may pre-authorize commit, non-protected feature-branch push, pull
request creation, and staging deployment. Authorization is necessary but never
sufficient: the matching Guardian gate and project verification must also be
current and passing.

Freeze the current task's completion `requiredGate` at start. Risk minimums are
focused for L0 and commit for L1-L3. Automatic commit raises it to at least
commit; automatic feature-branch push raises it to push only on an eligible,
non-protected `feature|fix|bugfix|hotfix|chore|docs|refactor` branch. A current
request for push, PR, or staging also raises it to push. Manual actions require
approval before execution but do not lower the frozen delivery obligation.

Explicit instructions for the current task take precedence when they are more
restrictive. If they prohibit a frozen delivery action, leave the session active
and report the blocker; do not complete early. Never infer permission for a
broader action from permission for a narrower one. Push is not deploy.

Production deployment, destructive database migration, irreversible data write,
secret or credential change, and destructive protected-branch operations always
require a fresh human confirmation at the risky boundary. Production policy must
remain `manual`; configuration cannot promote it to automatic.

Using an existing credential is distinct from changing one. When the user has
provided or explicitly authorized that credential and a reversible login or
acceptance check is within the current task, Codex may enter it without another
project-level confirmation or an automatic L3 escalation. Platform-required
CAPTCHA, MFA, password-manager unlock, Hook trust, operating-system permission,
or comparable security interaction still belongs to the user and cannot be
bypassed. Creating, changing, rotating, deleting, revoking, or elevating a
credential remains L3 and requires fresh confirmation at that boundary.

Minimize exposure: do not repeat credentials in progress or final messages, and
do not persist raw values in Git, project documentation, Task Contracts, Guardian
review evidence/reports, test fixtures, or long-term memory. Prefer form input,
stdin, or a user-authorized local secret mechanism over command-line arguments.
Do not promise that chats, browser automation, terminal arguments, or tool calls
are absent from platform audit logs. A planned later rotation does not authorize
storing or publishing the current credential.

Before delivery, verify exact branch/target, fresh report/session, clean intended
scope, gate readiness, and the configured action. `guardian complete` then checks
that task changes are fully committed when the effective gate is commit or push
and, for a push obligation, that a local remote-tracking ref contains current HEAD.
The delivery branch must match the branch that produced the gate report; after an
intentional target-branch change, rerun the required gate before completion.
This is local evidence only: Guardian does not fetch, query, or prove remote state.
Capture committed, pushed, deployed, and verified states separately.

For release-only continuation, first prove that the exact commit/artifact matches
the completed Guardian session and its deterministic evidence. Use archived
evidence to establish eligibility without repeating exploration or AI review.
Run checks whose truth can change after the commit—target/branch preflight, backup,
deployment, live health, authenticated smoke, configuration and rollback readiness—
at the release boundary. A missing/mismatched fingerprint or any source/config edit
invalidates the fast path and requires the normal classified workflow.
If release delivery needs a new Guardian session, start `type=release` on the
unchanged target commit and pass an explicit ancestor comparison base to its required gate.
The base is persisted as an immutable SHA and the start-time HEAD is the frozen
release target; a non-ancestor or empty range, target drift, wrong branch, or missing local
remote-tracking evidence still blocks completion. Configured gate commands remain
authoritative. A new session does not automatically reuse an archived session's
verification; only matching evidence from the same active session may be reused
under the command's declared evidence policy.
