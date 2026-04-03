/* eslint-disable @typescript-eslint/no-explicit-any */
import { KokoroTTS } from 'kokoro-js';

let tts: any = null;
let currentGenerationId = 0;

// --- INITIALIZATION ---
(async () => {
  try {
    self.postMessage({ status: 'loading', message: 'Initializing Stable Neural Engine...' });
    self.postMessage({ status: 'loading', message: 'Loading Cinematic Model (fp32 Precision)...' });

    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'fp32',
      device: 'wasm',
    });

    self.postMessage({ status: 'loading', message: 'Warming up Engine...' });
    await tts.generate("Hello", { voice: 'af_heart' });

    self.postMessage({ status: 'ready', message: 'Engine Ready (Stable)' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ status: 'error', message: `Initialization failed: ${message}` });
  }
})();

// --- GENERATION QUEUE ---
self.addEventListener('message', async (event: MessageEvent) => {
  const { chunks, voiceId, generationId } = event.data;
  currentGenerationId = generationId;

  if (!tts) {
    self.postMessage({ status: 'error', message: 'Engine not ready yet' });
    return;
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (currentGenerationId !== generationId) return;

      const text = chunks[i].trim();
      if (!text || !/[a-zA-Z0-9]/.test(text)) continue;

      const rawAudio = await tts.generate(text, { voice: voiceId });

      self.postMessage({
        status: 'chunk_complete',
        chunkIndex: i,
        audioData: rawAudio.audio,
        sampleRate: rawAudio.sampling_rate,
        text,
        generationId
      });
    }

    self.postMessage({ status: 'all_complete', generationId }); 
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ status: 'error', message, generationId });
  }
});