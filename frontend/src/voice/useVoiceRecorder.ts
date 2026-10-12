import { useCallback, useEffect, useRef, useState } from 'react';
import { createSilenceDetector } from './silence';

export type RecorderState = 'idle' | 'requesting' | 'listening';

export interface RecordingResult {
  blob: Blob;
  mime: string;
  /** False when nobody spoke (only meaningful when the silence detector could run). */
  heardSpeech: boolean;
  reason: 'silence' | 'manual' | 'max-length' | 'no-speech';
}

export interface RecorderOptions {
  silenceMs?: number;
  noSpeechMs?: number;
  maxMs?: number;
}

export const micSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((m) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m));
}

export function describeMicError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "Microphone access was blocked. Allow it in your browser's site settings, then try again.";
  }
  if (name === 'NotFoundError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'The microphone is being used by another application.';
  return 'Could not start the microphone.';
}

type AudioCtxCtor = typeof AudioContext;

/**
 * Records one spoken utterance and stops by itself when the speaker goes quiet.
 * `level` (0..1) drives the on-screen meter. Without Web Audio the recording still works; it just
 * has to be stopped by hand (or by the length limit).
 */
export function useVoiceRecorder(onDone: (r: RecordingResult) => void, options: RecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const optsRef = useRef(options);
  optsRef.current = options;

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const poll = useRef<number | null>(null);
  const maxTimer = useRef<number | null>(null);
  const reasonRef = useRef<RecordingResult['reason']>('manual');
  const heardRef = useRef(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const starting = useRef(false);

  const cleanup = useCallback(() => {
    if (poll.current !== null) window.clearInterval(poll.current);
    if (maxTimer.current !== null) window.clearTimeout(maxTimer.current);
    poll.current = maxTimer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    try {
      void audioCtx.current?.close();
    } catch {
      /* already closed */
    }
    audioCtx.current = null;
  }, []);

  const stop = useCallback((reason: RecordingResult['reason'] = 'manual') => {
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') {
      reasonRef.current = reason;
      rec.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else cleanup();
    if (mounted.current) {
      setState('idle');
      setLevel(0);
    }
  }, [cleanup]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      const rec = recorder.current;
      if (rec) rec.onstop = null;
      if (rec && rec.state !== 'inactive') rec.stop();
      cleanup();
    };
  }, [cleanup]);

  const start = useCallback(async () => {
    if (starting.current || recorder.current?.state === 'recording') return;
    setError(null);
    if (!micSupported()) {
      setError('Voice input is not supported in this browser, or this page is not served from localhost or HTTPS.');
      return;
    }
    starting.current = true;
    setState('requesting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      starting.current = false;
      if (mounted.current) {
        setState('idle');
        setError(describeMicError(e));
      }
      return;
    }
    starting.current = false;
    if (!mounted.current) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }

    stream.current = media;
    cancelled.current = false;
    heardRef.current = false;
    reasonRef.current = 'manual';
    chunks.current = [];

    const mime = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
    } catch {
      cleanup();
      setState('idle');
      setError('Could not start recording in this browser.');
      return;
    }
    rec.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunks.current.push(ev.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];
      const wasCancelled = cancelled.current;
      const reason = reasonRef.current;
      const heard = heardRef.current;
      cleanup();
      recorder.current = null;
      if (!mounted.current) return;
      setState('idle');
      setLevel(0);
      if (wasCancelled) return;
      if (blob.size === 0) {
        setError('No audio was captured. Check your microphone and try again.');
        return;
      }
      onDoneRef.current({ blob, mime: type, heardSpeech: heard, reason });
    };
    recorder.current = rec;
    rec.start();
    setState('listening');

    const o = optsRef.current;
    maxTimer.current = window.setTimeout(() => stop('max-length'), o.maxMs ?? 60000);

    // Loudness meter + automatic end-of-speech.
    const Ctx: AudioCtxCtor | undefined =
      (window as unknown as { AudioContext?: AudioCtxCtor }).AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
    if (Ctx) {
      try {
        const ctx = new Ctx();
        audioCtx.current = ctx;
        void ctx.resume?.();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(media).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const detector = createSilenceDetector({ silenceMs: o.silenceMs, noSpeechMs: o.noSpeechMs });
        poll.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          if (mounted.current) setLevel(Math.min(1, rms * 6));
          const verdict = detector.push(rms, Date.now());
          heardRef.current = detector.heardSpeech;
          if (verdict === 'stop') stop('silence');
          else if (verdict === 'no-speech') {
            heardRef.current = false;
            stop('no-speech');
          }
        }, 100);
      } catch {
        /* no Web Audio: manual stop only */
      }
    }
  }, [cleanup, stop]);

  return { state, level, error, start, stop: () => stop('manual'), cancel, clearError: () => setError(null) };
}
