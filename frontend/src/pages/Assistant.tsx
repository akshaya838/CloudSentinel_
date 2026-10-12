import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, Loader2, Mic, Send, Square, Volume2, VolumeX } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { apiGet, apiPost, apiUpload, ApiError } from '../services/api';
import type { AssistantResult, TranscribeResult, WarmupStatus } from '../types/api';
import { speak, speechSupported, stopSpeaking, type SpeechLang } from '../voice/speech';
import { micSupported, useVoiceRecorder, type RecordingResult } from '../voice/useVoiceRecorder';

type LangChoice = 'auto' | SpeechLang;

const LANGS: { code: LangChoice; label: string; name: string }[] = [
  { code: 'auto', label: 'Auto', name: 'Detect my language' },
  { code: 'en', label: 'English', name: 'English' },
  { code: 'ta', label: 'தமிழ்', name: 'Tamil' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi' },
];
const LANG_NAME: Record<SpeechLang, string> = { en: 'English', ta: 'Tamil', hi: 'Hindi' };
const SLOW_CALL_MS = 180000; // the very first call may still be loading a model
const PREFS_KEY = 'cloudsentinel_assistant_prefs';
const EXAMPLES = ['Explain CVE-2021-44228.', 'Which vulnerabilities allow remote code execution?'];

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  lang: SpeechLang;
  viaVoice?: boolean;
  understoodAs?: string;
  sources?: string[];
  results?: AssistantResult['results'];
  note?: string | null;
  mode?: 'llm' | 'extractive' | null;
  ms?: number;
  failed?: { question: string };
}

interface Prefs {
  lang: LangChoice;
  voiceReplies: boolean;
  handsFree: boolean;
}

function loadPrefs(): Prefs {
  const base: Prefs = { lang: 'auto', voiceReplies: true, handsFree: false };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      lang: LANGS.some((l) => l.code === p.lang) ? (p.lang as LangChoice) : base.lang,
      voiceReplies: typeof p.voiceReplies === 'boolean' ? p.voiceReplies : base.voiceReplies,
      handsFree: typeof p.handsFree === 'boolean' ? p.handsFree : base.handsFree,
    };
  } catch {
    return base;
  }
}

const asSpeechLang = (v: unknown): SpeechLang => (v === 'ta' || v === 'hi' ? v : 'en');

export function Assistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'idle' | 'transcribing' | 'thinking'>('idle');
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [warm, setWarm] = useState<WarmupStatus | null>(null);

  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const nextId = useRef(1);
  const mounted = useRef(true);
  const bottom = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<() => void>(() => {});

  const canSpeak = speechSupported();

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode: preferences just won't persist */
    }
  }, [prefs]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  // Tell the user while the models are still loading in the background after a server start.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: number | undefined;
    const check = () => {
      apiGet<WarmupStatus>('/health/warmup')
        .then((st) => {
          if (!alive || !st) return;
          setWarm(st);
          if (!st.ready && ++tries < 60) timer = window.setTimeout(check, 4000);
        })
        .catch(() => {});
    };
    check();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopSpeaking();
    };
  }, []);

  const addMessage = useCallback((m: Omit<Msg, 'id'>): number => {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  const speakMessage = useCallback(async (m: Msg): Promise<void> => {
    if (!m.text) return;
    setSpeakingId(m.id);
    const r = await speak(m.text, m.lang);
    if (mounted.current) {
      setSpeakingId((cur) => (cur === m.id ? null : cur));
      if (!r.spoken && r.reason === 'no-voice') {
        setNotice(
          `This device has no ${LANG_NAME[m.lang]} voice installed, so the reply is shown as text only. ` +
            `Install one in your system's speech settings to hear it.`,
        );
      }
    }
  }, []);

  const ask = useCallback(
    async (question: string, viaVoice: boolean) => {
      const q = question.trim();
      if (!q) return;
      stopSpeaking();
      setNotice(null);
      const history = messagesRef.current
        .filter((m) => !m.failed)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.text.slice(0, 1500), sources: m.sources ?? [] }));
      const userId = addMessage({ role: 'user', text: q, lang: 'en', viaVoice });
      setBusy('thinking');
      const wanted = prefsRef.current.lang;
      try {
        const res = await apiPost<AssistantResult>(
          '/api/v1/assistant',
          { question: q, target_lang: wanted === 'auto' ? undefined : wanted, history, top_k: 3 },
          { timeout: SLOW_CALL_MS },
        );
        if (!mounted.current) return;
        const lang = asSpeechLang(res.response_lang_code);
        const understood = res.question_en && res.question_en.trim() !== q ? res.question_en : undefined;
        setMessages((prev) => prev.map((m) => (m.id === userId ? { ...m, understoodAs: understood } : m)));
        const reply: Omit<Msg, 'id'> = {
          role: 'assistant',
          text: res.answer ?? res.generation_note ?? "I couldn't find enough information in the indexed vulnerability data to answer this reliably.",
          lang: res.answer ? lang : 'en',
          sources: res.sources?.filter(Boolean) ?? [],
          results: res.results ?? [],
          note: res.answer ? res.generation_note : null,
          mode: res.answer_mode ?? null,
          ms: res.timings_ms?.total,
        };
        const id = addMessage(reply);
        setBusy('idle');
        if (prefsRef.current.voiceReplies) await speakMessage({ ...reply, id });
        if (mounted.current && prefsRef.current.handsFree) startRef.current();
      } catch (e) {
        if (!mounted.current) return;
        setBusy('idle');
        addMessage({
          role: 'assistant',
          text: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.',
          lang: 'en',
          failed: { question: q },
        });
        setPrefs((p) => (p.handsFree ? { ...p, handsFree: false } : p)); // never loop on errors
      }
    },
    [addMessage, speakMessage],
  );

  const onRecorded = useCallback(
    async (r: RecordingResult) => {
      if (r.reason === 'no-speech') {
        setNotice("I didn't hear anything. Tap the microphone and try again.");
        setPrefs((p) => (p.handsFree ? { ...p, handsFree: false } : p));
        return;
      }
      setBusy('transcribing');
      try {
        const form = new FormData();
        form.append('file', r.blob, `voice.${r.mime.includes('ogg') ? 'ogg' : r.mime.includes('mp4') ? 'mp4' : 'webm'}`);
        const lang = prefsRef.current.lang;
        if (lang !== 'auto') form.append('language', lang);
        const t = await apiUpload<TranscribeResult>('/api/v1/voice/transcribe', form, { timeout: SLOW_CALL_MS });
        if (!mounted.current) return;
        const heard = (t.text || '').trim();
        if (!heard) {
          setBusy('idle');
          setNotice("I couldn't make out any words. Try again a little closer to the microphone.");
          setPrefs((p) => (p.handsFree ? { ...p, handsFree: false } : p));
          return;
        }
        await ask(heard, true);
      } catch (e) {
        if (!mounted.current) return;
        setBusy('idle');
        setNotice(e instanceof ApiError ? e.message : 'Voice input failed. Please try again.');
        setPrefs((p) => (p.handsFree ? { ...p, handsFree: false } : p));
      }
    },
    [ask],
  );

  const rec = useVoiceRecorder(onRecorded, { silenceMs: 1400, noSpeechMs: 8000, maxMs: 60000 });
  const recStart = rec.start;
  startRef.current = () => void recStart(); // only called once a reply is finished, so nothing is in flight

  const listening = rec.state === 'listening';
  const working = busy !== 'idle';

  const onMic = () => {
    if (listening) {
      rec.stop(); // "I'm done": send now instead of waiting for silence
      return;
    }
    if (working || rec.state === 'requesting') return;
    stopSpeaking(); // barge-in: talking over the reply stops it
    setSpeakingId(null);
    setNotice(null);
    void rec.start();
  };

  const send = () => {
    if (!text.trim() || working) return;
    const q = text;
    setText('');
    void ask(q, false);
  };

  const status = listening
    ? 'Listening… stop talking when you are done.'
    : rec.state === 'requesting'
      ? 'Waiting for microphone permission…'
      : busy === 'transcribing'
        ? 'Transcribing what you said…'
        : busy === 'thinking'
          ? 'Searching the vulnerability records…'
          : speakingId !== null
            ? 'Speaking…'
            : prefs.handsFree
              ? 'Hands-free is on.'
              : '';

  const micOk = micSupported();
  const warming = warm && !warm.ready;

  return (
    <div>
      <PageHeader
        title="CloudSentinel Voice Assistant"
        subtitle="Ask by voice or text in English, Tamil or Hindi. Answers come only from retrieved CVE records."
      />

      {warming && (
        <p role="status" className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Language and speech models are still loading after the server start. Your first questions may take longer.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Language" className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              title={l.name}
              aria-pressed={prefs.lang === l.code}
              onClick={() => setPrefs((p) => ({ ...p, lang: l.code }))}
              className={`px-3 py-1.5 text-sm ${prefs.lang === l.code ? 'bg-brand-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={prefs.voiceReplies && canSpeak}
            disabled={!canSpeak}
            onChange={(e) => {
              if (!e.target.checked) {
                stopSpeaking();
                setSpeakingId(null);
              }
              setPrefs((p) => ({ ...p, voiceReplies: e.target.checked }));
            }}
          />
          Speak replies
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={prefs.handsFree}
            disabled={!micOk}
            onChange={(e) => setPrefs((p) => ({ ...p, handsFree: e.target.checked }))}
          />
          Hands-free (listen again after each reply)
        </label>
        {speakingId !== null && (
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setSpeakingId(null);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <VolumeX size={14} /> Stop speaking
          </button>
        )}
      </div>
      {prefs.lang !== 'auto' && (
        <p className="mb-3 text-xs text-gray-500">
          Replies and microphone recognition are set to {LANG_NAME[prefs.lang]}. Choose Auto to speak in any of the three languages.
        </p>
      )}

      <div className="flex h-[calc(100vh-17rem)] min-h-[420px] flex-col rounded-xl border border-gray-200 bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
              <Headphones size={32} className="mb-3 text-brand-primary" />
              <p className="text-sm font-medium text-gray-700">
                {micOk ? 'Tap the microphone and ask a question.' : 'Type a question below.'}
              </p>
              <p className="mt-1 max-w-sm text-xs">
                For example: “Explain CVE-2021-44228”, or ask in Tamil or Hindi. Follow-ups like “how do I patch it?” work too.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void ask(ex, false)}
                    className="rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <Bubble
              key={m.id}
              m={m}
              speaking={speakingId === m.id}
              canSpeak={canSpeak}
              onReplay={() => void speakMessage(m)}
              onStop={() => {
                stopSpeaking();
                setSpeakingId(null);
              }}
              onRetry={m.failed ? () => void ask(m.failed!.question, false) : undefined}
            />
          ))}

          {working && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              {busy === 'transcribing' ? 'Transcribing…' : 'Thinking…'}
            </div>
          )}
          <div ref={bottom} />
        </div>

        {notice && (
          <p role="alert" className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {notice}
          </p>
        )}
        {rec.error && (
          <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {rec.error}
          </p>
        )}

        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onMic}
              disabled={!micOk || (working && !listening)}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              title={micOk ? (listening ? 'Click to finish and send' : 'Click and speak') : 'Voice input is not supported in this browser'}
              className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow transition disabled:cursor-not-allowed disabled:opacity-40 ${
                listening ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-primary hover:bg-brand-primary-hover'
              }`}
            >
              {listening && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-red-500/40"
                  style={{ transform: `scale(${1 + rec.level * 0.6})`, transition: 'transform 80ms linear' }}
                />
              )}
              <span className="relative">{listening ? <Square size={20} /> : <Mic size={24} />}</span>
            </button>
            <input
              type="text"
              aria-label="Type a question"
              placeholder="Or type your question…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
            />
            <button
              type="button"
              onClick={send}
              disabled={working || !text.trim()}
              className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-primary-hover disabled:opacity-40"
            >
              <Send size={16} />
              Send
            </button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-gray-500">
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  m, speaking, canSpeak, onReplay, onStop, onRetry,
}: {
  m: Msg;
  speaking: boolean;
  canSpeak: boolean;
  onReplay: () => void;
  onStop: () => void;
  onRetry?: () => void;
}) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-primary px-4 py-2.5 text-sm text-white">
          {m.viaVoice && <Mic size={12} className="mr-1.5 inline opacity-80" aria-label="spoken" />}
          {m.text}
          {m.understoodAs && <p className="mt-1 text-xs italic opacity-80">Understood as: {m.understoodAs}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex">
      <div className={`max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-3 text-sm ${m.failed ? 'border-red-200 bg-red-50 text-red-800' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
        <p className="leading-relaxed" lang={m.lang}>{m.text}</p>
        {m.note && <p className="mt-2 text-xs text-amber-700">{m.note}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 rounded-md bg-brand-primary px-3 py-1 text-xs font-medium text-white hover:bg-brand-primary-hover">
            Retry
          </button>
        )}
        {m.sources && m.sources.length > 0 && (
          <div className="mt-3 border-t border-gray-200 pt-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Sources</p>
            <ul className="space-y-1">
              {m.sources.map((id) => {
                const hit = m.results?.find((h) => h.metadata.source_id === id);
                return (
                  <li key={id} className="flex items-center gap-2">
                    <Link to={`/explorer/${id}`} className="text-xs font-medium text-brand-primary hover:underline">
                      {id}
                    </Link>
                    {hit && <SeverityBadge severity={hit.metadata.cvss_severity as never} />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!m.failed && (
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            {canSpeak && (
              <button
                type="button"
                onClick={speaking ? onStop : onReplay}
                aria-label={speaking ? 'Stop speaking' : 'Read this answer aloud'}
                className="flex items-center gap-1 hover:text-gray-600"
              >
                {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
                {speaking ? 'Stop' : 'Listen'}
              </button>
            )}
            {m.mode === 'extractive' && <span>Quoted from the top record</span>}
            {m.ms !== undefined && <span>{(m.ms / 1000).toFixed(1)} s</span>}
          </div>
        )}
      </div>
    </div>
  );
}
