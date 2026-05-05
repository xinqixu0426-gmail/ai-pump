import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Paper, Button } from '@mui/material';
import { Trash2 as DeleteIcon } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import VoiceChatMessages, { ChatMessage } from '../components/voice/VoiceChatMessages';
import { proxyFetch } from '../utils/api';
import './VoiceAssistant.css';

export default function VoiceAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

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
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
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
      // 通过 setState 的形式拿到最新的 messages
      let historyToSend: any[] = [];
      setMessages(prev => {
        historyToSend = [...prev.slice(0, -2), userMsg]
          .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
          .slice(-10)
          .map(m => ({ role: m.role, content: m.content }));
        return prev;
      });

      const response = await proxyFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: historyToSend }),
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
                  if (SAFE_CARD_TOOLS.has(event.name)) {
                    a.toolResults = [...(a.toolResults || []), { name: event.name, result: event.result }];
                  }
                  a.statusMessage = '正在整理结果...';
                  break;
                case 'content':
                  a.content += event.content;
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
    }
  }, [SAFE_CARD_TOOLS]);

  const { isRecording, isProcessing: hookIsProcessing, audioLevel, interimText, startRecording, stopRecording } = useAudioRecorder({
    onTranscribed: sendMessage
  });

  // Since we don't have isProcessing as state anymore, we simulate it during sendMessage
  const [isSending, setIsSending] = useState(false);
  
  // Wrap sendMessage to handle sending state natively
  const handleSendMessage = useCallback(async (text: string) => {
    setIsSending(true);
    await sendMessage(text);
    setIsSending(false);
  }, [sendMessage]);

  const handleClear = () => {
    setMessages([]);
    setInputText('');
  };

  const isProcessing = hookIsProcessing || (messages.length > 0 && messages[messages.length - 1].isLoading) || isSending;
  const canInteract = !isRecording && !isProcessing;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, maxWidth: 1100, mx: 'auto', width: '100%' }} className="va-root-override">
      <PageHeader
        title="语音助手"
        subtitle="点击麦克风直接对话，解锁极客流模式"
        actions={
          messages.length > 0 && (
            <Button variant="outlined" color="error" startIcon={<DeleteIcon size={18} />} onClick={handleClear} size="small">清空对话</Button>
          )
        }
      />
      <Paper elevation={0} sx={{ 
        display: 'flex', flexDirection: 'column', 
        flex: 1, minHeight: 400, 
        borderRadius: 3, 
        overflow: 'hidden',
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper'
      }}>
        <VoiceChatMessages 
          messages={messages} 
          isRecording={isRecording} 
          onSendMessage={handleSendMessage} 
          messagesEndRef={messagesEndRef} 
        />

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
                  handleSendMessage(inputText.trim());
                }
              }}
              disabled={!canInteract}
            />
            {inputText.trim() ? (
              <button
                className="va-send-btn"
                onClick={() => handleSendMessage(inputText.trim())}
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
      </Paper>
    </Box>
  );
}
