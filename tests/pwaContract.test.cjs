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

test('PWA 契约：基础 AI 助手复用受控 AI client 和确认流程，不包含语音入口', () => {
    const component = readUtf8('apps/web-next/components/basic-ai-assistant.tsx');
    const promptKit = readUtf8('apps/web-next/components/prompt-kit/basic-chat.tsx');

    assert.match(component, /streamAiChat/);
    assert.match(component, /confirmAiTool/);
    assert.match(component, /PromptInput/);
    assert.match(component, /StreamingText/);
    assert.match(component, /'confirming'/);
    assert.match(promptKit, /PromptInputTextarea/);
    assert.match(promptKit, /PromptSuggestion/);
    assert.match(promptKit, /function StreamingText/);
    assert.doesNotMatch(component, /MobileVoiceAssistant|recognizeVoiceBlob|MediaRecorder|getUserMedia|Mic|语音播报|按住说话/);
    assert.doesNotMatch(component, /\bfetch\s*\(/);
});
