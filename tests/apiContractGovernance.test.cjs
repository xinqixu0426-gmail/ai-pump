const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routeDeclarations(source) {
    const matches = [...source.matchAll(
        /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
    )];
    return matches.map((match, index) => {
        const routeSource = source.slice(
            match.index,
            matches[index + 1]?.index ?? source.length
        );
        return {
            method: match[1].toUpperCase(),
            path: match[2],
            queryParams: [...new Set(
                [...routeSource.matchAll(/req\.query(?:\?\.)?\.([A-Za-z][A-Za-z0-9]*)/g)]
                    .map((queryMatch) => queryMatch[1])
            )],
        };
    });
}

function collectReferenceEndpoints(reference) {
    return [...reference.matchAll(
        /^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`([^`]+)`\s*\|([^\n]*)$/gm
    )].map((match) => ({
        method: match[1],
        path: match[2].split('?')[0],
        row: match[0],
    }));
}

function joinMountedPath(prefix, routePath) {
    if (routePath === '/') return prefix;
    return `${prefix}${routePath}`;
}

function collectHttpEndpoints() {
    const routeDir = path.join(repoRoot, 'api/routes');
    const mountPrefixes = {
        'auth.cjs': '/api/auth',
        'health.cjs': '/api/health',
        'cost.cjs': '/api',
        'parts.cjs': '/api/parts',
        'recipes.cjs': '/api/recipes',
        'templates.cjs': '/api/templates',
        'modelVariants.cjs': '/api/model-variants',
        'orders.cjs': '/api/orders',
        'coils.cjs': '/api/coils',
        'rotor.cjs': '/api/rotor',
        'settings.cjs': '/api/settings',
        'customers.cjs': '/api/customers',
        'quotations.cjs': '/api/quotations',
        'workbench.cjs': '/api/workbench',
        'quality.cjs': '/api/quality',
        'files.cjs': '/api/files',
        'knowledge.cjs': '/api/knowledge',
        'businessChanges.cjs': '/api/business-changes',
        'entityLookup.cjs': '/api/entity-lookup',
        'entitySpanCandidates.cjs': '/api/entity-span-candidates',
        'mcp.cjs': '/mcp',
    };
    const endpoints = [];

    for (const fileName of fs.readdirSync(routeDir).filter((name) => name.endsWith('.cjs'))) {
        const declarations = routeDeclarations(readUtf8(`api/routes/${fileName}`));
        if (declarations.length === 0) continue;
        assert.ok(
            mountPrefixes[fileName],
            `route file ${fileName} has HTTP endpoints but no documented mount prefix`
        );
        for (const endpoint of declarations) {
            endpoints.push({
                ...endpoint,
                path: joinMountedPath(mountPrefixes[fileName], endpoint.path),
                source: `api/routes/${fileName}`,
            });
        }
    }

    const aiRouteDir = path.join(routeDir, 'ai');
    for (const fileName of fs.readdirSync(aiRouteDir).filter((name) => name.endsWith('.cjs'))) {
        for (const endpoint of routeDeclarations(readUtf8(`api/routes/ai/${fileName}`))) {
            assert.match(
                endpoint.path,
                /^\//,
                `AI route ${fileName} must declare its absolute public path`
            );
            endpoints.push({
                ...endpoint,
                source: `api/routes/ai/${fileName}`,
            });
        }
    }

    // Separate opt-in executable, deliberately not mounted in legacy Express.
    const gateway = require('../api/services/ownerReadCanaryGateway.cjs');
    const gatewaySource = readUtf8('api/services/ownerReadCanaryGateway.cjs');
    assert.match(gatewaySource, /const ordinary = req\.url === '\/api\/ai\/chat'/);
    assert.match(gatewaySource, /req\.method !== 'POST' \|\| \(!ordinary && req\.url !== OWNER_CANARY_PATH\)/);
    assert.match(gatewaySource, /isAuthenticatedOwner\(verifyAuthentication\(cookies\.token, currentEnv\), currentEnv\)/);
    assert.match(gatewaySource, /AI_V5_OWNER_READ_DEFAULT_ENABLED === 'true'/);
    endpoints.push({ method: 'POST', path: gateway.OWNER_CANARY_PATH, queryParams: [],
        source: 'api/services/ownerReadCanaryGateway.cjs' });
    return endpoints;
}

test('API 治理契约：规则、流程和当前接口表职责分离且被项目入口引用', () => {
    const contract = readUtf8('docs/api-contract.md');
    const sop = readUtf8('docs/api-sop.md');
    const reference = readUtf8('docs/api-reference.md');
    const agents = readUtf8('AGENTS.md');
    const rootReadme = readUtf8('README.md');
    const docsReadme = readUtf8('docs/README.md');

    assert.match(contract, /规范等级：强制/);
    assert.match(sop, /\[API 统一契约\]\(\.\/api-contract\.md\)/);
    assert.match(reference, /\[API 统一契约\]\(\.\/api-contract\.md\)/);
    assert.match(agents, /docs\/api-contract\.md/);
    assert.match(agents, /这是项目默认工作流，无须用户在每次需求中重复提醒/);
    assert.match(agents, /能力登记、实现、文档和自动化契约测试任一缺失/);
    assert.match(rootReadme, /\[API 统一契约\]\(docs\/api-contract\.md\)/);
    assert.match(docsReadme, /\[API 统一契约\]\(\.\/api-contract\.md\)/);
    assert.doesNotMatch(sop, /当前 API 已完成主契约收口/);
    assert.match(sop, /本 SOP 是项目默认工作流/);
});

test('API 治理契约：默认校验命令必须存在并接入发布门禁', () => {
    const packageJson = JSON.parse(readUtf8('package.json'));

    assert.match(
        packageJson.scripts['verify:api-contract'],
        /apiContractGovernance\.test\.cjs/
    );
    assert.match(
        packageJson.scripts['verify:api-contract'],
        /aiCapabilityRegistry\.test\.cjs/
    );
    assert.match(
        packageJson.scripts['verify:release'],
        /npm run verify:api-contract/
    );
});

test('API 治理契约：能力必须声明读写、事实来源和完整写操作保护', () => {
    const contract = readUtf8('docs/api-contract.md');

    for (const marker of [
        'capabilityId',
        'displayName',
        'executorKey',
        'resultProvenance',
        'inputSchema',
        'outputSchema',
        'sourceOfTruth',
        'riskLevel',
        'requiresConfirmation',
        'supportsPreview',
        'idempotency',
        'concurrencyControl',
        'transactionality',
        'audit',
        'timeoutMs',
        'idempotencyKey',
        'expectedVersion',
        'expectedUpdatedAt',
        'confirmationToken',
        'operationId',
        'auditId',
        'idempotentReplay',
        'costEngine',
        'safeInsert',
        'safeUpdate',
        'proxyRequest',
        'WRITE_TOOLS',
    ]) {
        assert.match(
            contract,
            new RegExp(escapeRegex(marker)),
            `API contract must define ${marker}`
        );
    }

    assert.match(contract, /Query[\s\S]*不修改业务表、审计表、缓存表、知识索引、同步队列或文件/);
    assert.match(contract, /禁止藏在普通 GET 或页面加载过程中/);
    assert.match(contract, /知识库和 RAG[\s\S]*不能作为实时库存、价格、成本、报价金额或订单状态的最终来源/);
    assert.match(contract, /AI[\s\S]*不得直接生成 SQL/);
    assert.match(contract, /未声明 `access` 的能力按写操作处理，默认拒绝执行/);
});

test('API 当前契约：Express 路由与 api-reference 必须双向唯一对应', () => {
    const reference = readUtf8('docs/api-reference.md');
    const endpoints = collectHttpEndpoints();
    const referenceEndpoints = collectReferenceEndpoints(reference);
    const codeByKey = new Map();
    const referenceByKey = new Map();

    assert.ok(endpoints.length > 0, 'HTTP endpoint inventory must not be empty');
    assert.ok(referenceEndpoints.length > 0, 'API reference inventory must not be empty');

    for (const endpoint of endpoints) {
        const key = `${endpoint.method} ${endpoint.path}`;
        assert.equal(
            codeByKey.has(key),
            false,
            `duplicate HTTP endpoint declaration: ${key} (${endpoint.source})`
        );
        codeByKey.set(key, endpoint);
    }

    for (const endpoint of referenceEndpoints) {
        const key = `${endpoint.method} ${endpoint.path}`;
        assert.equal(
            referenceByKey.has(key),
            false,
            `duplicate API reference row: ${key}`
        );
        referenceByKey.set(key, endpoint);
    }

    assert.deepEqual(
        [...referenceByKey.keys()].sort(),
        [...codeByKey.keys()].sort(),
        'docs/api-reference.md and Express routes must contain the same Method + Path set'
    );

    assert.match(
        reference,
        new RegExp(`当前源码共有 ${endpoints.filter(e => e.source !== 'api/services/ownerReadCanaryGateway.cjs').length} 个 Express 路由声明`),
        'documented Express route count must match source'
    );

    for (const [key, endpoint] of codeByKey) {
        const referenceRow = referenceByKey.get(key).row;
        for (const queryParam of endpoint.queryParams) {
            assert.match(
                referenceRow,
                new RegExp(`\\b${escapeRegex(queryParam)}\\b`),
                `${key} from ${endpoint.source} is missing documented query parameter ${queryParam}`
            );
        }
    }
});

test('API 当前契约：文档中的 AI 与业务能力数量必须来自注册表', () => {
    const reference = readUtf8('docs/api-reference.md');
    const {
        AI_CAPABILITY_REGISTRY,
        BUSINESS_CAPABILITY_REGISTRY,
    } = require('../api/capabilities/registry.cjs');

    assert.match(
        reference,
        new RegExp(`${Object.keys(AI_CAPABILITY_REGISTRY).length} 个 AI 工具`),
        'documented AI tool count must match the capability registry'
    );
    assert.match(
        reference,
        new RegExp(`当前 ${Object.keys(BUSINESS_CAPABILITY_REGISTRY).length} 个已迁移正式业务`),
        'documented business capability count must match the capability registry'
    );
});
