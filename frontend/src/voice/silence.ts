/**
 * Decides when someone has finished speaking, from a stream of loudness readings (RMS, 0..1).
 *
 * - The first ~400 ms measure the room's background noise; the speech threshold sits above it, so a
 *   fan or a quiet room does not keep the recording open (or end it too early).
 * - Speech counts as started after ~250 ms of sound above the threshold, which ignores a single click.
 * - After speech has started, `silenceMs` of quiet ends the recording.
 * - If nobody speaks within `noSpeechMs`, it gives up so the microphone is not left open.
 */
export type SilenceVerdict = 'continue' | 'stop' | 'no-speech';

export interface SilenceOptions {
  silenceMs?: number;
  noSpeechMs?: number;
  calibrationMs?: number;
  minSpeechMs?: number;
}

export function createSilenceDetector(opts: SilenceOptions = {}) {
  const silenceMs = opts.silenceMs ?? 1400;
  const noSpeechMs = opts.noSpeechMs ?? 8000;
  const calibrationMs = opts.calibrationMs ?? 400;
  const minSpeechMs = opts.minSpeechMs ?? 250;

  let startedAt: number | null = null;
  let lastTick = 0;
  let floor = Infinity;
  let speechMs = 0;
  let speaking = false;
  let lastLoudAt = 0;

  const threshold = () => Math.max(0.02, (Number.isFinite(floor) ? floor : 0) * 2.5 + 0.01);

  return {
    push(rms: number, now: number): SilenceVerdict {
      if (startedAt === null) {
        startedAt = now;
        lastTick = now;
      }
      const dt = now - lastTick;
      lastTick = now;
      const elapsed = now - startedAt;

      if (elapsed < calibrationMs) {
        floor = Math.min(floor, rms);
        return 'continue';
      }
      if (rms > threshold()) {
        speechMs += dt;
        lastLoudAt = now;
        if (speechMs >= minSpeechMs) speaking = true;
      } else if (!speaking) {
        speechMs = 0; // sound must be sustained, not scattered clicks
      }
      if (speaking) return now - lastLoudAt >= silenceMs ? 'stop' : 'continue';
      return elapsed >= noSpeechMs ? 'no-speech' : 'continue';
    },
    get heardSpeech() {
      return speaking;
    },
    get threshold() {
      return threshold();
    },
  };
}
