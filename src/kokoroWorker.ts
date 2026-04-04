/* eslint-disable @typescript-eslint/no-explicit-any */
import { KokoroTTS } from 'kokoro-js';
// We use a wildcard import to prevent Vite from mangling the named export during ESM interop
import * as transformers from '@huggingface/transformers';

// --- STRICT COMPILER OVERRIDE ---
// 1. We must access env through the wildcard object (transformers.env)
// 2. We cast to 'any' to bypass TS strict null checks on deeply nested optional properties
const tfEnv = transformers.env as any;
tfEnv.backends.onnx.wasm.simd = true;
tfEnv.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

// (Removed the accidental duplicate declarations that would break strict compilers)
let tts: any = null;
let currentGenerationId = 0;

// Hardware detector for safe acceleration
const getOptimalDevice = async (): Promise<'webgpu' | 'wasm'> => {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch (e: unknown) {
      console.warn("WebGPU requested but not available.", e);
    }
  }
  return 'wasm';
};

// --- INITIALIZATION ---
(async () => {
  try {
    self.postMessage({ status: 'loading', message: 'Probing Hardware Architecture...' });
    
    const device = await getOptimalDevice();
    
    // WebGPU + q8 causes math corruption. If WebGPU, use fp32. If WASM, use q8 for speed.
    const dtype = device === 'webgpu' ? 'fp32' : 'q8';

    self.postMessage({ status: 'loading', message: `Booting Neural Core (${device.toUpperCase()} / ${dtype})...` });

    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: dtype,
      device: device,
    });

    self.postMessage({ status: 'loading', message: 'Warming up Audio Shaders...' });
    
    // Prewarm hides the JIT + GPU init cost
    await tts.generate("Hello", { voice: 'af_heart' });

    self.postMessage({ status: 'ready', message: `Engine Ready (${device.toUpperCase()})` });
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
      // Abort background generation instantly if user clicked Stop/Pause
      if (currentGenerationId !== generationId) return;

      const text = chunks[i].trim();
      
      // Anti-hallucination check
      if (!text || !/[a-zA-Z0-9]/.test(text)) continue;

      // Generates and immediately yields to the main thread
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