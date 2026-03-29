import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Divider,
  Alert,
  Snackbar,
  CircularProgress
} from '@mui/material';
import { SmartToy as BotIcon, Save as SaveIcon } from '@mui/icons-material';

export default function AgentConfigPage() {
  const [config, setConfig] = useState({
    systemPrompt: '你是专业水泵BOM成本分析AI。请使用提供给你的工具精准计算并解答用户的报价需求。',
    apiKey: '',
    temperature: 0.1
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('http://localhost:3002/api/agent-config');
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config);
      }
    } catch (error) {
      console.error('Failed to fetch config', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('http://localhost:3002/api/agent-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      
      if (data.success) {
        setToast({ open: true, message: '配置保存成功！', severity: 'success' });
      } else {
        setToast({ open: true, message: '保存失败: ' + data.error, severity: 'error' });
      }
    } catch (error: any) {
      setToast({ open: true, message: '网络错误: ' + error.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig(prev => ({ ...prev, [field]: e.target.value }));
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ maxWidth: 800, margin: '0 auto', pt: 2 }}>
      <Typography variant="h5" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
        <BotIcon color="primary" fontSize="large" />
        AI Agent 专属配置
      </Typography>

      <Card elevation={2} sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            修改提示词可以自由定制 AI 的回答性格、语言风格，或者教它掌握特定的水泵术语。
          </Alert>
          
          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>系统提示词 (System Prompt)</Typography>
            <TextField
              fullWidth
              multiline
              rows={6}
              value={config.systemPrompt}
              onChange={handleChange('systemPrompt')}
              placeholder="告诉 AI 它的角色定位，比如：你是一位有10年水泵销售经验的老板..."
              variant="outlined"
            />
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>DeepSeek API Key (可选)</Typography>
            <TextField
              fullWidth
              type="password"
              value={config.apiKey}
              onChange={handleChange('apiKey')}
              placeholder="覆盖系统默认的 API Key（留空则使用默认配置sk-...）"
              variant="outlined"
              size="small"
            />
          </Box>
          
          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>温度 (Temperature) - {config.temperature}</Typography>
            <TextField
              fullWidth
              type="number"
              inputProps={{ min: 0, max: 2, step: 0.1 }}
              value={config.temperature}
              onChange={handleChange('temperature')}
              helperText="值越低AI回答越严谨保守，值越高AI想象力越丰富 (建议设为0.1~0.3)"
              variant="outlined"
              size="small"
            />
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
            <Button 
              variant="contained" 
              size="large" 
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving}
              sx={{ px: 4, borderRadius: 2 }}
            >
              保存所有配置
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Snackbar 
        open={toast.open} 
        autoHideDuration={3000} 
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
