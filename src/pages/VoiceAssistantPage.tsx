import { useState, useRef, useCallback, useEffect } from 'react';
import StructuredResult from '../components/ai/StructuredResult';

// ── Types ──
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolResults?: Array<{ name: string; result: unknown }>;
  toolCalls?: Array<{ name: string }>;
  isLoading?: boolean;
  error?: string;
  statusMessage?: string;
}

const EXAMPLES = [
  { text: 'V750的成本是多少', icon: '💰' },
  { text: '当前铜价', icon: '🔴' },
  { text: '12规格200片线圈成本', icon: '⚡' },
  { text: '运营数据汇总', icon: '📊' },
];

export default function VoiceAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimText, setInterimText] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // ── Audio level monitoring ──
  const startAudioMonitor = useCallback((analyser: AnalyserNode) => {
    analyserRef.current = analyser;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(Math.min(avg / 128, 1));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopAudioMonitor = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setAudioLevel(0);
  }, []);

  // ── Float32 → 16bit PCM WAV ──
  const float32ToWav = useCallback((samples: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }, []);

  // ── 下采样到 16kHz ──
  const downsample = useCallback((buffer: Float32Array, fromRate: number, toRate: number): Float32Array => {
    if (fromRate === toRate) return buffer;
    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      result[i] = buffer[Math.round(i * ratio)];
    }
    return result;
  }, []);

  // ── Recording via AudioContext (raw PCM) ──
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      pcmChunksRef.current = [];
      setInterimText('');

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // ScriptProcessorNode to capture raw PCM
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mediaRecorderRef as any).current = { processor, source, ctx };
      setIsRecording(true);
      startAudioMonitor(analyser);
    } catch (err) {
      console.error('Mic error:', err);
      alert('无法访问麦克风，请检查权限设置');
    }
  }, [startAudioMonitor]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    stopAudioMonitor();

    // Capture sampleRate before closing
    const ctx = audioCtxRef.current;
    const originalRate = ctx?.sampleRate || 48000;

    // Stop audio processing
    if (ctx) {
      ctx.close();
      audioCtxRef.current = null;
    }

    // Stop mic stream
    streamRef.current?.getTracks().forEach(t => t.stop());

    // Combine PCM chunks
    const chunks = pcmChunksRef.current;
    if (chunks.length === 0) return;

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Downsample to 16kHz and create WAV
    const targetRate = 16000;
    const downsampled = downsample(combined, originalRate, targetRate);
    const wavBlob = float32ToWav(downsampled, targetRate);

    processAudio(wavBlob);
  }, [stopAudioMonitor, downsample, float32ToWav]);

  // ── ASR + AI pipeline ──
  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setInterimText('语音识别中...');

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');
      formData.append('format', 'wav');
      formData.append('sampleRate', '16000');

      const asrRes = await fetch('/api/voice/asr', { method: 'POST', body: formData });
      const asrJson = await asrRes.json();

      if (!asrJson.success || !asrJson.text?.trim()) {
        setInterimText(asrJson.error ? `识别失败: ${asrJson.error}` : '');
        setTimeout(() => setInterimText(''), 2000);
        setIsProcessing(false);
        return;
      }

      const userText = asrJson.text.trim();
      setInterimText('');
      sendMessage(userText);
    } catch (err) {
      console.error('ASR error:', err);
      setInterimText('');
      setIsProcessing(false);
    }
  };

  // 只有这些 tool 的结果才渲染卡片（精确查询），批量列表类隐藏防止信息泄露
  const SAFE_CARD_TOOLS = new Set([
    'query_recipe_cost_by_name', 'query_recipe_cost_by_id',
    'get_copper_price', 'calculate_coil_cost', 'full_calculate',
    'get_order_detail', 'create_order', 'create_part', 'update_part',
    'delete_part', 'create_recipe', 'update_recipe', 'delete_recipe',
    'compare_recipes', 'add_recipe_to_order', 'remove_recipe_from_order',
    'update_order_item', 'update_order_status', 'delete_order',
    'generate_purchase_list', 'batch_update_prices',
    'dynamic_config_cost', 'get_dashboard_summary',
  ]);

  // ── Send message to AI (SSE) ──
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    setIsProcessing(true);
    setInputText('');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
      statusMessage: '正在理解问题...',
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const history = [...messages, userMsg]
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('无法读取响应流');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (!last || last.role !== 'assistant') return prev;
              const a = { ...last };
              updated[updated.length - 1] = a;

              switch (event.type) {
                case 'status':
                  a.statusMessage = event.message;
                  a.isLoading = true;
                  break;
                case 'tool_call':
                  a.statusMessage = `调用 ${event.name}...`;
                  a.toolCalls = [...(a.toolCalls || []), { name: event.name }];
                  break;
                case 'tool_result':
                  // 只保留安全卡片的 tool result
                  if (SAFE_CARD_TOOLS.has(event.name)) {
                    a.toolResults = [...(a.toolResults || []), { name: event.name, result: event.result }];
                  }
                  a.statusMessage = '正在整理结果...';
                  break;
                case 'content':
                  a.content = event.content;
                  a.isLoading = false;
                  a.statusMessage = '';
                  break;
                case 'done':
                  a.isLoading = false;
                  a.statusMessage = '';
                  break;
                case 'error':
                  a.isLoading = false;
                  a.error = event.message;
                  a.content = `❌ ${event.message}`;
                  break;
              }
              return updated;
            });
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          last.isLoading = false;
          last.error = (err as Error).message;
          last.content = '请求失败，请重试';
        }
        return updated;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setInputText('');
  };

  const canInteract = !isRecording && !isProcessing;

  return (
    <div className="va-root">
      {/* ── Header ── */}
      <header className="va-header">
        <div className="va-header-left">
          <span className="va-logo">💧</span>
          <span className="va-title">水泵助手</span>
        </div>
        {messages.length > 0 && (
          <button className="va-clear-btn" onClick={handleClear}>清空</button>
        )}
      </header>

      {/* ── Messages ── */}
      <main className="va-messages">
        {messages.length === 0 && !isRecording && (
          <div className="va-welcome">
            <div className="va-welcome-icon">🎙</div>
            <h2>语音助手</h2>
            <p>点击下方麦克风按钮开始说话</p>
            <div className="va-examples">
              {EXAMPLES.map((q, i) => (
                <button key={i} className="va-example-btn" onClick={() => sendMessage(q.text)}>
                  <span>{q.icon}</span> {q.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`va-msg va-msg-${msg.role}`}>
            {msg.role === 'user' && (
              <div className="va-bubble va-bubble-user">{msg.content}</div>
            )}
            {msg.role === 'assistant' && (
              <div className="va-bubble va-bubble-assistant">
                {msg.isLoading && msg.statusMessage && (
                  <div className="va-status">
                    <div className="va-status-dot" />
                    <span>{msg.statusMessage}</span>
                  </div>
                )}
                {msg.isLoading && !msg.statusMessage && (
                  <div className="va-typing">
                    <span></span><span></span><span></span>
                  </div>
                )}
                {msg.toolCalls && msg.toolCalls.length > 0 && !msg.isLoading && (
                  <div className="va-tool-badges">
                    {msg.toolCalls.map((tc, idx) => (
                      <span key={idx} className="va-tool-badge">⚡ {tc.name}</span>
                    ))}
                  </div>
                )}
                {msg.error && <div className="va-error">❌ {msg.error}</div>}
                {msg.toolResults && msg.toolResults.length > 0 && (
                  <div className="va-tools">
                    {msg.toolResults.map((tr, idx) => (
                      <StructuredResult key={idx} toolName={tr.name} result={tr.result} />
                    ))}
                  </div>
                )}
                {msg.content && !msg.isLoading && (
                  <div className="va-text">{msg.content}</div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* ── Bottom Bar ── */}
      <footer className="va-footer">
        {interimText && <div className="va-interim">{interimText}</div>}

        <div className="va-input-row">
          <input
            className="va-text-input"
            type="text"
            placeholder="输入文字..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && inputText.trim() && canInteract) {
                sendMessage(inputText.trim());
              }
            }}
            disabled={!canInteract}
          />
          {inputText.trim() ? (
            <button
              className="va-send-btn"
              onClick={() => sendMessage(inputText.trim())}
              disabled={!canInteract}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          ) : (
            <button
              className={`va-mic-btn ${isRecording ? 'recording' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
            >
              <div className="va-mic-rings">
                <div className="va-mic-ring" style={{ transform: `scale(${1 + audioLevel * 0.6})`, opacity: isRecording ? 0.3 : 0 }} />
                <div className="va-mic-ring r2" style={{ transform: `scale(${1 + audioLevel * 1.2})`, opacity: isRecording ? 0.15 : 0 }} />
              </div>
              {isRecording ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              ) : isProcessing ? (
                <div className="va-spinner" />
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </footer>

      <style>{`
        .va-root {
          display: flex;
          flex-direction: column;
          height: 100vh;
          height: 100dvh;
          background: #0b0f1a;
          color: #e4e8f1;
          font-family: 'Inter', -apple-system, 'SF Pro Display', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          overflow: hidden;
        }

        /* ── Header ── */
        .va-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          padding-top: max(12px, env(safe-area-inset-top));
          background: rgba(11,15,26,0.9);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          z-index: 10;
          flex-shrink: 0;
        }
        .va-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .va-logo { font-size: 22px; }
        .va-title {
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .va-clear-btn {
          background: rgba(255,255,255,0.08);
          border: none;
          color: #8891a5;
          font-size: 13px;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .va-clear-btn:active { transform: scale(0.95); background: rgba(255,255,255,0.12); }

        /* ── Messages ── */
        .va-messages {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 16px;
          -webkit-overflow-scrolling: touch;
          scroll-behavior: smooth;
        }

        /* ── Welcome ── */
        .va-welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          text-align: center;
          gap: 8px;
        }
        .va-welcome-icon {
          width: 72px; height: 72px;
          background: linear-gradient(135deg, #6c8aff, #a78bfa);
          border-radius: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36px;
          margin-bottom: 8px;
          box-shadow: 0 8px 32px rgba(108,138,255,0.3);
        }
        .va-welcome h2 {
          font-size: 22px;
          font-weight: 700;
          margin: 0;
          background: linear-gradient(135deg, #6c8aff, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .va-welcome p {
          font-size: 14px;
          color: #5a6378;
          margin: 0 0 16px;
        }
        .va-examples {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          max-width: 400px;
        }
        .va-example-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          color: #b0b8cc;
          font-size: 13px;
          padding: 8px 14px;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .va-example-btn:active {
          transform: scale(0.96);
          background: rgba(108,138,255,0.15);
          border-color: rgba(108,138,255,0.3);
        }

        /* ── Message Bubbles ── */
        .va-msg { margin-bottom: 12px; display: flex; }
        .va-msg-user { justify-content: flex-end; }
        .va-msg-assistant { justify-content: flex-start; }

        .va-bubble {
          max-width: 88%;
          border-radius: 18px;
          padding: 12px 16px;
          font-size: 15px;
          line-height: 1.6;
          word-break: break-word;
          animation: msgIn 0.3s ease;
        }
        @keyframes msgIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .va-bubble-user {
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          border-radius: 18px 18px 4px 18px;
          box-shadow: 0 2px 12px rgba(37,99,235,0.3);
        }
        .va-bubble-assistant {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 4px 18px 18px 18px;
          max-width: 95%;
        }

        .va-text {
          white-space: pre-wrap;
          color: #c0c8d8;
        }
        .va-error {
          color: #f87171;
          font-size: 14px;
        }

        /* ── Card overrides for dark mode ── */
        .va-tools {
          margin: -4px -4px 8px;
        }
        .va-tools .MuiPaper-root {
          background: rgba(255,255,255,0.03) !important;
          border-color: rgba(255,255,255,0.08) !important;
          color: #e4e8f1 !important;
        }
        .va-tools .MuiTableCell-root {
          color: #c0c8d8 !important;
          border-color: rgba(255,255,255,0.06) !important;
        }
        .va-tools .MuiTableCell-head {
          color: white !important;
        }

        /* ── Typing indicator ── */
        .va-typing {
          display: flex;
          gap: 5px;
          padding: 4px 0;
        }
        .va-typing span {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #6c8aff;
          animation: typing 1.4s ease-in-out infinite;
        }
        .va-typing span:nth-child(2) { animation-delay: 0.2s; }
        .va-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }

        /* ── Status indicator ── */
        .va-status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #6c8aff;
          padding: 4px 0;
          animation: fadeIn 0.3s ease;
        }
        .va-status-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #6c8aff;
          animation: statusPulse 1.2s ease infinite;
          flex-shrink: 0;
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* ── Tool badges ── */
        .va-tool-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .va-tool-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 500;
          color: #a78bfa;
          background: rgba(167,139,250,0.1);
          border: 1px solid rgba(167,139,250,0.2);
          padding: 3px 10px;
          border-radius: 12px;
        }

        /* ── Footer ── */
        .va-footer {
          padding: 8px 16px;
          padding-bottom: max(12px, env(safe-area-inset-bottom));
          background: rgba(11,15,26,0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }
        .va-interim {
          font-size: 13px;
          color: #6c8aff;
          text-align: center;
          padding: 4px 0 8px;
          animation: pulse 1.5s ease infinite;
        }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

        .va-input-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .va-text-input {
          flex: 1;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px;
          padding: 12px 18px;
          font-size: 15px;
          color: #e4e8f1;
          outline: none;
          transition: all 0.2s;
          font-family: inherit;
        }
        .va-text-input:focus {
          border-color: rgba(108,138,255,0.4);
          background: rgba(255,255,255,0.08);
        }
        .va-text-input::placeholder { color: #4a5368; }
        .va-text-input:disabled { opacity: 0.5; }

        /* ── Send button ── */
        .va-send-btn {
          width: 48px; height: 48px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .va-send-btn:active { transform: scale(0.92); }
        .va-send-btn:disabled { opacity: 0.4; }

        /* ── Mic button ── */
        .va-mic-btn {
          width: 56px; height: 56px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg, #6c8aff, #a78bfa);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
          position: relative;
        }
        .va-mic-btn:active { transform: scale(0.92); }
        .va-mic-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .va-mic-btn.recording {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          box-shadow: 0 0 24px rgba(239,68,68,0.4);
        }

        /* ── Mic rings ── */
        .va-mic-rings {
          position: absolute;
          inset: -20px;
          pointer-events: none;
        }
        .va-mic-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid #ef4444;
          transition: transform 0.1s ease, opacity 0.2s ease;
        }
        .va-mic-ring.r2 {
          border-color: #f87171;
        }

        /* ── Spinner ── */
        .va-spinner {
          width: 22px; height: 22px;
          border: 2.5px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
