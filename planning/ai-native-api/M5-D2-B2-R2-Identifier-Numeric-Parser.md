# D2-B2-R2 identifier-safe operational quantity parser

The parser now accepts an operational number only when it has a local quantity
role grammar (for example `需求10个`, `缺3个`, `已下单0个`) or a local measured
noun phrase. Numeric fragments adjacent to identifier-token characters
(letters, digits, `_`, hyphen/dash, or slash) are ignored before role binding.
This is a lexical boundary rule, not a model-specific blacklist.

The previous W1-01 failure is closed: `D1-R1轴承-202` contributes no `1` or
`202` operational mention; `10`, `7`, and `3` bind respectively to required,
available, and shortage. Unit, entity, role, collection-completeness and
unknown-number fail-closed checks remain intact.

R2 targeted acceptance is nevertheless REWORK (8/13). The three W1-06 runs
obtained verified readiness and purchase evidence but finalization submitted
two goal entries for one Owner request, producing `GOAL_STATUS_MISSING` and a
safe UNAVAILABLE fallback. W1-09 and W1-10 expose separate completion/partial
semantic reliability failures. No code was changed after fresh model samples
began.
