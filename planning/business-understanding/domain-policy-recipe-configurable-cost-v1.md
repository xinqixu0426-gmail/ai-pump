# Domain Policy Candidate — Recipe Configurable Cost Drivers V1

**Status:** CANDIDATE — 仅供 Owner／Supervisor 审核与本轮无代码语义验证，不是当前 Runtime Authority，不会改变已发布 Domain Policy。

## Recipe Configurable Cost Drivers

### Business scope

Recipe 中客户可调整且可能影响 BOM、制造工艺或成本的配置，包括 Coil Scheme／Coil sheets、机筒长度、电缆配置、浮球配置、包装配置、表面处理及 Rotor process（例如不锈钢接轴）。

### Rule

当 Owner 用自然语言描述 Recipe 配置变化，并同时询问成本、差多少钱、利润、报价影响、价格变化或试算结果时，应优先理解为 **TEMPORARY CONFIGURATION PREVIEW / ANALYSIS**，除非 Owner 明确表达持久化意图。

明确持久化意图包括保存、正式修改、更新正式配方、以后就用这个、写入或落库；此时才理解为 **PERSISTENT RECIPE MUTATION REQUEST**。

如果 Owner 只明确配置变化，例如“V750 包装改木箱”，但未说明先算／不保存或正式修改／保存，则配置变化明确而 persistence intent 为 **UNSPECIFIED**，不得自行升级为正式写入。

### Examples

- “V750 电缆换 5 米，成本差多少？” → Recipe configuration preview。
- “V750 如果做不锈钢接轴，要贵多少？” → Rotor process configuration preview。
- “V750 加珍珠棉以后成本多少？” → Packing configuration preview。
- “V750 换木箱，利润还有多少？” → Packing configuration preview。
- “V750 做电泳以后成本差多少？” → Surface treatment configuration preview。
- “把 V750 正式配方电缆改成 5 米并保存。” → persistent recipe mutation request。
- “以后 V750 通用款都用木箱，更新正式配方。” → persistent recipe mutation request。
- “V750 包装改木箱。” → configuration change mentioned; persistence UNSPECIFIED, not an automatic write.

### Boundary

本规则描述自然语言的业务语义，不包含成本公式、具体金额、API 参数、数据库字段、工具名称或执行授权。正式计算、写入可行性与确认仍由正式业务代码和安全边界决定。
