import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useVoiceRecorder, type RecordingResult } from '../voice/useVoiceRecorder';

class FakeRecorder {
  static isTypeSupported() { return true; }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc']) });
    this.onstop?.();
  }
}

let amp = 0.005; // what the fake microphone "hears"
let ctxClosed = 0;
class FakeAudioContext {
  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData(buf: Uint8Array) { for (let i = 0; i < buf.length; i++) buf[i] = 128 + (i % 2 ? 1 : -1) * Math.round(amp * 128); } };
  }
  createMediaStreamSource() { return { connect() {} }; }
  resume() { return Promise.resolve(); }
  close() { ctxClosed++; return Promise.resolve(); }
}

let results: RecordingResult[];
let trackStop: ReturnType<typeof vi.fn>;

function Harness({ opts }: { opts?: { silenceMs?: number; noSpeechMs?: number; maxMs?: number } }) {
  const r = useVoiceRecorder((x) => results.push(x), opts);
  return (
    <div>
      <button onClick={() => void r.start()}>start</button>
      <button onClick={r.stop}>stop</button>
      <button onClick={r.cancel}>cancel</button>
      <span data-testid="state">{r.state}</span>
      <span data-testid="level">{r.level.toFixed(2)}</span>
      {r.error && <p role="alert">{r.error}</p>}
    </div>
  );
}

const click = (name: string) => act(async () => { screen.getByText(name).click(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  results = [];
  amp = 0.005;
  ctxClosed = 0;
  trackStop = vi.fn();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useVoiceRecorder', () => {
  it('stops by itself shortly after the speaker goes quiet and hands over the audio', async () => {
    render(<Harness />);
    await click('start');
    expect(state()).toBe('listening');
    await advance(600);
    amp = 0.2;
    await advance(1500);
    expect(state()).toBe('listening'); // still talking
    amp = 0.005;
    await advance(2000);
    expect(state()).toBe('idle');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ reason: 'silence', heardSpeech: true });
    expect(results[0].blob.size).toBeGreaterThan(0);
    expect(trackStop).toHaveBeenCalled(); // microphone released
    expect(ctxClosed).toBe(1);
  });

  it('gives up when nobody speaks and says so', async () => {
    render(<Harness />);
    await click('start');
    await advance(9000);
    expect(state()).toBe('idle');
    expect(results[0]).toMatchObject({ reason: 'no-speech', heardSpeech: false });
  });

  it('drives the level meter from the microphone', async () => {
    render(<Harness />);
    await click('start');
    await advance(700);
    amp = 0.1;
    await advance(300);
    expect(Number(screen.getByTestId('level').textContent)).toBeGreaterThan(0.3);
  });

  it('manual stop sends immediately', async () => {
    render(<Harness />);
    await click('start');
    await advance(300);
    await click('stop');
    expect(results[0].reason).toBe('manual');
    expect(state()).toBe('idle');
  });

  it('cancel discards the recording', async () => {
    render(<Harness />);
    await click('start');
    await click('cancel');
    expect(results).toHaveLength(0);
    expect(trackStop).toHaveBeenCalled();
    expect(state()).toBe('idle');
  });

  it('enforces the maximum length', async () => {
    render(<Harness opts={{ maxMs: 2000, noSpeechMs: 60000 }} />);
    await click('start');
    amp = 0.2; // keep talking
    await advance(2500);
    expect(results[0].reason).toBe('max-length');
  });

  it('a second start while listening does nothing', async () => {
    render(<Harness />);
    await click('start');
    await click('start');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('explains a blocked microphone', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    render(<Harness />);
    await click('start');
    expect(screen.getByRole('alert').textContent).toMatch(/blocked/);
    expect(state()).toBe('idle');
  });

  it('works without Web Audio (manual stop only)', async () => {
    vi.stubGlobal('AudioContext', undefined);
    render(<Harness />);
    await click('start');
    await advance(20000);
    expect(state()).toBe('listening');
    await click('stop');
    expect(results).toHaveLength(1);
  });

  it('releases the microphone if the page is left while recording', async () => {
    const { unmount } = render(<Harness />);
    await click('start');
    unmount();
    expect(trackStop).toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });
});
