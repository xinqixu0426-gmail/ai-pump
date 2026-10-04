# M5 D1 R7 Evaluator Adjudication

This is a **scoring correction**, not a model-sample replacement. The seven listed V3 raw evidence files remain byte-identical to commit `5602c221d1b52fa1aabbc1ae07f0df9ddf618e81`.

- D1-10 is adjudicated PASS: its formal `ENTITY_AMBIGUOUS` result, valid clarification envelope, absence of a money assertion, and absence of target selection meet the corrected ambiguity contract. Listing every candidate is optional.
- REAL-01 is adjudicated PASS: it has verified `resolve_entity` and identity-protected `get_recipe_detail` execution, a valid answer naming the resolved recipe, and cited formal evidence. Detail child facts are not required to duplicate the parent recipe name.

Revised V3 score: controlled 10/10, repetition 21/21, applicable real cases REAL-01 through REAL-05 PASS; REAL-06 and REAL-RP-01 remain DATA_LIMITATION.

Fresh targeted verification under harness `638945dce9b3a2cdc936fdabe9ec4a4dff066915`: D1-10 3/3 PASS and REAL-01 3/3 PASS. Both controlled and real before/after business snapshots are unchanged.

All required repository gates passed: `npm test`, API-contract verification, deep API, lint, build, AI architecture, and AI-assistant release verification.
