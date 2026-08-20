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

Before delivery, verify exact branch/target, fresh report/session, clean intended
scope, gate readiness, and the configured action. `guardian complete` then checks
that task changes are fully committed when the effective gate is commit or push
and, for a push obligation, that a local remote-tracking ref contains current HEAD.
The delivery branch must match the branch that produced the gate report; after an
intentional target-branch change, rerun the required gate before completion.
This is local evidence only: Guardian does not fetch, query, or prove remote state.
Capture committed, pushed, deployed, and verified states separately.
