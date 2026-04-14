"""
HTTP server that wraps CosyVoice TTS Python package for local text-to-speech.

Exposes an OpenAI-compatible /v1/audio/speech endpoint so the frontend
provider can use standard fetch calls.

Usage:
    python3 scripts/cosyvoice-server.py [--port 10097] [--device cpu]
"""

import argparse
import io
import json
import sys
import warnings
from http.server import HTTPServer, BaseHTTPRequestHandler

warnings.filterwarnings('ignore', message='.*LibreSSL.*')

# Parse arguments before heavy imports so --help is fast
parser = argparse.ArgumentParser(description='CosyVoice TTS HTTP server')
parser.add_argument('--port', type=int, default=10097)
parser.add_argument('--device', type=str, default='cpu')
args = parser.parse_args()

import torch  # noqa: E402

use_cuda = args.device == 'cuda' and torch.cuda.is_available()
use_fp16 = use_cuda

print(f'[cosyvoice-server] Loading CosyVoice-300M-SFT device={args.device}, cuda={use_cuda}, fp16={use_fp16}', flush=True)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from cosyvoice.cli.cosyvoice import CosyVoice  # noqa: E402

cosyvoice = CosyVoice('iic/CosyVoice-300M-SFT', load_jit=False, fp16=use_fp16)

print('[cosyvoice-server] Model loaded', flush=True)

# SFT preset voices from CosyVoice-300M-SFT
# NOTICE: Upstream CosyVoice fixed the typo from list_avaliable_spks → list_available_spks.
# Support both for compatibility with older checkouts.
_list_spks = getattr(cosyvoice, 'list_available_spks', None) or getattr(cosyvoice, 'list_avaliable_spks')
AVAILABLE_VOICES = list(_list_spks())
print(f'[cosyvoice-server] Available voices: {AVAILABLE_VOICES}', flush=True)


def generate_speech(text: str, voice: str) -> bytes:
    """Generate speech audio from text and return WAV bytes."""
    output = cosyvoice.inference_sft(text, voice)

    audio_segments = []
    for result in output:
        audio = result['tts_speech']
        if hasattr(audio, 'numpy'):
            audio = audio.numpy()
        audio_segments.append(np.array(audio).flatten())

    if not audio_segments:
        raise RuntimeError('No audio generated')

    full_audio = np.concatenate(audio_segments)

    buf = io.BytesIO()
    sf.write(buf, full_audio, 22050, format='WAV')
    return buf.getvalue()


class CosyVoiceHandler(BaseHTTPRequestHandler):
    """HTTP request handler for CosyVoice TTS."""

    def log_message(self, format, *log_args):
        print(f'[cosyvoice-server] {format % log_args}', flush=True)

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
            self._send_json(200, {'status': 'ok', 'model': 'CosyVoice-300M-SFT'})
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
                voice = body.get('voice', AVAILABLE_VOICES[0] if AVAILABLE_VOICES else '')

                if not text:
                    self._send_json(400, {'error': 'input text is required'})
                    return

                if not voice or voice not in AVAILABLE_VOICES:
                    self._send_json(400, {'error': f'voice must be one of: {AVAILABLE_VOICES}'})
                    return

                print(f'[cosyvoice-server] Generating speech: voice={voice}, text="{text[:80]}..."', flush=True)

                wav_bytes = generate_speech(text, voice)

                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(wav_bytes)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(wav_bytes)

                print(f'[cosyvoice-server] Generated {len(wav_bytes)} bytes of audio', flush=True)

            except Exception as e:
                print(f'[cosyvoice-server] Generation error: {e}', flush=True)
                import traceback
                traceback.print_exc()
                self._send_json(500, {'error': str(e)})
        else:
            self._send_json(404, {'error': 'Not found'})


def main():
    server = HTTPServer(('0.0.0.0', args.port), CosyVoiceHandler)
    print(f'[cosyvoice-server] Listening on http://0.0.0.0:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[cosyvoice-server] Shutting down...', flush=True)
        server.shutdown()


if __name__ == '__main__':
    main()
