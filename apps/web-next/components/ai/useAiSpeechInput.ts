'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<{
    0?: { transcript?: string };
    length: number;
  }>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function appendSpeechTranscript(base: string, transcript: string) {
  const normalizedTranscript = transcript.trim();
  if (!normalizedTranscript) return base;
  const normalizedBase = base.trimEnd();
  return normalizedBase ? `${normalizedBase} ${normalizedTranscript}` : normalizedTranscript;
}

function speechErrorMessage(error?: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '无法使用麦克风，请在浏览器设置中允许麦克风权限。';
  if (error === 'audio-capture') return '未检测到可用的麦克风。';
  if (error === 'network') return '语音识别服务暂时无法连接，请稍后重试。';
  if (error === 'no-speech') return '没有识别到语音，请靠近麦克风后重试。';
  return '语音识别失败，请重试。';
}

export function useAiSpeechInput(input: string, setInput: Dispatch<SetStateAction<string>>) {
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechBaseInputRef = useRef('');

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      const recognition = speechRecognitionRef.current;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
      speechRecognitionRef.current = null;
    };
  }, []);

  function stopVoiceInput() {
    speechRecognitionRef.current?.stop();
  }

  function toggleVoiceInput() {
    if (isListening) {
      stopVoiceInput();
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSpeechError('当前浏览器不支持语音输入，请使用 Chrome、Edge 或 Safari。');
      return;
    }

    const recognition = new Recognition();
    speechRecognitionRef.current = recognition;
    speechBaseInputRef.current = input;
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setSpeechError('');
      setIsListening(true);
    };
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript || '';
      }
      setInput(appendSpeechTranscript(speechBaseInputRef.current, transcript));
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setSpeechError(speechErrorMessage(event.error));
    };
    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      speechRecognitionRef.current = null;
      setIsListening(false);
      setSpeechError('麦克风启动失败，请重试。');
    }
  }

  return {
    speechSupported,
    isListening,
    speechError,
    stopVoiceInput,
    toggleVoiceInput,
  };
}
