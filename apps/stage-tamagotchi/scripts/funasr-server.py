"""
Minimal WebSocket server that bridges FunASR AutoModel (SenseVoice) to the
FunASR WebSocket protocol expected by the stage-ui frontend.

Protocol (matches legacy funasr.bin.server):
1. Client connects via WebSocket.
2. Client sends a JSON first-frame: { mode, chunk_size, wav_format, audio_fs, is_speaking, ... }
3. Client streams raw PCM16 audio as binary frames.
4. Client sends JSON { is_speaking: false } to signal end-of-stream.
5. Server responds with JSON { text, mode, is_final } messages.

Usage:
    python3 scripts/funasr-server.py [--port 10095] [--device cpu]
"""

import argparse
import asyncio
import json
import sys
import warnings

warnings.filterwarnings('ignore', message='.*LibreSSL.*')

# Parse arguments before heavy imports so --help is fast
parser = argparse.ArgumentParser(description='FunASR SenseVoice WebSocket server')
parser.add_argument('--port', type=int, default=10095)
parser.add_argument('--device', type=str, default='cpu')
parser.add_argument('--model', type=str, default='iic/SenseVoiceSmall')
parser.add_argument('--vad-model', type=str, default='iic/speech_fsmn_vad_zh-cn-16k-common-pytorch')
args = parser.parse_args()

print(f'[funasr-server] Loading model={args.model} vad={args.vad_model} device={args.device}', flush=True)

import numpy as np  # noqa: E402
from funasr import AutoModel  # noqa: E402

model = AutoModel(
    model=args.model,
    vad_model=args.vad_model,
    device=args.device,
    disable_update=True,
)

print(f'[funasr-server] Model loaded, starting WebSocket server on port {args.port}', flush=True)

try:
    import websockets  # noqa: E402
except ImportError:
    print('[funasr-server] Installing websockets...', flush=True)
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'websockets', '-q'])
    import websockets  # noqa: E402


async def handle_client(websocket):
    """Handle a single WebSocket client session."""
    audio_chunks = bytearray()
    sample_rate = 16000
    configured = False
    # Track how many bytes we've already processed for partial inference,
    # so we only run inference on new audio segments.
    last_inference_offset = 0
    inference_lock = asyncio.Lock()

    # NOTICE: The frontend streams audio continuously from the microphone and only
    # sends `is_speaking: false` when the session ends (abort/idle timeout). To
    # provide real-time transcription we run partial inference periodically on new
    # audio segments (~3 seconds of audio = 96000 bytes at 16kHz 16-bit mono).
    PARTIAL_INFERENCE_BYTES = 96000

    print(f'[funasr-server] Client connected', flush=True)

    try:
        async for message in websocket:
            if isinstance(message, str):
                # JSON control frame
                data = json.loads(message)
                print(f'[funasr-server] JSON frame: {data}', flush=True)

                if not configured:
                    # First-frame configuration
                    sample_rate = data.get('audio_fs', 16000)
                    configured = True
                    continue

                if data.get('is_speaking') is False:
                    # End-of-stream: run inference on remaining audio
                    remaining = len(audio_chunks) - last_inference_offset
                    duration_s = remaining / (sample_rate * 2) if remaining > 0 else 0
                    print(f'[funasr-server] End of stream, remaining={remaining} bytes ({duration_s:.1f}s)', flush=True)

                    if remaining > 0:
                        async with inference_lock:
                            segment = bytes(audio_chunks[last_inference_offset:])
                            result = await asyncio.get_event_loop().run_in_executor(
                                None, _run_inference, segment, sample_rate
                            )
                            print(f'[funasr-server] Final result: "{result}"', flush=True)
                            if result:
                                response = json.dumps({
                                    'text': result,
                                    'mode': '2pass-offline',
                                    'is_final': True,
                                })
                                await websocket.send(response)
                    audio_chunks.clear()
                    last_inference_offset = 0
            else:
                # Binary audio frame
                audio_chunks.extend(message)

                # Run partial inference on new audio segments periodically
                new_bytes = len(audio_chunks) - last_inference_offset
                if new_bytes >= PARTIAL_INFERENCE_BYTES and not inference_lock.locked():
                    segment = bytes(audio_chunks[last_inference_offset:])
                    last_inference_offset = len(audio_chunks)

                    async with inference_lock:
                        result = await asyncio.get_event_loop().run_in_executor(
                            None, _run_inference, segment, sample_rate
                        )
                        if result:
                            print(f'[funasr-server] Partial result: "{result}"', flush=True)
                            await websocket.send(json.dumps({
                                'text': result,
                                'mode': '2pass-online',
                                'is_final': False,
                            }))

    except websockets.exceptions.ConnectionClosed:
        print(f'[funasr-server] Client disconnected', flush=True)
    except Exception as e:
        print(f'[funasr-server] Client error: {e}', flush=True)
        import traceback
        traceback.print_exc()


def _run_inference(pcm_bytes: bytes, sample_rate: int) -> str:
    """Run SenseVoice inference on raw PCM16 audio bytes."""
    # Convert raw PCM16 bytes to float32 numpy array (funasr accepts numpy arrays directly)
    pcm_array = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    print(f'[funasr-server] Running inference on {len(pcm_array)} samples ({len(pcm_array)/sample_rate:.1f}s)', flush=True)

    try:
        results = model.generate(input=pcm_array, input_len=np.array([len(pcm_array)]), fs=sample_rate)
        print(f'[funasr-server] Raw results: {results}', flush=True)

        if results and len(results) > 0:
            # NOTICE: AutoModel.generate() returns a list of dicts.
            # Each dict has a 'text' key with the transcription string.
            # SenseVoice includes emotion/language tags like <|HAPPY|> in the text.
            texts = []
            for r in results:
                if isinstance(r, dict) and 'text' in r:
                    text = r['text'].strip()
                    if text:
                        texts.append(text)
            return ' '.join(texts)
    except Exception as e:
        print(f'[funasr-server] Inference error: {e}', flush=True)
        import traceback
        traceback.print_exc()

    return ''


async def main():
    async with websockets.serve(handle_client, '0.0.0.0', args.port):
        print(f'[funasr-server] Listening on ws://0.0.0.0:{args.port}', flush=True)
        await asyncio.Future()  # run forever


if __name__ == '__main__':
    asyncio.run(main())
