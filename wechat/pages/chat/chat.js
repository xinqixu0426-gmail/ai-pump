/**
 * BOM 智能助手 - 聊天页面
 * 
 * 功能：
 * 1. 语音输入（RecorderManager + 阿里云 ASR）
 * 2. 文字输入
 * 3. SSE 流式接收 LLM 回复 + 工具调用结果
 * 4. 结构化数据卡片渲染
 */

const app = getApp();
const recorderManager = wx.getRecorderManager();

Page({
  data: {
    messages: [],       // { id, type, role, content, view_type, data, expanded }
    inputText: '',
    isVoiceMode: true,
    isRecording: false,
    isBusy: false,
    scrollToId: '',
    duration: 0,
    formatDuration: '00:00',
    quickActions: [
      { icon: '💰', text: 'V750的成本是多少？' },
      { icon: '📊', text: '系统运营数据汇总' },
      { icon: '🔍', text: '看看订单5的详情' },
      { icon: '🧩', text: '对比V750和V550的成本' },
    ],
  },

  // 内部状态
  _msgIdCounter: 0,
  _durationTimer: null,
  _chatHistory: [],  // 给 LLM 的对话历史

  onLoad() {
    this._initRecorder();
  },

  onUnload() {
    this._clearTimer();
  },

  // ==================== 录音管理器 ====================

  _initRecorder() {
    recorderManager.onStop((res) => {
      this._clearTimer();
      this.setData({ isRecording: false });

      if (res.duration < 800) {
        this._addMsg({ type: 'status', text: '录音太短，请长按说话', done: true });
        return;
      }

      // 上传 ASR
      this._uploadASR(res.tempFilePath);
    });

    recorderManager.onError((err) => {
      this._clearTimer();
      this.setData({ isRecording: false });
      this._addMsg({ type: 'status', text: '录音出错: ' + (err.errMsg || ''), done: true });
    });
  },

  // ==================== 语音输入事件 ====================

  onVoiceStart() {
    if (this.data.isBusy || this.data.isRecording) return;

    wx.authorize({
      scope: 'scope.record',
      success: () => {
        wx.vibrateShort({ type: 'medium' });
        this.setData({ isRecording: true, duration: 0, formatDuration: '00:00' });
        this._startTimer();

        recorderManager.start({
          duration: 60000,
          sampleRate: 16000,
          numberOfChannels: 1,
          format: 'pcm',
        });
      },
      fail: () => {
        wx.showModal({
          title: '需要麦克风权限',
          content: '请在设置中允许麦克风权限',
          confirmText: '去设置',
          success: (res) => { if (res.confirm) wx.openSetting(); }
        });
      }
    });
  },

  onVoiceEnd() {
    if (this.data.isRecording) {
      wx.vibrateShort({ type: 'light' });
      recorderManager.stop();
    }
  },

  // ==================== 文字输入 ====================

  onInputChange(e) {
    this.setData({ inputText: e.detail.value });
  },

  onSendText() {
    const text = this.data.inputText.trim();
    if (!text || this.data.isBusy) return;
    this.setData({ inputText: '' });
    this._sendToChat(text);
  },

  onQuickAction(e) {
    const text = e.currentTarget.dataset.text;
    this._sendToChat(text);
  },

  toggleInputMode() {
    this.setData({ isVoiceMode: !this.data.isVoiceMode });
  },

  toggleCardExpand(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `messages[${idx}].expanded`;
    this.setData({ [key]: !this.data.messages[idx].expanded });
  },

  // ==================== ASR 上传 ====================

  _uploadASR(filePath) {
    this.setData({ isBusy: true });
    const statusId = this._addMsg({ type: 'status', text: '正在通过语音识别...' });

    wx.uploadFile({
      url: `${app.globalData.baseUrl}/api/wechat/asr`,
      filePath,
      name: 'audio',
      formData: { format: 'pcm', sampleRate: '16000' },
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (data.success && data.text) {
            this._updateMsg(statusId, { text: `识别完成：${data.text}`, done: true });
            this._sendToChat(data.text);
          } else {
            this._updateMsg(statusId, { text: '语音识别失败: ' + (data.error || ''), done: true });
            this.setData({ isBusy: false });
          }
        } catch (e) {
          this._updateMsg(statusId, { text: '服务器响应异常', done: true });
          this.setData({ isBusy: false });
        }
      },
      fail: () => {
        this._updateMsg(statusId, { text: '网络连接失败', done: true });
        this.setData({ isBusy: false });
      }
    });
  },

  // ==================== 核心：SSE 对话 ====================

  _sendToChat(text) {
    // 添加用户消息
    this._addMsg({ role: 'user', content: text });
    this._chatHistory.push({ role: 'user', content: text });

    this.setData({ isBusy: true });
    const statusId = this._addMsg({ type: 'status', text: '正在思考...' });

    // 模拟进度状态
    const statusSteps = ['正在理解您的问题...', '正在查询数据...', '正在整理结果...'];
    let stepIdx = 0;
    const statusTimer = setInterval(() => {
      if (stepIdx < statusSteps.length) {
        this._updateMsg(statusId, { text: statusSteps[stepIdx++] });
      }
    }, 2500);

    wx.request({
      url: `${app.globalData.baseUrl}/api/wechat/chat`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { messages: this._chatHistory },
      timeout: 120000,
      success: (res) => {
        clearInterval(statusTimer);
        const data = res.data;

        if (!data.success) {
          this._updateMsg(statusId, { text: '❌ ' + (data.error || '出错了'), done: true });
          return;
        }

        // 渲染工具结果卡片
        if (data.toolResults && data.toolResults.length > 0) {
          for (const tr of data.toolResults) {
            const viewType = tr.view_type || 'action_result';
            let cardData = tr.result || {};

            if (viewType === 'order_detail_card' && cardData.order) {
              cardData = cardData.order;
              const statusMap = { '待采购': 'pending', '采购中': 'purchasing', '已完成': 'completed' };
              cardData.statusClass = statusMap[cardData.status] || 'pending';
            } else {
              cardData = cardData.data || cardData.summary || cardData;
            }

            this._addMsg({ type: 'card', view_type: viewType, data: cardData, expanded: false });
          }
        }

        // 添加助手文本回复
        if (data.content) {
          this._addMsg({ role: 'assistant', content: data.content });
          this._chatHistory.push({ role: 'assistant', content: data.content });
        }

        this._updateMsg(statusId, { text: '✅ 完成', done: true });
      },
      fail: (err) => {
        clearInterval(statusTimer);
        console.error('[Chat] 请求失败:', err);
        this._updateMsg(statusId, { text: '❌ 网络连接失败', done: true });
      },
      complete: () => {
        this.setData({ isBusy: false });
      }
    });
  },

  // ==================== 消息管理 ====================

  _addMsg(msg) {
    const id = ++this._msgIdCounter;
    const messages = [...this.data.messages, { id, ...msg }];
    this.setData({ messages, scrollToId: `msg-${id}` });
    // 延迟滚动到底部
    setTimeout(() => this.setData({ scrollToId: 'msg-bottom' }), 50);
    return id;
  },

  _updateMsg(id, updates) {
    const idx = this.data.messages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const newMessages = [...this.data.messages];
    newMessages[idx] = { ...newMessages[idx], ...updates };
    this.setData({ messages: newMessages });
  },

  // ==================== 计时器 ====================

  _startTimer() {
    this._clearTimer();
    this._durationTimer = setInterval(() => {
      const d = this.data.duration + 1;
      const min = String(Math.floor(d / 60)).padStart(2, '0');
      const sec = String(d % 60).padStart(2, '0');
      this.setData({ duration: d, formatDuration: `${min}:${sec}` });
    }, 1000);
  },

  _clearTimer() {
    if (this._durationTimer) {
      clearInterval(this._durationTimer);
      this._durationTimer = null;
    }
  },
});
