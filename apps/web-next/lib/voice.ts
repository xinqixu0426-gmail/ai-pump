'use client';

import { proxyRequest } from './api';

/** 后端 /api/voice/asr 的实际响应形状 */
type VoiceAsrResponse = {
  success: boolean;
  text?: string;
  error?: string;
  detail?: unknown;
};

/** 阿里云一句话识别支持的采样率 */
const ASR_SAMPLE_RATE = 16000;

/**
 * 将浏览器录音 blob 解码，重采样到 16kHz，输出 16-bit 单声道 PCM。
 * 浏览器原生录音采样率通常为 44100 / 48000 Hz，阿里云一句话识别只接受 8000 / 16000 Hz。
 * 使用 OfflineAudioContext 做高质量重采样（带抗混叠滤波），比手动线性插值效果好得多。
 */
async function decodeToPcm(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const sourceBuffer = await ctx.decodeAudioData(arrayBuffer);

    // OfflineAudioContext 自动完成重采样
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(sourceBuffer.duration * ASR_SAMPLE_RATE),
      ASR_SAMPLE_RATE,
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const resampled = await offlineCtx.startRendering();
    const channelData = resampled.getChannelData(0);
    const numSamples = channelData.length;

    // Float32 → Int16 PCM
    const pcm = new ArrayBuffer(numSamples * 2);
    const view = new DataView(pcm);
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return pcm;
  } finally {
    ctx.close();
  }
}

export function getSupportedVoiceMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/wav'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export async function recognizeVoiceBlob(blob: Blob, mimeType: string): Promise<string> {
  // 统一解码 + 重采样到 16kHz PCM，消除容器格式和采样率差异
  let pcmBuffer: ArrayBuffer;
  try {
    pcmBuffer = await decodeToPcm(blob);
  } catch (err) {
    console.error('[voice] decodeToPcm 失败', err);
    throw new Error('音频解码失败，请再试一次');
  }

  const formData = new FormData();
  formData.append('audio', new Blob([pcmBuffer], { type: 'application/octet-stream' }), 'voice.pcm');
  formData.append('format', 'pcm');
  formData.append('sampleRate', String(ASR_SAMPLE_RATE));

  const result = await proxyRequest<VoiceAsrResponse>('/api/voice/asr', {
    method: 'POST',
    body: formData,
  });

  if (!result.success) {
    throw new Error(result.error || '语音识别失败');
  }

  const text = (result.text || '').trim();
  if (!text) throw new Error('没有识别到有效文字');
  return text;
}
