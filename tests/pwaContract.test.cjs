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

    assert.equal(manifest.start_url, '/voice');
    assert.equal(nextManifest.start_url, '/voice');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.orientation, 'portrait');
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/icon-192.svg' && icon.sizes === '192x192'));
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/icon-512.svg' && icon.sizes === '512x512'));
    assert.ok(manifest.icons.some(icon => icon.src === '/icons/apple-touch-icon.png' && icon.type === 'image/png'));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/icon-192.svg')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/icon-512.svg')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/public/icons/apple-touch-icon.png')));
    assert.match(readUtf8('apps/web-next/app/voice/page.tsx'), /BasicAiAssistant/);
});

test('PWA 契约：/voice 使用独立移动外壳，不加载桌面 AppShell 导航', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const layout = readUtf8('apps/web-next/app/layout.tsx');

    assert.match(shell, /pathname === '\/voice'/);
    assert.match(layout, /manifest: '\/manifest\.json'/);
    assert.match(layout, /appleWebApp:\s*\{/);
    assert.match(layout, /viewportFit: 'cover'/);
});

test('PWA 契约：基础 AI 助手复用受控 AI client、ASR client 和确认流程', () => {
    const component = readUtf8('apps/web-next/components/basic-ai-assistant.tsx');
    const promptKit = readUtf8('apps/web-next/components/prompt-kit/basic-chat.tsx');
    const voiceClient = readUtf8('apps/web-next/lib/voice.ts');

    assert.match(component, /streamAiChat/);
    assert.match(component, /confirmAiTool/);
    assert.match(component, /recognizeVoiceBlob/);
    assert.match(component, /MediaRecorder/);
    assert.match(component, /PromptInput/);
    assert.match(component, /StreamingText/);
    assert.match(component, /'confirming'/);
    assert.match(promptKit, /PromptInputTextarea/);
    assert.match(promptKit, /PromptSuggestion/);
    assert.match(promptKit, /function StreamingText/);
    assert.match(voiceClient, /proxyRequest/);
    assert.match(voiceClient, /\/api\/voice\/asr/);
    assert.doesNotMatch(component, /MobileVoiceAssistant|SpeechRecognition|AudioContext|voice-orb|语音播报|按住说话/);
    assert.doesNotMatch(component, /\bfetch\s*\(/);
});

test('AI 契约：桌面 AI 直连后端 SSE 并使用 Markdown 流式渲染', () => {
    const aiClient = readUtf8('apps/web-next/lib/ai.ts');
    const aiView = readUtf8('apps/web-next/components/ai-view.tsx');
    const promptKit = readUtf8('apps/web-next/components/prompt-kit/basic-chat.tsx');

    assert.match(aiClient, /resolveAiStreamUrl/);
    assert.match(aiClient, /:3002\/api\/ai\/chat/);
    assert.match(aiClient, /type: 'tool_plan'/);
    assert.doesNotMatch(aiClient, /proxyFetch\('\/api\/ai\/chat'/);
    assert.match(aiView, /<StreamingText/);
    assert.match(aiView, /ToolPlanPanel/);
    assert.match(aiView, /SegmentedControl/);
    assert.match(aiView, /FadePanel/);
    assert.match(aiView, /activeSampleCategory/);
    assert.match(aiView, /h-\[calc\(100vh-8rem\)\]/);
    assert.match(aiView, /shrink-0 border-t border-line bg-white/);
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
