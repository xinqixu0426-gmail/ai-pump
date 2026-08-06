const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('PWA 契约：manifest 指向真实 Next 移动助手入口', () => {
    const manifest = JSON.parse(readUtf8('apps/web-next/public/manifest.json'));

    assert.equal(manifest.start_url, '/ai');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.orientation, 'portrait');
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/icon-192.svg' && icon.sizes === '192x192'));
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/icon-512.svg' && icon.sizes === '512x512'));
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/apple-touch-icon.png' && icon.type === 'image/png'));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/icon-192.svg')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/icon-512.svg')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/apple-touch-icon.png')));
    assert.equal(fs.existsSync(path.join(repoRoot, 'public/manifest.json')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'apps/web-next/components/basic-ai-assistant.tsx')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'apps/web-next/lib/voice.ts')), false);
    assert.match(readUtf8('apps/web-next/app/voice/page.tsx'), /redirect\('\/ai'\)/);
    assert.doesNotMatch(readUtf8('apps/web-next/app/voice/page.tsx'), /BasicAiAssistant/);
});

test('PWA 契约：/ai 在移动端隐藏全局业务导航并接管完整视口', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const layout = readUtf8('apps/web-next/app/layout.tsx');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const sidebars = readUtf8('apps/web-next/components/ai/AiConversationSidebars.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');

    assert.match(shell, /isAiWorkspace = pathname === '\/ai'/);
    assert.match(shell, /isAiWorkspace \? 'hidden' : 'flex'/);
    assert.match(shell, /lg:hidden/);
    assert.match(aiView, /h-\[100dvh\]/);
    assert.match(aiView, /ai-mobile-header/);
    assert.match(composer, /ai-mobile-composer/);
    assert.match(aiView, /mobileSidebarOpen/);
    assert.match(sidebars, /ai-mobile-drawer/);
    assert.match(layout, /manifest: '\/manifest\.json'/);
    assert.match(layout, /appleWebApp:\s*\{/);
    assert.match(layout, /viewportFit: 'cover'/);
});

test('AI 契约：桌面 AI 直连后端 SSE 并使用 Markdown 流式渲染', () => {
    const aiClient = readUtf8('apps/web-next/lib/ai.ts');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const answerProcess = readUtf8('apps/web-next/components/ai/AiAnswerProcess.tsx');
    const dialogs = readUtf8('apps/web-next/components/ai/AiWorkspaceDialogs.tsx');
    const sidebars = readUtf8('apps/web-next/components/ai/AiConversationSidebars.tsx');
    const conversationHistory = readUtf8('apps/web-next/components/ai/useAiConversationHistory.ts');
    const messageList = readUtf8('apps/web-next/components/ai/AiMessageList.tsx');
    const composer = readUtf8('apps/web-next/components/ai/AiComposer.tsx');
    const promptKit = readUtf8('apps/web-next/components/prompt-kit/basic-chat.tsx');

    assert.match(aiClient, /resolveAiStreamUrl/);
    assert.match(aiClient, /:3002\/api\/ai\/chat/);
    assert.match(aiClient, /type: 'tool_plan'/);
    assert.match(aiClient, /AI_CONTEXT_MESSAGE_LIMIT = 10/);
    assert.match(aiClient, /messages\.slice\(-AI_CONTEXT_MESSAGE_LIMIT\)/);
    assert.match(aiClient, /getAiSystemPrompt/);
    assert.match(aiClient, /updateAiSystemPrompt/);
    assert.doesNotMatch(aiClient, /proxyFetch\('\/api\/ai\/chat'/);
    assert.match(messageList, /<StreamingText/);
    assert.match(answerProcess, /ToolPlanPanel/);
    assert.match(sidebars, /SegmentedControl/);
    assert.match(aiView, /FadePanel/);
    assert.match(aiView, /activeSampleCategory/);
    assert.match(sidebars, /编辑工厂配置/);
    assert.match(dialogs, /核心安全与业务规则由系统维护/);
    assert.match(aiView, /openPromptEditor/);
    assert.match(conversationHistory, /listAiConversations/);
    assert.match(aiView, /openConversation/);
    assert.match(aiView, /新建会话/);
    assert.match(answerProcess, /历史记录，仅供查看/);
    assert.match(aiView, /h-\[calc\(100vh-8rem\)\]/);
    assert.match(composer, /ai-mobile-composer shrink-0 border-t border-line bg-white/);
    assert.match(promptKit, /function MarkdownContent/);
    assert.match(promptKit, /import ReactMarkdown from 'react-markdown'/);
    assert.match(promptKit, /import remarkGfm from 'remark-gfm'/);
    assert.match(promptKit, /remarkPlugins=\{\[remarkGfm\]\}/);
    assert.match(promptKit, /skipHtml/);
    assert.match(promptKit, /urlTransform=\{safeHref\}/);
    assert.match(promptKit, /blockquote:/);
    assert.match(promptKit, /target="_blank"/);
    assert.match(promptKit, /table:/);
    assert.match(promptKit, /del:/);
    assert.match(promptKit, /input:/);
    assert.doesNotMatch(promptKit, /function parseMarkdown/);
    assert.match(readUtf8('api/routes/ai/chat.cjs'), /composeAiSystemPrompt/);
    assert.match(readUtf8('api/routes/ai/chat.cjs'), /send\('tool_plan'/);
    assert.match(readUtf8('api/services/aiPromptComposer.cjs'), /最终回复使用 Markdown/);
});
