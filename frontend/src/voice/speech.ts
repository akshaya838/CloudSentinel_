/**
 * Spoken replies through the browser's built-in speech synthesis. It is instant (no server round
 * trip, no model to load) and uses whatever voices the device has; Tamil and Hindi voices ship with
 * Windows, macOS, Android and iOS, and Edge adds natural ones.
 */
export type SpeechLang = 'en' | 'ta' | 'hi';

const LOCALES: Record<SpeechLang, string[]> = {
  en: ['en-IN', 'en-GB', 'en-US', 'en'],
  ta: ['ta-IN', 'ta'],
  hi: ['hi-IN', 'hi'],
};

export const speechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

function allVoices(): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

/** Voices load asynchronously in Chrome; resolve once they are available (or after a short wait). */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const now = allVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', done);
      resolve(allVoices());
    };
    window.speechSynthesis.addEventListener?.('voiceschanged', done);
    window.setTimeout(done, timeoutMs);
  });
}

export function pickVoice(lang: SpeechLang, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();
  for (const locale of LOCALES[lang]) {
    const matches = voices.filter((v) => norm(v) === locale.toLowerCase() || (locale.length === 2 && norm(v).startsWith(locale + '-')));
    if (matches.length) {
      // prefer natural/neural voices, then ones that run on this device
      return matches.find((v) => /natural|neural|online/i.test(v.name)) ?? matches.find((v) => v.localService) ?? matches[0];
    }
  }
  return null;
}

/** Long text is spoken sentence by sentence: Chrome silently cuts off a single utterance after ~15 s. */
export function chunkForSpeech(text: string, maxLen = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?।॥])\s+/);
  const chunks: string[] = [];
  for (const s of sentences) {
    let rest = s;
    while (rest.length > maxLen) {
      const cut = rest.lastIndexOf(' ', maxLen);
      const at = cut > 0 ? cut : maxLen;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}

/** Make identifiers sound right: "CVE-2021-44228" is read digit by digit, not as a date. */
export function prepareForSpeech(text: string): string {
  return text.replace(/CVE-(\d{4})-(\d{4,7})/gi, (_m, y: string, n: string) => `C V E ${y} ${n.split('').join(' ')}`);
}

export interface SpeakResult {
  spoken: boolean;
  reason?: 'unsupported' | 'no-voice' | 'empty';
}

let session = 0; // bumped by stopSpeaking so an old queue never keeps talking

export function stopSpeaking(): void {
  session += 1;
  if (speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing to stop */
    }
  }
}

/**
 * Speak `text` in `lang`. Resolves when finished, interrupted or failed; never throws.
 * Returns spoken=false (with a reason) when this device has no voice for the language, so the caller
 * can say so instead of staying silent or reading Tamil with an English voice.
 */
export async function speak(text: string, lang: SpeechLang, onStart?: () => void): Promise<SpeakResult> {
  if (!speechSupported()) return { spoken: false, reason: 'unsupported' };
  const chunks = chunkForSpeech(prepareForSpeech(text));
  if (chunks.length === 0) return { spoken: false, reason: 'empty' };

  const voices = await loadVoices();
  const voice = pickVoice(lang, voices);
  if (!voice) return { spoken: false, reason: 'no-voice' };

  stopSpeaking();
  const mine = session;
  let started = false;

  for (const chunk of chunks) {
    if (mine !== session) break;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1;
      // Some browsers never fire onend (a stalled engine, a cancelled queue). Never hang the UI on that.
      const watchdog = window.setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* nothing to cancel */
        }
        resolve();
      }, 5000 + chunk.length * 120);
      const finish = () => {
        window.clearTimeout(watchdog);
        resolve();
      };
      u.onstart = () => {
        if (!started) {
          started = true;
          onStart?.();
        }
      };
      u.onend = finish;
      u.onerror = finish;
      try {
        window.speechSynthesis.speak(u);
      } catch {
        finish();
      }
    });
  }
  return { spoken: true };
}
