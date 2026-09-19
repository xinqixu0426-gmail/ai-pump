# Business Understanding Benchmark V2

BusinessUnderstandingBenchmarkV2 是当前业务验收基线。V1 仍是历史基线，其 Case、Fixture、Oracle 和 Baseline 不修改、不重命名。

V2 保留 BU-01—BU-04 和 BU-06—BU-10 的业务意图，将原 BU-05 拆成两个正式计价模式场景：

- BU-05：`calculated` 模式允许用户线重覆盖；只有正式成本结果同时证明 requested/applied 相等、`isCustomWireWeight=true`、`wireWeightAuthority=OVERRIDABLE` 和 `overrideStatus=APPLIED` 才验收通过。
- BU-11：`kit` 模式使用固定供应商套件价；线重覆盖必须返回 `UNSUPPORTED_FOR_PRICING_MODE`，并把当前 kitPrice 明确标记为未按 0.8 线重重算的固定成本。

V2 Oracle 由隔离 Fixture、正式 `coilCost.cjs` 能力、`costEngine.cjs` 和 canonical identity 生成，不读取模型回答，不重复成本算术。Evaluator 覆盖 calculated applied 值/标志突变、kit 虚假已应用/金额口径突变，以及别名选错/歧义静默选择。

## 冻结定义

- Case Hash: `95ef58e6cc399ed4780202caa1921a6c7036079a75d79c4bff689808dde12481`
- Fixture Hash: `77735ee01b6df61568e63e6c9c87a9a1907d2fcd89a18536a887204444b9c062`
- Oracle Hash: `b7165de435511c1c902ad70cfe8efab95be0d1d5cd9682fffe05afa14f6b9082`

## 执行

```bash
npm run test:business-v2
npm run benchmark:business-v2 -- --env-file=/absolute/path/to/test.env
```

完整验收固定为 11 个 Core Case × 2，使用隔离临时 SQLite，仅允许读取/试算能力，并记录实际 Provider、fallback、Provider 调用数、7 个维度、关键失败、Frame/Outcome 稳定性和 Scale Sentinel。生产开关不由本 Benchmark 修改。
