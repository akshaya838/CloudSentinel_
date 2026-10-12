import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as api from '../services/api';
import { SeverityAnalysis } from '../pages/SeverityAnalysis';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiUpload: vi.fn() };
});

const apiPost = vi.mocked(api.apiPost);
const apiUpload = vi.mocked(api.apiUpload);

const RESULT = {
  text: 't', entities: [],
  severity_prediction: { predicted_severity: 'CRITICAL', confidence: 0.924, contributing_words: [{ word: 'execution', weight: 0.3 }] },
  business_impact: ['Integrity'],
};
const ENGLISH = 'Remote code execution via a crafted request';

/** A stand-in for the browser's MediaRecorder: stop() delivers one chunk and fires onstop. */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported(): boolean { return true; }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    if (opts?.mimeType) this.mimeType = opts.mimeType;
    FakeRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let trackStop: ReturnType<typeof vi.fn>;

function setMicrophone(getUserMedia: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value: getUserMedia ? { getUserMedia } : undefined, configurable: true });
}

function transcribed(text: string, language: string) {
  apiUpload.mockResolvedValueOnce({ text, detected_language: language, language_probability: 0.95 } as never);
}

async function speak() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start voice input' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
}

const box = () => screen.getByLabelText('CVE description') as HTMLTextAreaElement;
const classificationCalls = () => apiPost.mock.calls.filter((c) => c[0] === '/api/v1/classification');

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  FakeRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  trackStop = vi.fn();
  setMicrophone(vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }));
  apiPost.mockImplementation(async (path: string) => {
    if (path === '/api/v1/classification') return RESULT as never;
    throw new api.ApiError('NOT_FOUND', `no fixture for ${path}`, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('voice input on the severity page', () => {
  it('records, uploads, fills the box and classifies automatically', async () => {
    transcribed(ENGLISH, 'en');
    render(<SeverityAnalysis />);
    await speak();

    await waitFor(() => expect(box().value).toBe(ENGLISH));
    await waitFor(() => expect(classificationCalls()).toEqual([['/api/v1/classification', { text: ENGLISH }]]));
    expect(await screen.findByText('92.4% confidence')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();

    const [path, form, options] = apiUpload.mock.calls[0];
    expect(path).toBe('/api/v1/voice/transcribe');
    expect((form as FormData).get('file')).toBeInstanceOf(Blob);
    expect(((form as FormData).get('file') as File).name).toBe('voice.webm');
    expect(options).toEqual({ timeout: 180000 }); // first call may load the model
    expect(screen.getByTestId('heard')).toHaveTextContent('Heard (English)');
  });

  it('releases the microphone when recording stops', async () => {
    transcribed(ENGLISH, 'en');
    render(<SeverityAnalysis />);
    await speak();
    await waitFor(() => expect(trackStop).toHaveBeenCalled());
  });

  it('shows a live recording state with a timer, then the transcribing state', async () => {
    let finish!: (v: unknown) => void;
    apiUpload.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }) as never);
    render(<SeverityAnalysis />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice input' }));
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toHaveTextContent('0:00');
    expect(screen.getByRole('status')).toHaveTextContent('Listening');

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(await screen.findByText('Transcribing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeDisabled(); // no second recording mid-upload

    finish({ text: ENGLISH, detected_language: 'en', language_probability: 0.9 });
    await waitFor(() => expect(box().value).toBe(ENGLISH));
  });

  it('with auto-classify off it only fills the box, so the text can be checked first', async () => {
    transcribed(ENGLISH, 'en');
    render(<SeverityAnalysis />);
    fireEvent.click(screen.getByLabelText('Classify automatically after I speak'));
    await speak();

    await waitFor(() => expect(box().value).toBe(ENGLISH));
    expect(classificationCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Classify' })).toBeEnabled();
  });

  it('adds spoken text after what was already typed', async () => {
    transcribed('and it needs no login.', 'en');
    render(<SeverityAnalysis />);
    fireEvent.click(screen.getByLabelText('Classify automatically after I speak'));
    fireEvent.change(box(), { target: { value: 'A flaw lets attackers run code' } });
    await speak();
    await waitFor(() => expect(box().value).toBe('A flaw lets attackers run code and it needs no login.'));
  });

  it('translates Tamil speech to English, shows what was heard, and classifies the English', async () => {
    transcribed('தொலைநிலை குறியீடு செயலாக்கம்', 'ta');
    apiPost.mockImplementation(async (path: string) => {
      if (path === '/api/v1/translation') return { translated_text: 'remote code execution flaw' } as never;
      return RESULT as never;
    });
    render(<SeverityAnalysis />);
    await speak();

    await waitFor(() => expect(box().value).toBe('remote code execution flaw'));
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/translation',
      { text: 'தொலைநிலை குறியீடு செயலாக்கம்', target_lang: 'en', source_lang: 'ta' },
      { timeout: 180000 },
    );
    await waitFor(() => expect(classificationCalls()).toEqual([['/api/v1/classification', { text: 'remote code execution flaw' }]]));
    const heard = screen.getByTestId('heard');
    expect(heard).toHaveTextContent('Heard (Tamil)');
    expect(heard).toHaveTextContent('தொலைநிலை குறியீடு செயலாக்கம்');
    expect(heard).toHaveTextContent('Translated to English');
  });

  it('if translation fails it keeps the original words, explains, and does NOT classify non-English text', async () => {
    transcribed('தொலைநிலை குறியீடு', 'ta');
    apiPost.mockImplementation(async (path: string) => {
      if (path === '/api/v1/translation') throw new api.ApiError('TRANSLATION_UNAVAILABLE', 'Translation is unavailable right now.', 503);
      return RESULT as never;
    });
    render(<SeverityAnalysis />);
    await speak();

    await waitFor(() => expect(box().value).toBe('தொலைநிலை குறியீடு'));
    expect(screen.getByTestId('heard')).toHaveTextContent('could not translate it to English');
    expect(screen.getByTestId('heard')).toHaveTextContent('Translation is unavailable right now.');
    expect(classificationCalls()).toHaveLength(0);
  });

  it('warns and does not classify when the language is one it cannot translate', async () => {
    transcribed('Bonjour le monde', 'fr');
    render(<SeverityAnalysis />);
    await speak();
    await waitFor(() => expect(box().value).toBe('Bonjour le monde'));
    expect(screen.getByTestId('heard')).toHaveTextContent('Detected fr');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('says so when no speech was detected, and changes nothing', async () => {
    transcribed('   ', 'en');
    render(<SeverityAnalysis />);
    await speak();
    expect(await screen.findByRole('alert')).toHaveTextContent('No speech was detected');
    expect(box().value).toBe('');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows the server message when transcription fails', async () => {
    apiUpload.mockRejectedValueOnce(new api.ApiError('VOICE_UNAVAILABLE', 'Speech-to-text is not installed. Run: pip install faster-whisper', 503));
    render(<SeverityAnalysis />);
    await speak();
    expect(await screen.findByRole('alert')).toHaveTextContent('pip install faster-whisper');
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeEnabled(); // can try again
  });

  it('explains when the microphone permission is refused', async () => {
    setMicrophone(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
    render(<SeverityAnalysis />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice input' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access was blocked');
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it('explains when there is no microphone', async () => {
    setMicrophone(vi.fn().mockRejectedValue(new DOMException('none', 'NotFoundError')));
    render(<SeverityAnalysis />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice input' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No microphone was found');
  });

  it('explains when the browser cannot record at all', async () => {
    setMicrophone(undefined);
    render(<SeverityAnalysis />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice input' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not supported in this browser');
  });

  it('typing and the Classify button still work without any voice', async () => {
    render(<SeverityAnalysis />);
    fireEvent.change(box(), { target: { value: 'buffer overflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Classify' }));
    expect(await screen.findByText('92.4% confidence')).toBeInTheDocument();
    expect(apiUpload).not.toHaveBeenCalled();
  });
});
