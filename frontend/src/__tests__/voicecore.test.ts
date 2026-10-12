import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSilenceDetector } from '../voice/silence';
import { chunkForSpeech, loadVoices, pickVoice, prepareForSpeech, speak, stopSpeaking } from '../voice/speech';

/** Feed the detector one reading every 100 ms: `plan` is a list of [rms, durationMs]. */
function run(plan: [number, number][], opts = {}) {
  const d = createSilenceDetector(opts);
  let t = 1000;
  let verdict = 'continue';
  for (const [rms, dur] of plan) {
    for (let i = 0; i < dur / 100; i++) {
      t += 100;
      verdict = d.push(rms, t);
      if (verdict !== 'continue') return { verdict, at: t - 1000, d };
    }
  }
  return { verdict, at: t - 1000, d };
}

describe('silence detector', () => {
  it('stops 1.4 s after speech ends', () => {
    const r = run([[0.005, 500], [0.2, 1500], [0.005, 3000]]);
    expect(r.verdict).toBe('stop');
    expect(r.at).toBeGreaterThanOrEqual(500 + 1500 + 1400 - 100);
    expect(r.at).toBeLessThanOrEqual(500 + 1500 + 1400 + 200);
    expect(r.d.heardSpeech).toBe(true);
  });

  it('keeps listening through a short pause mid-sentence', () => {
    const r = run([[0.005, 500], [0.2, 1000], [0.005, 900], [0.2, 1000], [0.005, 800]]);
    expect(r.verdict).toBe('continue');
  });

  it('gives up when nobody speaks', () => {
    const r = run([[0.005, 20000]]);
    expect(r.verdict).toBe('no-speech');
    expect(r.at).toBeGreaterThanOrEqual(8000);
    expect(r.d.heardSpeech).toBe(false);
  });

  it('never stops before speech has started, however quiet', () => {
    expect(run([[0, 5000]]).verdict).toBe('continue');
  });

  it('ignores a single click or knock', () => {
    const r = run([[0.005, 500], [0.5, 100], [0.005, 9000]]);
    expect(r.verdict).toBe('no-speech');
    expect(r.d.heardSpeech).toBe(false);
  });

  it('adapts to a noisy room: constant background hum is not speech', () => {
    const r = run([[0.05, 12000]]);
    expect(r.verdict).toBe('no-speech');
  });

  it('still hears speech that is louder than the background hum', () => {
    const r = run([[0.05, 500], [0.3, 1000], [0.05, 3000]]);
    expect(r.verdict).toBe('stop');
  });

  it('honours custom timings', () => {
    const r = run([[0.005, 500], [0.2, 600], [0.005, 2000]], { silenceMs: 500 });
    expect(r.verdict).toBe('stop');
    expect(r.at).toBeLessThan(500 + 600 + 800);
  });
});

describe('speech helpers', () => {
  it('splits text into sentences for speaking', () => {
    expect(chunkForSpeech('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
    expect(chunkForSpeech('இது ஒன்று। இது இரண்டு।')).toEqual(['இது ஒன்று।', 'இது இரண்டு।']);
    expect(chunkForSpeech('   ')).toEqual([]);
  });

  it('cuts very long sentences without losing words', () => {
    const long = Array(200).fill('word').join(' ');
    const chunks = chunkForSpeech(long, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(' ').split(' ')).toHaveLength(200);
  });

  it('reads CVE ids out digit by digit', () => {
    expect(prepareForSpeech('See CVE-2021-44228 now')).toBe('See C V E 2021 4 4 2 2 8 now');
  });

  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice;

  it('picks a voice for the right language, preferring natural ones', () => {
    const voices = [v('Zira', 'en-US'), v('Valluvar', 'ta-IN'), v('Microsoft Pallavi Online (Natural)', 'ta-IN', false), v('Hemant', 'hi-IN')];
    expect(pickVoice('ta', voices)?.name).toBe('Microsoft Pallavi Online (Natural)');
    expect(pickVoice('hi', voices)?.name).toBe('Hemant');
    expect(pickVoice('en', voices)?.name).toBe('Zira');
  });

  it('returns null rather than reading Tamil with an English voice', () => {
    expect(pickVoice('ta', [v('Zira', 'en-US')])).toBeNull();
  });

  it('understands underscore locales (Android)', () => {
    expect(pickVoice('hi', [v('x', 'hi_IN')])?.name).toBe('x');
  });
});

describe('speak()', () => {
  let spoken: string[];
  let voices: SpeechSynthesisVoice[];

  beforeEach(() => {
    spoken = [];
    voices = [{ name: 'Valluvar', lang: 'ta-IN', localService: true } as SpeechSynthesisVoice, { name: 'Zira', lang: 'en-US', localService: true } as SpeechSynthesisVoice];
    class Utter {
      text: string; voice: unknown; lang = ''; rate = 1;
      onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(t: string) { this.text = t; }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utter);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: vi.fn(),
        speak: (u: Utter) => { spoken.push(`${(u.voice as SpeechSynthesisVoice).name}:${u.text}`); u.onstart?.(); u.onend?.(); },
      },
    });
  });
  afterEach(() => {
    stopSpeaking();
    vi.unstubAllGlobals();
    // @ts-expect-error cleanup of the test double
    delete window.speechSynthesis;
  });

  it('speaks each sentence with the voice for the language and reports it started', async () => {
    const onStart = vi.fn();
    const r = await speak('Pehla vaakyam. Doosra vaakyam.', 'ta', onStart);
    expect(r).toEqual({ spoken: true });
    expect(spoken).toEqual(['Valluvar:Pehla vaakyam.', 'Valluvar:Doosra vaakyam.']);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('says there is no voice instead of staying silent', async () => {
    expect(await speak('नमस्ते', 'hi')).toEqual({ spoken: false, reason: 'no-voice' });
    expect(spoken).toEqual([]);
  });

  it('reports empty text and unsupported browsers', async () => {
    expect(await speak('   ', 'en')).toEqual({ spoken: false, reason: 'empty' });
    // @ts-expect-error simulate a browser without speech synthesis
    delete window.speechSynthesis;
    expect(await speak('hello', 'en')).toEqual({ spoken: false, reason: 'unsupported' });
  });

  it('stopSpeaking() ends a long reply between sentences', async () => {
    const synth = window.speechSynthesis as unknown as { speak: (u: { voice: unknown; text: string; onend: (() => void) | null }) => void };
    synth.speak = (u) => {
      spoken.push(u.text);
      if (spoken.length === 1) stopSpeaking();
      u.onend?.();
    };
    await speak('One. Two. Three.', 'en');
    expect(spoken).toEqual(['One.']);
  });

  it('does not hang when the engine never reports the end of an utterance', async () => {
    vi.useFakeTimers();
    try {
      (window.speechSynthesis as unknown as { speak: () => void }).speak = () => {}; // stalled engine
      const p = speak('Hello.', 'en');
      await vi.advanceTimersByTimeAsync(10000);
      expect(await p).toEqual({ spoken: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for voices that load late (Chrome)', async () => {
    voices = [];
    let fire: () => void = () => {};
    (window.speechSynthesis as unknown as { addEventListener: (e: string, f: () => void) => void }).addEventListener = (_e, f) => { fire = f; };
    const p = loadVoices(5000);
    voices = [{ name: 'Late', lang: 'en-US' } as SpeechSynthesisVoice];
    fire();
    expect((await p).map((x) => x.name)).toEqual(['Late']);
  });
});
