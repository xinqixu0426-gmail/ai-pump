# Codex总指令：水泵工厂AI-native版本

你在现有ai-pump / pump-cost-accounting-system工作树中协助实施AI-native版本。目标不是新ERP，不是增加一套独立Ontology或重新部署旧V4/V5实验运行器，而是复用当前业务底座，逐阶段提高完整任务的执行与核验能力。

## 先确认事实

本计划基准是GitHub `251f822491d677056f2d7b82f09473a51321d8e1`。当前本地工作树可能更新，不能reset成该版本。先读AGENTS.md、docs/api-contract.md、docs/api-sop.md和本计划README、01—06。再跟随本次唯一任务包查实际源码、API、schema和测试。

计划中的PROPOSED_NEW、新schema、新API和新表都是目标，不是已有事实。发现同等正式能力必须优先复用；发现计划与现有业务冲突，保留现有权威口径并记录具体证据、影响及最小调整，不能为迎合计划改账。N0先解决底层可执行性，不能直接跳到写大Runtime。

## 范围和权限

只有本次给定的任务编号获准执行；本包PASS后停止，不自动进入下一包。不要自动push、部署、改生产开关、生产数据库或外部设备。保护用户全部已有改动；不得隐式reset、clean、stash或批量删除实验文件。不得在输出、日志、文档、commit中暴露凭据或真实客户资料。

查询能力继续走唯一registry→executor→internalApiClient→正式API。模型候选不是身份；工具成功不是任务完成；仅有verified/hash字符串不是可信证据；自然语言“确认”不是有效写入token。成本、库存、订单状态和写安全复用原公共实现。

不要在首个版本引入微服务、消息队列、图数据库、多代理组织或第二个能力目录。普通单目标不强制额外模型规划；复杂任务在有界循环内登记全部目标。预算用于可靠运行，不按老板的业务域划分读取权限。

## 先分析后修改

本包开始时检查git状态及完整调用链；列出将复用的现有函数、需要新增/改动的合同及测试。实施每项改动遵循API SOP，route薄、service权威、schema明确、调用方同步。被冻结内容通过显式版本化交接，不修改旧oracle值或删断言换PASS。

N0.1只有盘点，不修改业务实现。之后每包在本地隔离环境完成实现与回归；不能仅改文档称完成。真正缺能力时明确BLOCKED/UNSUPPORTED，不让模型或前端用临时算式冒充正式业务能力。

## 验证和返回

只列真正执行的测试命令、exitCode、报告位置；未跑的放notRun说明。区分设计自检、mock单测、正式API测试、真实provider测试和生产验证。当前计划自检通过不代表项目测试通过。

阶段结束按以下字段返回，不自动启动后续任务：

```text
TICKET:
STATUS: PASS | REWORK | BLOCKED
一句话结论:
START_COMMIT:
END_COMMIT: 未提交则明确写未提交
BRANCH:
USER_DIRTY_PRESERVED: YES | NO
REUSED_IMPLEMENTATIONS:
CHANGED_CONTRACTS_AND_FILES:
ACTUAL_TESTS: command / exitCode / reportPath
NOT_RUN:
CRITICAL_FINDINGS:
BUSINESS_WRITES_IN_READ_TESTS:
PRODUCTION_CHANGED: NO
ROLLBACK:
NEXT_TICKET:
```

完成当前任务的必要小修复可在本包范围内闭环；改变业务口径、扩大写权限或增加阶段范围需先列出差异与阻断，不能擅自推进。
