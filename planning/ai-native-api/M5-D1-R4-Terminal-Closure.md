# M5 D1-R4 Terminal Closure

Status: **REWORK**.

Fresh D1-06 evidence shows the formal scenario result applied `surfaceTreatmentMode`, was `COMPARABLE`, and produced current/candidate/delta facts. Its finalization completed on the first validated envelope. The former failure is therefore a delivery/finalization reliability failure, not a Business API or cost-engine failure.

Fresh D1-07 evidence shows a different earlier failure: the Agent did not call `compare_recipe_scenarios`, so no formal scenario receipt exists. It searched knowledge, parts, templates, and identities until budget exhaustion, then reported missing parts. This is not a valid Rotor Process capability-gap explanation. R4 adds deterministic scenario outcome receipts and a bounded terminal review for formal `NOT_APPLIED` / non-comparable outcomes, but that terminal trigger cannot fire when the model never submits a representable scenario request.

Do not advance to D2. The remaining R4 blocker is a general semantic-to-schema expressibility stop rule that does not become a case-specific router.
