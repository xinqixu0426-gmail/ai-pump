import { useState, useRef, useCallback, useEffect } from 'react';
import StructuredResult from '../components/ai/StructuredResult';

// ── Types ──
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolResults?: Array<{ name: string; result: unknown }>;
  isLoading?: boolean;
  error?: string;
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
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // ── Audio level monitoring ──
  const startAudioMonitor = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
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

  // ── Recording ──
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];
      setInterimText('');

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        stopAudioMonitor();
        processAudio(audioBlob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);
      startAudioMonitor(stream);
    } catch (err) {
      console.error('Mic error:', err);
      alert('无法访问麦克风，请检查权限设置');
    }
  }, [startAudioMonitor, stopAudioMonitor]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  // ── ASR + AI pipeline ──
  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setInterimText('语音识别中...');

    try {
      // Step 1: ASR
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('format', 'mp3');
      formData.append('sampleRate', '16000');

      const asrRes = await fetch('/api/voice/asr', { method: 'POST', body: formData });
      const asrJson = await asrRes.json();

      if (!asrJson.success || !asrJson.text?.trim()) {
        setInterimText('');
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

  // ── Send message to AI ──
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
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      // Build message history for context
      const history = [...messages, userMsg]
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .slice(-10) // Keep last 10 messages for context
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/wechat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      const json = await res.json();

      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          last.content = json.content || '';
          last.toolResults = json.toolResults?.map((tr: { name: string; view_type: string; result: unknown }) => ({
            name: tr.name,
            result: tr.result,
          })) || [];
          last.isLoading = false;
          last.error = json.success ? undefined : (json.error || '请求失败');
        }
        return updated;
      });
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
                {msg.isLoading && (
                  <div className="va-typing">
                    <span></span><span></span><span></span>
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
