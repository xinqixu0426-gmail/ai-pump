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
        'docs/business-mindmap.md',
        'docs/v9-user-guide.md',
        'docs/v10-user-guide.md',
        'docs/api-architecture-audit.md',
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

test('文档契约：当前技术债只保留未完成事项并明确巨型组件瘦身边界', () => {
    const debt = readUtf8('docs/technical-debt.md');
    const stateBoundary = readUtf8('docs/frontend-state-boundary.md');
    const docsReadme = readUtf8('docs/README.md');

    assert.match(debt, /只保留尚未完成/);
    assert.match(debt, /87\/100/);
    assert.doesNotMatch(debt, /recipes-view\.tsx/);
    assert.match(debt, /ai-view\.tsx/);
    assert.match(debt, /需要，但应渐进拆分，禁止一次性重写/);
    assert.doesNotMatch(debt, /qty=0/);
    assert.doesNotMatch(debt, /shellComponentsJson.*字段白名单/);

    const templateCommands = readUtf8('api/services/templateCommands.cjs');
    const bomEngine = readUtf8('api/services/recipeBomEngine.cjs');
    const shellEditor = readUtf8('apps/web-next/components/recipe/ShellCostEditor.tsx');
    assert.doesNotMatch(templateCommands, /const normalized = \{\s*\.\.\.component,/);
    assert.match(templateCommands, /included \? parsePositiveNumber : parseNonNegativeNumber/);
    assert.doesNotMatch(bomEngine, /component\.qty \|\| 1/);
    assert.match(shellEditor, /type="number" min="0\.01" step="0\.01" title=\{row\.componentType/);
    assert.match(stateBoundary, /超过约 1,500 行/);
    assert.match(stateBoundary, /\[当前技术债与优化清单\]\(\.\/technical-debt\.md/);
    assert.match(docsReadme, /\[当前技术债与优化清单\]\(\.\/technical-debt\.md\)/);
});

test('文档契约：数据库当前版本必须与迁移代码最高版本一致', () => {
    const migrations = readUtf8('api/database/migrations.cjs');
    const schemaDoc = readUtf8('docs/database-schema.md');
    const versions = Array.from(
        migrations.matchAll(/\bversion:\s*(\d+),/g),
        match => Number(match[1])
    );
    const latestVersion = Math.max(...versions);

    assert.match(schemaDoc, new RegExp(`当前版本为 \\\`${latestVersion}\\\``));
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
    assert.match(nextPackageJson.scripts['clean:build'], /\.next-dev\/types/);
    assert.match(nextPackageJson.scripts['clean:build'], /\.next-preview\/types/);
    assert.doesNotMatch(nextPackageJson.scripts['clean:build'], /['"]\.next-dev['"]/);
    assert.doesNotMatch(nextPackageJson.scripts['clean:build'], /['"]\.next-preview['"]/);
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

test('Next UI 契约：详情编辑面板统一使用 Dialog 或右侧 Drawer', () => {
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');
    const dialog = readUtf8('apps/web-next/components/ui/dialog.tsx');

    assert.match(slideOver, /import \{ Dialog, Drawer \}/);
    assert.match(slideOver, /size === 'workspace'/);
    assert.match(slideOver, /<Drawer/);
    assert.doesNotMatch(slideOver, /lg:left-56|min-\[1600px\]:right|min-\[1920px\]:right/);
    assert.match(dialog, /export function Dialog/);
    assert.match(dialog, /export function Drawer/);
    assert.match(dialog, /createPortal/);
    assert.match(dialog, /rounded-panel/);
    assert.match(dialog, /border-l/);
});

test('Next UI 契约：P0 表单、面板和反馈使用统一基础组件', () => {
    const dialog = readUtf8('apps/web-next/components/ui/dialog.tsx');
    const field = readUtf8('apps/web-next/components/ui/field.tsx');
    const panel = readUtf8('apps/web-next/components/ui/panel.tsx');
    const notice = readUtf8('apps/web-next/components/ui/notice.tsx');
    const coils = readUtf8('apps/web-next/components/coils-view.tsx');

    assert.match(dialog, /export function ConfirmDialog/);
    assert.match(dialog, /focusableSelector/);
    assert.match(dialog, /previousFocus\?\.focus/);
    assert.match(field, /export function Field/);
    assert.match(field, /export const Input/);
    assert.match(field, /export const Select/);
    assert.match(field, /export const Textarea/);
    assert.match(panel, /export function Panel/);
    assert.match(panel, /export function PanelHeader/);
    assert.match(notice, /export function InlineNotice/);
    assert.match(coils, /<PanelHeader title="成本试算"/);
    assert.match(coils, /<Field label="规格"/);
    assert.match(coils, /<FormError message=\{formError\}/);
    assert.match(coils, /<InlineNotice tone="danger"/);
});

test('Next UI 契约：相同表单功能统一走共享组件并阻止已收口页面回退', () => {
    const webRoot = path.join(repoRoot, 'apps/web-next');
    const checkboxOffenders = walkFiles(
        webRoot,
        (filePath) => /\.(tsx|jsx)$/.test(filePath)
            && relative(filePath) !== 'apps/web-next/components/ui/field.tsx'
            && /\btype\s*=\s*["']checkbox["']/.test(fs.readFileSync(filePath, 'utf8'))
    ).map(relative);
    const field = readUtf8('apps/web-next/components/ui/field.tsx');
    const setup = readUtf8('apps/web-next/components/setup-view.tsx');
    const labor = readUtf8('apps/web-next/components/recipe/RecipeLaborCostSection.tsx');
    const guide = readUtf8('docs/ui-component-guide.md');

    assert.deepEqual(checkboxOffenders, []);
    assert.match(field, /export const Checkbox/);
    assert.match(setup, /import \{ Checkbox, Field, Input, Select \}/);
    assert.match(setup, /<Panel elevated>/);
    assert.match(setup, /<InlineNotice tone="danger"/);
    assert.doesNotMatch(setup, /const (input|section)Class|<input|<select/);
    assert.match(labor, /import \{ Field, Input, Select \}/);
    assert.match(labor, /<InlineNotice tone="warning"/);
    assert.doesNotMatch(labor, /inputClassName|<input|<select/);
    assert.match(guide, /同一种交互只能有一个基础组件入口/);
    assert.match(guide, /页面传入的 `className` 只用于网格跨度、外边距和对齐/);
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
    const knowledgeDialogs = readUtf8('apps/web-next/components/knowledge/KnowledgeDialogs.tsx');
    const knowledgeUi = `${knowledgeView}\n${knowledgeDialogs}`;
    const knowledgeLib = readUtf8('apps/web-next/lib/knowledge.ts');
    const docs = readUtf8('docs/api-reference.md') + '\n' + readUtf8('docs/README.md');

    assert.match(dashboardView, /<KnowledgeView/);
    assert.match(dashboardView, /label: '知识库'/);
    assert.match(dashboardPage, /params\.view === 'knowledge'/);
    assert.match(dashboardPage, /params\.entry/);
    assert.match(knowledgeView, /知识条目/);
    assert.match(knowledgeView, /待同步/);
    assert.match(knowledgeUi, /当前已同步内容/);
    assert.match(knowledgeUi, /查看业务来源/);
    assert.match(knowledgeView, /确认同步/);
    assert.match(knowledgeView, /同步记录/);
    assert.match(knowledgeView, /失败和重试可追溯/);
    assert.match(knowledgeView, /syncHealth\.status !== 'healthy'/);
    assert.match(knowledgeView, /检查并恢复/);
    assert.match(knowledgeView, /导入工厂资料/);
    assert.match(knowledgeUi, /下载原文件/);
    assert.match(knowledgeUi, /删除资料/);
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
    const answerProcess = readUtf8('apps/web-next/components/ai/AiAnswerProcess.tsx');
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');

    assert.match(aiLib, /AiKnowledgeSource/);
    assert.match(aiLib, /knowledgePath/);
    assert.match(answerProcess, /function AnswerEvidence/);
    assert.match(answerProcess, /回答依据/);
    assert.match(answerProcess, /实时业务数据/);
    assert.match(answerProcess, /知识库快照/);
    assert.match(answerProcess, /待同步状态/);
    assert.match(answerProcess, /查看原数据/);
});

test('Next UI 契约：AI 回答依据和处理过程默认折叠且异常自动展开', () => {
    const answerProcess = readUtf8('apps/web-next/components/ai/AiAnswerProcess.tsx');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');

    assert.match(answerProcess, /function AnswerProcess/);
    assert.match(answerProcess, /已处理/);
    assert.match(answerProcess, /查看处理过程/);
    assert.match(answerProcess, /open=\{open\}/);
    assert.match(answerProcess, /if \(requiresAttention\) setOpen\(true\)/);
    assert.match(answerProcess, /isConfirmationResult\(tool\.result\)/);
    assert.match(answerProcess, /asRecord\(tool\.result\)\.success === false/);
    assert.ok(messageList.indexOf('<AnswerProcess') < messageList.indexOf('<StreamingText'));
    assert.match(messageList, /hasAnswerProcess/);
    assert.match(messageList, /my-3 border-t border-line/);
});

test('Next UI 契约：AI 工作台提供可执行首屏、历史搜索和稳定阅读宽度', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const sidebars = readUtf8('apps/web-next/components/ai/AiConversationSidebars.tsx');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');

    assert.match(aiView, /查询成本、订单、库存与工厂知识/);
    assert.match(sidebars, /aria-label="搜索会话"/);
    assert.match(aiView, /filteredConversations/);
    assert.match(messageList, /今天想先处理什么/);
    assert.match(messageList, /aiStarterSamples/);
    assert.match(sidebars, /group-hover:opacity-100/);
    assert.match(messageList, /max-w-4xl/);
    assert.match(composer, /\[field-sizing:content\]/);
    assert.doesNotMatch(aiView, /AI Executor/);
});

test('Next UI 契约：AI 工作台保护中文输入、草稿和长回答阅读位置', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');

    assert.match(composer, /nativeEvent\.isComposing/);
    assert.match(aiView, /autoFollowRef/);
    assert.match(aiView, /nearBottom/);
    assert.match(aiView, /回到最新/);
    assert.match(aiView, /当前还有未发送内容/);
    assert.match(aiView, /retryAssistantId/);
    assert.match(aiView, /function applyTaskTemplate/);
    assert.match(aiView, /current\.trimEnd\(\)/);
    assert.match(aiView, /restoreComposerFocusAfterSendRef/);
    assert.match(aiView, /composer\.focus\(\{ preventScroll: true \}\)/);
    assert.match(aiView, /document\.activeElement === composerRef\.current/);
    assert.match(aiView, /activeElement !== document\.body/);
    assert.match(messageList, /重新回答/);
    assert.match(messageList, /不会重复保存提问/);
});

test('Next UI 契约：AI 移动抽屉提供完整模板并复用统一无障碍 Drawer', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const sidebars = readUtf8('apps/web-next/components/ai/AiConversationSidebars.tsx');
    const aiText = readUtf8('apps/web-next/components/ai/ai-text.tsx');

    assert.match(sidebars, /import \{ Drawer \} from '@\/components\/ui\/dialog'/);
    assert.match(sidebars, /ariaLabel="AI 会话与任务模板"/);
    assert.match(sidebars, /移动端 AI 任务模板分类/);
    assert.match(aiView, /模型配置异常/);
    assert.match(aiView, /智能路由 · 默认 DeepSeek/);
    assert.match(aiView, /固定使用/);
    assert.match(aiText, /打开页面/);
    assert.match(aiText, /isSafeInternalHref/);
});

test('Next UI 契约：订单生产准备检查展示结论、六步状态和缺料清单', () => {
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    assert.match(workflowResults, /function OrderReadinessResult/);
    assert.match(businessResult, /check_order_readiness/);
    assert.match(workflowResults, /可生产/);
    assert.match(workflowResults, /待补料/);
    assert.match(workflowResults, /数据阻塞/);
    assert.match(workflowResults, /procurementStage/);
    assert.match(workflowResults, /recommendedActions/);
});

test('Next UI 契约：订单处理方案展示顺序、负责人、依赖和执行方式', () => {
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    assert.match(workflowResults, /function OrderReadinessPlanResult/);
    assert.match(businessResult, /plan_order_readiness_actions/);
    assert.match(workflowResults, /AI可确认/);
    assert.match(workflowResults, /人工处理/);
    assert.match(workflowResults, /等待跟进/);
    assert.match(workflowResults, /dependsOn/);
    assert.match(workflowResults, /Array\.isArray\(item\.dependsOn\)/);
    assert.match(workflowResults, /完成标准/);
    assert.match(workflowResults, /负责人/);
    assert.match(workflowResults, /前置阻塞/);
});

test('Next UI 契约：V8 工厂执行计划展示统一步骤、边界和执行保护', () => {
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    const tools = readUtf8('api/routes/ai/tools.cjs');

    assert.match(workflowResults, /function FactoryExecutionPlanResult/);
    assert.match(businessResult, /plan_factory_workflow/);
    assert.match(workflowResults, /已有安全执行器/);
    assert.match(workflowResults, /执行保护/);
    assert.doesNotMatch(
        workflowResults.slice(
            workflowResults.indexOf('function FactoryExecutionPlanResult'),
            workflowResults.indexOf('function OrderReadinessPlanResult')
        ),
        /item\.owner/
    );
    assert.match(tools, /quotation_to_order/);
    assert.match(tools, /canExecute=true/);
});

test('Next UI 契约：V8.2 跨模块执行后展示转单结果和新订单复查', () => {
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    const tools = readUtf8('api/routes/ai/tools.cjs');

    assert.match(workflowResults, /function FactoryWorkflowActionResult/);
    assert.match(businessResult, /execute_factory_workflow_step/);
    assert.match(workflowResults, /新订单生产准备/);
    assert.match(workflowResults, /原报价流程复查/);
    assert.match(tools, /计划过期、报价未接受、已转单、资料不完整或步骤受阻时立即停止/);
});

test('Next UI 契约：V8.3 执行计划提供精确业务入口和受保护确认捷径', () => {
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const answerProcess = readUtf8('apps/web-next/components/ai/AiAnswerProcess.tsx');
    const primitives = readUtf8('apps/web-next/components/ai/AiResultPrimitives.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const factoryPlanStart = workflowResults.indexOf('function FactoryExecutionPlanResult');
    const orderPlanStart = workflowResults.indexOf('function OrderReadinessPlanResult');
    const factoryPlan = workflowResults.slice(factoryPlanStart, orderPlanStart);

    assert.match(primitives, /function buildFactoryWorkflowShortcutPrompt/);
    assert.match(primitives, /重新生成最新报价转订单执行计划/);
    assert.match(primitives, /重新检查最新生产准备计划/);
    assert.match(factoryPlan, /打开当前业务/);
    assert.match(factoryPlan, /发起确认/);
    assert.match(factoryPlan, /isSafeInternalPath\(subject\.path\)/);
    assert.match(factoryPlan, /isSafeInternalPath\(item\.path\)/);
    assert.match(factoryPlan, /onRequestAction\(actionPrompt\)/);
    assert.match(answerProcess, /onSendPrompt=\{readOnly \? undefined : onSendPrompt\}/);
    assert.match(messageList, /shortcutDisabled=\{loading\}/);
    assert.doesNotMatch(factoryPlan, /confirmAiTool/);
    assert.match(quotationsView, /searchParams\.get\('quotationId'\)/);
    assert.match(quotationsView, /consumedViewQuotationRef/);
    assert.match(quotationsView, /setViewQuotation\(target\)/);
});

test('Next UI 契约：V8.4 展示执行结果、失败原因和可恢复步骤', () => {
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');

    assert.match(workflowResults, /function WorkflowExecutionRunSummary/);
    assert.match(workflowResults, /最近执行/);
    assert.match(workflowResults, /latestRecheck/);
    assert.match(workflowResults, /最新复查/);
    assert.match(workflowResults, /recovery\.message/);
    assert.match(workflowResults, /recoverableActionIds/);
    assert.match(workflowResults, /重新发起确认/);
    assert.match(workflowResults, /执行记录 #/);
    assert.match(workflowResults, /historyWarning/);
});

test('Next UI 契约：订单方案动作执行后展示结果和重验后的方案', () => {
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    assert.match(workflowResults, /function OrderReadinessActionResult/);
    assert.match(businessResult, /execute_order_readiness_action/);
    assert.match(workflowResults, /重新检查后的处理方案/);
    assert.match(workflowResults, /<OrderReadinessPlanResult result=\{\{ data: nextPlan \}\}/);
});

test('Next UI 契约：管理看板和 AI 均展示订单准备总览', () => {
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const overview = readUtf8('apps/web-next/components/order-readiness-overview.tsx');
    const readinessLib = readUtf8('apps/web-next/lib/order-readiness.ts');
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');

    assert.match(dashboard, /value: 'readiness', label: '订单准备'/);
    assert.match(dashboard, /attentionRequired/);
    assert.match(dashboard, /OrderReadinessOverviewView/);
    assert.match(overview, /订单生产准备/);
    assert.match(overview, /待补物料/);
    assert.match(overview, /SegmentedControl/);
    assert.match(readinessLib, /proxyRequest<ApiResponse<OrderReadinessOverview>>\('\/api\/orders\/readiness-overview'\)/);
    assert.match(workflowResults, /function OrderReadinessOverviewResult/);
    assert.match(businessResult, /get_order_readiness_overview/);
    assert.match(workflowResults, /\/dashboard\?view=readiness/);
});

test('Next UI 契约：管理看板和 AI 使用同一管理待办中心', () => {
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const actionCenter = readUtf8('apps/web-next/components/management-action-center.tsx');
    const dashboardLib = readUtf8('apps/web-next/lib/dashboard.ts');
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');

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
    assert.match(workflowResults, /function ManagementActionCenterResult/);
    assert.match(businessResult, /get_management_action_center/);
    assert.match(workflowResults, /\/dashboard\?view=actions/);
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
    const assistantPanel = readUtf8('apps/web-next/components/ai/assistant-panel.tsx');
    const dashboard = readUtf8('apps/web-next/components/dashboard-view.tsx');
    const segmented = readUtf8('apps/web-next/components/ui/segmented-control.tsx');
    const partsPage = readUtf8('apps/web-next/app/parts/page.tsx');
    const partsView = readUtf8('apps/web-next/components/parts-view.tsx');

    assert.match(shell, /window\.matchMedia\('\(min-width: 1600px\)'\)/);
    assert.match(shell, /gridTemplateColumns: aiPanelDocked/);
    assert.match(shell, /AI_PANEL_STORAGE/);
    assert.match(shell, /<AssistantPanel/);
    assert.match(assistantPanel, /AI_PANEL_MIN_WIDTH = 420/);
    assert.match(assistantPanel, /AI_PANEL_MAX_WIDTH = 720/);
    assert.match(aiView, /panelControls/);
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
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
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
    assert.match(shell, /window\.localStorage\.getItem\(AI_PANEL_STORAGE\.open\)/);
    assert.match(shell, /setAiPanelOpen\(window\.localStorage/);
    assert.doesNotMatch(shell, /setAiPanelOpen\(media\.matches/);
    assert.match(shell, /sticky top-0 hidden h-screen w-56/);
    assert.match(shell, /mobileNavOpen/);
    assert.match(shell, /event\.key === 'Escape'/);
    assert.match(nav, /export function NavSection/);
    assert.match(nav, /aria-current/);
    assert.match(pageHeader, /export function PageHeader/);
    assert.match(metricCard, /export function MetricCard/);
    assert.match(metricCard, /export function MetricGrid/);
    assert.match(metricCard, /grid grid-cols-2 gap-3 xl:grid-cols-4/);
    for (const pageView of pageViews) assert.match(pageView, /<PageHeader/);
    assert.match(ordersView, /return \(\s*<div className="space-y-4">/);
    assert.doesNotMatch(ordersView, /max-w-6xl/);
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
    const dialog = readUtf8('apps/web-next/components/ui/dialog.tsx');
    const confirmDiscard = readUtf8('apps/web-next/hooks/use-confirm-discard.ts');
    const formError = readUtf8('apps/web-next/components/ui/form-error.tsx');
    const formViews = [
        readUtf8('apps/web-next/components/orders-view.tsx'),
        readUtf8('apps/web-next/components/quotations-view.tsx'),
        readUtf8('apps/web-next/components/customers-view.tsx'),
        readUtf8('apps/web-next/components/parts-view.tsx'),
    ];

    assert.match(slideOver, /from '@\/components\/ui\/dialog'/);
    assert.match(dialog, /document\.body\.style\.overflow = 'hidden'/);
    assert.match(dialog, /event\.key === 'Escape'/);
    assert.match(dialog, /openDialogStack\[openDialogStack\.length - 1\] !== dialogId/);
    assert.match(dialog, /openDialogStack\.splice\(stackIndex, 1\)/);
    assert.match(dialog, /openDialogStack\.length === 0[\s\S]*bodyOverflowBeforeDialogs/);
    assert.match(dialog, /aria-labelledby=\{ariaLabelledBy\}/);
    assert.match(dialog, /previousFocus\?\.focus/);
    assert.match(confirmDiscard, /beforeunload/);
    assert.match(confirmDiscard, /discardPromptOpen/);
    assert.match(confirmDiscard, /confirmDiscard/);
    assert.doesNotMatch(confirmDiscard, /window\.confirm/);
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
        assert.match(view, /<ConfirmDialog/);
    }
    assert.match(formViews[0], /markFormDirty\(\);[\s\S]*setDraftItems\(\(current\) => current\.filter/);
});

test('Next UI 契约：P1 高频 CRUD 使用统一字段与确认弹层', () => {
    const partsView = readUtf8('apps/web-next/components/parts-view.tsx');
    const customersView = readUtf8('apps/web-next/components/customers-view.tsx');

    for (const view of [partsView, customersView]) {
        assert.doesNotMatch(view, /window\.confirm/);
        assert.match(view, /<ConfirmDialog/);
        assert.match(view, /<Field/);
        assert.match(view, /<Input/);
        assert.match(view, /<FormError message=\{formError\}/);
    }
    assert.match(partsView, /kind: 'duplicate'/);
    assert.match(partsView, /kind: 'delete-selected'/);
    assert.match(customersView, /title="删除客户？"/);
});

test('Next UI 契约：P2 高风险删除操作使用统一确认弹层', () => {
    const views = [
        readUtf8('apps/web-next/components/quotations-view.tsx'),
        readUtf8('apps/web-next/components/coils-view.tsx'),
        readUtf8('apps/web-next/components/recipes-view.tsx'),
        readUtf8('apps/web-next/components/factory-file-attachments.tsx'),
        readUtf8('apps/web-next/components/technical-data-editor.tsx'),
    ];

    for (const view of views) {
        assert.doesNotMatch(view, /window\.confirm/);
        assert.match(view, /<ConfirmDialog/);
        assert.match(view, /confirmVariant="danger"/);
    }
    assert.match(views[0], /title="删除报价？"/);
    assert.match(views[1], /title="删除线圈记录？"/);
    assert.match(views[2], /删除泵壳模板？/);
    assert.match(views[3], /title="解除附件关联？"/);
    assert.match(views[4], /title="删除测试报告？"/);
});

test('Next UI 契约：P2 特殊业务确认流程使用统一确认弹层', () => {
    const orderRequirements = readUtf8('apps/web-next/components/order-requirements-panel.tsx');
    const orderExecution = readUtf8('apps/web-next/components/order-execution-records-panel.tsx');
    const orderDetail = readUtf8('apps/web-next/components/order-detail-drawer.tsx');
    const purchaseView = readUtf8('apps/web-next/components/purchase-view.tsx');
    const qualityView = readUtf8('apps/web-next/components/quality-view.tsx');
    const setupView = readUtf8('apps/web-next/components/setup-view.tsx');
    const rotorView = readUtf8('apps/web-next/components/rotor-view.tsx');

    for (const view of [
        orderRequirements,
        orderExecution,
        orderDetail,
        purchaseView,
        qualityView,
        setupView,
        rotorView,
    ]) {
        assert.doesNotMatch(view, /window\.confirm/);
        assert.match(view, /<ConfirmDialog/);
    }
    for (const nestedView of [orderRequirements, orderExecution, orderDetail, qualityView, rotorView]) {
        assert.match(nestedView, /layer="top"/);
    }
    assert.match(orderRequirements, /确认客户要求进入知识库？/);
    assert.match(orderExecution, /确认执行事实进入知识库？/);
    assert.match(orderDetail, /确认超计划下单？/);
    assert.match(purchaseView, /确认全部下单？/);
    assert.match(qualityView, /恢复历史规则状态？/);
    assert.match(setupView, /放弃未保存的系统设置？/);
    assert.match(rotorView, /发送图纸到默认打印机？/);
});

test('Next UI 契约：P3 删除重复 AI 外壳并拆分知识库大型弹层', () => {
    const aiText = readUtf8('apps/web-next/components/ai/ai-text.tsx');
    const aiMessageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const knowledgeDialogs = readUtf8('apps/web-next/components/knowledge/KnowledgeDialogs.tsx');
    const knowledgeModel = readUtf8('apps/web-next/components/knowledge/knowledge-view-model.ts');
    const componentGuide = readUtf8('docs/ui-component-guide.md');

    assert.match(aiText, /export function MarkdownContent/);
    assert.match(aiText, /export function StreamingText/);
    assert.match(aiMessageList, /from '@\/components\/ai\/ai-text'/);
    assert.ok(!fs.existsSync(path.join(repoRoot, 'apps/web-next/components/prompt-kit/basic-chat.tsx')));
    assert.doesNotMatch(knowledgeView, /components\/prompt-kit/);
    assert.match(knowledgeView, /<KnowledgeDialogs/);
    assert.match(knowledgeView, /knowledge-view-model/);
    assert.match(knowledgeDialogs, /feedback-diagnosis-title/);
    assert.match(knowledgeDialogs, /knowledge-detail-title/);
    assert.match(knowledgeModel, /export const STATUS_META/);
    assert.doesNotMatch(knowledgeView, /feedback-diagnosis-title|knowledge-detail-title/);
    assert.match(componentGuide, /AI 组件边界/);
    assert.match(componentGuide, /业务页面不得手写 `fixed inset-0` 遮罩/);
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
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const dialogs = readUtf8('apps/web-next/components/ai/AiWorkspaceDialogs.tsx');
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const knowledgeDialogs = readUtf8('apps/web-next/components/knowledge/KnowledgeDialogs.tsx');
    const knowledgeUi = `${knowledgeView}\n${knowledgeDialogs}`;
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');

    assert.match(messageList, /这条回答是否可靠/);
    assert.match(dialogs, /报告回答问题/);
    assert.match(dialogs, /内容错误/);
    assert.match(dialogs, /来源过期/);
    assert.match(dialogs, /资料不足/);
    assert.match(aiLib, /submitAiAnswerFeedback/);
    assert.match(aiLib, /proxyRequest/);
    assert.match(knowledgeView, /AI 回答反馈/);
    assert.match(knowledgeView, /标记已处理/);
    assert.match(knowledgeView, /原对话已删除；反馈快照、长期规则和回归案例仍保留/);
    assert.match(knowledgeView, /已提炼为独立长期规则并生效/);
    assert.match(aiLib, /conversationDeleted: boolean/);
    assert.match(knowledgeView, /reviewAiAnswerFeedback/);
    assert.match(dialogs, /长期规则只约束 AI，不会修改业务数据/);
    assert.match(dialogs, /让 AI 长期记住这条正确做法/);
    assert.match(knowledgeView, /AI 长期学习规则/);
    assert.match(knowledgeView, /toggleLearningRule/);
    assert.match(knowledgeUi, /回答诊断与复测/);
    assert.match(knowledgeUi, /重新验证/);
    assert.match(knowledgeUi, /原回答/);
    assert.match(knowledgeUi, /复测回答/);
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
    assert.match(knowledgeView, /纠错回归用例/);
    assert.match(knowledgeView, /纳入回归/);
    assert.match(knowledgeView, /reviewEvaluationCase/);
    assert.match(knowledgeView, /系统检查项管理/);
    assert.match(knowledgeView, /toggleSystemEvaluationCase/);
    assert.match(knowledgeView, /历史记录/);
    assert.match(knowledgeView, /streamAiChat/);
    assert.match(aiLib, /createAiEvaluationRun/);
    assert.match(aiLib, /recordAiEvaluationResult/);
    assert.match(aiLib, /completeAiEvaluationRun/);
    assert.match(aiLib, /reviewAiEvaluationCase/);
    assert.match(aiLib, /configureAiSystemEvaluationCase/);
    assert.match(liveRunner, /\/api\/ai\/evaluations\/runs/);
    assert.match(liveRunner, /\/api\/ai\/chat/);
    assert.match(liveRunner, /process\.exitCode = 1/);
    assert.match(packageJson, /"test:knowledge-live"/);
    assert.match(packageJson, /--scope=manual/);
    assert.match(packageJson, /--scope=release/);
});

test('Next UI 契约：业务页面使用自适应三栏工作台并提供可复用 AI 助手', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const assistantPanel = readUtf8('apps/web-next/components/ai/assistant-panel.tsx');

    assert.match(shell, /aria-label="主导航"/);
    assert.match(shell, /gridTemplateColumns: aiPanelDocked/);
    assert.match(shell, /aiPanelPinned/);
    assert.match(shell, /aiPanelFullscreen/);
    assert.match(shell, /aria-label="展开业务 AI 助手"/);
    assert.match(shell, /fixed bottom-\[max\(1\.25rem,env\(safe-area-inset-bottom\)\)\] right-5 z-\[90\]/);
    assert.match(assistantPanel, /调整 AI 助手宽度/);
    assert.match(assistantPanel, /固定 AI 助手到右侧/);
    assert.match(assistantPanel, /全屏显示 AI 助手/);
    assert.doesNotMatch(shell, /isSetupWorkspace/);
    assert.match(shell, /<AiView\s+variant="panel"/);
    assert.match(shell, /<NavSection/);
    assert.doesNotMatch(shell, /<NavMenu/);
    assert.match(shell, /label="销售"/);
    assert.match(shell, /label="供应链"/);
    assert.match(shell, /label="产品工程"/);
    assert.match(shell, /label="系统"/);
    assert.match(shell, /fixed inset-y-0 left-0/);
    assert.match(shell, /aria-label="打开主导航"/);
    assert.match(aiView, /variant\?: 'workspace' \| 'panel'/);
    assert.match(aiView, /进入 AI 工作台/);
    assert.match(aiView, /同步知识库/);
    assert.match(aiView, /syncFactoryKnowledge/);
});

test('Next UI 契约：订单详情上下文独立传给业务 AI 助手', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');
    const aiLib = readUtf8('apps/web-next/lib/ai.ts');
    const pageContext = readUtf8('apps/web-next/lib/page-context.ts');
    const conversationHistory = readUtf8('apps/web-next/components/ai/useAiConversationHistory.ts');
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const orderDrawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');

    assert.match(shell, /readCurrentAiPageContext/);
    assert.match(shell, /pageContext=\{pageContext\}/);
    assert.match(composer, /aria-label="AI 页面上下文"/);
    assert.match(aiView, /controller\.signal, pageContext/);
    assert.match(aiLib, /resourceId: pageContext\.resourceId/);
    assert.doesNotMatch(aiLib, /pageContext: \{[\s\S]{0,200}label:/);
    assert.match(pageContext, /resourceType: 'order'/);
    assert.match(pageContext, /AI_PAGE_CONTEXT_EVENT/);
    assert.match(conversationHistory, /window\.sessionStorage\.setItem\(ACTIVE_CONVERSATION_STORAGE_KEY/);
    assert.match(conversationHistory, /restorableConversationId/);
    assert.match(aiView, /restoreConversationActionsRef\.current\.openConversation\(restorableConversationId\)/);
    assert.match(ordersView, /replacePageLocation\(`\/orders\?orderId=/);
    assert.match(orderDrawer, /replacePageLocation\(`\/orders\?orderId=/);
});

test('Next UI 契约：浮动业务 AI 必须位于订单详情弹层之上', () => {
    const dialog = readUtf8('apps/web-next/components/ui/dialog.tsx');
    const assistantPanel = readUtf8('apps/web-next/components/ai/assistant-panel.tsx');
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');
    const orderDrawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');

    assert.match(dialog, /base: 'z-50'/);
    assert.match(dialog, /assistant: 'z-\[130\]'/);
    assert.match(slideOver, /closeOnBackdrop = true/);
    assert.match(dialog, /onClick=\{closeOnBackdrop \? onClose : undefined\}/);
    assert.match(orderDrawer, /closeOnBackdrop=\{false\}/);
    assert.match(assistantPanel, /fixed inset-0 z-\[100\]/);
    assert.match(assistantPanel, /fixed z-\[110\]/);
    assert.doesNotMatch(assistantPanel, /min-\[1600px\]:z-auto/);
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
    const recipeDetailPanel = readUtf8('apps/web-next/components/recipe/RecipeDetailPanel.tsx');
    const editor = readUtf8('apps/web-next/components/technical-data-editor.tsx');
    const technicalLib = readUtf8('apps/web-next/lib/technical-data.ts');

    assert.match(recipesView, /TechnicalDataEditor/);
    assert.match(recipeDetailPanel, /parseTechnicalDataJson/);
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
    assert.match(editor, /onTechnicalFileCountChange\?: \(count: number\) => void/);
    assert.match(editor, /onTechnicalFileCountChange\?\.\(files\.length\)/);
    assert.match(recipesView, /recipeId=\{editingRecipe\?\.id\}/);
    assert.match(recipesView, /syncRecipeTechnicalFileCount/);
    assert.match(recipesView, /recipe\.id === recipeId \? \{ \.\.\.recipe, technicalFileCount \} : recipe/);
    assert.match(recipesView, /onTechnicalFileCountChange=\{handleTechnicalFileCountChange\}/);
    assert.match(technicalLib, /customFields/);
    assert.match(technicalLib, /export function getRecipeTechnicalProgress/);
    assert.match(technicalLib, /TECHNICAL_DATA_KEYS\.length \+ IMPELLER_PROGRESS_FIELDS\.length/);
    assert.match(editor, /technicalProgress\.completed/);
});

test('Next UI 契约：配方列表在桌面和窄屏均展示技术参数进度', () => {
    const workspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');

    assert.match(workspace, /getRecipeTechnicalProgress/);
    assert.match(workspace, /parseTechnicalDataJson\(recipe\.technicalDataJson\)/);
    assert.match(workspace, /function TechnicalProgress/);
    assert.match(workspace, /\{progress\.completed\}\/\{progress\.total\}/);
    assert.match(workspace, /technicalFileCount/);
    assert.match(workspace, /报告 \$\{technicalFileCount\} 份/);
    assert.match(workspace, /无测试报告/);
    assert.match(recipesLib, /technicalFileCount\?: number/);
    assert.match(recipesLib, /technicalFileCount: Number\(row\.technicalFileCount\) \|\| 0/);
    assert.match(workspace, /progress\.entries\.map/);
    assert.match(workspace, /role="tooltip"/);
    assert.match(workspace, /createPortal/);
    assert.match(workspace, /<th[^>]*>\u6280术参数<\/th>/);
    assert.ok((workspace.match(/progress=\{row\.technicalProgress\}/g) || []).length >= 2);
    assert.ok((workspace.match(/technicalFileCount=\{row\.recipe\.technicalFileCount\}/g) || []).length >= 2);
});

test('Next UI 契约：配方零件必须在旁边展示成本价和计算公式', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeOptionalPackingSection = readUtf8('apps/web-next/components/recipe/RecipeOptionalPackingSection.tsx');
    const recipeCostDisplay = readUtf8('apps/web-next/components/recipe/recipe-cost-display.ts');
    const recipeDetailPanel = readUtf8('apps/web-next/components/recipe/RecipeDetailPanel.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const apiReference = readUtf8('docs/api-reference.md');

    assert.match(recipeOptionalPackingSection, /partCostLine/);
    assert.match(recipesView, /partFormulaLine/);
    assert.match(recipeOptionalPackingSection, /findDraftSelectionPart\(bomDraft, part\)/);
    assert.match(recipeOptionalPackingSection, /公式:/);
    assert.match(recipeCostDisplay, /function findDraftSelectionPart/);
    assert.match(recipeDetailPanel, /快照小计/);
    assert.match(recipesLib, /formula\?: string/);
    assert.match(apiReference, /snapshotPrice/);
    assert.match(apiReference, /formula\/costSource\/source/);
});

test('Next UI 契约：配方编辑必须按泵壳、线圈和选配顺序分区', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeEditor = readUtf8('apps/web-next/components/recipe/RecipeEditor.tsx');
    const recipeBasicSection = readUtf8('apps/web-next/components/recipe/RecipeBasicSection.tsx');
    const recipeCoilSection = readUtf8('apps/web-next/components/recipe/RecipeCoilSection.tsx');
    const recipeDynamicConfigSection = readUtf8('apps/web-next/components/recipe/RecipeDynamicConfigSection.tsx');
    const recipeOptionalPackingSection = readUtf8('apps/web-next/components/recipe/RecipeOptionalPackingSection.tsx');
    const recipeLaborCostSection = readUtf8('apps/web-next/components/recipe/RecipeLaborCostSection.tsx');
    const templateMatchSummary = readUtf8('apps/web-next/components/recipe/TemplateMatchSummary.tsx');
    const technicalEditor = readUtf8('apps/web-next/components/technical-data-editor.tsx');

    assert.match(recipesView, /<RecipeEditor/);
    assert.match(recipesView, /<RecipeBasicSection/);
    assert.match(recipesView, /<RecipeCoilSection/);
    assert.match(recipesView, /<RecipeDynamicConfigSection/);
    assert.match(recipesView, /<RecipeOptionalPackingSection/);
    assert.match(recipesView, /<RecipeLaborCostSection/);
    assert.doesNotMatch(recipesView, /id="recipe-basic-section"/);
    assert.match(recipeEditor, /保存配方/);
    assert.match(recipeBasicSection, /1\. 泵壳与产品/);
    assert.match(recipeBasicSection, /配方名称/);
    assert.match(recipeBasicSection, /泵壳模板/);
    assert.match(recipeCoilSection, /2\. 线圈转子/);
    assert.match(recipeDynamicConfigSection, /3\. 浮球与电缆/);
    assert.match(recipeOptionalPackingSection, /4\. 包装与其他配件/);
    assert.match(recipeLaborCostSection, /5\. 人工与费用/);
    assert.match(recipeLaborCostSection, /以下费用可能漏算/);
    assert.match(recipeLaborCostSection, /安装工资/);
    assert.match(recipeLaborCostSection, /打包工资/);
    assert.match(recipeLaborCostSection, /管理费/);
    assert.match(recipeLaborCostSection, /value: 'custom'/);
    assert.match(recipeLaborCostSection, /disabled=\{form\.surfaceTreatmentMode === 'none'\}/);
    assert.match(recipeCoilSection, /线重 kg/);
    assert.match(recipesView, /exactCoilRecord\.wireWeight/);
    assert.match(recipeCoilSection, /value=\{form\.coilWireWeight\}/);
    assert.match(recipeCoilSection, /系统默认 \/ 客户指定/);
    assert.doesNotMatch(recipesView, /recipe-coil-wire-weight-options/);
    assert.match(templateMatchSummary, /模板 \/ 型号零配件/);
    assert.match(templateMatchSummary, /查看明细/);
    assert.doesNotMatch(templateMatchSummary, /parts\.slice/);
    assert.match(recipesView, /relatedBomParts/);
    assert.match(recipeCoilSection, /自动关联电容/);
    assert.match(recipeCoilSection, /sm:grid-cols-4/);
    assert.match(recipeCoilSection, /sm:grid-cols-\[8\.5rem_minmax\(0,1fr\)_7rem\]/);
    assert.match(recipeCoilSection, /<details className="group mt-2 rounded-md border border-line bg-slate-50\/70">/);
    assert.match(recipeCoilSection, /计算明细/);
    assert.match(recipeCoilSection, /coilSnapshot\?\.formula/);
    assert.match(recipesView, /coilSnapshot=\{bomDraft\?\.coilSnapshot\}/);
    assert.doesNotMatch(recipesView, /线圈与叶轮/);
    assert.match(technicalEditor, /叶轮参数/);
});

test('Next UI 契约：配方保存前自动智能检查并允许明确覆盖', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const analysisPanel = readUtf8('apps/web-next/components/recipe/RecipeAnalysisPanel.tsx');
    const qualityLib = readUtf8('apps/web-next/lib/quality.ts');

    assert.match(recipesView, /runRecipeAnalysis/);
    assert.match(recipesView, /<RecipeAnalysisPanel/);
    assert.match(analysisPanel, /配方智能检查/);
    assert.match(analysisPanel, /确定问题/);
    assert.match(analysisPanel, /已批准工厂规则/);
    assert.match(analysisPanel, /factoryRuleAlerts/);
    assert.match(analysisPanel, /appliedFactoryRuleCount/);
    assert.match(analysisPanel, /复核建议/);
    assert.match(analysisPanel, /价格提醒/);
    assert.match(analysisPanel, /相似配方依据/);
    assert.match(recipesView, /parts: draft\.parts/);
    assert.match(recipesView, /analyzeCurrentRecipeDraft\(draft\)/);
    assert.match(recipesView, /analysis\.summary\.highConfidenceAlertCount > 0/);
    assert.match(recipesView, /setAnalysisSaveGateOpen\(true\)/);
    assert.match(recipesView, /skipIntelligenceCheck: true/);
    assert.match(analysisPanel, /确认并继续保存/);
    assert.match(analysisPanel, /普通复核建议不会阻止保存/);
    assert.match(qualityLib, /\/api\/quality\/recipe-analysis/);
    assert.match(qualityLib, /proxyRequest/);
    assert.match(qualityLib, /advisoryOnly: true/);
});

test('Next UI 契约：浮球和电缆参数完成后展示后端 BOM 成本', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeDynamicConfigSection = readUtf8('apps/web-next/components/recipe/RecipeDynamicConfigSection.tsx');
    const recipeCostDisplay = readUtf8('apps/web-next/components/recipe/recipe-cost-display.ts');

    assert.match(recipeDynamicConfigSection, /DynamicConfigCostRow/);
    assert.match(recipeDynamicConfigSection, /label="浮球成本"/);
    assert.match(recipeDynamicConfigSection, /label="成品电缆成本"/);
    assert.match(recipesView, /floatCostPart=\{floatCostPart\}/);
    assert.match(recipesView, /cableCostPart=\{cableCostPart\}/);
    assert.match(recipeDynamicConfigSection, /未匹配到零件价格，请先补齐零件库/);
    assert.match(recipeCostDisplay, /function partFormulaLine/);
});

test('Next UI 契约：BOM 预览集中管理参数、自动刷新和过期响应', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const bomPreviewHook = readUtf8('apps/web-next/components/recipe/useBomPreview.ts');

    assert.match(recipesView, /useBomPreview\(\{/);
    assert.match(recipesView, /canPreview: canPreviewBomDraft/);
    assert.match(recipesView, /runBomPreview/);
    assert.match(recipesView, /resetBomPreview/);
    assert.doesNotMatch(recipesView, /replaceBomPreview/);
    assert.doesNotMatch(recipesView, /bomDraftRequestRef/);
    assert.doesNotMatch(recipesView, /floatAccessoryDelta: 0/);
    assert.doesNotMatch(recipesView, /void buildBomDraft\(\{ silent: true \}\)/);
    assert.match(bomPreviewHook, /previewRecipeBomDraft/);
    assert.match(bomPreviewHook, /function buildBomPreviewInput/);
    assert.doesNotMatch(bomPreviewHook, /floatAccessoryDelta:\s*0/);
    assert.match(bomPreviewHook, /selectionToRecipeParts\(optionalParts\)/);
    assert.match(bomPreviewHook, /selectionToRecipeParts\(packingParts, true\)/);
    assert.match(bomPreviewHook, /autoDelayMs = 400/);
    assert.match(bomPreviewHook, /activeRef = useRef\(false\)/);
    assert.match(bomPreviewHook, /runImmediately = active && !activeRef\.current/);
    assert.match(bomPreviewHook, /window\.setTimeout/);
    assert.match(bomPreviewHook, /runImmediately \? 0 : autoDelayMs/);
    assert.match(bomPreviewHook, /run\(\{ captureError: true \}\)/);
    assert.match(bomPreviewHook, /requestId === requestRef\.current/);
    assert.match(bomPreviewHook, /requestRef\.current \+= 1/);
    assert.match(bomPreviewHook, /setLoading\(false\)/);
    assert.match(bomPreviewHook, /captureError/);
});

test('Next UI 契约：配方草稿集中管理生命周期和纯草稿操作', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeDraftHook = readUtf8('apps/web-next/components/recipe/useRecipeDraft.ts');
    const bomPreviewHook = readUtf8('apps/web-next/components/recipe/useBomPreview.ts');

    assert.match(recipesView, /useRecipeDraft\(\)/);
    assert.match(recipesView, /startCreate: startCreateDraft/);
    assert.match(recipesView, /startEdit: startEditDraft/);
    assert.match(recipesView, /startClone: startCloneDraft/);
    assert.doesNotMatch(recipesView, /function formFromRecipe/);
    assert.doesNotMatch(recipesView, /function parseSelections/);
    assert.doesNotMatch(recipesView, /setEditingRecipe/);
    assert.doesNotMatch(recipesView, /setOptionalParts/);
    assert.doesNotMatch(recipesView, /setPackingParts/);
    assert.match(recipesView, /defaultSupplierForModel/);
    assert.match(recipesView, /packagingMaterialForCatalogPart/);
    assert.match(recipeDraftHook, /function createEmptyRecipeForm/);
    assert.match(recipeDraftHook, /function createEmptySelection/);
    assert.match(recipeDraftHook, /function formFromRecipe/);
    assert.match(recipeDraftHook, /function selectionsFromRecipe/);
    assert.match(recipeDraftHook, /const addOptionalPart = useCallback/);
    assert.match(recipeDraftHook, /const addPackingPart = useCallback/);
    assert.match(recipeDraftHook, /const updateOptionalPart = useCallback/);
    assert.match(recipeDraftHook, /const updatePackingPart = useCallback/);
    assert.match(recipeDraftHook, /const removeOptionalPart = useCallback/);
    assert.match(recipeDraftHook, /const removePackingPart = useCallback/);
    assert.match(recipeDraftHook, /const startCreate = useCallback/);
    assert.match(recipeDraftHook, /const startEdit = useCallback/);
    assert.match(recipeDraftHook, /const startClone = useCallback/);
    assert.match(recipeDraftHook, /未命名配方.*副本/);
    assert.match(recipeDraftHook, /variantId: ''/);
    assert.match(recipeDraftHook, /savedCoilWireWeight/);
    assert.doesNotMatch(bomPreviewHook, /bomPreviewFromRecipe/);
});

test('Next UI 契约：编辑配方首次成本完成前不得展示历史快照或允许保存', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const bomPreviewHook = readUtf8('apps/web-next/components/recipe/useBomPreview.ts');
    const costSummary = readUtf8('apps/web-next/components/recipe/CostSummaryPanel.tsx');
    const recipeEditor = readUtf8('apps/web-next/components/recipe/RecipeEditor.tsx');

    assert.match(recipesView, /const openEditDrawer[\s\S]*startEditDraft\(recipe\);[\s\S]*resetBomPreview\(\);[\s\S]*prepareRecipeEditorUi\(\)/);
    assert.doesNotMatch(recipesView, /replaceBomPreview\(bomPreviewFromRecipe\(recipe\)\)/);
    assert.doesNotMatch(bomPreviewHook, /parseRecipePartsJson/);
    assert.match(recipesView, /costPreviewPending = canPreviewBomDraft && \(!bomDraft \|\| bomDraftLoading\)/);
    assert.match(recipesView, /当前成本正在计算，请等待完成后再保存配方/);
    assert.match(costSummary, /loading \? '正在计算' : ready \? money\(total\) : '—'/);
    assert.match(costSummary, /ready \? money\(value\) : '—'/);
    assert.match(recipeEditor, /costLoading \? '等待成本计算'/);
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
    assert.match(partsLib, /business-setting-update:/);
    assert.match(partsLib, /expectedUpdatedAt:\s*settingVersions\.get\(key\)/);
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

test('Next UI 契约：直接建单基于完整配方支持客户配置并由服务端锁定成本和采购计划', () => {
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const ordersLib = readUtf8('apps/web-next/lib/orders.ts');
    const configurationEditor = readUtf8('apps/web-next/components/order-item-configuration-editor.tsx');
    const recipeConfigurations = readUtf8('apps/web-next/lib/recipe-configurations.ts');

    assert.doesNotMatch(ordersLib, /getRecipeCurrentPartsCost/);
    assert.doesNotMatch(ordersLib, /createOrderItemWithUnitCost/);
    assert.match(ordersView, /该配方缺少完整保存成本，请先重新保存配方后再建单/);
    assert.match(ordersLib, /configurationOverrides/);
    assert.match(ordersView, /previewRecipeConfiguration/);
    assert.match(ordersView, /configurationPreviewCoordinatorRef\.current\.run/);
    assert.match(configurationEditor, /线圈片数/);
    assert.match(configurationEditor, /电缆长度（米）/);
    assert.match(configurationEditor, /外包装/);
    assert.match(configurationEditor, /带浮球/);
    assert.match(recipeConfigurations, /\/api\/recipes\/\$\{recipeId\}\/cost-preview/);
    assert.match(ordersLib, /\/api\/orders\/purchase-plan/);
});

test('Next UI 契约：线圈页移除材质默认单价并保留定子组合批量改单价', () => {
    const coilsView = readUtf8('apps/web-next/components/coils-view.tsx');
    const coilsLib = readUtf8('apps/web-next/lib/coils.ts');
    const coilsRoute = readUtf8('api/routes/coils.cjs');
    const coilCommands = readUtf8('api/services/coilCommands.cjs');
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
    assert.match(coilsLib, /\/api\/coils\/spec-price-preview/);
    assert.match(coilsLib, /\/api\/coils\/spec\/\$\{encodeURIComponent\(spec\)\}/);
    assert.match(coilsLib, /previewHash:\s*preview\.previewHash/);
    assert.match(coilsLib, /expectedUpdatedAt:\s*coil\.updatedAt/);
    assert.match(coilsRoute, /executeCoilCreate/);
    assert.match(coilsRoute, /executeCoilUpdate/);
    assert.match(coilsRoute, /executeCoilDelete/);
    assert.match(coilsRoute, /executeCoilUnitPriceBatch/);
    assert.match(coilCommands, /executePersistentCommand/);
    assert.match(coilCommands, /assertCoilIdentityEditable/);
    assert.match(coilCommands, /assertCoilCanBeDeleted/);
    assert.match(coilCommands, /assertPreviewHash/);
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
    const recipeConfigurations = readUtf8('apps/web-next/lib/recipe-configurations.ts');

    assert.match(quotationsLib, /previewQuotationItemCost/);
    assert.match(quotationsLib, /previewRecipeConfiguration/);
    assert.match(recipeConfigurations, /\/api\/recipes\/\$\{recipeId\}\/cost-preview/);
    assert.match(quotationsLib, /buildRecipeDefaultQuotationOverrides/);
    assert.match(quotationsView, /previewQuotationItemCost/);
    assert.match(quotationsView, /updateDraftItemOverrides/);
    assert.match(quotationsView, /hydrateQuotationItemsForEdit/);
    assert.match(quotationsView, /overridePreviewCoordinatorRef\.current\.run/);
    assert.match(quotationsView, /configurationWarnings/);
    assert.match(quotationsView, /hasFloat/);
    assert.match(quotationsView, /hasCable/);
    assert.doesNotMatch(quotationsView, /updateDraftItemOverrides\(item\.id,\s*\{\s*customBarrelLength/);
    assert.match(quotationsView, /packagingOptions/);
    assert.match(quotationsView, /containerOptions/);
    assert.match(quotationsView, /foamOptions/);
    assert.match(quotationsView, /pearlCottonOptions/);
    assert.match(quotationsView, /packingRole/);
    assert.match(quotationsView, /buildPackingOptions\(parts, recipes\)/);
    assert.doesNotMatch(quotationsView, /function inferPackingRole/);
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
    assert.match(quotationsView, /sm:grid-cols-\[7rem_minmax\(16rem,28rem\)\]/);
    assert.match(quotationsView, /lg:grid-cols-\[7rem_minmax\(16rem,28rem\)_minmax\(18rem,1fr\)\]/);
    assert.match(quotationsView, /hasCable:\s*Number\(nextLength\) > 0/);
    assert.match(quotationsView, /packingPartsJson/);
    assert.match(quotationsView, /包装/);
    assert.match(quotationsView, /报价配置/);
    assert.match(quotationsView, /含税出厂价/);
    assert.match(quotationsView, /quotationTaxIncludedFactoryPrice/);
    assert.match(quotationsView, /function PackingHoverSummary/);
    assert.match(quotationsView, /createPortal/);
    assert.match(quotationsView, /role="tooltip"/);
    assert.match(quotationsView, /onMouseEnter/);
    assert.match(quotationsView, /onFocus/);
    assert.match(quotationsView, /\{rows\.length\} 项包材/);
    assert.match(quotationsView, /title="单位成本">单价/);
    assert.match(quotationsView, /title="产品出厂单价">出厂价/);
    assert.match(quotationsView, /money\(Number\(item\.unitCost \|\| 0\)\)/);
    assert.match(quotationsView, /money\(Number\(item\.unitPrice \|\| 0\)\)/);
    assert.doesNotMatch(quotationsView, /setDraftItems\(\(current\) => \[\.\.\.current, item\]\)/);
    assert.match(quotationsView, /overrides: currentItem\.overrides/);
    assert.match(quotationsView, /configurationWarnings: currentItem\.configurationWarnings/);
    assert.match(quotationsView, /function resetForm\(\) \{\s+overridePreviewCoordinatorRef\.current\.clear\(\)/);
    assert.match(quotationsView, /function openEditDrawer\(quotation: Quotation\) \{\s+overridePreviewCoordinatorRef\.current\.clear\(\)/);
    assert.match(quotationsView, /surfaceTreatmentLabel/);
    assert.match(quotationsLib, /getAllParts/);
    assert.doesNotMatch(quotationsLib, /getAllCoils/);
    assert.match(recipeConfigurations, /surfaceTreatmentMode/);
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
    assert.match(rotorLib, /\/api\/rotor\/history\/\$\{record\.id\}\/link/);
    assert.match(rotorLib, /expectedUpdatedAt: record\.updatedAt/);
    assert.match(rotorRoute, /router\.post\('\/recipe-draft'/);
    assert.match(rotorDraftService, /function buildRotorRecipeDraft/);
});

test('Next UI 契约：配方页必须保留模板入口并支持直接复制配方', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const technicalReferences = readUtf8('apps/web-next/lib/technical-references.ts');
    const recipeWorkspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');
    const recipeComparePanel = readUtf8('apps/web-next/components/recipe/RecipeComparePanel.tsx');
    const modelVariantPanel = readUtf8('apps/web-next/components/recipe/ModelVariantCompatibilityPanel.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const recipeBasicSection = readUtf8('apps/web-next/components/recipe/RecipeBasicSection.tsx');
    const recipeCoilSection = readUtf8('apps/web-next/components/recipe/RecipeCoilSection.tsx');
    const recipeDynamicConfigSection = readUtf8('apps/web-next/components/recipe/RecipeDynamicConfigSection.tsx');
    const recipeDetailPanel = readUtf8('apps/web-next/components/recipe/RecipeDetailPanel.tsx');
    const editableValueSelect = readUtf8('apps/web-next/components/recipe/EditableValueSelect.tsx');
    const templateMatchSummary = readUtf8('apps/web-next/components/recipe/TemplateMatchSummary.tsx');
    const recipeDraftHook = readUtf8('apps/web-next/components/recipe/useRecipeDraft.ts');
    const bomPreviewHook = readUtf8('apps/web-next/components/recipe/useBomPreview.ts');

    assert.match(recipesView, /sectionOptions/);
    assert.match(recipesView, /泵壳模板/);
    assert.match(recipeComparePanel, /配方对比/);
    assert.match(recipesView, /toggleCompareRecipe/);
    assert.match(recipeComparePanel, /buildComparePartRows/);
    assert.match(recipeComparePanel, /comparePartRows/);
    assert.match(recipeDetailPanel, /Recipe Detail/);
    assert.match(recipesView, /openRecipeDetail/);
    assert.match(recipesView, /currentSummary=\{detailRecipe \? currentCostMap\.get\(detailRecipe\.id\)/);
    assert.match(recipeDetailPanel, /当日完整成本/);
    assert.doesNotMatch(recipeDetailPanel, /currentCost \? Number\(currentCost\.totalCost/);
    assert.match(recipesView, /getRecipeInventoryStatus/);
    assert.match(recipeDetailPanel, /配件与线圈库存/);
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
    assert.match(technicalReferences, /candidate\.hasDimensionSuffix !== target\.hasDimensionSuffix/);
    assert.match(technicalReferences, /distinctModels\.size === 1/);
    assert.match(recipeBasicSection, /\{hasStainlessBarrel \? \(/);
    assert.match(recipesView, /customBarrelLength: hasStainlessBarrel \? form\.customBarrelLength \|\| null : null/);
    assert.match(recipesView, /longScrewExtraLength: hasStainlessBarrel \? form\.longScrewExtraLength \|\| 0 : 0/);
    assert.match(recipeDraftHook, /longScrewExtraLength: String\(recipe\.longScrewExtraLength \|\| 0\)/);
    assert.match(bomPreviewHook, /longScrewExtraLength: hasStainlessBarrel \? form\.longScrewExtraLength \|\| 0 : 0/);
    assert.match(recipesView, /openCloneRecipe/);
    assert.match(recipeDraftHook, /副本/);
    assert.match(recipeWorkspace, /复制/);
    assert.doesNotMatch(recipesView, /保存为常用配置/);
    assert.match(recipeWorkspace, /线圈快照/);
    assert.match(recipeCoilSection, /自动电容/);
    assert.match(recipesView, /bomDraft\?\.coilSnapshot\?\.wireGauge/);
    assert.match(recipesView, /patch\.floatWire = nextFloatWire/);
    assert.match(recipesView, /patch\.cableWire = nextCableWire/);
    assert.match(recipeDynamicConfigSection, /isFloatWireRecommended \? <RecipeStatusBadge tone="green">系统推荐<\/RecipeStatusBadge>/);
    assert.match(recipeDynamicConfigSection, /isCableWireRecommended \? <RecipeStatusBadge tone="green">系统推荐<\/RecipeStatusBadge>/);
    assert.match(recipesView, /autoWireSelectionRef\.current\.floatWire = ''/);
    assert.match(recipesView, /autoWireSelectionRef\.current\.cableWire = ''/);
    assert.match(recipesView, /wireOptions\(parts, '浮球', '浮球-线径'\)/);
    assert.match(recipesView, /wireOptions\(parts, '电缆线', '电缆-线径'\)/);
    assert.match(recipeDynamicConfigSection, /ariaLabel="浮球线径"/);
    assert.match(recipeDynamicConfigSection, /ariaLabel="电缆线径"/);
    assert.match(editableValueSelect, /function EditableWireSelect/);
    assert.match(recipesView, /const coilSheetOptions = useMemo/);
    assert.match(editableValueSelect, /function EditableNumberSelect/);
    assert.match(editableValueSelect, /onFocus=\{\(\) => \{/);
    assert.match(recipesView, /const exactCoilRecord = useMemo/);
    assert.match(recipesView, /coilWireWeight: String\(exactCoilRecord\.wireWeight\)/);
    assert.doesNotMatch(recipesView, /recipe-coil-wire-weight-options/);
    assert.match(editableValueSelect, /role="listbox"/);
    assert.match(recipesView, /sheetOptions=\{coilSheetOptions\}/);
    assert.match(recipeCoilSection, /options=\{sheetOptions\}/);
    assert.doesNotMatch(recipesView, /list="recipe-coil-sheet-options"/);
    assert.match(recipeBasicSection, /系统联动/);
    assert.match(recipeBasicSection, /CircleHelp/);
    assert.match(recipesView, /linkedChangeSummary/);
    assert.match(recipesView, /hasLinkedChangeWarning/);
    assert.match(recipeBasicSection, /<details/);
    assert.match(recipesView, /linkedChangeAnnotations/);
    assert.match(recipesView, /泵壳整体成本/);
    assert.match(recipesView, /不锈钢长螺丝/);
    assert.match(recipesView, /关联电容/);
    assert.match(recipeDynamicConfigSection, /浮球线径/);
    assert.match(recipeDynamicConfigSection, /电缆线径/);
    assert.match(recipeDynamicConfigSection, /wireLinkNote/);
    assert.match(modelVariantPanel, /机筒 \/ 长螺丝/);
    assert.doesNotMatch(recipesView, /bomDraft\.parts\.slice\(0,\s*12\)/);
    assert.doesNotMatch(templateMatchSummary, /getSubtotal/);
    assert.doesNotMatch(templateMatchSummary, /getSourceLabel/);
    assert.match(recipesView, /onOpenTemplateParts=\{\(\) => setTemplateMatchDialogOpen\(true\)\}/);
    assert.match(recipeBasicSection, /onOpenAll=\{onOpenTemplateParts\}/);
    assert.match(recipesView, /buildRecipeSavePayloadDraft/);
    assert.match(recipesView, /assemblyWage:\s*String\(recipeDraft\.assemblyWage/);
    assert.match(recipesLib, /createModelVariant/);
    assert.match(recipesLib, /updateModelVariant/);
    assert.match(recipesLib, /deleteModelVariant/);
    assert.match(recipesLib, /model-variant-create/);
    assert.match(recipesLib, /model-variant-update:/);
    assert.match(recipesLib, /model-variant-delete:/);
    assert.match(recipesLib, /expectedUpdatedAt:\s*variant\.updatedAt/);
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
    const recipeWorkspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');
    const costSummary = readUtf8('apps/web-next/components/recipe/CostSummaryPanel.tsx');
    const recipeSection = readUtf8('apps/web-next/components/recipe/RecipeSection.tsx');
    const recipeLaborCostSection = readUtf8('apps/web-next/components/recipe/RecipeLaborCostSection.tsx');
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');

    assert.match(recipesView, /<RecipeWorkspace/);
    assert.match(recipeWorkspace, /成本（当日 \/ 保存）/);
    assert.match(recipeWorkspace, /成本状态正常/);
    assert.match(recipeWorkspace, /className="flex items-baseline justify-end gap-2"/);
    assert.match(recipeWorkspace, /className="h-7"/);
    assert.match(recipeWorkspace, /px-4 py-2/);
    assert.match(recipeLaborCostSection, /defaultOpen=\{false\}/);
    assert.doesNotMatch(recipesView, />Recipes</);
    assert.doesNotMatch(recipeWorkspace, /variant="danger" aria-label=\{`删除\$\{row\.recipe/);
    assert.match(costSummary, /pendingHints = Array\.from\(new Set/);
    assert.match(costSummary, /查看模块状态/);
    assert.doesNotMatch(costSummary, /成本完整性提示/);
    assert.match(recipeSection, /aria-expanded=\{open\}/);
    assert.match(recipesView, /button\[aria-expanded\]/);
    assert.match(recipesView, /requestAnimationFrame/);
    assert.match(slideOver, /<Drawer/);
    assert.doesNotMatch(slideOver, /lg:left-56|min-\[1600px\]:right|min-\[1920px\]:right/);
    assert.doesNotMatch(slideOver, /\sp-4 xl:right-\[500px\]/);
    assert.match(slideOver, /from '@\/components\/ui\/dialog'/);
});

test('Next UI 契约：配方工作区独立管理列表派生和筛选展示', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeWorkspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');

    assert.match(recipesView, /<RecipeWorkspace/);
    assert.match(recipesView, /onView=\{openRecipeDetail\}/);
    assert.match(recipesView, /onEdit=\{openEditDrawer\}/);
    assert.match(recipesView, /onClone=\{openCloneRecipe\}/);
    assert.match(recipesView, /onRemove=\{\(recipe\) => setDeleteTarget\(\{ kind: 'recipe', item: recipe \}\)\}/);
    assert.doesNotMatch(recipesView, /const recipeRows = useMemo/);
    assert.doesNotMatch(recipesView, /const filteredRows = useMemo/);
    assert.doesNotMatch(recipesView, /const stats = useMemo/);
    assert.match(recipeWorkspace, /const recipeRows = useMemo/);
    assert.match(recipeWorkspace, /const filteredRows = useMemo/);
    assert.match(recipeWorkspace, /const stats = useMemo/);
    assert.match(recipeWorkspace, /buildRecipeCopperRisk/);
    assert.match(recipeWorkspace, /recipePartsOverview/);
    assert.match(recipeWorkspace, /ariaLabel="配方快速筛选"/);
    assert.match(recipeWorkspace, /className="max-w-full overflow-x-auto"/);
    assert.match(recipeWorkspace, /onToggleCompare\(row\.recipe\.id\)/);
    assert.doesNotMatch(recipeWorkspace, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：不完整当日成本不得显示为正常金额', () => {
    const workspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');
    const detail = readUtf8('apps/web-next/components/recipe/RecipeDetailPanel.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');

    assert.match(workspace, /当日成本不完整/);
    assert.match(workspace, /incompleteCost/);
    assert.match(workspace, /row\.currentCost\?\.costComplete === false/);
    assert.match(detail, /当日成本未生成完整金额/);
    assert.match(detail, /currentSummary\?\.costComplete === false/);
    assert.match(recipesLib, /currentTotalCost: number \| null/);
    assert.match(recipesLib, /costComplete: boolean/);
});

test('Next UI 契约：配方详情独立展示成本、BOM、技术参数和库存', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeDetailPanel = readUtf8('apps/web-next/components/recipe/RecipeDetailPanel.tsx');

    assert.match(recipesView, /<RecipeDetailPanel/);
    assert.match(recipesView, /onRefreshInventory=\{refreshInventoryStatus\}/);
    assert.match(recipesView, /getRecipeCurrentCost\(detailRecipe\.id\)/);
    assert.match(recipesView, /getRecipeInventoryStatus\(recipe\.id\)/);
    assert.doesNotMatch(recipesView, /const detailParts = useMemo/);
    assert.doesNotMatch(recipesView, /const detailTechnicalEntries = useMemo/);
    assert.doesNotMatch(recipesView, /const detailPartCompareRows = useMemo/);
    assert.match(recipeDetailPanel, /parseRecipePartsJson\(recipe\.partsJson\)/);
    assert.match(recipeDetailPanel, /parseTechnicalDataJson\(recipe\.technicalDataJson\)/);
    assert.match(recipeDetailPanel, /getTechnicalDataEntries\(technicalData\)/);
    assert.match(recipeDetailPanel, /representedKeys\.add\('pieceCount'\)/);
    assert.match(recipeDetailPanel, /representedKeys\.add\('impellerDepth'\)/);
    assert.match(recipeDetailPanel, /const partCompareRows = useMemo/);
    assert.match(recipeDetailPanel, /part\.barrelLength/);
    assert.match(recipeDetailPanel, /未记录，请在编辑配方中补录/);
    assert.match(recipeDetailPanel, /const bomSummary = useMemo/);
    assert.match(recipeDetailPanel, /快照配件合计/);
    assert.match(recipeDetailPanel, /当前配件合计/);
    assert.match(recipeDetailPanel, /<tfoot/);
    assert.match(recipeDetailPanel, /BOM 快照/);
    assert.match(recipeDetailPanel, /配件与线圈库存/);
    assert.doesNotMatch(recipeDetailPanel, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：配方对比独立派生基础信息和 BOM 差异', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipeComparePanel = readUtf8('apps/web-next/components/recipe/RecipeComparePanel.tsx');

    assert.match(recipesView, /<RecipeComparePanel/);
    assert.match(recipesView, /compareIds=\{compareIds\}/);
    assert.match(recipesView, /onClose=\{\(\) => setCompareOpen\(false\)\}/);
    assert.doesNotMatch(recipesView, /function buildComparePartRows/);
    assert.doesNotMatch(recipesView, /const compareRecipes = useMemo/);
    assert.doesNotMatch(recipesView, /const comparePartRows = useMemo/);
    assert.match(recipeComparePanel, /function buildComparePartRows/);
    assert.match(recipeComparePanel, /const compareRecipes = useMemo/);
    assert.match(recipeComparePanel, /const comparePartRows = useMemo/);
    assert.match(recipeComparePanel, /BOM 差异/);
    assert.match(recipeComparePanel, /comparePartDifference/);
    assert.doesNotMatch(recipeComparePanel, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：历史型号兼容工作区独立管理筛选、草稿和线圈联动', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const variantPanel = readUtf8('apps/web-next/components/recipe/ModelVariantCompatibilityPanel.tsx');
    const coilSelection = readUtf8('apps/web-next/components/recipe/coil-selection.ts');

    assert.match(recipesView, /<ModelVariantCompatibilityPanel/);
    assert.match(recipesView, /visible=\{activeSection === 'variants'\}/);
    assert.match(recipesView, /editorTarget=\{variantEditorTarget\}/);
    assert.match(recipesView, /onSubmit=\{submitVariant\}/);
    assert.match(recipesView, /await (?:createModelVariant|updateModelVariant)/);
    assert.match(recipesView, /await load\(true\)/);
    assert.doesNotMatch(recipesView, /variantDrawerOpen|variantQuery|variantTemplateFilter/);
    assert.doesNotMatch(recipesView, /function parseVariantCustomFields|function variantFormToInput/);
    assert.match(variantPanel, /const filteredVariants = useMemo/);
    assert.match(variantPanel, /function variantFormToInput/);
    assert.match(variantPanel, /function addCustomField/);
    assert.match(variantPanel, /resolveCoilVariantSelection/);
    assert.match(variantPanel, /<SlideOver open=\{Boolean\(editorTarget\)\}/);
    assert.match(coilSelection, /export function resolveCoilVariantSelection/);
    assert.match(recipesView, /from '@\/components\/recipe\/coil-selection'/);
    assert.doesNotMatch(variantPanel, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：泵壳模板工作区独立派生列表成本并展示详情', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const templateWorkspace = readUtf8('apps/web-next/components/recipe/PumpShellTemplateWorkspace.tsx');

    assert.match(recipesView, /<PumpShellTemplateWorkspace/);
    assert.match(recipesView, /visible=\{activeSection === 'templates'\}/);
    assert.match(recipesView, /parts=\{parts\}/);
    assert.match(recipesView, /onEdit=\{openEditTemplate\}/);
    assert.match(recipesView, /onReuse=\{openReuseTemplate\}/);
    assert.match(recipesView, /onRemove=\{\(template\) => setDeleteTarget\(\{ kind: 'template', item: template \}\)\}/);
    assert.doesNotMatch(recipesView, /const templateRows = useMemo/);
    assert.doesNotMatch(recipesView, /templateDetail|setTemplateDetail/);
    assert.match(templateWorkspace, /const rows = useMemo/);
    assert.match(templateWorkspace, /Number\(catalogPart\?\.price \|\| 0\) > 0/);
    assert.match(templateWorkspace, /Number\(component\.unitCost \|\| 0\)/);
    assert.match(templateWorkspace, /<SlideOver open=\{Boolean\(detail\)\}/);
    assert.match(templateWorkspace, /onReuse\(row\.template\)/);
    assert.match(templateWorkspace, /复用模板/);
    assert.match(templateWorkspace, /固定配件/);
    assert.match(templateWorkspace, /泵壳计价/);
    assert.match(templateWorkspace, /供应商小套件/);
    assert.doesNotMatch(templateWorkspace, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：配方智能检查面板独立管理复核展示和反馈草稿', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const analysisPanel = readUtf8('apps/web-next/components/recipe/RecipeAnalysisPanel.tsx');

    assert.match(recipesView, /<RecipeAnalysisPanel/);
    assert.match(recipesView, /onSaveFeedback=\{saveAnalysisFeedback\}/);
    assert.match(recipesView, /await saveRecipeAnalysisFeedback\(editingRecipe\.id/);
    assert.match(recipesView, /await runRecipeAnalysis\(\{ preserveSaveGate: analysisSaveGateOpen \}\)/);
    assert.match(recipesView, /void saveRecipe\(\{ skipIntelligenceCheck: true \}\)/);
    assert.doesNotMatch(recipesView, /analysisFeedbackDraft|feedbackActions|reviewTargetFinding/);
    assert.match(analysisPanel, /const \[feedbackDraft, setFeedbackDraft\] = useState/);
    assert.match(analysisPanel, /const reviewTargetFinding = useMemo/);
    assert.match(analysisPanel, /data-review-target/);
    assert.match(analysisPanel, /待复核进度/);
    assert.match(analysisPanel, /规则学习已按本次判断刷新/);
    assert.match(analysisPanel, /ariaLabelledBy="analysis-feedback-title"/);
    assert.match(analysisPanel, /onSaveFeedback\(/);
    assert.doesNotMatch(analysisPanel, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：泵壳模板表单转换独立管理默认值、回填和提交序列化', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const templateForm = readUtf8('apps/web-next/components/recipe/pump-shell-template-form.ts');

    assert.match(recipesView, /from '@\/components\/recipe\/pump-shell-template-form'/);
    assert.match(recipesView, /setTemplateForm\(emptyTemplateForm\(\)\)/);
    assert.match(recipesView, /setTemplateForm\(templateFormFromTemplate\(template\)\)/);
    assert.match(recipesView, /setTemplateForm\(templateFormForReuse\(template, templates\)\)/);
    assert.match(recipesView, /const input = templateFormToInput\(templateForm\)/);
    assert.match(recipesView, /await (?:createTemplate|updateTemplate)/);
    assert.match(recipesView, /await load\(true\)/);
    assert.doesNotMatch(recipesView, /function defaultTemplateParts|function defaultShellComponents/);
    assert.doesNotMatch(recipesView, /function templateFormFromTemplate|function templateFormToInput/);
    assert.match(templateForm, /export function emptyTemplateForm/);
    assert.match(templateForm, /export function templateFormFromTemplate/);
    assert.match(templateForm, /export function templateFormForReuse/);
    assert.match(templateForm, /template\.costMode === 'bundle'/);
    assert.match(templateForm, /nextReusableTemplateName/);
    assert.match(templateForm, /export function templateFormToInput/);
    assert.match(templateForm, /partsJson: JSON\.stringify\(partsPayload\)/);
    assert.match(templateForm, /shellComponentsJson: JSON\.stringify\(componentsPayload\)/);
    assert.match(templateForm, /rotorParamsJson: JSON\.stringify\(rotorParamsPayload\)/);
    assert.match(templateForm, /form\.surfaceTreatmentMode === 'none'/);
    assert.doesNotMatch(templateForm, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：AI 工作台弹层独立展示且写入状态仍由专属状态层编排', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const dialogs = readUtf8('apps/web-next/components/ai/AiWorkspaceDialogs.tsx');
    const dialogPrimitive = readUtf8('apps/web-next/components/ui/dialog.tsx');
    const conversationHistory = readUtf8('apps/web-next/components/ai/useAiConversationHistory.ts');
    const attachmentArchive = readUtf8('apps/web-next/components/ai/AiAttachmentArchiveController.tsx');
    const answerFeedback = readUtf8('apps/web-next/components/ai/useAiAnswerFeedback.ts');

    assert.match(aiView, /from '@\/components\/ai\/AiWorkspaceDialogs'/);
    assert.match(aiView, /<AiAttachmentArchiveController/);
    assert.match(aiView, /<AnswerFeedbackDialog/);
    assert.match(aiView, /<DeleteConversationDialog/);
    assert.match(aiView, /<KnowledgeSyncDialog/);
    assert.match(aiView, /<SystemPromptDialog/);
    assert.match(attachmentArchive, /await archiveFactoryFile\(/);
    assert.match(answerFeedback, /await submitAiAnswerFeedback\(/);
    assert.match(conversationHistory, /await deleteAiConversation\(/);
    assert.match(aiView, /await syncFactoryKnowledge\(/);
    assert.match(aiView, /await updateAiSystemPrompt\(/);
    assert.doesNotMatch(aiView, /aria-labelledby="file-archive-title"/);
    assert.doesNotMatch(aiView, /aria-labelledby="answer-feedback-title"/);
    assert.doesNotMatch(aiView, /aria-labelledby="knowledge-sync-title"/);
    assert.doesNotMatch(aiView, /aria-labelledby="ai-prompt-title"/);
    assert.match(dialogs, /export function AttachmentArchiveDialog/);
    assert.match(dialogs, /export function AnswerFeedbackDialog/);
    assert.match(dialogs, /export function DeleteConversationDialog/);
    assert.match(dialogs, /export function KnowledgeSyncDialog/);
    assert.match(dialogs, /export function SystemPromptDialog/);
    assert.match(dialogs, /from '@\/components\/ui\/dialog'/);
    assert.match(dialogPrimitive, /role="dialog"/);
    assert.match(dialogPrimitive, /openDialogStack/);
    assert.doesNotMatch(dialogs, /archiveFactoryFile|submitAiAnswerFeedback|deleteAiConversation|syncFactoryKnowledge|updateAiSystemPrompt/);
    assert.doesNotMatch(dialogs, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：AI 回答依据、确认卡片和业务结果按职责拆分', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const answerProcess = readUtf8('apps/web-next/components/ai/AiAnswerProcess.tsx');
    const businessResult = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const workflowResults = readUtf8('apps/web-next/components/ai/AiWorkflowResults.tsx');
    const primitives = readUtf8('apps/web-next/components/ai/AiResultPrimitives.tsx');

    assert.match(aiView, /<AiMessageList/);
    assert.match(messageList, /from '@\/components\/ai\/AiAnswerProcess'/);
    assert.match(messageList, /<AnswerProcess/);
    assert.match(aiView, /useAiMessageStream/);
    assert.doesNotMatch(aiView, /function ToolResultCard|function BusinessResult|function AnswerEvidence/);
    assert.match(answerProcess, /export function AnswerProcess/);
    assert.match(answerProcess, /function ToolResultCard/);
    assert.match(answerProcess, /confirmAiTool\(confirmation\.confirmationToken\)/);
    assert.match(answerProcess, /isConfirmationResult\(result\)/);
    assert.match(answerProcess, /readOnly \? undefined : onSendPrompt/);
    assert.match(businessResult, /export function BusinessResult/);
    assert.match(businessResult, /FactoryExecutionPlanResult/);
    assert.match(workflowResults, /export function FactoryExecutionPlanResult/);
    assert.match(workflowResults, /buildFactoryWorkflowShortcutPrompt/);
    assert.match(primitives, /export function DataTable/);
    assert.match(primitives, /export function attachmentParserText/);
    assert.doesNotMatch(answerProcess, /fetch\(/);
    assert.doesNotMatch(businessResult, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(workflowResults, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(primitives, /proxyRequest|proxyFetch|fetch\(/);
});

test('Next UI 契约：AI 会话侧栏、历史状态和流式消息状态按职责拆分', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const sidebars = readUtf8('apps/web-next/components/ai/AiConversationSidebars.tsx');
    const conversationHistory = readUtf8('apps/web-next/components/ai/useAiConversationHistory.ts');
    const messageStream = readUtf8('apps/web-next/components/ai/useAiMessageStream.ts');

    assert.match(aiView, /<AiDesktopSidebar/);
    assert.match(aiView, /<AiMobileConversationDrawer/);
    assert.match(aiView, /useAiConversationHistory\(loading\)/);
    assert.match(aiView, /useAiMessageStream\(\)/);
    assert.match(sidebars, /function ConversationList/);
    assert.match(sidebars, /aria-label="搜索会话"/);
    assert.match(sidebars, /export const aiStarterSamples/);
    assert.match(conversationHistory, /listAiConversations\(\)/);
    assert.match(conversationHistory, /getAiConversation\(id\)/);
    assert.match(conversationHistory, /deleteAiConversation\(id\)/);
    assert.match(messageStream, /export function applyAiStreamEvent/);
    assert.match(messageStream, /const abortRef = useRef<AbortController/);
    assert.doesNotMatch(sidebars, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(conversationHistory, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(messageStream, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(aiView, /function applyAiStreamEvent|function ConversationList/);
});

test('Next UI 契约：AI 附件上传、展示和归档编排按职责拆分', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const attachments = readUtf8('apps/web-next/components/ai/useAiAttachments.ts');
    const displays = readUtf8('apps/web-next/components/ai/AiAttachmentDisplays.tsx');
    const archiveController = readUtf8('apps/web-next/components/ai/AiAttachmentArchiveController.tsx');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');

    assert.match(aiView, /useAiAttachments\(initialAttachmentId\)/);
    assert.match(messageList, /<AiMessageAttachments/);
    assert.match(composer, /<AiPendingAttachmentStrip/);
    assert.match(aiView, /<AiAttachmentArchiveController/);
    assert.match(attachments, /uploadFactoryFile\(file\)/);
    assert.match(attachments, /transientAttachmentIdsRef/);
    assert.match(attachments, /markAttachmentsPersisted/);
    assert.match(attachments, /discardAllPendingAttachments/);
    assert.match(displays, /export function AiMessageAttachments/);
    assert.match(displays, /export function AiPendingAttachmentStrip/);
    assert.match(archiveController, /searchFactoryFileArchiveTargets/);
    assert.match(archiveController, /archiveFactoryFile\(attachment\.id/);
    assert.doesNotMatch(displays, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(aiView, /uploadFactoryFile|function openArchiveDialog|function saveFileArchive/);
});

test('Next UI 契约：AI 消息、输入、语音和反馈状态按职责拆分', () => {
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');
    const speech = readUtf8('apps/web-next/components/ai/useAiSpeechInput.ts');
    const feedback = readUtf8('apps/web-next/components/ai/useAiAnswerFeedback.ts');

    assert.match(aiView, /<AiMessageList/);
    assert.match(aiView, /<AiComposer/);
    assert.match(aiView, /useAiSpeechInput\(input, setInput\)/);
    assert.match(aiView, /useAiAnswerFeedback\(setHistoryError\)/);
    assert.match(messageList, /<StreamingText/);
    assert.match(messageList, /这条回答是否可靠/);
    assert.match(composer, /ai-mobile-composer/);
    assert.match(composer, /AI 页面上下文/);
    assert.match(speech, /webkitSpeechRecognition/);
    assert.match(speech, /recognition\.abort\(\)/);
    assert.match(feedback, /submitAiAnswerFeedback/);
    assert.doesNotMatch(messageList, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(composer, /proxyRequest|proxyFetch|fetch\(/);
    assert.doesNotMatch(aiView, /function toggleVoiceInput|function markAnswerHelpful|<StreamingText/);
});

test('Next UI 契约：泵壳模板分离套件引用和自由组合组件', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const templateEditor = readUtf8('apps/web-next/components/recipe/PumpShellTemplateEditor.tsx');
    const shellCostEditor = readUtf8('apps/web-next/components/recipe/ShellCostEditor.tsx');
    const templateForm = readUtf8('apps/web-next/components/recipe/pump-shell-template-form.ts');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const partFormRules = readUtf8('apps/web-next/lib/part-form-rules.ts');
    const templatePartCategory = readUtf8('apps/web-next/lib/template-part-category.ts');
    const templateCommands = readUtf8('api/services/templateCommands.cjs');
    const schema = readUtf8('api/database/schema.cjs');

    assert.match(recipesView, /part\.category === '泵壳'/);
    assert.match(recipesView, /<PumpShellTemplateEditor/);
    assert.match(templateEditor, /零件库泵壳型号/);
    assert.match(templateEditor, /组合模板名称/);
    assert.match(templateEditor, /list="shell-template-model-options"/);
    assert.match(templateEditor, /可直接输入新的组合名称，也可展开选择零件库中的泵壳型号/);
    assert.match(templateEditor, /<ShellCostEditor/);
    assert.match(shellCostEditor, /componentType/);
    assert.match(partFormRules, /泵壳搭配/);
    assert.match(recipesView, /part\.category === SHELL_COMPONENT_CATEGORY/);
    assert.match(shellCostEditor, /barrelComponentNameOptions = \['铝机筒', STAINLESS_STRETCH_BARREL_NAME, '铁机筒'\]/);
    assert.match(shellCostEditor, /不锈钢拉伸筒/);
    assert.match(shellCostEditor, /aria-label="机筒类型"/);
    assert.match(shellCostEditor, /modelOptions\.map/);
    assert.match(shellCostEditor, /id="shell-component-model-options"/);
    assert.match(shellCostEditor, /输入或检索零件型号/);
    assert.match(shellCostEditor, /输入或检索供应商/);
    assert.match(shellCostEditor, /存入零件库/);
    assert.match(shellCostEditor, /findCatalogPart/);
    assert.match(recipesView, /createShellComponentPart/);
    assert.match(recipesView, /category:\s*SHELL_COMPONENT_CATEGORY/);
    assert.match(recipesView, /stock:\s*0/);
    assert.match(recipesView, /const beforeCreate = await readPartsFresh\(\)/);
    assert.match(recipesView, /const afterCreate = await readPartsFresh\(\)/);
    assert.match(recipesView, /window\.addEventListener\('focus', refreshWhenVisible\)/);
    assert.match(recipesView, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/);
    assert.doesNotMatch(shellCostEditor, /checked=\{Boolean\(row\.isStainlessStretchBarrel\)\}/);
    assert.match(shellCostEditor, /supplier/);
    assert.doesNotMatch(recipesView, /function addSubassemblyContentRow/);
    assert.doesNotMatch(recipesView, /function updateComponentRow/);
    assert.doesNotMatch(recipesView, /function selectTemplateShell/);
    assert.match(templateEditor, /function selectShell/);
    assert.match(shellCostEditor, /泵壳套件/);
    assert.match(shellCostEditor, /自由搭配/);
    assert.match(shellCostEditor, /2\. 搭建泵壳/);
    assert.match(shellCostEditor, /从第一个采购项开始搭建/);
    assert.match(shellCostEditor, /添加小套件/);
    assert.match(shellCostEditor, /添加单件/);
    assert.match(shellCostEditor, /aria-expanded=\{expandedRowId === row\.id\}/);
    assert.match(shellCostEditor, /完成此项/);
    assert.match(templateForm, /componentRows: \[\]/);
    assert.doesNotMatch(templateForm, /function defaultShellComponents/);
    assert.match(shellCostEditor, /包含组件/);
    assert.match(shellCostEditor, /不单独计价或扣库存/);
    assert.match(templateEditor, /role="radiogroup" aria-label="泵壳计价方式"/);
    assert.match(templateEditor, /form\.costMode === 'bundle'/);
    assert.match(templateEditor, /bundleNote=\{form\.bundleNote\}/);
    assert.match(shellCostEditor, /填写套件计价或配置说明/);
    assert.match(templateEditor, /电泳\+喷塑/);
    assert.match(templateEditor, /整体喷塑/);
    assert.match(templateEditor, /表面处理费用/);
    assert.match(templateEditor, /form\.surfaceTreatmentCost/);
    assert.match(templateEditor, /templatePartCatalogForName/);
    assert.match(templateEditor, /templatePartCategoryForName/);
    assert.match(templateEditor, /template-part-model-options-\$\{row\.id\}/);
    assert.match(templateEditor, /型号候选会根据配件名称自动限定分类/);
    assert.match(templatePartCategory, /category: '轴承', keywords: \['轴承'\]/);
    assert.match(templatePartCategory, /category: '油封'/);
    assert.match(templatePartCategory, /category: '螺丝'/);
    assert.match(templatePartCategory, /part\.category !== '包装'/);
    assert.doesNotMatch(recipesView, /喷漆工资/);
    assert.match(recipesLib, /electrophoresis_powder_coating/);
    assert.match(templateCommands, /surfaceTreatmentMode:\s*'surface_treatment_mode'/);
    assert.match(templateCommands, /validateShellComponents/);
    assert.match(templateCommands, /category = \? AND deleted_at IS NULL/);
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
    const orderDetail = readUtf8('apps/web-next/components/order-detail-drawer.tsx');
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
    assert.match(purchaseView, /搜索供应商、型号、名称或来源订单/);
    assert.match(purchaseView, />采购来源</);
    assert.match(purchaseView, /purchaseSourceOrders\(task\)/);
    assert.match(purchaseView, /\/orders\?orderId=\$\{encodeURIComponent\(order\.id\)\}&view=purchase/);
    assert.match(purchaseView, /rounded-full/);
    assert.match(purchaseView, /order\.contractNo \|\| `#\$\{order\.id\}`/);
    assert.match(orderDetail, /实际采购单价/);
    assert.match(orderDetail, /purchasePriceDraftValue/);
    assert.match(orderDetail, /参考 \$\{referenceSource\} ¥/);
    assert.match(orderDetail, /coil_total_cost'\) return '线圈页总成本'/);
    assert.match(orderDetail, /<td className="px-1\.5 py-2 align-top">\s*<input\s*value=\{draft\?\.actualSupplier/);
    assert.match(orderDetail, /<td className="px-3 py-2 text-right align-top">\s*<Button\s*size="sm"/);
    assert.match(orderDetail, /无参考价/);
    assert.match(quotationsView, /searchLabel="搜索报价单"/);
    assert.match(customersView, /searchLabel="搜索客户"/);
    assert.doesNotMatch(customersView, />\s*新建\s*<\/Button>\s*<\/div>\s*<div className="border-b border-line p-4">/);
});

test('Next UI 契约：P0 工作区响应式、长列表分页和辅助历史抽屉', () => {
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const customersView = readUtf8('apps/web-next/components/customers-view.tsx');
    const knowledgeView = readUtf8('apps/web-next/components/knowledge-view.tsx');
    const knowledgeDialogs = readUtf8('apps/web-next/components/knowledge/KnowledgeDialogs.tsx');
    const knowledgeModel = readUtf8('apps/web-next/components/knowledge/knowledge-view-model.ts');
    const rotorView = readUtf8('apps/web-next/components/rotor-view.tsx');
    const analysisPanel = readUtf8('apps/web-next/components/recipe/RecipeAnalysisPanel.tsx');
    const dialog = readUtf8('apps/web-next/components/ui/dialog.tsx');
    const guidelines = readUtf8('docs/ui-refactor-guidelines.md');

    assert.match(quotationsView, /min-\[1280px\]:hidden/);
    assert.match(quotationsView, /min-w-\[920px\]/);
    assert.match(customersView, /min-\[1440px\]:grid-cols-\[360px_minmax\(0,1fr\)\]/);
    assert.match(customersView, /md:hidden/);
    assert.match(knowledgeModel, /const KNOWLEDGE_PAGE_SIZE = 30/);
    assert.match(knowledgeView, /KNOWLEDGE_WORKSPACES/);
    assert.match(knowledgeView, /pagedDisplayItems\.map/);
    assert.match(knowledgeView, /第 \{safeEntryPage\}\/\{entryPageCount\} 页/);
    assert.match(rotorView, /historyOpen/);
    assert.match(rotorView, /ariaLabel="出图历史"/);
    assert.match(rotorView, /<Drawer/);
    assert.match(rotorView, /<Dialog/);
    assert.match(knowledgeDialogs, /import \{ Dialog, Drawer \}/);
    assert.match(knowledgeDialogs, /<Drawer/);
    assert.match(analysisPanel, /from '@\/components\/ui\/dialog'/);
    assert.doesNotMatch(knowledgeView, /fixed inset-0/);
    assert.doesNotMatch(rotorView, /fixed inset-0/);
    assert.doesNotMatch(analysisPanel, /fixed inset-0/);
    assert.match(dialog, /document\.body\.style\.overflow = 'hidden'/);
    assert.doesNotMatch(rotorView, /max-h-\[680px\]/);
    assert.match(guidelines, /有效内容宽度/);
    assert.match(guidelines, /一个纵向滚动容器/);
});

test('Next UI 契约：P1 配方窄屏首屏和质量问题聚焦保持紧凑', () => {
    const recipeWorkspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');
    const qualityView = readUtf8('apps/web-next/components/quality-view.tsx');
    const guidelines = readUtf8('docs/ui-refactor-guidelines.md');

    assert.match(recipeWorkspace, /sm:hidden/);
    assert.match(recipeWorkspace, /min-\[1180px\]:hidden/);
    assert.match(recipeWorkspace, /hidden overflow-x-auto min-\[1180px\]:block/);
    assert.match(recipeWorkspace, /min-w-\[1020px\]/);
    assert.match(recipeWorkspace, /保存成本 \{money\(stats\.totalSavedCost\)\}/);
    assert.match(qualityView, /const itemLimit = activeKey === 'all' \? 4 : 12/);
    assert.match(qualityView, /focusIssueGroup/);
    assert.match(qualityView, /查看此类问题/);
    assert.match(qualityView, /全部模式每类展示前 4 项/);
    assert.match(guidelines, /多张桌面指标卡应合并为一条紧凑摘要/);
    assert.match(guidelines, /单类别聚焦入口/);
});

test('Next UI 契约：P2 系统设置按任务分区并保护未保存修改', () => {
    const setupView = readUtf8('apps/web-next/components/setup-view.tsx');
    const guidelines = readUtf8('docs/ui-refactor-guidelines.md');

    assert.match(setupView, /type SetupSection = 'ai' \| 'knowledge' \| 'deployment'/);
    assert.match(setupView, /ariaLabel="设置工作区"/);
    assert.match(setupView, /section === 'ai'/);
    assert.match(setupView, /section === 'knowledge'/);
    assert.match(setupView, /section === 'deployment'/);
    assert.match(setupView, /JSON\.stringify\(form\) !== JSON\.stringify\(formFromSnapshot\(snapshot\)\)/);
    assert.match(setupView, /window\.addEventListener\('beforeunload', protectUnsavedSettings\)/);
    assert.match(setupView, /放弃未保存的系统设置/);
    assert.match(setupView, /disabled=\{loading \|\| saving \|\| !isDirty\}/);
    assert.match(setupView, /有未保存修改/);
    assert.match(guidelines, /共享同一份草稿和统一保存动作/);
    assert.match(guidelines, /刷新或关闭页面前阻止静默丢弃/);
});
