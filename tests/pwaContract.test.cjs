const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('PWA 契约：manifest 指向真实 Next 移动助手入口', () => {
    const manifest = JSON.parse(readUtf8('public/manifest.json'));
    const nextManifest = JSON.parse(readUtf8('apps/web-next/public/manifest.json'));

    assert.equal(manifest.start_url, '/ai');
    assert.equal(nextManifest.start_url, '/ai');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.orientation, 'portrait');
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/icon-192.svg' && icon.sizes === '192x192'));
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/icon-512.svg' && icon.sizes === '512x512'));
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/apple-touch-icon.png' && icon.type === 'image/png'));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/icon-192.svg')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/icon-512.svg')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/apple-touch-icon.png')));
    assert.match(readUtf8('apps/web-next/app/voice/page.tsx'), /redirect\('\/ai'\)/);
    assert.doesNotMatch(readUtf8('apps/web-next/app/voice/page.tsx'), /BasicAiAssistant/);
});

test('PWA 契约：/ai 在移动端隐藏全局业务导航并接管完整视口', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const layout = readUtf8('apps/web-next/app/layout.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');

    assert.match(shell, /isAiWorkspace = pathname === '\/ai'/);
    assert.match(shell, /isAiWorkspace \? 'hidden md:block'/);
    assert.match(aiView, /h-\[100dvh\]/);
    assert.match(aiView, /ai-mobile-header/);
    assert.match(aiView, /ai-mobile-composer/);
    assert.match(aiView, /mobileSidebarOpen/);
    assert.match(aiView, /ai-mobile-drawer/);
    assert.match(layout, /manifest: '\/manifest\.json'/);
    assert.match(layout, /appleWebApp:\s*\{/);
    assert.match(layout, /viewportFit: 'cover'/);
});

test('AI 契约：桌面 AI 直连后端 SSE 并使用 Markdown 流式渲染', () => {
    const aiClient = readUtf8('apps/web-next/lib/ai.ts');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const promptKit = readUtf8('apps/web-next/components/prompt-kit/basic-chat.tsx');

    assert.match(aiClient, /resolveAiStreamUrl/);
    assert.match(aiClient, /:3002\/api\/ai\/chat/);
    assert.match(aiClient, /type: 'tool_plan'/);
    assert.match(aiClient, /AI_CONTEXT_MESSAGE_LIMIT = 10/);
    assert.match(aiClient, /messages\.slice\(-AI_CONTEXT_MESSAGE_LIMIT\)/);
    assert.match(aiClient, /getAiSystemPrompt/);
    assert.match(aiClient, /updateAiSystemPrompt/);
    assert.doesNotMatch(aiClient, /proxyFetch\('\/api\/ai\/chat'/);
    assert.match(aiView, /<StreamingText/);
    assert.match(aiView, /ToolPlanPanel/);
    assert.match(aiView, /SegmentedControl/);
    assert.match(aiView, /FadePanel/);
    assert.match(aiView, /activeSampleCategory/);
    assert.match(aiView, /编辑系统提示词/);
    assert.match(aiView, /openPromptEditor/);
    assert.match(aiView, /listAiConversations/);
    assert.match(aiView, /openConversation/);
    assert.match(aiView, /新建会话/);
    assert.match(aiView, /历史记录，仅供查看/);
    assert.match(aiView, /h-\[calc\(100vh-8rem\)\]/);
    assert.match(aiView, /ai-mobile-composer shrink-0 border-t border-line bg-white/);
    assert.match(promptKit, /function MarkdownContent/);
    assert.match(promptKit, /function renderInline/);
    assert.match(promptKit, /type: 'blockquote'/);
    assert.match(promptKit, /target="_blank"/);
    assert.ok(promptKit.includes('\\d+[\\.)]'));
    assert.match(promptKit, /ordered-list/);
    assert.match(promptKit, /type: 'table'/);
    assert.match(promptKit, /<table/);
    assert.match(readUtf8('api/routes/ai/chat.cjs'), /AI_RUNTIME_RESPONSE_RULES/);
    assert.match(readUtf8('api/routes/ai/chat.cjs'), /send\('tool_plan'/);
    assert.match(readUtf8('api/routes/ai/chat.cjs'), /最终面向用户的回复必须使用 Markdown/);
});
