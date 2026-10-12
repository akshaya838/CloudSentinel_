import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import * as api from '../services/api';
import * as speech from '../voice/speech';
import { Assistant } from '../pages/Assistant';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiUpload: vi.fn() };
});
vi.mock('../voice/speech', async () => {
  const actual = await vi.importActual<typeof import('../voice/speech')>('../voice/speech');
  return { ...actual, speak: vi.fn(), stopSpeaking: vi.fn(), speechSupported: vi.fn(() => true) };
});

const apiGet = vi.mocked(api.apiGet);
const apiPost = vi.mocked(api.apiPost);
const apiUpload = vi.mocked(api.apiUpload);
const speak = vi.mocked(speech.speak);
const stopSpeaking = vi.mocked(speech.stopSpeaking);

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported() { return true; }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { FakeRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc']) });
    this.onstop?.();
  }
}

const ANSWER = (over: Record<string, unknown> = {}) => ({
  question: 'q', question_en: 'q', detected_language: 'English', response_language: 'English', response_lang_code: 'en',
  answer: 'Log4Shell allows remote code execution.', answer_mode: 'llm', generation_note: null,
  sources: ['CVE-2021-44228'],
  results: [{ text: 'Apache Log4j2 ...', distance: 0.2, metadata: { source_id: 'CVE-2021-44228', cvss_severity: 'CRITICAL' } }],
  timings_ms: { total: 2400 },
  ...over,
});

const transcribed = (text: string, lang = 'en') =>
  apiUpload.mockResolvedValueOnce({ text, detected_language: lang, language_probability: 0.9 } as never);

function renderPage() {
  return render(<MemoryRouter><Assistant /></MemoryRouter>);
}

const mic = () => screen.getByRole('button', { name: /Start listening|Stop listening/ });
async function talk() {
  fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop listening' }));
}
const recorders = () => FakeRecorder.instances;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  FakeRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
  apiGet.mockResolvedValue({ steps: {}, ready: true } as never);
  apiPost.mockResolvedValue(ANSWER() as never);
  speak.mockResolvedValue({ spoken: true });
  vi.mocked(speech.speechSupported).mockReturnValue(true);
});

describe('voice assistant', () => {
  it('is named CloudSentinel and offers a microphone first', () => {
    renderPage();
    expect(screen.getByText('CloudSentinel Voice Assistant')).toBeInTheDocument();
    expect(mic()).toBeEnabled();
    expect(screen.getByText(/Tap the microphone and ask a question/)).toBeInTheDocument();
  });

  it('speak -> transcribe -> answer -> read aloud, end to end', async () => {
    transcribed('Explain CVE-2021-44228');
    renderPage();
    await talk();
    expect(await screen.findByText('Log4Shell allows remote code execution.')).toBeInTheDocument();

    const form = apiUpload.mock.calls[0][1] as FormData;
    expect(apiUpload.mock.calls[0][0]).toBe('/api/v1/voice/transcribe');
    expect((form.get('file') as File).name).toBe('voice.webm');
    expect(form.has('language')).toBe(false); // Auto: let the server detect
    expect(apiPost).toHaveBeenCalledWith('/api/v1/assistant',
      expect.objectContaining({ question: 'Explain CVE-2021-44228', target_lang: undefined, history: [] }),
      expect.objectContaining({ timeout: expect.any(Number) }));
    expect(screen.getByText('Explain CVE-2021-44228')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CVE-2021-44228' })).toHaveAttribute('href', '/explorer/CVE-2021-44228');
    expect(screen.getByText('2.4 s')).toBeInTheDocument();
    await waitFor(() => expect(speak).toHaveBeenCalledWith('Log4Shell allows remote code execution.', 'en'));
  });

  it('a chosen language is used for recognition and for the reply', async () => {
    transcribed('லாக்4ஷெல் என்றால் என்ன', 'ta');
    apiPost.mockResolvedValueOnce(ANSWER({ answer: 'லாக்4ஷெல் ஒரு பாதிப்பு.', response_lang_code: 'ta', question_en: 'What is Log4Shell' }) as never);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'தமிழ்' }));
    await talk();
    expect(await screen.findByText('லாக்4ஷெல் ஒரு பாதிப்பு.')).toBeInTheDocument();
    expect((apiUpload.mock.calls[0][1] as FormData).get('language')).toBe('ta');
    expect(apiPost.mock.calls[0][1]).toMatchObject({ target_lang: 'ta' });
    expect(screen.getByText(/Understood as: What is Log4Shell/)).toBeInTheDocument();
    await waitFor(() => expect(speak).toHaveBeenCalledWith('லாக்4ஷெல் ஒரு பாதிப்பு.', 'ta'));
  });

  it('typing works without a microphone and the mic is disabled with an explanation', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    renderPage();
    expect(mic()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'Explain CVE-2021-44228.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByText('Log4Shell allows remote code execution.')).toBeInTheDocument();
  });

  it('follow-up questions carry the earlier turns and their sources', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'Explain CVE-2021-44228.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('Log4Shell allows remote code execution.');
    apiPost.mockResolvedValueOnce(ANSWER({ answer: 'Upgrade to Log4j 2.17.1.' }) as never);
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'How do I patch it?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('Upgrade to Log4j 2.17.1.');
    expect(apiPost.mock.calls[1][1]).toMatchObject({
      question: 'How do I patch it?',
      history: [
        { role: 'user', content: 'Explain CVE-2021-44228.', sources: [] },
        { role: 'assistant', content: 'Log4Shell allows remote code execution.', sources: ['CVE-2021-44228'] },
      ],
    });
  });

  it('does not speak when spoken replies are turned off, and the preference is remembered', async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Speak replies'));
    expect(JSON.parse(localStorage.getItem('cloudsentinel_assistant_prefs')!).voiceReplies).toBe(false);
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('Log4Shell allows remote code execution.');
    expect(speak).not.toHaveBeenCalled();
    cleanup();
    renderPage();
    expect(screen.getByLabelText('Speak replies')).not.toBeChecked();
  });

  it('says so when the device has no voice for the reply language', async () => {
    speak.mockResolvedValue({ spoken: false, reason: 'no-voice' });
    apiPost.mockResolvedValueOnce(ANSWER({ answer: 'उत्तर', response_lang_code: 'hi' }) as never);
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByText(/no Hindi voice installed/)).toBeInTheDocument();
    expect(screen.getByText('उत्तर')).toBeInTheDocument(); // the text is still shown
  });

  it('a replay button reads an answer again', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('Log4Shell allows remote code execution.');
    speak.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: 'Read this answer aloud' }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
  });

  it('talking over a reply stops it (barge-in)', async () => {
    renderPage();
    stopSpeaking.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    expect(stopSpeaking).toHaveBeenCalled();
  });

  it('shows the refusal, not an invented answer, when nothing relevant is found', async () => {
    apiPost.mockResolvedValueOnce(ANSWER({ answer: null, sources: [], results: [], generation_note: "I couldn't find enough information in the indexed vulnerability data to answer this reliably." }) as never);
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'capital of France' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByText(/couldn't find enough information/)).toBeInTheDocument();
  });

  it('flags an answer quoted directly from a record when the language model is down', async () => {
    apiPost.mockResolvedValueOnce(ANSWER({ answer_mode: 'extractive', generation_note: 'The language model is not running, so this is the top matching record quoted directly.' }) as never);
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByText(/language model is not running/)).toBeInTheDocument();
    expect(screen.getByText('Quoted from the top record')).toBeInTheDocument();
  });

  it('a backend failure shows the message with Retry, and Retry asks again', async () => {
    apiPost.mockRejectedValueOnce(new api.ApiError('ASSISTANT_UNAVAILABLE', 'Vector index not found.', 503));
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByText('Vector index not found.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Log4Shell allows remote code execution.')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(2);
  });

  it('a failed turn is not sent back as history', async () => {
    apiPost.mockRejectedValueOnce(new api.ApiError('ASSISTANT_UNAVAILABLE', 'down', 503));
    renderPage();
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('down');
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('Log4Shell allows remote code execution.');
    expect((apiPost.mock.calls[1][1] as { history: unknown[] }).history).toEqual([{ role: 'user', content: 'first', sources: [] }]);
  });

  it('tells the user when no words were recognised and does not ask the assistant', async () => {
    transcribed('   ');
    renderPage();
    await talk();
    expect(await screen.findByText(/couldn't make out any words/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows a transcription error from the server', async () => {
    apiUpload.mockRejectedValueOnce(new api.ApiError('TRANSCRIPTION_FAILED', 'Could not transcribe this recording. Please try again.', 503));
    renderPage();
    await talk();
    expect(await screen.findByText(/Could not transcribe this recording/)).toBeInTheDocument();
    expect(mic()).toBeEnabled(); // ready to try again
  });

  it('hands-free listens again after the reply, and stops after an error', async () => {
    transcribed('Explain CVE-2021-44228');
    renderPage();
    fireEvent.click(screen.getByLabelText(/Hands-free/));
    await talk();
    await screen.findByText('Log4Shell allows remote code execution.');
    await waitFor(() => expect(recorders().length).toBe(2)); // a second recording started by itself
    expect(recorders()[1].state).toBe('recording');

    apiUpload.mockRejectedValueOnce(new api.ApiError('TRANSCRIPTION_FAILED', 'boom', 503));
    await act(async () => { recorders()[1].stop(); });
    await screen.findByText('boom');
    await waitFor(() => expect(screen.getByLabelText(/Hands-free/)).not.toBeChecked());
    expect(recorders().length).toBe(2); // no endless retry loop
  });

  it('hands-free switches itself off when the assistant call fails', async () => {
    apiPost.mockRejectedValueOnce(new api.ApiError('ASSISTANT_UNAVAILABLE', 'down', 503));
    renderPage();
    fireEvent.click(screen.getByLabelText(/Hands-free/));
    fireEvent.change(screen.getByLabelText('Type a question'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await screen.findByText('down');
    expect(screen.getByLabelText(/Hands-free/)).not.toBeChecked();
    expect(recorders().length).toBe(0);
  });

  it('shows a loading banner while models warm up', async () => {
    apiGet.mockResolvedValue({ steps: { translation: 'loading' }, ready: false } as never);
    renderPage();
    expect(await screen.findByText(/still loading after the server start/)).toBeInTheDocument();
  });

  it('works when the warm-up endpoint is unreachable', async () => {
    apiGet.mockRejectedValue(new api.ApiError('NETWORK_ERROR', 'x', 0));
    renderPage();
    expect(screen.queryByText(/still loading/)).not.toBeInTheDocument();
    expect(mic()).toBeEnabled();
  });
});
