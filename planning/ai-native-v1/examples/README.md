# 合成示例说明
所有ID、名称、金额和hash均为计划校验用合成数据，不是生产记录，也不是成本引擎运行结果。

comparison-receipt / identity-receipt是测试夹具中的受信服务端投影。identity的`data.id`是合成adapter形状，不是声称当前 `/api/entity-lookup` 返回该形状；真实适配必须读取当前API的candidates/canonicalId等字段并按实际schema核对。`synthetic.*`不得登记到生产工具目录。

JSON Schema能检查形状，不能通过一个origin字符串证明来源。审计程序另持有允许的fixture回执ID集合，再验证pointer、hash和数值；产品实现必须使用真正server执行/存储边界。
