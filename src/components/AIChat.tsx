import { useState, useRef, useEffect } from 'react';
import { 
  Fab, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  TextField, 
  IconButton, 
  Box, 
  Typography, 
  Paper,
  CircularProgress
} from '@mui/material';
import { 
  Chat as ChatIcon, 
  Close as CloseIcon, 
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon 
} from '@mui/icons-material';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AIChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '您好！我是水泵BOM管家的AI助手，您可以让我帮您自动计算成本，或者查询系统信息。' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3002/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，API调用失败：' + (data.error || '未知错误') }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: '网络错误：' + error.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <Fab 
        color="primary" 
        sx={{ 
          position: 'fixed', 
          bottom: 24, 
          right: 24,
          boxShadow: '0 8px 16px rgba(0,0,0,0.2)' 
        }} 
        onClick={() => setOpen(true)}
      >
        <ChatIcon />
      </Fab>

      <Dialog 
        open={open} 
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { height: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 3 }
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)',
          color: 'white'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BotIcon />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>DeepSeek AI 助手</Typography>
          </Box>
          <IconButton onClick={() => setOpen(false)} size="small" sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ flexGrow: 1, bgcolor: '#f5f7fa', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {messages.map((msg, index) => (
            <Box 
              key={index} 
              sx={{ 
                display: 'flex', 
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                alignItems: 'flex-start',
                gap: 1
              }}
            >
              {msg.role === 'assistant' && (
                <Box sx={{ bgcolor: '#e0e7ff', p: 1, borderRadius: '50%', color: '#3b82f6' }}>
                  <BotIcon fontSize="small" />
                </Box>
              )}
              
              <Paper 
                elevation={1} 
                sx={{ 
                  p: 1.5, 
                  maxWidth: '75%', 
                  bgcolor: msg.role === 'user' ? '#3b82f6' : 'white',
                  color: msg.role === 'user' ? 'white' : 'text.primary',
                  borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                <Typography variant="body2">{msg.content}</Typography>
              </Paper>

              {msg.role === 'user' && (
                <Box sx={{ bgcolor: '#3b82f6', p: 1, borderRadius: '50%', color: 'white' }}>
                  <PersonIcon fontSize="small" />
                </Box>
              )}
            </Box>
          ))}
          
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 1 }}>
              <Box sx={{ bgcolor: '#e0e7ff', p: 1, borderRadius: '50%', color: '#3b82f6' }}>
                <BotIcon fontSize="small" />
              </Box>
              <Paper elevation={1} sx={{ p: 1.5, borderRadius: '4px 16px 16px 16px' }}>
                <CircularProgress size={20} />
              </Paper>
            </Box>
          )}
          <div ref={messagesEndRef} />
        </DialogContent>

        <DialogActions sx={{ p: 2, bgcolor: 'white' }}>
          <TextField
            fullWidth
            placeholder="问问 AI 某款水泵的成本大概是多少..."
            variant="outlined"
            size="small"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={loading}
            InputProps={{
              sx: { borderRadius: 4, pr: 0.5 },
              endAdornment: (
                <IconButton color="primary" onClick={handleSend} disabled={!input.trim() || loading}>
                  <SendIcon />
                </IconButton>
              )
            }}
          />
        </DialogActions>
      </Dialog>
    </>
  );
}
