import { Button } from '@mui/material';
import StructuredResult from '../ai/StructuredResult';

export interface ChatMessage {
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

interface VoiceChatMessagesProps {
  messages: ChatMessage[];
  isRecording: boolean;
  onSendMessage: (text: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

const EXAMPLES = [
  { text: 'V750的成本是多少', icon: '💰' },
  { text: '当前铜价', icon: '🔴' },
  { text: '12规格200片线圈成本', icon: '⚡' },
  { text: '运营数据汇总', icon: '📊' },
];

export default function VoiceChatMessages({ messages, isRecording, onSendMessage, messagesEndRef }: VoiceChatMessagesProps) {
  return (
    <main className="va-messages">
      {messages.length === 0 && !isRecording && (
        <div className="va-welcome">
          <div className="va-welcome-icon">🎙</div>
          <h2>语音助手</h2>
          <p>点击下方麦克风按钮开始说话</p>
          <div className="va-examples">
            {EXAMPLES.map((q, i) => (
              <Button key={i} variant="outlined" color="primary" sx={{ borderRadius: 6, textTransform: 'none', bgcolor: 'primary.50' }} onClick={() => onSendMessage(q.text)}>
                <span style={{ marginRight: 6 }}>{q.icon}</span> {q.text}
              </Button>
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
  );
}
