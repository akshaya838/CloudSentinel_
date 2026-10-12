import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { apiPost, apiUpload, ApiError } from '../../services/api';
import type { TranscribeResult, TranslateResult } from '../../types/api';

const MAX_SECONDS = 60;
const SLOW_CALL_MS = 180000; // the first request may download/load the speech or translation model
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', ta: 'Tamil', hi: 'Hindi' };
const TRANSLATABLE = new Set(['ta', 'hi']);

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

export interface VoiceResult {
  /** Text to use: the transcript, translated to English when it was Tamil or Hindi. */
  text: string;
  /** Exactly what the speech model heard, in the spoken language. */
  heard: string;
  language: string;
  translated: boolean;
  /** False when `text` is not English, so an English-only model should not be run on it. */
  classifiable: boolean;
  notice: string | null;
}

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'translating';

const STATUS: Record<Phase, string> = {
  idle: '',
  requesting: 'Waiting for microphone permission…',
  recording: 'Listening… click Stop when you are done.',
  transcribing: 'Transcribing…',
  translating: 'Translating to English…',
};

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((m) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m));
}

function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

function describeMicError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "Microphone access was blocked. Allow it in your browser's site settings, then try again.";
  }
  if (name === 'NotFoundError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'The microphone is being used by another application.';
  return 'Could not start the microphone.';
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function VoiceInput({ onResult, disabled = false }: { onResult: (r: VoiceResult) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  const onResultRef = useRef(onResult); // always call the latest callback, not the one from when recording began
  onResultRef.current = onResult;

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };
  const releaseMic = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      releaseMic();
    };
  }, []);

  const finish = async (mime: string) => {
    const blob = new Blob(chunks.current, { type: mime });
    chunks.current = [];
    if (!mounted.current) return;
    if (blob.size === 0) {
      setPhase('idle');
      setError('No audio was captured. Check your microphone and try again.');
      return;
    }

    setPhase('transcribing');
    try {
      const form = new FormData();
      form.append('file', blob, `voice.${extensionFor(mime)}`);
      const transcript = await apiUpload<TranscribeResult>('/api/v1/voice/transcribe', form, { timeout: SLOW_CALL_MS });
      if (!mounted.current) return;

      const heard = (transcript.text || '').trim();
      if (!heard) {
        setPhase('idle');
        setError('No speech was detected. Try again, a little closer to the microphone.');
        return;
      }

      const language = transcript.detected_language || 'en';
      if (language === 'en') {
        onResultRef.current({ text: heard, heard, language, translated: false, classifiable: true, notice: null });
      } else if (TRANSLATABLE.has(language)) {
        setPhase('translating');
        try {
          const tr = await apiPost<TranslateResult>(
            '/api/v1/translation',
            { text: heard, target_lang: 'en', source_lang: language },
            { timeout: SLOW_CALL_MS },
          );
          if (!mounted.current) return;
          onResultRef.current({ text: tr.translated_text, heard, language, translated: true, classifiable: true, notice: null });
        } catch (e) {
          if (!mounted.current) return;
          const why = e instanceof ApiError ? e.message : 'the translation service did not respond';
          onResultRef.current({
            text: heard, heard, language, translated: false, classifiable: false,
            notice: `Heard ${languageName(language)} but could not translate it to English (${why}). The classifier only understands English, so edit the text before classifying.`,
          });
        }
      } else {
        onResultRef.current({
          text: heard, heard, language, translated: false, classifiable: false,
          notice: `Detected ${languageName(language)}. The classifier only understands English, so edit the text before classifying.`,
        });
      }
      if (mounted.current) setPhase('idle');
    } catch (e) {
      if (!mounted.current) return;
      setPhase('idle');
      setError(e instanceof ApiError ? e.message : 'Voice input failed. Please try again.');
    }
  };

  const stop = () => {
    clearTimer();
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    releaseMic();
  };

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice input is not supported in this browser, or this page is not served from localhost or HTTPS.');
      return;
    }
    setPhase('requesting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (mounted.current) {
        setPhase('idle');
        setError(describeMicError(e));
      }
      return;
    }
    if (!mounted.current) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }

    stream.current = media;
    const mime = pickMimeType();
    const rec = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
    chunks.current = [];
    rec.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunks.current.push(ev.data);
    };
    rec.onstop = () => {
      void finish(rec.mimeType || mime || 'audio/webm');
    };
    recorder.current = rec;
    rec.start();

    const startedAt = Date.now();
    setSeconds(0);
    setPhase('recording');
    timer.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop(); // keeps uploads small and stops a forgotten recording
    }, 500);
  };

  const busy = phase === 'requesting' || phase === 'transcribing' || phase === 'translating';

  return (
    <div>
      <div className="flex items-center gap-3">
        {phase === 'recording' ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop recording"
            className="flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <Square size={13} />
            Stop · {mmss(seconds)}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={disabled || busy}
            aria-label="Start voice input"
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            Speak
          </button>
        )}
        <span role="status" aria-live="polite" className="text-xs text-gray-500">
          {STATUS[phase]}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
