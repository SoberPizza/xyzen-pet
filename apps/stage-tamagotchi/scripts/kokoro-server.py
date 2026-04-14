"""
HTTP server that wraps Kokoro TTS Python package for local text-to-speech.

Exposes an OpenAI-compatible /v1/audio/speech endpoint so the frontend
provider can use standard fetch calls.

Usage:
    python3 scripts/kokoro-server.py [--port 10096] [--device cpu]
"""

import argparse
import io
import json
import sys
import warnings
from http.server import HTTPServer, BaseHTTPRequestHandler

warnings.filterwarnings('ignore', message='.*LibreSSL.*')

# Parse arguments before heavy imports so --help is fast
parser = argparse.ArgumentParser(description='Kokoro TTS HTTP server')
parser.add_argument('--port', type=int, default=10096)
parser.add_argument('--device', type=str, default='cpu')
parser.add_argument('--model', type=str, default='kokoro')
args = parser.parse_args()

print(f'[kokoro-server] Loading model={args.model} device={args.device}', flush=True)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from kokoro import KPipeline  # noqa: E402

pipeline = KPipeline(lang_code='a', device=args.device)

print(f'[kokoro-server] Model loaded, starting HTTP server on port {args.port}', flush=True)

# Cache available voices from the pipeline
AVAILABLE_VOICES = []
try:
    # Kokoro exposes voices through its internal voice list
    # Try to get voices from the pipeline
    if hasattr(pipeline, 'voices') and pipeline.voices:
        AVAILABLE_VOICES = list(pipeline.voices)
    else:
        # Fallback to common Kokoro v1 voices
        AVAILABLE_VOICES = [
            'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica',
            'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
            'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx',
            'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
            'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
        ]
except Exception:
    AVAILABLE_VOICES = ['af_heart']

print(f'[kokoro-server] Available voices: {len(AVAILABLE_VOICES)}', flush=True)


def generate_speech(text: str, voice: str = 'af_heart') -> bytes:
    """Generate speech audio from text and return WAV bytes."""
    audio_segments = []

    for _graphemes, _phonemes, audio in pipeline(text, voice=voice):
        if audio is not None:
            audio_segments.append(audio.numpy() if hasattr(audio, 'numpy') else np.array(audio))

    if not audio_segments:
        raise RuntimeError('No audio generated')

    full_audio = np.concatenate(audio_segments)

    # Write to WAV bytes
    buf = io.BytesIO()
    sf.write(buf, full_audio, 24000, format='WAV')
    return buf.getvalue()


class KokoroHandler(BaseHTTPRequestHandler):
    """HTTP request handler for Kokoro TTS."""

    def log_message(self, format, *log_args):
        print(f'[kokoro-server] {format % log_args}', flush=True)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_OPTIONS(self):
        self._send_cors_headers()

    def do_GET(self):
        if self.path == '/health':
            self._send_json(200, {'status': 'ok', 'model': args.model})
        elif self.path == '/v1/voices':
            voices = [{'id': v, 'name': v} for v in AVAILABLE_VOICES]
            self._send_json(200, {'voices': voices})
        else:
            self._send_json(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/v1/audio/speech':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(content_length))

                text = body.get('input', '')
                voice = body.get('voice', 'af_heart')

                if not text:
                    self._send_json(400, {'error': 'input text is required'})
                    return

                print(f'[kokoro-server] Generating speech: voice={voice}, text="{text[:80]}..."', flush=True)

                wav_bytes = generate_speech(text, voice)

                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(wav_bytes)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(wav_bytes)

                print(f'[kokoro-server] Generated {len(wav_bytes)} bytes of audio', flush=True)

            except Exception as e:
                print(f'[kokoro-server] Generation error: {e}', flush=True)
                import traceback
                traceback.print_exc()
                self._send_json(500, {'error': str(e)})
        else:
            self._send_json(404, {'error': 'Not found'})


def main():
    server = HTTPServer(('0.0.0.0', args.port), KokoroHandler)
    print(f'[kokoro-server] Listening on http://0.0.0.0:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[kokoro-server] Shutting down...', flush=True)
        server.shutdown()


if __name__ == '__main__':
    main()
