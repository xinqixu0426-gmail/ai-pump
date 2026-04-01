/**
 * 微信小程序 SSE 流式请求工具
 * 
 * 利用 wx.request + enableChunkedTransfer + onChunkReceived
 * 模拟 Server-Sent Events 接收
 * 
 * 要求基础库 >= 2.20.2
 */

/**
 * 发起 SSE 流式请求
 * @param {Object} options
 * @param {string} options.url - 请求地址
 * @param {Object} options.data - POST body
 * @param {Function} options.onEvent - 收到 SSE 事件回调 (event: Object)
 * @param {Function} options.onDone - 请求完成回调
 * @param {Function} options.onError - 错误回调 (err: Object)
 * @returns {RequestTask} 可调用 .abort() 取消
 */
function createSSERequest(options) {
  const { url, data, onEvent, onDone, onError } = options;
  let buffer = '';

  const task = wx.request({
    url,
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    data,
    enableChunkedTransfer: true,
    responseType: 'text',
    timeout: 120000,
    success: () => {
      // 处理 buffer 中残留的数据
      if (buffer.trim()) {
        _parseBuffer(buffer, onEvent);
      }
      onDone?.();
    },
    fail: (err) => {
      console.error('[SSE] 请求失败:', err);
      onError?.(err);
    },
  });

  task.onChunkReceived((res) => {
    // res.data 是 ArrayBuffer
    let text;
    try {
      // 微信基础库支持 TextDecoder
      if (typeof TextDecoder !== 'undefined') {
        text = new TextDecoder('utf-8').decode(res.data);
      } else {
        // fallback: 手动 ArrayBuffer -> String
        const bytes = new Uint8Array(res.data);
        text = '';
        for (let i = 0; i < bytes.length; i++) {
          text += String.fromCharCode(bytes[i]);
        }
        // 处理 UTF-8 多字节（简单 decodeURIComponent 方案）
        try { text = decodeURIComponent(escape(text)); } catch(e) {}
      }
    } catch (e) {
      console.warn('[SSE] 解码失败:', e);
      return;
    }

    buffer += text;

    // 按 SSE 标准分割：双换行分隔事件
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || ''; // 保留不完整的最后一段

    for (const part of parts) {
      _parseBuffer(part, onEvent);
    }
  });

  return task;
}

function _parseBuffer(text, onEvent) {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      try {
        const event = JSON.parse(trimmed.slice(6));
        onEvent?.(event);
      } catch (e) {
        console.warn('[SSE] JSON 解析失败:', trimmed);
      }
    }
  }
}

module.exports = { createSSERequest };
