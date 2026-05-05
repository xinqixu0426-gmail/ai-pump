import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Chip,
  CircularProgress,
  Fade,
  Tooltip,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  SendHorizontal as SendIcon,
  Bot as BotIcon,
  User as PersonIcon,
  Sparkles as SparkleIcon,
  Trash2 as DeleteIcon,
  Settings as SettingsIcon,
  Mic as MicIcon,
  Square as StopIcon,
} from 'lucide-react';
import StructuredResult from '../components/ai/StructuredResult';
import StatusIndicator from '../components/ai/StatusIndicator';
import PageHeader from '../components/PageHeader';
import { colors, gradients } from '../utils/theme';
import { proxyFetch, proxyRequest } from '../utils/api';

// ─── Types ────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'thinking' | 'calling_api' | 'formatting' | 'done' | 'error';
  statusMessage?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults?: Array<{ name: string; result: unknown }>;
}

// ─── 示例问题 ─────────────────────────────────────────
const EXAMPLE_QUESTIONS = [
  { text: 'V750的成本是多少？' },
  { text: '当前铜价是多少？' },
  { text: '12规格200片线圈成本' },
  { text: '系统运营数据汇总' },
  { text: '帮我新建一个台州李总的订单，加2台V750(1.5寸)' },
  { text: '看看订单5的详情' },
  { text: '生成订单5的采购清单' },
  { text: '对比一下V750和V550的成本差异' },
];

// ─── 主页面组件 ───────────────────────────────────────
export default function AIChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  // 语音识别状态
  const [isRecording, setIsRecording] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediaRecorderRef = useRef<any>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 加载 system prompt
  const loadSystemPrompt = useCallback(async () => {
    try {
      const json = await proxyRequest<{ success: boolean; data: string }>('/api/ai/system-prompt');
      if (json.success) setSystemPrompt(json.data);
    } catch { /* ignore */ }
  }, []);

  const handleOpenSettings = () => {
    loadSystemPrompt();
    setPromptSaved(false);
    setSettingsOpen(true);
  };

  const handleSavePrompt = async () => {
    setPromptLoading(true);
    try {
      const json = await proxyRequest<{ success: boolean }>('/api/ai/system-prompt', {
        method: 'PUT',
        body: JSON.stringify({ prompt: systemPrompt }),
      });
      if (json.success) {
        setPromptSaved(true);
        setTimeout(() => setPromptSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setPromptLoading(false);
  };

  const handleSend = async (text?: string) => {
    const userMessage = text || input.trim();
    if (!userMessage || isLoading) return;

    setInput('');
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'thinking',
      statusMessage: '正在理解您的问题...',
      toolCalls: [],
      toolResults: [],
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    // 构造发送给后端的消息历史
    const apiMessages = [...messages, userMsg]
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map(m => ({ role: m.role, content: m.content }));

    try {
      abortControllerRef.current = new AbortController();
      const response = await proxyFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortControllerRef.current.signal,
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
              const lastAssistant = updated[updated.length - 1];
              if (!lastAssistant || lastAssistant.role !== 'assistant') return prev;

              const newAssistant = { ...lastAssistant };
              updated[updated.length - 1] = newAssistant;

              switch (event.type) {
                case 'status':
                  newAssistant.status = event.status;
                  newAssistant.statusMessage = event.message;
                  break;
                case 'tool_call':
                  newAssistant.toolCalls = [
                    ...(newAssistant.toolCalls || []),
                    { name: event.name, args: event.args }
                  ];
                  break;
                case 'tool_result':
                  newAssistant.toolResults = [
                    ...(newAssistant.toolResults || []),
                    { name: event.name, result: event.result }
                  ];
                  break;
                case 'content':
                  newAssistant.content += event.content;
                  newAssistant.status = 'formatting';
                  newAssistant.statusMessage = '';
                  break;
                case 'done':
                  newAssistant.status = 'done';
                  break;
                case 'error':
                  newAssistant.status = 'error';
                  newAssistant.statusMessage = event.message;
                  newAssistant.content = `❌ ${event.message}`;
                  break;
              }
              return updated;
            });
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          last.status = 'error';
          last.content = `❌ 请求失败: ${(err as Error).message}`;
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleClear = () => {
    if (isLoading && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setIsLoading(false);
  };

  // ── 语音识别（Web Speech API）──
  const voiceTextRef = useRef('');

  const handleStartRecording = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mediaRecorderRef.current = recognition as any;
    voiceTextRef.current = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      const text = finalText || interimText;
      voiceTextRef.current = text;
      setInput(text);
    };

    recognition.onend = () => {
      setIsRecording(false);
      const text = voiceTextRef.current.trim();
      if (text) {
        handleSend(text);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('[语音识别错误]', event.error);
      setIsRecording(false);
      if (event.error === 'not-allowed') {
        alert('麦克风权限被拒绝，请在浏览器设置中允许');
      }
    };

    recognition.start();
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mediaRecorderRef.current as any).stop();
    }
    setIsRecording(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, maxWidth: 1100, mx: 'auto', width: '100%' }}>
      <PageHeader
        title="BOM 智能助手"
        subtitle="用自然语言查询成本、基本配方和供应链数据"
        actions={
          <>
            {messages.length > 0 && (
              <Button variant="outlined" color="error" startIcon={<DeleteIcon size={18} />} onClick={handleClear} size="small">
                清空对话
              </Button>
            )}
            <Tooltip title="设置 System Prompt">
              <IconButton onClick={handleOpenSettings} sx={{ bgcolor: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <SettingsIcon size={20} />
              </IconButton>
            </Tooltip>
          </>
        }
      />
      <Paper elevation={0} sx={{ 
        display: 'flex', flexDirection: 'column', 
        flex: 1, minHeight: 400, 
        borderRadius: 3, 
        overflow: 'hidden',
        border: '1px solid', borderColor: 'divider'
      }}>
      {/* 消息区域 */}
      <Box sx={{ flex: 1, overflow: 'auto', pb: 2, px: { xs: 2, md: 3 }, pt: 3 }}>
        {messages.length === 0 ? (
          // 欢迎界面
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 3 }}>
            <Box sx={{
              width: 64, height: 64, borderRadius: '50%',
              background: gradients.brand,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(124, 58, 237, 0.2)',
            }}>
              <SparkleIcon size={32} color="white" />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, color: 'text.primary' }}>
                BOM 智能助手
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                用自然语言查询成本、配方、铜价和线圈数据
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 1.5, width: '100%', maxWidth: 700, mt: 1 }}>
              {EXAMPLE_QUESTIONS.map((q, idx) => (
                <Paper
                  key={idx}
                  variant="outlined"
                  sx={{
                    p: 2, cursor: 'pointer', borderRadius: 3,
                    transition: 'all 0.2s',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: alpha('#2563eb', 0.04),
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(37, 99, 235, 0.1)',
                    }
                  }}
                  onClick={() => handleSend(q.text)}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {q.text}
                  </Typography>
                </Paper>
              ))}
            </Box>
          </Box>
        ) : (
          // 消息列表
          messages.map((msg) => (
            <Fade in key={msg.id}>
              <Box sx={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                mb: 2,
                gap: 1.5,
              }}>
                {msg.role === 'assistant' && (
                  <Box sx={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: gradients.brandText,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    mt: 0.5,
                  }}>
                    <BotIcon size={20} color="white" />
                  </Box>
                )}

                <Box sx={{
                  maxWidth: '80%',
                  ...(msg.role === 'user' ? {
                    bgcolor: 'primary.main',
                    color: 'white',
                    borderRadius: '20px 20px 4px 20px',
                    px: 2.5, py: 1.5,
                    boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
                  } : {
                    bgcolor: 'background.paper',
                    borderRadius: '4px 20px 20px 20px',
                    px: 2.5, py: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    minWidth: 200,
                  })
                }}>
                  {msg.role === 'assistant' && msg.status && msg.status !== 'done' && (
                    <StatusIndicator status={msg.status} message={msg.statusMessage || ''} />
                  )}

                  {/* Tool Results — 结构化展示 */}
                  {msg.role === 'assistant' && msg.toolResults && msg.toolResults.length > 0 && (
                    <Box>
                      {msg.toolResults.map((tr, idx) => (
                        <StructuredResult key={idx} toolName={tr.name} result={tr.result} />
                      ))}
                    </Box>
                  )}

                  {/* 文本内容 */}
                  {msg.content && (
                    <Typography
                      variant="body1"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.7,
                        '& strong': { fontWeight: 700 },
                        mt: msg.toolResults && msg.toolResults.length > 0 ? 1.5 : 0,
                      }}
                    >
                      {msg.content}
                    </Typography>
                  )}
                </Box>

                {msg.role === 'user' && (
                  <Box sx={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    bgcolor: 'primary.main',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    mt: 0.5,
                  }}>
                    <PersonIcon size={20} color="white" />
                  </Box>
                )}
              </Box>
            </Fade>
          ))
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* 输入区域 */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          bgcolor: 'background.paper',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.05)',
          border: '1px solid',
          borderColor: isLoading ? 'primary.main' : 'divider',
          transition: 'border-color 0.3s',
        }}
      >
        <Tooltip title="清空对话">
          <IconButton size="small" onClick={handleClear} sx={{ color: 'text.secondary' }}>
            <DeleteIcon size={18} />
          </IconButton>
        </Tooltip>
        <Tooltip title="编辑 System Prompt">
          <IconButton size="small" onClick={handleOpenSettings} sx={{ color: 'text.secondary' }}>
            <SettingsIcon size={18} />
          </IconButton>
        </Tooltip>
        <TextField
          inputRef={inputRef}
          fullWidth
          placeholder="输入你的问题，如：V750的成本是多少？"
          variant="standard"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isLoading}
          InputProps={{
            disableUnderline: true,
            sx: { fontSize: '1rem', fontWeight: 500 },
          }}
          autoFocus
        />
        <IconButton
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          disabled={isLoading}
          sx={{
            bgcolor: isRecording ? '#ef4444' : alpha(colors.green.main, 0.1),
            color: isRecording ? 'white' : colors.green.main,
            width: 40, height: 40,
            transition: 'all 0.2s',
            ...(isRecording ? {
              animation: 'mic-pulse 1.2s ease-in-out infinite',
              '@keyframes mic-pulse': {
                '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.4)' },
                '50%': { boxShadow: '0 0 0 10px rgba(239,68,68,0)' },
              }
            } : {}),
            '&:hover': { bgcolor: isRecording ? '#dc2626' : alpha(colors.green.main, 0.2) },
          }}
        >
          {isRecording ? <StopIcon size={18} /> : <MicIcon size={18} />}
        </IconButton>
        <IconButton
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          sx={{
            bgcolor: input.trim() && !isLoading ? 'primary.main' : alpha('#000', 0.05),
            color: input.trim() && !isLoading ? 'white' : 'text.disabled',
            width: 40, height: 40,
            transition: 'all 0.2s',
            '&:hover': {
              bgcolor: 'primary.dark',
              transform: 'scale(1.05)',
            },
            '&.Mui-disabled': {
              bgcolor: alpha('#000', 0.05),
              color: 'text.disabled',
            }
          }}
        >
          {isLoading ? <CircularProgress size={20} sx={{ color: 'text.secondary' }} /> : <SendIcon size={18} />}
        </IconButton>
      </Paper>
      </Paper>

      {/* System Prompt 编辑弹窗 */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3, minHeight: 500 }
        }}
      >
        <DialogTitle sx={{
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          <SettingsIcon size={24} color="#2563eb" style={{ marginRight: 8 }} />
          编辑 System Prompt
          {promptSaved && (
            <Chip label="✓ 已保存" size="small" color="success" sx={{ ml: 'auto', fontWeight: 600 }} />
          )}
        </DialogTitle>
        <DialogContent sx={{ p: 3, pt: 3 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 2, display: 'block' }}>
            System Prompt 定义了 AI 助手的行为和规则。修改后立即生效（运行时），重启服务会恢复默认值。
          </Typography>
          <TextField
            multiline
            fullWidth
            minRows={16}
            maxRows={24}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            variant="outlined"
            placeholder="输入 System Prompt..."
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                borderRadius: 2,
              }
            }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
            字符数: {systemPrompt.length}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setSettingsOpen(false)}
            variant="outlined"
            sx={{ borderRadius: 2, minWidth: 80 }}
          >
            关闭
          </Button>
          <Button
            onClick={handleSavePrompt}
            variant="contained"
            disabled={promptLoading}
            sx={{ borderRadius: 2, minWidth: 100 }}
          >
            {promptLoading ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
