# D2-B2-R1 root-cause record

Status: REWORK. This is not a readiness, shortage, order, or procurement
algorithm failure.

The first frozen targeted sample (`d2b2r1-w101-1`, W1-01) successfully
resolved ORDER-A and executed verified `check_order_readiness`. Its isolated
fixture database hash was unchanged. Finalization then produced grounded
required/available/shortage facts, but both finalization attempts were
rejected with `OPERATIONAL_QUANTITY_BINDING_MISMATCH` and the safe fallback was
`UNAVAILABLE`.

The R1 local-phrase change correctly separates comma-delimited quantities, but
does not yet reject a numeric fragment inside a canonical material display
name. In `D1-R1轴承-202`, the fragment `1` is followed by `-`, so it is still
parsed as an ununitized operational number in the local phrase. This yields an
invented `SHORTAGE` mention (`value: 1`, `unit: null`) before the real `10 个`
required assertion. It is a remaining Answer Validator parser defect.

No in-place product repair was made after this model sample. The sample and
its exclusive staged trace are retained for the next repair phase.

The separate harness blockers are closed: semantic runners now use an
explicit run ID, exclusive staging, and a single canonical-artifact assembler;
the real runner performs environment-first local read-only preflight.
