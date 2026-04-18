import { useState, useRef, useCallback } from 'react';

interface UseAudioRecorderOptions {
  onTranscribed: (text: string) => void;
}

export function useAudioRecorder({ onTranscribed }: UseAudioRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimText, setInterimText] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

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

  // ── ASR + AI pipeline ──
  const processAudio = useCallback(async (audioBlob: Blob) => {
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
      onTranscribed(userText); // Callback to parent
    } catch (err) {
      console.error('ASR error:', err);
      setInterimText('');
    } finally {
      setIsProcessing(false);
    }
  }, [onTranscribed]);

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
    if (!isRecording) return;
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
    if (chunks.length === 0) {
        setIsProcessing(false);
        return;
    }

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
  }, [isRecording, stopAudioMonitor, downsample, float32ToWav, processAudio]);

  return {
    isRecording,
    isProcessing,
    audioLevel,
    interimText,
    startRecording,
    stopRecording
  };
}
