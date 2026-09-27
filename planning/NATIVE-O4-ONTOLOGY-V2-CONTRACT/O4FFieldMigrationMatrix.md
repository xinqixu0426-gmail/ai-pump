# O4-F — Recipe Field Migration Matrix

| SEMANTIC CONCEPT | CURRENT STORAGE | CURRENT AUTHORITY | TARGET STORAGE | TARGET AUTHORITY | MIGRATION RULE | AMBIGUITY RULE | LEGACY AFTER CUTOVER | RETIREMENT STAGE |
|---|---|---|---|---|---|---|---|---|
| Recipe identity | `recipes.id` | canonical | `recipes.id` | canonical | none | n/a | unchanged | never move |
| Template relation | `recipes.template_id` | formal FK | `recipes.template_id` | formal relation | none | null/missing = unresolved | unchanged | never move |
| Coil relation | `recipes.coil_id` | formal FK | `recipes.coil_id` | formal relation | none | null/missing = unresolved | unchanged | never move |
| Coil sheets | `recipes.coil_sheets` | Recipe configuration snapshot | `recipes.coil_sheets` | BOM/configuration Fact | none | invalid/missing = incomplete | unchanged | never move |
| Piece count | JSON `pieceCount` plus UI copy | duplicate materialization | derived from `coil_sheets` | derived | do not migrate JSON as Fact | mismatch is evidence only | projection only | legacy JSON read retire |
| Rotor diameter | JSON `rotorDiameter` | explicit Recipe JSON | functional profile `rotor_diameter` | functional Fact | numeric direct migration | invalid/missing stays unresolved | one-way projection only | JSON functional key retire |
| Stack offset | JSON `stackOffset` | explicit Recipe JSON | `stack_offset` | functional Fact | numeric direct migration | invalid/missing stays unresolved | projection only | JSON key retire |
| Oil seal diameter | JSON `oilSealDiameter` | explicit Recipe JSON | `oil_seal_diameter` | functional Fact | numeric direct migration | invalid/missing stays unresolved | projection only | JSON key retire |
| Impeller bore diameter | JSON `impellerBoreDiameter` | explicit Recipe JSON | `impeller_bore_diameter` | functional Fact | numeric direct migration | invalid/missing stays unresolved | projection only | JSON key retire |
| Impeller span | JSON `impellerSpan` | explicit Recipe JSON | `impeller_span` | functional Fact | numeric direct migration | invalid/missing stays unresolved | projection only | JSON key retire |
| Thread length | JSON `threadLength` | explicit Recipe JSON | `thread_length` | functional Fact | numeric direct migration | invalid/missing stays unresolved | projection only | JSON key retire |
| Thread diameter | JSON `threadDiameter` | explicit Recipe JSON | `thread_diameter` | functional Fact | numeric direct migration | invalid/missing stays unresolved | projection only | JSON key retire |
| Barrel length | `recipes.custom_barrel_length` | Recipe column / BOM consumer | `barrel_length` | functional Fact + BOM input | copy with column provenance | unknown stainless state retains review status | old column projection only | column read retire after BOM cutover |
| Open offset | PumpShell `remark.openOffset/openFactor` | compatibility only | `open_offset` | Recipe functional Fact | never auto-copy; create review candidate evidence | explicit Owner confirmation required | evidence only | PumpShell fallback retire |
| Non-stainless bearing span | JSON `bearingSpan` | legacy/direct Recipe value | `bearing_span_explicit` | functional Fact | only if isStainless=false resolves | unknown mode remains pending | projection only | JSON key retire |
| Stainless bearing span | JSON span + shell offset formula | compatibility materialization | computed `barrel_length - open_offset` | derived Fact | compare after canonical inputs exist | >0.1 mm mismatch -> review | comparison evidence only | formula/JSON fallback retire |
| Upper bearing | JSON `upperBearing` 620x/63xx text | legacy code | `upper_bearing_part_id` | Part relation | exact normalized-code candidate migration | zero/multiple = unresolved/review | compatibility adapter only | string read retire |
| Lower bearing | JSON `lowerBearing` 620x/63xx text | legacy code | `lower_bearing_part_id` | Part relation | exact normalized-code candidate migration | zero/multiple = unresolved/review | compatibility adapter only | string read retire |
| Bearing geometry | `BEARING_DB` by legacy code | engineering adapter | future shared specification/reference catalog | engineering reference | retain temporary adapter | unknown spec blocks Rotor DTO | adapter only | later bearing-spec ticket |
| Impeller thickness | JSON `impellerDepth`; `recipes.impeller_thickness` | JSON-first runtime fallback | `impeller_thickness` profile field | one functional Fact | apply four-case conflict matrix | differing values = no write/review | compatibility evidence/projection | both old reads retire |
| Rotor length | JSON `rotorLength` | technical memo | knowledge `items_json` | Technical Knowledge | move generic entry | no functional validation | indexed projection | JSON key retire |
| Shaft diameter | JSON `shaftDiameter` | technical memo | knowledge | Technical Knowledge | move generic entry | no functional validation | indexed projection | JSON key retire |
| Impeller model | `recipes.impeller_model` | technical memo | knowledge | Technical Knowledge | move generic entry | no functional validation | projection only | column retire |
| Impeller outside diameter | `recipes.impeller_diameter` | technical memo | knowledge | Technical Knowledge | move generic entry | no functional validation | projection only | column retire |
| Impeller blade count | `recipes.impeller_blade_count` | technical memo | knowledge | Technical Knowledge | move generic entry | no functional validation | projection only | column retire |
| Power/voltage/current/frequency | JSON keys | technical memo | knowledge | Technical Knowledge | move generic entries | no functional validation | indexed projection | JSON keys retire |
| Test report fields | JSON `testReportNo/testDate/testSummary` | technical memo | knowledge + file IDs where applicable | Technical Knowledge/evidence | move metadata, retain file links | no functional validation | `recipe_technical_files` unchanged | JSON keys retire |
| Custom/unknown JSON key | `technical_data_json` | unknown custom metadata | knowledge | Technical Knowledge by default | preserve key/label/value | malformed JSON/report item requires review | raw JSON evidence retained | mixed JSON retire |
| PumpShell defaults / Template rotor params | `parts.remark`, `rotor_params_json` | compatibility | no target Fact | compatibility evidence only | never migrate to fill missing values | remain unresolved | legacy adapter cohort only | fallback readers retire |
