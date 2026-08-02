const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function walkFiles(dir, predicate, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && ['node_modules', '.next'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, files);
            continue;
        }
        if (predicate(fullPath)) files.push(fullPath);
    }
    return files;
}

function relative(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

test('文档契约：当前核心文档必须存在并被 README 引用', () => {
    const readme = readUtf8('docs/README.md');
    const requiredDocs = [
        'business-flow.md',
        'frontend-state-boundary.md',
        'ui-refactor-guidelines.md',
    ];

    for (const doc of requiredDocs) {
        assert.ok(fs.existsSync(path.join(repoRoot, 'docs', doc)), `${doc} should exist`);
        assert.match(readme, new RegExp(`\\[${doc}\\]\\(\\.\\/${doc}\\)`));
    }
});

test('文档契约：生产发布清单必须被根 README 引用并覆盖关键检查', () => {
    const rootReadme = readUtf8('README.md');
    const docPath = path.join(repoRoot, 'docs/deployment-checklist.md');
    const doc = readUtf8('docs/deployment-checklist.md');
    const deploySection = rootReadme.split('## 生产发布')[1].split('## 文档入口')[0];

    assert.ok(fs.existsSync(docPath), 'deployment checklist should exist');
    assert.match(rootReadme, /\[docs\/deployment-checklist\.md\]\(docs\/deployment-checklist\.md\)/);
    assert.match(deploySection, /\.\/scripts\/install-macmini-launchdaemons\.sh/);
    assert.doesNotMatch(deploySection, /pkill -f/);
    assert.doesNotMatch(deploySection, /nohup node api\.cjs/);
    for (const marker of [
        '.env.example',
        'ACCESS_PASSWORD',
        'JWT_SECRET',
        'INTERNAL_SECRET',
        'CORS_ORIGIN',
        'SIRI_API_TOKEN',
        'npm run verify:release',
        'npm run verify:prod-env',
        'npm run db:backup:release',
        'npm run db:backup:verify',
        'rollback-macmini-release.sh',
        '禁止只切换 Git',
        './scripts/install-macmini-launchdaemons.sh',
        '不要把手动 `pkill + nohup` 作为常规发布路径',
        'curl http://127.0.0.1:3002/api/health',
        'logs/api-launchd.error.log',
    ]) {
        assert.match(doc, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(rootReadme, /\(docs\/database-backup-recovery\.md\)/);
});

test('文档契约：API SOP 必须约束历史兼容字段扩散', () => {
    const doc = readUtf8('docs/api-sop.md');

    for (const marker of [
        'Id',
        'CreatedAt',
        'UpdatedAt',
        'snake_case',
        'camelCase',
        'apps/web-next/lib/',
        'paintingWage',
        'boxType',
        'surfaceTreatmentMode',
        'packingPartsJson',
        'npm run verify:release',
    ]) {
        assert.match(doc, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('运行时稳定性包含超时、就绪探针、优雅停机和部署自动验收', () => {
    const api = readUtf8('api.cjs');
    const health = readUtf8('api/routes/health.cjs');
    const deploy = readUtf8('scripts/install-macmini-launchdaemons.sh');
    const httpClient = readUtf8('api/services/httpClient.cjs');

    assert.match(httpClient, /AbortController/);
    assert.match(httpClient, /REQUEST_TIMEOUT/);
    assert.match(api, /app\.use\('\/api\/health', healthRouter\)/);
    assert.match(health, /router\.get\('\/live'/);
    assert.match(health, /router\.get\('\/ready'/);
    assert.match(api, /process\.once\('SIGTERM'/);
    assert.match(api, /server\.close\(/);
    assert.match(api, /status\(502\)/);
    assert.match(deploy, /api\/health\/ready/);
    assert.match(deploy, /state = running/);
    assert.match(deploy, /Web 登录页/);
});

test('维护边界：部署环境解析集中且健康路由不再耦合成本模块', () => {
    const api = readUtf8('api.cjs');
    const environment = readUtf8('api/services/environment.cjs');
    const cost = readUtf8('api/routes/cost.cjs');
    const health = readUtf8('api/routes/health.cjs');
    const internalClient = readUtf8('api/routes/ai/internalApiClient.cjs');

    assert.match(api, /isProductionEnvironment/);
    assert.match(environment, /REQUIRED_PRODUCTION_ENV/);
    assert.match(environment, /getInternalApiTimeoutMs/);
    assert.match(internalClient, /getInternalApiTimeoutMs\(\)/);
    assert.match(health, /buildReadinessSnapshot/);
    assert.doesNotMatch(cost, /router\.get\('\/health/);
    assert.doesNotMatch(cost, /buildReadinessSnapshot/);
});

test('生产可观测性包含请求链路、进程异常诊断和日志轮转', () => {
    const api = readUtf8('api.cjs');
    const requestObservability = readUtf8('api/services/requestObservability.cjs');
    const diagnostics = readUtf8('api/services/runtimeDiagnostics.cjs');
    const deploy = readUtf8('scripts/install-macmini-launchdaemons.sh');
    const rotation = readUtf8('scripts/com.pumpfactory.newsyslog.conf');
    const operations = readUtf8('docs/operations-runbook.md');

    assert.match(api, /createRequestObservability/);
    assert.match(api, /uncaughtException/);
    assert.match(api, /unhandledRejection/);
    assert.match(requestObservability, /X-Request-ID/);
    assert.match(requestObservability, /durationMs/);
    assert.match(diagnostics, /gitCommit/);
    assert.match(diagnostics, /memoryUsage/);
    assert.match(deploy, /newsyslog/);
    assert.match(rotation, /api-launchd/);
    assert.match(rotation, /web-launchd/);
    assert.match(rotation, /api-launchd\.pid 15/);
    assert.match(rotation, /web-launchd\.pid 15/);
    assert.doesNotMatch(rotation, /[ER]/);
    assert.ok(
        deploy.indexOf('newsyslog -n') < deploy.indexOf('bootout system/com.pumpfactory.api'),
        '日志和 plist 配置必须在停止线上服务前完成校验'
    );
    assert.match(operations, /X-Request-ID/);
    assert.match(operations, /runtime/);
    assert.match(operations, /newsyslog/);
});

test('文档契约：迁移过程文档和旧前端回滚说明不得保留', () => {
    const removedDocs = [
        'docs/next-migration-acceptance.md',
        'docs/ai-api-executor-migration-plan.md',
        'docs/business-logic-refactor-status.md',
        'docs/cost-rules.md',
        'docs/development-backlog.md',
    ];

    for (const doc of removedDocs) {
        assert.equal(fs.existsSync(path.join(repoRoot, doc)), false, `${doc} should be removed`);
    }

    const docs = walkFiles(path.join(repoRoot, 'docs'), (filePath) => /\.md$/.test(filePath))
        .map((filePath) => readUtf8(relative(filePath)))
        .join('\n');
    const readme = readUtf8('README.md') + '\n' + readUtf8('docs/README.md');

    assert.doesNotMatch(readme, /next-migration-acceptance|ai-api-executor-migration-plan|legacy:dev|回滚备用/);
    assert.doesNotMatch(docs, /Next 迁移验收清单|AI 调用 API 改造计划|正式 UI\/交互重构前|正式 UI 重构前/);
});

test('文档契约：Next 当前启动和生产脚本保持可用', () => {
    const packageJson = JSON.parse(readUtf8('package.json'));
    const nextPackageJson = JSON.parse(readUtf8('apps/web-next/package.json'));
    const nextConfig = readUtf8('apps/web-next/next.config.mjs');
    const nextDevRunner = readUtf8('apps/web-next/scripts/run-next-dev.cjs');
    const rootReadme = readUtf8('README.md');

    assert.equal(packageJson.scripts['web-next:full'], 'concurrently "npm run api" "npm run web-next:dev"');
    assert.equal(packageJson.scripts['web-next:prod'], 'concurrently "npm run start:prod" "npm run web-next:start"');
    assert.equal(packageJson.scripts['restart:local'], 'powershell -ExecutionPolicy Bypass -File scripts/restart-local-dev.ps1');
    assert.match(nextPackageJson.scripts['dev:primary'], /\.next-dev/);
    assert.match(nextPackageJson.scripts.dev, /\.next-preview/);
    assert.match(nextConfig, /process\.env\.NEXT_DIST_DIR \|\| '\.next'/);
    assert.match(nextDevRunner, /NEXT_DIST_DIR: distDir/);
    assert.match(rootReadme, /npm start/);
    assert.match(rootReadme, /npm run restart:local/);
    assert.match(rootReadme, /npm run web-next:full/);
    assert.match(rootReadme, /npm run build/);
});

test('文档契约：本地重启脚本保留前后端崩溃日志', () => {
    const restartScript = readUtf8('scripts/restart-local-dev.ps1');

    assert.match(restartScript, /Get-NetTCPConnection/);
    assert.match(restartScript, /Stop-Process/);
    assert.match(restartScript, /Start-Process/);
    assert.match(restartScript, /api\.cjs/);
    assert.match(restartScript, /dev:primary/);
    assert.match(restartScript, /local-api\.error\.log/);
    assert.match(restartScript, /local-web\.error\.log/);
});

test('文档契约：AI 文本助手在 Next 中启用导航', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const docsReadme = readUtf8('docs/README.md');

    assert.match(shell, /<NavItem[\s\S]*href="\/ai"[\s\S]*label="AI"/);
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/app/ai/page.tsx')), 'Next AI page should exist once AI navigation is enabled');
    assert.match(docsReadme, /AI executor 已通过内部 API client 调用标准 API/);
});

test('文档契约：数据质量必须融合进看板并保留标准 API', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const dashboardView = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const qualityView = readUtf8('apps/web-next/components/quality-view.tsx');
    const qualityPage = readUtf8('apps/web-next/app/quality/page.tsx');
    const qualityLib = readUtf8('apps/web-next/lib/quality.ts');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const api = readUtf8('api.cjs');
    const docs = readUtf8('docs/api-reference.md') + '\n' + readUtf8('docs/README.md');

    assert.doesNotMatch(shell, /href: '\/quality'/);
    assert.match(dashboardView, /<QualityView\s+embedded/);
    assert.match(dashboardView, /数据质量/);
    assert.match(dashboardView, /qualityScore\}分/);
    assert.doesNotMatch(qualityView, />健康分</);
    assert.match(qualityPage, /redirect\('\/dashboard\?view=quality'\)/);
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/app/quality/page.tsx')), 'quality page should exist');
    assert.match(qualityView, /getDataQualitySummary/);
    assert.match(qualityView, /getBusinessAlerts/);
    assert.match(qualityView, /经营提醒/);
    assert.match(qualityLib, /\/api\/quality\/business-alerts/);
    assert.match(quotationsView, /BusinessAlertsBanner scope="quotation"/);
    assert.match(ordersView, /BusinessAlertsBanner scope="order"/);
    assert.match(api, /\/api\/quality/);
    assert.match(docs, /\/api\/quality\/summary/);
    assert.match(docs, /\/api\/quality\/business-alerts/);
});

test('文档契约：前端状态边界必须约束全局状态、页面状态和刷新规则', () => {
    const doc = readUtf8('docs/frontend-state-boundary.md');

    assert.match(doc, /全局状态/);
    assert.match(doc, /页面本地状态/);
    assert.match(doc, /重新拉取对应资源/);
    assert.match(doc, /派生数据/);
    assert.match(doc, /跨资源刷新规则/);
    assert.match(doc, /禁止全局乐观写入/);
});

test('文档契约：UI 约束必须覆盖简洁风格、动效和业务边界', () => {
    const doc = readUtf8('docs/ui-refactor-guidelines.md');

    assert.match(doc, /motion-primitives/);
    assert.match(doc, /简洁/);
    assert.match(doc, /AI 味/);
    assert.match(doc, /动效只用于解释状态变化/);
    assert.match(doc, /表格操作要稳定/);
    assert.match(doc, /业务不可变边界/);
});

test('文档契约：业务流程文档必须链接状态和 UI 约束', () => {
    const doc = readUtf8('docs/business-flow.md');

    assert.match(doc, /\[前端状态边界\]\(\.\/frontend-state-boundary\.md\)/);
    assert.match(doc, /\[UI\/交互约束\]\(\.\/ui-refactor-guidelines\.md\)/);
});

test('Next UI 契约：按钮链接必须走基础组件且不得引入 MUI', () => {
    const webNextRoot = path.join(repoRoot, 'apps/web-next');
    const files = walkFiles(
        webNextRoot,
        (filePath) => /\.(ts|tsx)$/.test(filePath)
    );

    const muiOffenders = files
        .filter((filePath) => readUtf8(relative(filePath)).includes('@mui/'))
        .map(relative);
    assert.deepEqual(muiOffenders, []);

    const linkOffenders = files
        .filter((filePath) => {
            const rel = relative(filePath);
            if (rel === 'apps/web-next/components/ui/nav-item.tsx') return false;
            return /from 'next\/link'|from "next\/link"/.test(readUtf8(rel));
        })
        .map(relative);
    assert.deepEqual(linkOffenders, []);

    const doc = readUtf8('docs/ui-refactor-guidelines.md');
    assert.match(doc, /无频闪交互规则/);
    assert.match(doc, /prefetch=\{false\}/);
});

test('Next UI 契约：详情编辑面板必须居中显示，不使用右侧抽屉', () => {
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');

    assert.match(slideOver, /items-center justify-center/);
    assert.match(slideOver, /min-\[1600px\]:right-\[500px\]/);
    assert.match(slideOver, /max-h-\[calc\(100vh-2rem\)\]/);
    assert.match(slideOver, /rounded-panel/);
    assert.doesNotMatch(slideOver, /right-0/);
    assert.doesNotMatch(slideOver, /\bborder-l\b/);
});

test('Next UI 契约：启用导航必须有真实页面且只允许 NavItem 使用 Link', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const groupedRoutes = Array.from(shell.matchAll(/\{\s*href: '([^']+)',\s*label: '([^']+)',\s*icon: [^}]+\}/g))
        .map((match) => match[1]);
    const directRoutes = Array.from(shell.matchAll(/<NavItem[\s\S]*?href="([^"]+)"/g))
        .map((match) => match[1]);
    const enabledRoutes = Array.from(new Set([...groupedRoutes, ...directRoutes]));

    assert.ok(enabledRoutes.length > 0, 'should find enabled Next nav routes');
    for (const route of enabledRoutes) {
        const pathname = route.split('?')[0];
        const pagePath = pathname === '/'
            ? 'apps/web-next/app/page.tsx'
            : `apps/web-next/app${pathname}/page.tsx`;
        assert.ok(fs.existsSync(path.join(repoRoot, pagePath)), `${route} should have ${pagePath}`);
    }

    const webNextRoot = path.join(repoRoot, 'apps/web-next');
    const files = walkFiles(webNextRoot, (filePath) => /\.(ts|tsx)$/.test(filePath));
    const linkOffenders = files
        .filter((filePath) => {
            const rel = relative(filePath);
            if (rel === 'apps/web-next/components/ui/nav-item.tsx') return false;
            return /from 'next\/link'|from "next\/link"/.test(readUtf8(rel));
        })
        .map(relative);

    assert.deepEqual(linkOffenders, []);
});

test('Next UI 契约：知识库管理中心融合进看板并保持同步确认', () => {
    const dashboardView = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const dashboardPage = readUtf8('apps/web-next/app/dashboard/page.tsx');
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const knowledgeLib = readUtf8('apps/web-next/lib/knowledge.ts');
    const docs = readUtf8('docs/api-reference.md') + '\n' + readUtf8('docs/README.md');

    assert.match(dashboardView, /<KnowledgeView/);
    assert.match(dashboardView, /label: '知识库'/);
    assert.match(dashboardPage, /params\.view === 'knowledge'/);
    assert.match(dashboardPage, /params\.entry/);
    assert.match(knowledgeView, /知识条目/);
    assert.match(knowledgeView, /待同步/);
    assert.match(knowledgeView, /当前已同步内容/);
    assert.match(knowledgeView, /查看业务来源/);
    assert.match(knowledgeView, /确认同步/);
    assert.match(knowledgeView, /同步记录/);
    assert.match(knowledgeView, /失败和重试可追溯/);
    assert.match(knowledgeView, /syncHealth\.status !== 'healthy'/);
    assert.match(knowledgeView, /检查并恢复/);
    assert.match(knowledgeView, /导入工厂资料/);
    assert.match(knowledgeView, /下载原文件/);
    assert.match(knowledgeView, /删除资料/);
    assert.match(knowledgeLib, /\/api\/knowledge\/overview/);
    assert.match(knowledgeLib, /\/api\/knowledge\/documents/);
    assert.match(knowledgeLib, /\/api\/knowledge\/sync-runs/);
    assert.match(knowledgeLib, /\/api\/knowledge\/health/);
    assert.match(knowledgeLib, /proxyRequest/);
    assert.match(docs, /只读内容哈希比较/);
});

test('API 静态契约：Knowledge V6.3 增量向量与混合检索均保留 FTS 回退', () => {
    const knowledge = readUtf8('api/services/knowledge.cjs');
    const hybridSearch = readUtf8('api/services/knowledgeHybridSearch.cjs');
    const vectorSync = readUtf8('api/services/knowledgeVectorSync.cjs');
    const autoSync = readUtf8('api/services/knowledgeVectorAutoSync.cjs');
    const vectorStore = readUtf8('api/services/knowledgeVectorStore.cjs');
    const docs = readUtf8('docs/api-reference.md');

    assert.match(knowledge, /requestKnowledgeVectorRefresh/);
    assert.match(vectorSync, /entry\.content_hash/);
    assert.match(vectorSync, /provider\.embedPassages/);
    assert.match(vectorSync, /stats\.failed/);
    assert.match(vectorSync, /model <> \?/);
    assert.match(autoSync, /DEFAULT_RETRY_DELAYS_MS/);
    assert.match(autoSync, /void run\(\)/);
    assert.match(hybridSearch, /searchKnowledgeEntries/);
    assert.match(hybridSearch, /provider\.embedQuery/);
    assert.match(hybridSearch, /matchMode/);
    assert.match(hybridSearch, /回退到 FTS\/LIKE/);
    assert.match(vectorStore, /searchMode = operational && hybridEnabled \? 'hybrid' : 'fts'/);
    assert.match(docs, /knowledge_vector_sync_runs/);
    assert.match(docs, /V6\.3/);
});

test('API 静态契约：Knowledge V6.4 检索评测和备份恢复可无人值守执行', () => {
    const evaluation = readUtf8('api/services/knowledgeRetrievalEvaluation.cjs');
    const runner = readUtf8('scripts/run-knowledge-retrieval-evaluation.cjs');
    const backupCheck = readUtf8('scripts/check-knowledge-vector-backup.cjs');
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const knowledgeLib = readUtf8('apps/web-next/lib/knowledge.ts');
    const packageJson = readUtf8('package.json');
    const docs = readUtf8('docs/api-reference.md');

    assert.match(evaluation, /FIXED_RETRIEVAL_CASES/);
    assert.match(evaluation, /metrics/);
    assert.match(evaluation, /keyword/);
    assert.match(evaluation, /vector/);
    assert.match(evaluation, /hybrid/);
    assert.match(runner, /retrieval-evaluation/);
    assert.match(backupCheck, /source\.backup/);
    assert.match(backupCheck, /integrity_check/);
    assert.match(backupCheck, /searchStoredEmbeddings/);
    assert.match(knowledgeView, /向量检索/);
    assert.match(knowledgeView, /coveragePercent/);
    assert.match(knowledgeLib, /\/api\/knowledge\/vector-health/);
    assert.match(packageJson, /"test:knowledge-retrieval"/);
    assert.match(packageJson, /"knowledge:backup-check"/);
    assert.match(docs, /retrieval-evaluation/);
});

test('Next UI 契约：AI 回复展示可点击依据并保留新鲜度警告', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');

    assert.match(aiLib, /AiKnowledgeSource/);
    assert.match(aiLib, /knowledgePath/);
    assert.match(aiView, /function AnswerEvidence/);
    assert.match(aiView, /回答依据/);
    assert.match(aiView, /实时业务数据/);
    assert.match(aiView, /知识库快照/);
    assert.match(aiView, /待同步状态/);
    assert.match(aiView, /查看原数据/);
});

test('Next UI 契约：AI 回答依据和处理过程默认折叠且异常自动展开', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(aiView, /function AnswerProcess/);
    assert.match(aiView, /回答依据与处理过程/);
    assert.match(aiView, /open=\{open\}/);
    assert.match(aiView, /if \(requiresAttention\) setOpen\(true\)/);
    assert.match(aiView, /isConfirmationResult\(tool\.result\)/);
    assert.match(aiView, /asRecord\(tool\.result\)\.success === false/);
});

test('Next UI 契约：AI 工作台提供可执行首屏、历史搜索和稳定阅读宽度', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(aiView, /查询成本、订单、库存与工厂知识/);
    assert.match(aiView, /aria-label="搜索会话"/);
    assert.match(aiView, /filteredConversations/);
    assert.match(aiView, /今天想先处理什么/);
    assert.match(aiView, /starterSamples/);
    assert.match(aiView, /group-hover:opacity-100/);
    assert.match(aiView, /max-w-4xl/);
    assert.match(aiView, /\[field-sizing:content\]/);
    assert.doesNotMatch(aiView, /AI Executor/);
});

test('Next UI 契约：订单生产准备检查展示结论、六步状态和缺料清单', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    assert.match(aiView, /function OrderReadinessResult/);
    assert.match(aiView, /check_order_readiness/);
    assert.match(aiView, /可生产/);
    assert.match(aiView, /待补料/);
    assert.match(aiView, /数据阻塞/);
    assert.match(aiView, /procurementStage/);
    assert.match(aiView, /recommendedActions/);
});

test('Next UI 契约：订单处理方案展示顺序、负责人、依赖和执行方式', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    assert.match(aiView, /function OrderReadinessPlanResult/);
    assert.match(aiView, /plan_order_readiness_actions/);
    assert.match(aiView, /AI可确认/);
    assert.match(aiView, /人工处理/);
    assert.match(aiView, /等待跟进/);
    assert.match(aiView, /dependsOn/);
    assert.match(aiView, /Array\.isArray\(item\.dependsOn\)/);
    assert.match(aiView, /完成标准/);
    assert.match(aiView, /负责人/);
    assert.match(aiView, /前置阻塞/);
});

test('Next UI 契约：V8 工厂执行计划展示统一步骤、边界和执行保护', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const tools = readUtf8('api/routes/ai/tools.cjs');

    assert.match(aiView, /function FactoryExecutionPlanResult/);
    assert.match(aiView, /plan_factory_workflow/);
    assert.match(aiView, /已有安全执行器/);
    assert.match(aiView, /执行保护/);
    assert.doesNotMatch(
        aiView.slice(
            aiView.indexOf('function FactoryExecutionPlanResult'),
            aiView.indexOf('function OrderReadinessPlanResult')
        ),
        /item\.owner/
    );
    assert.match(tools, /quotation_to_order/);
    assert.match(tools, /canExecute=true/);
});

test('Next UI 契约：V8.2 跨模块执行后展示转单结果和新订单复查', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const tools = readUtf8('api/routes/ai/tools.cjs');

    assert.match(aiView, /function FactoryWorkflowActionResult/);
    assert.match(aiView, /execute_factory_workflow_step/);
    assert.match(aiView, /新订单生产准备/);
    assert.match(aiView, /原报价流程复查/);
    assert.match(tools, /计划过期、报价未接受、已转单、资料不完整或步骤受阻时立即停止/);
});

test('Next UI 契约：V8.3 执行计划提供精确业务入口和受保护确认捷径', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const factoryPlanStart = aiView.indexOf('function FactoryExecutionPlanResult');
    const orderPlanStart = aiView.indexOf('function OrderReadinessPlanResult');
    const factoryPlan = aiView.slice(factoryPlanStart, orderPlanStart);

    assert.match(aiView, /function buildFactoryWorkflowShortcutPrompt/);
    assert.match(aiView, /重新生成最新报价转订单执行计划/);
    assert.match(aiView, /重新检查最新生产准备计划/);
    assert.match(factoryPlan, /打开当前业务/);
    assert.match(factoryPlan, /发起确认/);
    assert.match(factoryPlan, /isSafeInternalPath\(subject\.path\)/);
    assert.match(factoryPlan, /isSafeInternalPath\(item\.path\)/);
    assert.match(factoryPlan, /onRequestAction\(actionPrompt\)/);
    assert.match(aiView, /onSendPrompt=\{readOnly \? undefined : onSendPrompt\}/);
    assert.match(aiView, /shortcutDisabled=\{loading\}/);
    assert.doesNotMatch(factoryPlan, /confirmAiTool/);
    assert.match(quotationsView, /searchParams\.get\('quotationId'\)/);
    assert.match(quotationsView, /consumedViewQuotationRef/);
    assert.match(quotationsView, /setViewQuotation\(target\)/);
});

test('Next UI 契约：V8.4 展示执行结果、失败原因和可恢复步骤', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(aiView, /function WorkflowExecutionRunSummary/);
    assert.match(aiView, /最近执行/);
    assert.match(aiView, /latestRecheck/);
    assert.match(aiView, /最新复查/);
    assert.match(aiView, /recovery\.message/);
    assert.match(aiView, /recoverableActionIds/);
    assert.match(aiView, /重新发起确认/);
    assert.match(aiView, /执行记录 #/);
    assert.match(aiView, /historyWarning/);
});

test('Next UI 契约：订单方案动作执行后展示结果和重验后的方案', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    assert.match(aiView, /function OrderReadinessActionResult/);
    assert.match(aiView, /execute_order_readiness_action/);
    assert.match(aiView, /重新检查后的处理方案/);
    assert.match(aiView, /<OrderReadinessPlanResult result=\{\{ data: nextPlan \}\}/);
});

test('Next UI 契约：管理看板和 AI 均展示订单准备总览', () => {
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const overview = readUtf8('apps/web-next/components/order-readiness-overview.tsx');
    const readinessLib = readUtf8('apps/web-next/lib/order-readiness.ts');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(dashboard, /value: 'readiness', label: '订单准备'/);
    assert.match(dashboard, /attentionRequired/);
    assert.match(dashboard, /OrderReadinessOverviewView/);
    assert.match(overview, /订单生产准备/);
    assert.match(overview, /待补物料/);
    assert.match(overview, /SegmentedControl/);
    assert.match(readinessLib, /proxyRequest<ApiResponse<OrderReadinessOverview>>\('\/api\/orders\/readiness-overview'\)/);
    assert.match(aiView, /function OrderReadinessOverviewResult/);
    assert.match(aiView, /get_order_readiness_overview/);
    assert.match(aiView, /\/dashboard\?view=readiness/);
});

test('Next UI 契约：管理看板和 AI 使用同一管理待办中心', () => {
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const actionCenter = readUtf8('apps/web-next/components/management-action-center.tsx');
    const dashboardLib = readUtf8('apps/web-next/lib/dashboard.ts');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(dashboard, /value: 'actions', label: '今日待办'/);
    assert.match(dashboard, /ManagementActionCenterView/);
    assert.match(dashboard, /categoryCounts\.order_readiness/);
    assert.match(dashboard, /if \(initialMode === 'readiness'\) void loadReadiness\(\)/);
    assert.match(dashboard, /nextMode === 'readiness' && !readinessOverview/);
    assert.match(actionCenter, /待办优先级筛选/);
    assert.match(actionCenter, /待办来源筛选/);
    assert.match(actionCenter, /当前最优先/);
    assert.match(actionCenter, /executionQueue\.items/);
    assert.match(actionCenter, /itemResolution/);
    assert.match(actionCenter, /交给 AI/);
    assert.doesNotMatch(actionCenter, /item\.owner/);
    assert.match(actionCenter, /item\.path/);
    assert.match(dashboardLib, /\/api\/workbench\/action-center/);
    assert.match(aiView, /function ManagementActionCenterResult/);
    assert.match(aiView, /get_management_action_center/);
    assert.match(aiView, /\/dashboard\?view=actions/);
});

test('Next UI 契约：管理看板压缩零状态并优先展示可处理内容', () => {
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const actionCenter = readUtf8('apps/web-next/components/management-action-center.tsx');
    const readiness = readUtf8('apps/web-next/components/order-readiness-overview.tsx');
    const quality = readUtf8('apps/web-next/components/quality-view.tsx');
    const knowledge = readUtf8('apps/web-next/components/knowledge-view.tsx');

    assert.match(dashboard, /item\.count > 0/);
    assert.match(dashboard, /供应商采购无待办/);
    assert.match(dashboard, /当前无待采购物料/);
    assert.match(dashboard, /最近刷新/);
    assert.match(actionCenter, /executionQueue\.items\.slice\(0, 1\)/);
    assert.match(actionCenter, /完整待办/);
    assert.match(readiness, /min-w-\[680px\]/);
    assert.match(readiness, /问题与下一步/);
    assert.match(quality, /<details className="order-4/);
    assert.match(quality, /规则与质量治理/);
    assert.match(knowledge, /grid gap-3 lg:grid-cols-3/);
    assert.match(knowledge, /2xl:grid-cols-5/);
});

test('Next UI 契约：管理看板释放主区宽度并提供可追溯下钻', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const segmented = readUtf8('apps/web-next/components/ui/segmented-control.tsx');
    const partsPage = readUtf8('apps/web-next/app/parts/page.tsx');
    const partsView = readUtf8('apps/web-next/components/parts-view.tsx');

    assert.match(shell, /setAiPanelOpen\(false\)/);
    assert.match(shell, /min-\[1600px\]:grid-cols-\[minmax\(0,1fr\)_460px\]/);
    assert.match(shell, /aiPanelOpen \? '收起 AI' : '问 AI'/);
    assert.match(aiView, /aria-label="关闭 AI 助手"/);
    assert.match(dashboard, /累计销售额/);
    assert.match(dashboard, /累计利润/);
    assert.match(dashboard, /router\.push\(nextMode === 'overview'/);
    assert.match(dashboard, /\/parts\?stock=attention/);
    assert.match(dashboard, /\/orders\?orderId=\$\{order\.id\}/);
    assert.match(segmented, /aria-pressed/);
    assert.doesNotMatch(segmented, /absolute -right/);
    assert.match(partsPage, /searchParams/);
    assert.match(partsView, /quickFilter === 'attention'/);
});

test('Next UI 契约：P0 全局导航按业务域分组并统一页面骨架', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const nav = readUtf8('apps/web-next/components/ui/nav-item.tsx');
    const pageHeader = readUtf8('apps/web-next/components/ui/page-header.tsx');
    const metricCard = readUtf8('apps/web-next/components/ui/metric-card.tsx');
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const pageViews = [
        'recipes-view.tsx',
        'parts-view.tsx',
        'purchase-view.tsx',
        'coils-view.tsx',
        'rotor-view.tsx',
        'customers-view.tsx',
        'quotations-view.tsx',
        'orders-view.tsx',
        'setup-view.tsx',
    ].map((file) => readUtf8(`apps/web-next/components/${file}`));

    for (const label of ['销售', '供应链', '产品工程', '系统']) {
        assert.match(shell, new RegExp(`label="${label}"`));
    }
    for (const route of ['/customers', '/quotations', '/orders', '/purchase', '/parts', '/coils', '/recipes', '/rotor', '/setup']) {
        assert.match(shell, new RegExp(route.replace('/', '\\/')));
    }
    assert.doesNotMatch(shell, /pump\.ai-panel-open|localStorage/);
    assert.match(shell, /useEffect\(\(\) => \{\s*setAiPanelOpen\(false\);\s*\}, \[pathname\]\)/);
    assert.match(shell, /overflow-x-auto[^"]*md:overflow-visible/);
    assert.match(nav, /event\.key === 'Escape'/);
    assert.match(pageHeader, /export function PageHeader/);
    assert.match(metricCard, /export function MetricCard/);
    assert.match(metricCard, /export function MetricGrid/);
    assert.match(metricCard, /grid grid-cols-2 gap-3 xl:grid-cols-4/);
    for (const pageView of pageViews) assert.match(pageView, /<PageHeader/);
    assert.match(dashboard, /<MetricGrid>/);
    assert.match(dashboard, /outOfStockParts\.slice\(0, 6\)/);
    assert.doesNotMatch(dashboard, /供应商采购无需关注|当前没有待采购物料/);
});

test('Next UI 契约：P1 高频列表统一筛选反馈、空状态和窄屏表格', () => {
    const listToolbar = readUtf8('apps/web-next/components/ui/list-toolbar.tsx');
    const emptyState = readUtf8('apps/web-next/components/ui/empty-state.tsx');
    const tableScrollArea = readUtf8('apps/web-next/components/ui/table-scroll-area.tsx');
    const listViews = [
        readUtf8('apps/web-next/components/orders-view.tsx'),
        readUtf8('apps/web-next/components/quotations-view.tsx'),
        readUtf8('apps/web-next/components/purchase-view.tsx'),
        readUtf8('apps/web-next/components/customers-view.tsx'),
    ];

    assert.match(listToolbar, /aria-live="polite"/);
    assert.match(listToolbar, /清空搜索/);
    assert.match(listToolbar, /focus-within:ring-2/);
    assert.match(emptyState, /export function EmptyState/);
    assert.match(tableScrollArea, /role="region"/);
    assert.match(tableScrollArea, /tabIndex=\{0\}/);
    assert.match(tableScrollArea, /左右滑动查看完整表格/);
    for (const view of listViews) {
        assert.match(view, /<ListToolbar/);
        assert.match(view, /<EmptyState/);
        assert.match(view, /<TableScrollArea/);
        assert.match(view, /显示 \$\{/);
    }
});

test('Next UI 契约：P2 长表单保护未保存修改并固定关键操作', () => {
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');
    const confirmDiscard = readUtf8('apps/web-next/hooks/use-confirm-discard.ts');
    const formError = readUtf8('apps/web-next/components/ui/form-error.tsx');
    const formViews = [
        readUtf8('apps/web-next/components/orders-view.tsx'),
        readUtf8('apps/web-next/components/quotations-view.tsx'),
        readUtf8('apps/web-next/components/customers-view.tsx'),
    ];

    assert.match(slideOver, /document\.body\.style\.overflow = 'hidden'/);
    assert.match(slideOver, /event\.key === 'Escape'/);
    assert.match(slideOver, /openDialogStack\[openDialogStack\.length - 1\] === dialogId/);
    assert.match(slideOver, /openDialogStack\.splice\(stackIndex, 1\)/);
    assert.match(slideOver, /openDialogStack\.length === 0[\s\S]*bodyOverflowBeforeDialogs/);
    assert.match(slideOver, /aria-labelledby=\{ariaLabelledBy\}/);
    assert.match(slideOver, /previousFocus\?\.focus/);
    assert.match(confirmDiscard, /beforeunload/);
    assert.match(confirmDiscard, /window\.confirm\(message\)/);
    assert.match(formError, /role="alert"/);
    assert.match(formError, /scrollIntoView/);
    assert.match(formError, /focus\(\{ preventScroll: true \}\)/);
    for (const view of formViews) {
        assert.match(view, /useConfirmDiscard/);
        assert.match(view, /<FormError message=\{formError\}/);
        assert.match(view, /onChange=\{markFormDirty\}/);
        assert.match(view, /sticky top-0/);
        assert.match(view, /sticky bottom-0/);
        assert.match(view, /有未保存修改/);
    }
    assert.match(formViews[0], /markFormDirty\(\);[\s\S]*setDraftItems\(\(current\) => current\.filter/);
});

test('Next UI 契约：订单准备总览可精确进入指定订单处理工作台', () => {
    const dashboardOverview = readUtf8('apps/web-next/components/order-readiness-overview.tsx');
    const ordersPage = readUtf8('apps/web-next/app/orders/page.tsx');
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const drawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');
    const readinessLib = readUtf8('apps/web-next/lib/order-readiness.ts');

    assert.match(dashboardOverview, /\/orders\?orderId=\$\{item\.order\.id\}&view=readiness/);
    assert.match(ordersPage, /params\.orderId/);
    assert.match(ordersPage, /initialDetailTab/);
    assert.match(ordersView, /initialOrderHandledRef/);
    assert.match(ordersView, /setSelectedOrder\(target\)/);
    assert.match(drawer, /value: 'readiness', label: '生产准备'/);
    assert.match(drawer, /getOrderReadiness\(orderId\)/);
    assert.match(drawer, /getOrderReadinessPlan\(orderId\)/);
    assert.match(drawer, /六步检查依据/);
    assert.match(drawer, /实时缺料/);
    assert.match(drawer, /处理方案/);
    assert.match(readinessLib, /proxyRequest<ApiResponse<OrderReadinessDetail>>\(`\/api\/orders\/\$\{id\}\/readiness`\)/);
    assert.match(readinessLib, /proxyRequest<ApiResponse<OrderReadinessPlan>>\(`\/api\/orders\/\$\{id\}\/readiness-plan`\)/);
});

test('Next UI 契约：AI 回答反馈进入知识库人工处理队列', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');

    assert.match(aiView, /这条回答是否可靠/);
    assert.match(aiView, /报告回答问题/);
    assert.match(aiView, /内容错误/);
    assert.match(aiView, /来源过期/);
    assert.match(aiView, /资料不足/);
    assert.match(aiLib, /submitAiAnswerFeedback/);
    assert.match(aiLib, /proxyRequest/);
    assert.match(knowledgeView, /AI 回答反馈/);
    assert.match(knowledgeView, /标记已处理/);
    assert.match(knowledgeView, /reviewAiAnswerFeedback/);
    assert.match(aiView, /长期规则只约束 AI，不会修改业务数据/);
    assert.match(aiView, /让 AI 长期记住这条正确做法/);
    assert.match(knowledgeView, /AI 长期学习规则/);
    assert.match(knowledgeView, /toggleLearningRule/);
    assert.match(knowledgeView, /回答诊断与复测/);
    assert.match(knowledgeView, /重新验证/);
    assert.match(knowledgeView, /原回答/);
    assert.match(knowledgeView, /复测回答/);
    assert.match(knowledgeView, /streamAiChat/);
    assert.match(aiLib, /diagnoseAiAnswerFeedback/);
    assert.match(aiLib, /recordAiAnswerFeedbackRetest/);
});

test('Next UI 契约：知识库回归检查支持一键运行和失败明细', () => {
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');
    const liveRunner = readUtf8('scripts/run-knowledge-evaluation.cjs');
    const packageJson = readUtf8('package.json');

    assert.match(knowledgeView, /知识库回归检查/);
    assert.match(knowledgeView, /运行知识库检查/);
    assert.match(knowledgeView, /需要修复/);
    assert.match(knowledgeView, /需要确认/);
    assert.match(knowledgeView, /自动判定/);
    assert.match(knowledgeView, /AI 实际回答/);
    assert.match(knowledgeView, /runEvaluationSuite/);
    assert.match(knowledgeView, /streamAiChat/);
    assert.match(aiLib, /createAiEvaluationRun/);
    assert.match(aiLib, /recordAiEvaluationResult/);
    assert.match(aiLib, /completeAiEvaluationRun/);
    assert.match(liveRunner, /\/api\/ai\/evaluations\/runs/);
    assert.match(liveRunner, /\/api\/ai\/chat/);
    assert.match(liveRunner, /process\.exitCode = 1/);
    assert.match(packageJson, /"test:knowledge-live"/);
});

test('Next UI 契约：业务页面使用顶部导航并提供可复用 AI 助手', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(shell, /aria-label="主导航"/);
    assert.match(shell, /min-\[1600px\]:grid-cols-\[minmax\(0,1fr\)_460px\]/);
    assert.match(shell, /<AiView\s+variant="panel"/);
    assert.match(shell, /<NavMenu/);
    assert.match(shell, /label="销售"/);
    assert.match(shell, /label="供应链"/);
    assert.match(shell, /label="产品工程"/);
    assert.match(shell, /label="系统"/);
    assert.doesNotMatch(shell, /fixed inset-y-0 left-0/);
    assert.match(aiView, /variant\?: 'workspace' \| 'panel'/);
    assert.match(aiView, /进入 AI 工作台/);
    assert.match(aiView, /同步知识库/);
    assert.match(aiView, /syncFactoryKnowledge/);
});

test('Next UI 契约：订单详情上下文独立传给业务 AI 助手', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');
    const pageContext = readUtf8('apps/web-next/lib/page-context.ts');
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const orderDrawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');

    assert.match(shell, /readCurrentAiPageContext/);
    assert.match(shell, /pageContext=\{pageContext\}/);
    assert.match(aiView, /aria-label="AI 页面上下文"/);
    assert.match(aiView, /controller\.signal, pageContext/);
    assert.match(aiLib, /resourceId: pageContext\.resourceId/);
    assert.doesNotMatch(aiLib, /pageContext: \{[\s\S]{0,200}label:/);
    assert.match(pageContext, /resourceType: 'order'/);
    assert.match(pageContext, /AI_PAGE_CONTEXT_EVENT/);
    assert.match(ordersView, /replacePageLocation\(`\/orders\?orderId=/);
    assert.match(orderDrawer, /replacePageLocation\(`\/orders\?orderId=/);
});

test('Next UI 契约：浮动业务 AI 必须位于订单详情弹层之上', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');
    const orderDrawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');

    assert.match(slideOver, /fixed inset-0 z-50/);
    assert.match(slideOver, /closeOnBackdrop = true/);
    assert.match(slideOver, /onClick=\{closeOnBackdrop \? onClose : undefined\}/);
    assert.match(orderDrawer, /closeOnBackdrop=\{false\}/);
    assert.match(shell, /fixed inset-0 z-\[60\] bg-slate-950\/20/);
    assert.match(shell, /fixed inset-0 z-\[70\]/);
    assert.doesNotMatch(shell, /min-\[1600px\]:z-auto/);
});

test('Next API 契约：页面组件不得直接请求 API', () => {
    const componentRoots = [
        path.join(repoRoot, 'apps/web-next/app'),
        path.join(repoRoot, 'apps/web-next/components'),
    ];
    const files = componentRoots.flatMap((root) => walkFiles(root, (filePath) => /\.(ts|tsx)$/.test(filePath)));

    const offenders = files
        .filter((filePath) => {
            const source = readUtf8(relative(filePath));
            return /import\s+\{[^}]*\bproxy(?:Request|Fetch)\b[^}]*\}/.test(source) ||
                /\bproxy(?:Request|Fetch)\s*\(/.test(source);
        })
        .map(relative);

    assert.deepEqual(offenders, []);
});

test('Next UI 契约：不得重新引入 MUI 或 Emotion 依赖', () => {
    const packageJson = JSON.parse(readUtf8('apps/web-next/package.json'));
    const packageLock = readUtf8('apps/web-next/package-lock.json');
    const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
    };

    const forbiddenDeps = Object.keys(deps).filter((name) => (
        name.startsWith('@mui/') ||
        name.startsWith('@emotion/')
    ));
    assert.deepEqual(forbiddenDeps, []);
    assert.doesNotMatch(packageLock, /"node_modules\/@mui\//);
    assert.doesNotMatch(packageLock, /"node_modules\/@emotion\//);
});

test('Next UI 契约：配方技术参数必须结构化编辑，不回退到手写 JSON', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const editor = readUtf8('apps/web-next/components/technical-data-editor.tsx');
    const technicalLib = readUtf8('apps/web-next/lib/technical-data.ts');

    assert.match(recipesView, /TechnicalDataEditor/);
    assert.match(recipesView, /parseTechnicalDataJson/);
    assert.match(recipesView, /buildRecipeSavePayloadDraft/);
    assert.doesNotMatch(recipesView, /技术参数 JSON/);
    assert.doesNotMatch(recipesView, /<textarea[\s\S]*technicalDataJson/);
    assert.doesNotMatch(recipesView, /technicalDataJson: stringifyTechnicalData/);
    assert.match(editor, /固定技术字段/);
    assert.match(editor, /自定义参数/);
    assert.match(editor, /useState\(false\)/);
    assert.match(editor, /expanded \? <div/);
    assert.match(editor, /uploadRecipeTechnicalFile/);
    assert.match(editor, /accept="\.xls,\.xlsx/);
    assert.match(recipesView, /recipeId=\{editingRecipe\?\.id\}/);
    assert.match(technicalLib, /customFields/);
});

test('Next UI 契约：配方零件必须在旁边展示成本价和计算公式', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const apiReference = readUtf8('docs/api-reference.md');

    assert.match(recipesView, /partCostLine/);
    assert.match(recipesView, /partFormulaLine/);
    assert.match(recipesView, /findDraftPart\(bomDraft, part\)/);
    assert.match(recipesView, /公式:/);
    assert.match(recipesView, /小计/);
    assert.match(recipesLib, /formula\?: string/);
    assert.match(apiReference, /snapshotPrice/);
    assert.match(apiReference, /formula\/costSource\/source/);
});

test('Next UI 契约：配方编辑必须按泵壳、线圈和选配顺序分区', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const templateMatchSummary = readUtf8('apps/web-next/components/recipe/TemplateMatchSummary.tsx');
    const technicalEditor = readUtf8('apps/web-next/components/technical-data-editor.tsx');

    assert.match(recipesView, /1\. 泵壳与产品/);
    assert.match(recipesView, /2\. 线圈转子/);
    assert.match(recipesView, /3\. 浮球与电缆/);
    assert.match(recipesView, /4\. 包装与其他配件/);
    assert.match(recipesView, /5\. 人工与费用/);
    assert.match(recipesView, /配方名称/);
    assert.match(recipesView, /泵壳模板/);
    assert.match(recipesView, /线重 kg/);
    assert.match(recipesView, /exactCoilRecord\.wireWeight/);
    assert.match(recipesView, /value=\{form\.coilWireWeight\}/);
    assert.match(recipesView, /系统默认 \/ 客户指定/);
    assert.doesNotMatch(recipesView, /recipe-coil-wire-weight-options/);
    assert.match(templateMatchSummary, /模板 \/ 型号零配件/);
    assert.match(templateMatchSummary, /查看明细/);
    assert.doesNotMatch(templateMatchSummary, /parts\.slice/);
    assert.match(recipesView, /relatedBomParts/);
    assert.match(recipesView, /自动关联电容/);
    assert.match(recipesView, /sm:grid-cols-4/);
    assert.match(recipesView, /sm:grid-cols-\[8\.5rem_minmax\(0,1fr\)_7rem\]/);
    assert.match(recipesView, /<details className="group mt-2 rounded-md border border-line bg-slate-50\/70">/);
    assert.match(recipesView, /计算明细/);
    assert.match(recipesView, /bomDraft\?\.coilSnapshot\?\.formula/);
    assert.doesNotMatch(recipesView, /线圈与叶轮/);
    assert.match(technicalEditor, /叶轮参数/);
});

test('Next UI 契约：配方保存前自动智能检查并允许明确覆盖', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const qualityLib = readUtf8('apps/web-next/lib/quality.ts');

    assert.match(recipesView, /runRecipeAnalysis/);
    assert.match(recipesView, /智能检查/);
    assert.match(recipesView, /确定问题/);
    assert.match(recipesView, /已批准工厂规则/);
    assert.match(recipesView, /factoryRuleAlerts/);
    assert.match(recipesView, /appliedFactoryRuleCount/);
    assert.match(recipesView, /复核建议/);
    assert.match(recipesView, /价格提醒/);
    assert.match(recipesView, /相似配方依据/);
    assert.match(recipesView, /parts: draft\.parts/);
    assert.match(recipesView, /analyzeCurrentRecipeDraft\(draft\)/);
    assert.match(recipesView, /analysis\.summary\.highConfidenceAlertCount > 0/);
    assert.match(recipesView, /setAnalysisSaveGateOpen\(true\)/);
    assert.match(recipesView, /skipIntelligenceCheck: true/);
    assert.match(recipesView, /确认并继续保存/);
    assert.match(recipesView, /普通复核建议不会阻止保存/);
    assert.match(qualityLib, /\/api\/quality\/recipe-analysis/);
    assert.match(qualityLib, /proxyRequest/);
    assert.match(qualityLib, /advisoryOnly: true/);
});

test('Next UI 契约：浮球和电缆参数完成后展示后端 BOM 成本', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');

    assert.match(recipesView, /DynamicConfigCostRow/);
    assert.match(recipesView, /label="浮球成本"/);
    assert.match(recipesView, /label="成品电缆成本"/);
    assert.match(recipesView, /floatCostPart/);
    assert.match(recipesView, /cableCostPart/);
    assert.match(recipesView, /未匹配到零件价格，请先补齐零件库/);
});

test('Next UI 契约：零件页必须按分类提供结构化输入', () => {
    const partsView = readUtf8('apps/web-next/components/parts-view.tsx');
    const rules = readUtf8('apps/web-next/lib/part-form-rules.ts');
    const partsLib = readUtf8('apps/web-next/lib/parts.ts');

    assert.match(partsView, /validatePartForm/);
    assert.match(partsView, /buildPartNotes/);
    assert.match(partsView, /finalPartModel/);
    assert.match(partsView, /getSettingValue/);
    assert.match(partsView, /setSettingValue/);
    for (const label of ['电容容量', '线径', '成品电缆插头 / 规格费用', '新界式浮球加价', '按长度自动计价', '不锈钢机筒', '保存并继续']) {
        assert.match(partsView, new RegExp(label));
    }
    for (const marker of ['groupedParts', 'collapsedCategories', 'toggleSelectGroup', 'exportSelectedCsv', 'deleteParts']) {
        assert.match(partsView, new RegExp(marker));
    }
    for (const category of ['电容', '电缆线', '浮球', '螺丝', '泵壳']) {
        assert.match(rules, new RegExp(category));
    }
    for (const packagingCategory of ['包装二级分类', '外包装', '内衬', '固定包材']) {
        assert.match(`${partsView}\n${rules}`, new RegExp(packagingCategory));
    }
    assert.match(partsLib, /subcategory/);
    assert.match(partsLib, /\/api\/settings\/\$\{key\}/);
    assert.match(partsLib, /export async function deleteParts/);
});

test('Next UI 契约：零件页默认压缩分类并提供清晰筛选反馈', () => {
    const partsView = readUtf8('apps/web-next/components/parts-view.tsx');

    assert.match(partsView, /维护零件价格、供应商与库存基础数据/);
    assert.match(partsView, /collapseInitializedRef/);
    assert.match(partsView, /setCollapsedCategories\(new Set\(groupedParts\.map/);
    assert.match(partsView, /aria-label="搜索零件"/);
    assert.match(partsView, /aria-label="按分类筛选"/);
    assert.match(partsView, /hasActiveFilters/);
    assert.match(partsView, /清除筛选/);
    assert.match(partsView, /查看缺货零件/);
    assert.match(partsView, /group-hover:opacity-100/);
    assert.match(partsView, /全部状态/);
});

test('Next UI 契约：订单详情必须保留后端动作和入库确认', () => {
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const detailDrawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');
    const ordersLib = readUtf8('apps/web-next/lib/orders.ts');

    assert.match(ordersView, /OrderDetailDrawer/);
    assert.match(ordersView, /createOrder/);
    assert.match(detailDrawer, /updateOrderPurchaseItem/);
    assert.match(detailDrawer, /toggleOrderTodoItem/);
    assert.match(detailDrawer, /setOrderStatus/);
    assert.match(detailDrawer, /completeOrderPurchase/);
    assert.match(detailDrawer, /全部到货并入库/);
    assert.match(detailDrawer, /purchaseAdditions/);
    assert.match(detailDrawer, /item\.inventoryType === 'coil'/);
    assert.match(detailDrawer, /非库存项/);
    assert.match(detailDrawer, /种物料库存/);
    assert.doesNotMatch(detailDrawer, /种零件库存/);
    assert.match(detailDrawer, /生产领用不会自动扣减库存/);
    assert.match(ordersLib, /coilId\?: number/);
    assert.match(ordersLib, /inventoryType\?: 'part' \| 'coil' \| 'none'/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/status/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/purchase-items\/progress/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/purchase-items\/toggle/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/todos\/toggle/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/complete-purchase/);
});

test('Next UI 契约：订单新增产品保存成本为空时必须后端兜底试算', () => {
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const ordersLib = readUtf8('apps/web-next/lib/orders.ts');

    assert.match(ordersLib, /getRecipeCurrentPartsCost/);
    assert.match(ordersLib, /\/api\/recipes\/\$\{recipeId\}\/cost/);
    assert.match(ordersLib, /createOrderItemWithUnitCost/);
    assert.match(ordersView, /getRecipeCurrentPartsCost\(selectedRecipe\.id\)/);
    assert.match(ordersView, /保存成本为空时调用后端当前配件价作为参考/);
    assert.doesNotMatch(ordersView, /保存成本为空时该产品成本为 0/);
});

test('Next UI 契约：线圈页移除材质默认单价并保留定子组合批量改单价', () => {
    const coilsView = readUtf8('apps/web-next/components/coils-view.tsx');
    const coilsLib = readUtf8('apps/web-next/lib/coils.ts');
    const coilsRoute = readUtf8('api/routes/coils.cjs');
    const settingsRoute = readUtf8('api/routes/settings.cjs');
    const db = readUtf8('api/db.cjs');
    const docsReadme = readUtf8('docs/README.md');

    assert.match(coilsView, /实时市场指标/);
    assert.match(coilsView, /同步市场指标/);
    assert.match(coilsView, /refreshMarketIndicators/);
    assert.match(coilsView, /syncMarketIndicators/);
    assert.doesNotMatch(coilsView, /材质默认单价|保存单价配置|添加材质|saveMaterialConfig/);
    assert.doesNotMatch(coilsLib, /saveCoilMaterialPrices|\/api\/coils\/materials/);
    assert.doesNotMatch(coilsRoute, /router\.(get|put)\('\/materials'/);
    assert.doesNotMatch(settingsRoute, /coil_material_prices/);
    assert.match(db, /DELETE FROM system_settings WHERE key = \?/);
    assert.match(db, /run\('coil_material_prices'\)/);
    assert.match(coilsView, /改单价/);
    assert.match(coilsView, /saveGroupPrice/);
    assert.match(coilsLib, /updateCoilSpecPrice/);
    assert.match(coilsLib, /\/api\/coils\/spec\/\$\{encodeURIComponent\(spec\)\}/);
    assert.match(coilsLib, /getMarketIndicators/);
    assert.match(coilsLib, /\/api\/market-indicators/);
    assert.match(coilsLib, /updateMarketIndicators/);
    assert.match(coilsLib, /\/api\/market-indicators\/update/);
    for (const field of ['mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData']) {
        assert.match(coilsLib, new RegExp(field));
        assert.match(coilsView, new RegExp(field));
    }
    for (const label of ['绕组技术参数', '主线线径', '主线数据', '副线线径', '副线数据']) {
        assert.match(coilsView, new RegExp(label));
    }
    assert.match(docsReadme, /实时市场指标/);
    assert.doesNotMatch(docsReadme, /材质默认单价配置/);
    assert.match(docsReadme, /组合批量改单价/);
});

test('Next UI 契约：报价转订单必须先预览后确认', () => {
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const quotationsLib = readUtf8('apps/web-next/lib/quotations.ts');

    assert.match(quotationsView, /报价转订单预览/);
    assert.match(quotationsView, /openConvertPreview/);
    assert.match(quotationsView, /confirmConvertToOrder/);
    assert.match(quotationsView, /buildQuotationOrderDraft/);
    assert.match(quotationsView, /采购计划预览/);
    assert.match(quotationsLib, /buildQuotationOrderDraft/);
    assert.match(quotationsLib, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(quotationsLib, /\/api\/quotations\/\$\{input\.quotation\.id\}\/convert/);
});

test('Next UI 契约：报价动态覆盖必须走后端 cost-preview', () => {
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const quotationsLib = readUtf8('apps/web-next/lib/quotations.ts');

    assert.match(quotationsLib, /previewQuotationItemCost/);
    assert.match(quotationsLib, /\/api\/recipes\/\$\{recipeId\}\/cost-preview/);
    assert.match(quotationsLib, /buildRecipeDefaultQuotationOverrides/);
    assert.match(quotationsView, /previewQuotationItemCost/);
    assert.match(quotationsView, /updateDraftItemOverrides/);
    assert.match(quotationsView, /hydrateQuotationItemsForEdit/);
    assert.match(quotationsView, /overridePreviewSeqRef/);
    assert.match(quotationsView, /overridePreviewSeqRef\.current\.get\(id\) !== requestSeq/);
    assert.match(quotationsView, /hasFloat/);
    assert.match(quotationsView, /hasCable/);
    assert.doesNotMatch(quotationsView, /updateDraftItemOverrides\(item\.id,\s*\{\s*customBarrelLength/);
    assert.match(quotationsView, /packagingOptions/);
    assert.match(quotationsView, /containerOptions/);
    assert.match(quotationsView, /foamOptions/);
    assert.match(quotationsView, /pearlCottonOptions/);
    assert.match(quotationsView, /packingRole/);
    assert.doesNotMatch(quotationsView, /coilOptions/);
    assert.doesNotMatch(quotationsView, /floatWireOptions/);
    assert.doesNotMatch(quotationsView, /cableWireOptions/);
    assert.doesNotMatch(quotationsView, /浮球铜套/);
    assert.doesNotMatch(quotationsView, /电缆铜套/);
    assert.doesNotMatch(quotationsView, /表面处理费用/);
    assert.match(quotationsView, /利润率/);
    assert.doesNotMatch(quotationsView, /加价倍数/);
    assert.match(quotationsView, /marginPercentToMultiplier/);
    assert.match(quotationsView, /电缆长度（米）/);
    assert.match(quotationsView, /inputMode="numeric"/);
    assert.match(quotationsView, /maxLength=\{2\}/);
    assert.match(quotationsView, /replace\(\/\\D\/g, ''\)\.slice\(0, 2\)/);
    assert.match(quotationsView, /w-24 rounded-md[^"]+text-left/);
    assert.match(quotationsView, /sm:grid-cols-\[7rem_minmax\(0,1fr\)\]/);
    assert.match(quotationsView, /hasCable:\s*Number\(nextLength\) > 0/);
    assert.match(quotationsView, /packingPartsJson/);
    assert.match(quotationsView, /包装/);
    assert.match(quotationsView, /报价配置/);
    assert.match(quotationsView, /含税出厂价/);
    assert.match(quotationsView, /quotationTaxIncludedFactoryPrice/);
    assert.doesNotMatch(quotationsView, /setDraftItems\(\(current\) => \[\.\.\.current, item\]\)/);
    assert.match(quotationsView, /item\.id === id \? \{ \.\.\.item, overrides: currentItem\.overrides \} : item/);
    assert.match(quotationsView, /surfaceTreatmentLabel/);
    assert.match(quotationsLib, /getAllParts/);
    assert.doesNotMatch(quotationsLib, /getAllCoils/);
    assert.match(quotationsLib, /surfaceTreatmentMode/);
    assert.doesNotMatch(quotationsView, /动态覆盖项稍后单独迁移/);
});

test('Next UI 契约：客户详情可以带客户上下文新建报价', () => {
    const customersView = readUtf8('apps/web-next/components/customers-view.tsx');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const quotationsPage = readUtf8('apps/web-next/app/quotations/page.tsx');

    assert.match(customersView, /useRouter/);
    assert.match(customersView, /createQuotationForCustomer/);
    assert.match(customersView, /\/quotations\?create=1&customerId=\$\{customer\.id\}/);
    assert.match(customersView, /新建报价/);
    assert.doesNotMatch(customersView, /后续接入报价创建/);
    assert.match(quotationsView, /useSearchParams/);
    assert.match(quotationsView, /prefillCustomerId/);
    assert.match(quotationsView, /shouldCreateFromQuery/);
    assert.match(quotationsView, /setDrawerOpen\(true\)/);
    assert.match(quotationsView, /setItemMargin\(customerMarginPercent\(customer\)\)/);
    assert.match(quotationsPage, /Suspense/);
    assert.match(quotationsPage, /<QuotationsView \/>/);
});

test('Next UI 契约：转子页支持配方技术档案带入并支持历史关联', () => {
    const rotorView = readUtf8('apps/web-next/components/rotor-view.tsx');
    const rotorLib = readUtf8('apps/web-next/lib/rotor.ts');
    const rotorRoute = readUtf8('api/routes/rotor.cjs');
    const rotorDraftService = readUtf8('api/services/rotorTemplateDraft.cjs');

    assert.match(rotorView, /getAllRecipes/);
    assert.doesNotMatch(rotorView, /getAllModelVariants/);
    assert.doesNotMatch(rotorView, /selectedVariantId/);
    assert.doesNotMatch(rotorView, /型号变体/);
    assert.match(rotorView, /target\.type !== 'variant'/);
    assert.match(rotorView, /calculateBearingSpan/);
    assert.match(rotorView, /getRotorRecipeDraft/);
    assert.doesNotMatch(rotorView, /function formPatchFromTemplate/);
    assert.doesNotMatch(rotorView, /findShellMetaForTemplate/);
    assert.match(rotorView, /getRotorLinkTargets/);
    assert.match(rotorView, /linkRotorHistory/);
    assert.match(rotorLib, /\/api\/rotor\/recipe-draft/);
    assert.match(rotorLib, /JSON\.stringify\(\{ recipeId \}\)/);
    assert.match(rotorLib, /\/api\/rotor\/link-targets/);
    assert.match(rotorLib, /\/api\/rotor\/history\/\$\{id\}\/link/);
    assert.match(rotorRoute, /router\.post\('\/recipe-draft'/);
    assert.match(rotorDraftService, /function buildRotorRecipeDraft/);
});

test('Next UI 契约：配方页必须保留模板入口并支持直接复制配方', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const templateMatchSummary = readUtf8('apps/web-next/components/recipe/TemplateMatchSummary.tsx');

    assert.match(recipesView, /sectionOptions/);
    assert.match(recipesView, /泵壳模板/);
    assert.match(recipesView, /配方对比/);
    assert.match(recipesView, /toggleCompareRecipe/);
    assert.match(recipesView, /buildComparePartRows/);
    assert.match(recipesView, /comparePartRows/);
    assert.match(recipesView, /Recipe Detail/);
    assert.match(recipesView, /openRecipeDetail/);
    assert.match(recipesView, /const detailCurrentSummary = detailRecipe \? currentCostMap\.get\(detailRecipe\.id\)/);
    assert.match(recipesView, /当日完整成本/);
    assert.doesNotMatch(recipesView, /detailCurrentCost \? Number\(detailCurrentCost\.totalCost/);
    assert.match(recipesView, /getRecipeInventoryStatus/);
    assert.match(recipesView, /配件与线圈库存/);
    assert.doesNotMatch(recipesView, /确认生产|生产数量|预检库存|produceRecipe/);
    assert.match(recipesView, /新建模板/);
    assert.match(recipesView, /submitTemplate/);
    assert.match(recipesView, /openEditTemplate/);
    assert.match(recipesView, /deleteTemplate/);
    assert.match(recipesView, /getTemplateRecipeDraft/);
    assert.match(recipesView, /templateId:\s*String\(recipeDraft\.templateId\)/);
    assert.match(recipesView, /const hasStainlessStretchBarrelComponent = formTemplateShellComponents\.some/);
    assert.match(recipesView, /isStainlessStretchBarrelComponent\(component\)/);
    assert.match(recipesView, /const hasStainlessBarrel = formTemplate\?\.costMode === 'components'/);
    assert.match(recipesView, /\{hasStainlessBarrel \? \(/);
    assert.match(recipesView, /customBarrelLength: hasStainlessBarrel \? form\.customBarrelLength \|\| null : null/);
    assert.match(recipesView, /longScrewExtraLength: hasStainlessBarrel \? form\.longScrewExtraLength \|\| 0 : 0/);
    assert.match(recipesView, /longScrewExtraLength: String\(recipe\.longScrewExtraLength \|\| 0\)/);
    assert.equal((recipesView.match(/longScrewExtraLength: recipe\.longScrewExtraLength \|\| 0/g) || []).length, 2);
    assert.match(recipesView, /openCloneRecipe/);
    assert.match(recipesView, /副本/);
    assert.match(recipesView, /复制/);
    assert.doesNotMatch(recipesView, /保存为常用配置/);
    assert.match(recipesView, /线圈快照/);
    assert.match(recipesView, /自动电容/);
    assert.match(recipesView, /bomDraft\?\.coilSnapshot\?\.wireGauge/);
    assert.match(recipesView, /patch\.floatWire = nextFloatWire/);
    assert.match(recipesView, /patch\.cableWire = nextCableWire/);
    assert.match(recipesView, /isFloatWireRecommended \? <RecipeStatusBadge tone="green">系统推荐<\/RecipeStatusBadge>/);
    assert.match(recipesView, /isCableWireRecommended \? <RecipeStatusBadge tone="green">系统推荐<\/RecipeStatusBadge>/);
    assert.match(recipesView, /autoWireSelectionRef\.current\.floatWire = ''/);
    assert.match(recipesView, /autoWireSelectionRef\.current\.cableWire = ''/);
    assert.match(recipesView, /wireOptions\(parts, '浮球', '浮球-线径'\)/);
    assert.match(recipesView, /wireOptions\(parts, '电缆线', '电缆-线径'\)/);
    assert.match(recipesView, /ariaLabel="浮球线径"/);
    assert.match(recipesView, /ariaLabel="电缆线径"/);
    assert.match(recipesView, /function EditableWireSelect/);
    assert.match(recipesView, /const coilSheetOptions = useMemo/);
    assert.match(recipesView, /function EditableNumberSelect/);
    assert.match(recipesView, /onFocus=\{\(\) => \{/);
    assert.match(recipesView, /const exactCoilRecord = useMemo/);
    assert.match(recipesView, /coilWireWeight: String\(exactCoilRecord\.wireWeight\)/);
    assert.doesNotMatch(recipesView, /recipe-coil-wire-weight-options/);
    assert.match(recipesView, /role="listbox"/);
    assert.match(recipesView, /options=\{coilSheetOptions\}/);
    assert.doesNotMatch(recipesView, /list="recipe-coil-sheet-options"/);
    assert.match(recipesView, /系统联动/);
    assert.match(recipesView, /CircleHelp/);
    assert.match(recipesView, /linkedChangeSummary/);
    assert.match(recipesView, /hasLinkedChangeWarning/);
    assert.match(recipesView, /<details/);
    assert.match(recipesView, /linkedChangeAnnotations/);
    assert.match(recipesView, /泵壳整体成本/);
    assert.match(recipesView, /不锈钢长螺丝/);
    assert.match(recipesView, /关联电容/);
    assert.match(recipesView, /浮球线径/);
    assert.match(recipesView, /电缆线径/);
    assert.match(recipesView, /wireLinkNote/);
    assert.match(recipesView, /机筒 \/ 长螺丝/);
    assert.doesNotMatch(recipesView, /bomDraft\.parts\.slice\(0,\s*12\)/);
    assert.doesNotMatch(templateMatchSummary, /getSubtotal/);
    assert.doesNotMatch(templateMatchSummary, /getSourceLabel/);
    assert.match(recipesView, /onOpenAll=\{\(\) => setTemplateMatchDialogOpen\(true\)\}/);
    assert.match(recipesView, /buildRecipeSavePayloadDraft/);
    assert.match(recipesView, /assemblyWage:\s*String\(recipeDraft\.assemblyWage/);
    assert.match(recipesLib, /createModelVariant/);
    assert.match(recipesLib, /updateModelVariant/);
    assert.match(recipesLib, /deleteModelVariant/);
    assert.match(recipesLib, /applyModelVariantDraft/);
    assert.match(recipesLib, /buildRecipeSavePayloadDraft/);
    assert.match(recipesLib, /getTemplateRecipeDraft/);
    assert.match(recipesLib, /\/api\/recipes\/model-variant-draft/);
    assert.match(recipesLib, /\/api\/recipes\/save-payload-draft/);
    assert.match(recipesLib, /\/api\/recipes\/\$\{recipeId\}\/inventory-status/);
    assert.match(recipesLib, /\/api\/templates\/\$\{templateId\}\/default-recipe/);
    assert.match(recipesLib, /createTemplate/);
    assert.match(recipesLib, /updateTemplate/);
    assert.match(recipesLib, /deleteTemplate/);
    assert.match(recipesLib, /\/api\/templates/);
    assert.match(recipesLib, /\/api\/model-variants/);
    assert.match(recipesLib, /\/api\/coils\/specs/);
});

test('Next UI 契约：配方页必须压缩成本信息并给工作台足够空间', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const costSummary = readUtf8('apps/web-next/components/recipe/CostSummaryPanel.tsx');
    const recipeSection = readUtf8('apps/web-next/components/recipe/RecipeSection.tsx');
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');

    assert.match(recipesView, /成本（当日 \/ 保存）/);
    assert.match(recipesView, /成本状态正常/);
    assert.match(recipesView, /className="flex items-baseline justify-end gap-2"/);
    assert.match(recipesView, /className="h-7"/);
    assert.match(recipesView, /px-4 py-2/);
    assert.match(recipesView, /defaultOpen=\{false\}/);
    assert.doesNotMatch(recipesView, />Recipes</);
    assert.doesNotMatch(recipesView, /variant="danger" aria-label=\{`删除\$\{row\.recipe/);
    assert.match(costSummary, /pendingHints = Array\.from\(new Set/);
    assert.match(costSummary, /查看模块状态/);
    assert.doesNotMatch(costSummary, /成本完整性提示/);
    assert.match(recipeSection, /aria-expanded=\{open\}/);
    assert.match(recipesView, /button\[aria-expanded\]/);
    assert.match(recipesView, /requestAnimationFrame/);
    assert.match(slideOver, /min-\[1600px\]:right-\[500px\]/);
    assert.doesNotMatch(slideOver, /\sp-4 xl:right-\[500px\]/);
    assert.match(slideOver, /aria-modal="true"/);
});

test('Next UI 契约：泵壳模板分离套件引用和自由组合组件', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const partFormRules = readUtf8('apps/web-next/lib/part-form-rules.ts');
    const templatesRoute = readUtf8('api/routes/templates.cjs');
    const schema = readUtf8('api/database/schema.cjs');

    assert.match(recipesView, /part\.category === '泵壳'/);
    assert.match(recipesView, /零件库泵壳型号/);
    assert.match(recipesView, /组合模板名称/);
    assert.match(recipesView, /list="shell-template-model-options"/);
    assert.match(recipesView, /可直接输入新的组合名称，也可展开选择零件库中的泵壳型号/);
    assert.match(recipesView, /componentType/);
    assert.match(partFormRules, /泵壳搭配/);
    assert.match(recipesView, /part\.category === SHELL_COMPONENT_CATEGORY/);
    assert.match(recipesView, /barrelComponentNameOptions = \['铝机筒', STAINLESS_STRETCH_BARREL_NAME, '铁机筒'\]/);
    assert.match(recipesView, /不锈钢拉伸筒/);
    assert.match(recipesView, /aria-label="机筒类型"/);
    assert.match(recipesView, /shellComponentModelOptions\.map/);
    assert.doesNotMatch(recipesView, /id="shell-component-model-options"/);
    assert.doesNotMatch(recipesView, /checked=\{Boolean\(row\.isStainlessStretchBarrel\)\}/);
    assert.match(recipesView, /supplier/);
    assert.match(recipesView, /selectTemplateShell/);
    assert.match(recipesView, /泵壳套件/);
    assert.match(recipesView, /自由搭配/);
    assert.match(recipesView, /role="radiogroup" aria-label="泵壳计价方式"/);
    assert.match(recipesView, /templateForm\.costMode === 'bundle'/);
    assert.match(recipesView, /templateForm\.bundleNote/);
    assert.match(recipesView, /填写套件计价或配置说明/);
    assert.match(recipesView, /电泳\+喷塑/);
    assert.match(recipesView, /整体喷塑/);
    assert.match(recipesView, /表面处理费用/);
    assert.match(recipesView, /templateForm\.surfaceTreatmentCost/);
    assert.doesNotMatch(recipesView, /喷漆工资/);
    assert.match(recipesLib, /electrophoresis_powder_coating/);
    assert.match(templatesRoute, /surfaceTreatmentMode:\s*'surface_treatment_mode'/);
    assert.match(templatesRoute, /validateShellComponents/);
    assert.match(templatesRoute, /category = \? AND deleted_at IS NULL/);
    assert.match(schema, /\['surface_treatment_mode', "TEXT DEFAULT 'none'"\]/);
    assert.match(schema, /\['surface_treatment_cost', 'REAL'\]/);
    assert.match(schema, /\['bundle_note', "TEXT DEFAULT ''"\]/);
});

test('Next UI 契约：线圈新增按定子组合自动带入并区分槽眼和方案状态', () => {
    const coilsView = readUtf8('apps/web-next/components/coils-view.tsx');
    const coilsLib = readUtf8('apps/web-next/lib/coils.ts');
    const coilsRoute = readUtf8('api/routes/coils.cjs');
    const coilCostService = readUtf8('api/services/coilCost.cjs');

    assert.match(coilsView, /function autoFillFromSpec/);
    assert.match(coilsView, /getCoilSpecDraft/);
    assert.match(coilsView, /specOptions\.includes\(spec\)/);
    assert.match(coilsView, /onBlur=\{\(\) => \{/);
    assert.match(coilsView, /list="coil-spec-options"/);
    assert.match(coilsView, /wireWeight:\s*optionalNumberText\(draft\.wireWeight\)/);
    assert.match(coilsView, /copperBase:\s*optionalNumberText\(draft\.copperBase\)/);
    assert.match(coilsView, /coilFee:\s*optionalNumberText\(draft\.coilFee\)/);
    assert.match(coilsView, /rotorFee:\s*optionalNumberText\(draft\.rotorFee\)/);
    assert.match(coilsView, /defaultWireGauge:\s*draft\.defaultWireGauge/);
    assert.match(coilsView, /defaultCapacitor:\s*draft\.defaultCapacitor/);
    assert.match(coilsView, /disabled=\{Boolean\(editingCoil\)\}/);
    assert.match(coilsView, /单片价请在定子组合里批量修改/);
    assert.match(coilsView, /定子直径 mm/);
    assert.match(coilsView, /国标眼/);
    assert.match(coilsView, /schemeStatus/);
    assert.match(coilsView, /默认搭配电缆线径/);
    assert.match(coilsView, /搭配电缆线径/);
    assert.match(coilsLib, /getCoilSpecDraft/);
    assert.match(coilsLib, /\/api\/coils\/spec-draft/);
    assert.match(coilsRoute, /router\.post\('\/spec-draft'/);
    assert.match(coilCostService, /function buildCoilSpecDraft/);
    assert.match(coilCostService, /status !== 'official'/);
});

test('Next UI 契约：剩余业务工作台压缩标题并补齐高频操作反馈', () => {
    const coilsView = readUtf8('apps/web-next/components/coils-view.tsx');
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const rotorView = readUtf8('apps/web-next/components/rotor-view.tsx');
    const purchaseView = readUtf8('apps/web-next/components/purchase-view.tsx');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const customersView = readUtf8('apps/web-next/components/customers-view.tsx');

    assert.match(coilsView, /groupsInitializedRef/);
    assert.match(coilsView, /setCollapsedGroups\(new Set\(groupedCoils\.map/);
    assert.match(coilsView, /aria-label="搜索线圈记录"/);
    assert.match(coilsView, /aria-expanded=\{!collapsed\}/);
    assert.match(coilsView, /展开全部/);
    assert.match(ordersView, /跟踪订单状态、销售金额与采购进度/);
    assert.match(ordersView, /searchLabel="搜索订单"/);
    assert.match(ordersView, /role="button"/);
    assert.match(ordersView, /event\.key === 'Enter' \|\| event\.key === ' '/);
    assert.match(rotorView, /按配方带入参数，生成并管理转子图纸/);
    assert.match(purchaseView, /searchLabel="搜索采购任务"/);
    assert.match(quotationsView, /searchLabel="搜索报价单"/);
    assert.match(customersView, /searchLabel="搜索客户"/);
    assert.doesNotMatch(customersView, />\s*新建\s*<\/Button>\s*<\/div>\s*<div className="border-b border-line p-4">/);
});
