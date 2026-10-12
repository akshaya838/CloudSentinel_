def transcribe_audio(audio_path: str, language: str | None = None) -> dict:
    from ml.voice.voice_io import transcribe
    return transcribe(audio_path, language=language)


def synthesize_speech(text: str, output_path: str) -> str:
    from ml.voice.voice_io import speak
    return speak(text, output_path)
