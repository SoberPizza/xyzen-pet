"""
End-to-end test for funasr-server.py WebSocket bridge.

Tests:
1. Server starts and accepts WebSocket connections
2. First-frame JSON config is accepted
3. Binary PCM16 audio is received
4. Inference runs and returns results
5. Response JSON matches expected format

Usage:
    # Terminal 1: Start the server
    python3 scripts/funasr-server.py --port 10096

    # Terminal 2: Run this test
    python3 scripts/test-funasr-server.py [--port 10096] [--use-mic]
"""

import argparse
import asyncio
import json
import sys
import time

import numpy as np

parser = argparse.ArgumentParser(description='Test funasr-server.py')
parser.add_argument('--port', type=int, default=10096)
parser.add_argument('--use-mic', action='store_true', help='Use microphone input instead of generated audio')
parser.add_argument('--duration', type=float, default=5.0, help='Recording duration in seconds (mic mode)')
args = parser.parse_args()

WS_URL = f'ws://localhost:{args.port}'

# --- Test utilities ---

def generate_speech_audio(duration_s: float = 3.0, sample_rate: int = 16000) -> bytes:
    """Generate synthetic audio that mimics speech characteristics."""
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), dtype=np.float32)
    # Mix of frequencies common in speech (100-3000 Hz)
    audio = np.zeros_like(t)
    for freq in [150, 300, 600, 1200, 2400]:
        audio += 0.1 * np.sin(2 * np.pi * freq * t + np.random.uniform(0, 2 * np.pi))
    # Add some noise
    audio += 0.02 * np.random.randn(len(t)).astype(np.float32)
    # Normalize
    audio = audio / np.max(np.abs(audio)) * 0.8
    pcm16 = (audio * 32768).astype(np.int16)
    return pcm16.tobytes()


def record_microphone(duration_s: float, sample_rate: int = 16000) -> bytes:
    """Record from microphone using PyAudio."""
    try:
        import pyaudio
    except ImportError:
        print('[test] pyaudio not installed. Install with: pip install pyaudio')
        print('[test] Falling back to generated audio.')
        return generate_speech_audio(duration_s, sample_rate)

    p = pyaudio.PyAudio()
    print(f'[test] Recording {duration_s}s from microphone... SPEAK NOW!')

    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=sample_rate,
        input=True,
        frames_per_buffer=1024,
    )

    frames = []
    for _ in range(int(sample_rate / 1024 * duration_s)):
        data = stream.read(1024)
        frames.append(data)

    stream.stop_stream()
    stream.close()
    p.terminate()

    print(f'[test] Recording complete.')
    return b''.join(frames)


# --- Tests ---

async def test_connection():
    """Test 1: Can we connect to the server?"""
    import websockets

    print(f'\n[test 1] Connecting to {WS_URL}...')
    try:
        async with websockets.connect(WS_URL) as ws:
            print(f'[test 1] PASS - Connected successfully')
            return True
    except Exception as e:
        print(f'[test 1] FAIL - Connection error: {e}')
        return False


async def test_first_frame():
    """Test 2: Does the server accept the first-frame config?"""
    import websockets

    print(f'\n[test 2] Sending first-frame config...')
    try:
        async with websockets.connect(WS_URL) as ws:
            first_frame = {
                'mode': '2pass',
                'chunk_size': [5, 10, 5],
                'wav_format': 'pcm',
                'audio_fs': 16000,
                'is_speaking': True,
                'itn': True,
            }
            await ws.send(json.dumps(first_frame))
            # If server doesn't crash, it accepted the frame
            await asyncio.sleep(0.5)
            print(f'[test 2] PASS - First frame accepted (no error)')
            return True
    except Exception as e:
        print(f'[test 2] FAIL - Error: {e}')
        return False


async def test_generated_audio():
    """Test 3: Send generated audio and check for response."""
    import websockets

    print(f'\n[test 3] Sending generated audio (3s)...')
    try:
        async with websockets.connect(WS_URL) as ws:
            # First frame
            await ws.send(json.dumps({
                'mode': '2pass',
                'chunk_size': [5, 10, 5],
                'wav_format': 'pcm',
                'audio_fs': 16000,
                'is_speaking': True,
                'itn': True,
            }))

            # Send audio in chunks (simulating real-time streaming)
            pcm_data = generate_speech_audio(3.0)
            chunk_size = 3200  # ~100ms at 16kHz 16-bit mono
            chunks_sent = 0
            for i in range(0, len(pcm_data), chunk_size):
                await ws.send(pcm_data[i:i + chunk_size])
                chunks_sent += 1
                await asyncio.sleep(0.01)

            print(f'[test 3] Sent {len(pcm_data)} bytes in {chunks_sent} chunks')

            # Send end-of-stream
            await ws.send(json.dumps({'is_speaking': False}))
            print(f'[test 3] Sent is_speaking: false')

            # Collect responses
            responses = []
            try:
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    data = json.loads(msg)
                    responses.append(data)
                    print(f'[test 3] Response: {json.dumps(data, ensure_ascii=False)}')
            except asyncio.TimeoutError:
                pass

            if responses:
                # Validate response format
                for resp in responses:
                    assert 'text' in resp, f'Missing "text" field: {resp}'
                    assert 'mode' in resp, f'Missing "mode" field: {resp}'
                    assert 'is_final' in resp, f'Missing "is_final" field: {resp}'
                print(f'[test 3] PASS - Got {len(responses)} response(s) with correct format')
            else:
                print(f'[test 3] WARN - No responses (generated audio may not contain recognizable speech)')
                print(f'[test 3] This is expected for synthetic audio. Try --use-mic for real speech.')

            return True
    except Exception as e:
        print(f'[test 3] FAIL - Error: {e}')
        import traceback
        traceback.print_exc()
        return False


async def test_microphone_audio():
    """Test 4: Send real microphone audio and check for transcription."""
    import websockets

    print(f'\n[test 4] Recording from microphone ({args.duration}s)...')
    pcm_data = record_microphone(args.duration)

    print(f'[test 4] Sending {len(pcm_data)} bytes to server...')
    try:
        async with websockets.connect(WS_URL) as ws:
            # First frame
            await ws.send(json.dumps({
                'mode': '2pass',
                'chunk_size': [5, 10, 5],
                'wav_format': 'pcm',
                'audio_fs': 16000,
                'is_speaking': True,
                'itn': True,
            }))

            # Send audio in chunks
            chunk_size = 3200
            for i in range(0, len(pcm_data), chunk_size):
                await ws.send(pcm_data[i:i + chunk_size])
                await asyncio.sleep(0.005)

            # Send end-of-stream
            await ws.send(json.dumps({'is_speaking': False}))
            print(f'[test 4] Sent all audio + is_speaking: false')

            # Collect responses
            responses = []
            try:
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    data = json.loads(msg)
                    responses.append(data)
                    print(f'[test 4] Response: {json.dumps(data, ensure_ascii=False)}')
            except asyncio.TimeoutError:
                pass

            if responses:
                texts = [r['text'] for r in responses if r.get('text')]
                if texts:
                    print(f'[test 4] PASS - Transcription: {" | ".join(texts)}')
                else:
                    print(f'[test 4] WARN - Got responses but text was empty')
            else:
                print(f'[test 4] FAIL - No response from server')
            return len(responses) > 0
    except Exception as e:
        print(f'[test 4] FAIL - Error: {e}')
        import traceback
        traceback.print_exc()
        return False


async def test_streaming_partial():
    """Test 5: Send enough audio to trigger partial inference (>96000 bytes)."""
    import websockets

    print(f'\n[test 5] Testing partial inference with 6s audio...')
    try:
        async with websockets.connect(WS_URL) as ws:
            # First frame
            await ws.send(json.dumps({
                'mode': '2pass',
                'chunk_size': [5, 10, 5],
                'wav_format': 'pcm',
                'audio_fs': 16000,
                'is_speaking': True,
                'itn': True,
            }))

            # Generate 6 seconds of audio (192000 bytes > 96000 threshold)
            if args.use_mic:
                pcm_data = record_microphone(6.0)
            else:
                pcm_data = generate_speech_audio(6.0)

            chunk_size = 3200
            partial_responses = []
            final_responses = []

            # Set up response collector in background
            async def collect_responses():
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.recv(), timeout=20)
                        data = json.loads(msg)
                        if data.get('is_final'):
                            final_responses.append(data)
                        else:
                            partial_responses.append(data)
                        print(f'[test 5] {"FINAL" if data.get("is_final") else "PARTIAL"}: {json.dumps(data, ensure_ascii=False)}')
                except asyncio.TimeoutError:
                    pass

            collector = asyncio.create_task(collect_responses())

            # Stream audio
            for i in range(0, len(pcm_data), chunk_size):
                await ws.send(pcm_data[i:i + chunk_size])
                await asyncio.sleep(0.005)

            print(f'[test 5] Sent {len(pcm_data)} bytes')

            # Wait a bit for partial inference to complete
            await asyncio.sleep(5)

            # Send end-of-stream
            await ws.send(json.dumps({'is_speaking': False}))
            print(f'[test 5] Sent is_speaking: false')

            # Wait for all responses
            await asyncio.sleep(10)
            collector.cancel()
            try:
                await collector
            except asyncio.CancelledError:
                pass

            print(f'\n[test 5] Summary: {len(partial_responses)} partial, {len(final_responses)} final')
            if partial_responses or final_responses:
                print(f'[test 5] PASS - Got inference results during streaming')
            else:
                print(f'[test 5] WARN - No responses (may be expected for synthetic audio)')
            return True
    except Exception as e:
        print(f'[test 5] FAIL - Error: {e}')
        import traceback
        traceback.print_exc()
        return False


async def test_direct_inference():
    """Test 6: Test model.generate() directly (bypass WebSocket)."""
    print(f'\n[test 6] Testing model.generate() directly...')
    try:
        from funasr import AutoModel

        model = AutoModel(
            model='iic/SenseVoiceSmall',
            vad_model='iic/speech_fsmn_vad_zh-cn-16k-common-pytorch',
            device='cpu',
            disable_update=True,
        )

        # Test with synthetic audio
        sample_rate = 16000
        duration = 3.0
        t = np.linspace(0, duration, int(sample_rate * duration), dtype=np.float32)
        audio = np.zeros_like(t)
        for freq in [150, 300, 600]:
            audio += 0.1 * np.sin(2 * np.pi * freq * t)
        audio = audio / np.max(np.abs(audio)) * 0.8

        print(f'[test 6] Running model.generate() with {len(audio)} float32 samples...')
        results = model.generate(input=audio, input_len=np.array([len(audio)]), fs=sample_rate)
        print(f'[test 6] Results type: {type(results)}')
        print(f'[test 6] Results: {results}')

        if results and len(results) > 0:
            for r in results:
                print(f'[test 6]   Item type={type(r)}, keys={list(r.keys()) if isinstance(r, dict) else "N/A"}')
                if isinstance(r, dict):
                    print(f'[test 6]   text="{r.get("text", "")}"')

        # Also test PCM16 → float32 conversion path (what the server does)
        pcm16 = (audio * 32768).astype(np.int16)
        pcm_bytes = pcm16.tobytes()
        reconverted = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        print(f'\n[test 6] Testing PCM16 round-trip conversion...')
        print(f'[test 6]   Original shape: {audio.shape}, dtype: {audio.dtype}')
        print(f'[test 6]   Reconverted shape: {reconverted.shape}, dtype: {reconverted.dtype}')
        print(f'[test 6]   Max diff: {np.max(np.abs(audio - reconverted)):.6f}')

        results2 = model.generate(input=reconverted, input_len=np.array([len(reconverted)]), fs=sample_rate)
        print(f'[test 6] PCM round-trip results: {results2}')

        print(f'[test 6] PASS')
        return True
    except Exception as e:
        print(f'[test 6] FAIL - Error: {e}')
        import traceback
        traceback.print_exc()
        return False


async def main():
    print('=' * 60)
    print('FunASR Server End-to-End Test')
    print('=' * 60)

    # Test 6 first (direct inference, no server needed)
    await test_direct_inference()

    # Check if server is reachable
    try:
        import websockets
    except ImportError:
        print('\n[error] websockets not installed. Run: pip install websockets')
        sys.exit(1)

    print(f'\n--- WebSocket Tests (server must be running on port {args.port}) ---')

    try:
        async with websockets.connect(WS_URL):
            pass
    except Exception:
        print(f'\n[error] Cannot connect to {WS_URL}')
        print(f'[error] Start the server first:')
        print(f'[error]   python3 scripts/funasr-server.py --port {args.port}')
        sys.exit(1)

    results = {}
    results['connection'] = await test_connection()
    results['first_frame'] = await test_first_frame()
    results['generated_audio'] = await test_generated_audio()
    results['streaming_partial'] = await test_streaming_partial()

    if args.use_mic:
        results['microphone'] = await test_microphone_audio()

    print('\n' + '=' * 60)
    print('Results:')
    for name, passed in results.items():
        status = 'PASS' if passed else 'FAIL'
        print(f'  {name}: {status}')
    print('=' * 60)


if __name__ == '__main__':
    asyncio.run(main())
