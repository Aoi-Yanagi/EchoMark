import { KokoroTTS } from 'kokoro-js';

let tts: any = null;
let currentGenerationId = 0;

// ---- 1. Pre-load the model securely ----
(async () => {
  try {
    self.postMessage({ status: 'loading', message: 'Initializing Stable Neural Engine...' });

    // Force 'wasm' and use 'fp32'. WebGPU or q8 quantization in WASM 
    // causes mathematical tensor corruption, leading to gibberish hallucinations.
    const device = 'wasm';

    self.postMessage({ status: 'loading', message: `Loading Cinematic Model (fp32 Precision)...` });

    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'fp32', // fp32 guarantees stable math and clean audio
      device: device,
    });

    self.postMessage({ status: 'loading', message: 'Warming up Engine...' });

    // Safely warm up with a real English word to prevent phonetic confusion
    await tts.generate("Hello", { voice: 'af_heart' });

    self.postMessage({ status: 'ready', message: `Engine Ready (Stable)` });
  } catch (error: any) {
    self.postMessage({ status: 'error', message: `Initialization failed: ${error.message}` });
  }
})();

// ---- 2. High-Speed Generation Queue ----
self.addEventListener('message', async (event) => {
  const { chunks, voiceId, generationId } = event.data;
  currentGenerationId = generationId;

  if (!tts) {
    self.postMessage({ status: 'error', message: 'Engine not ready yet' });
    return;
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (currentGenerationId !== generationId) return; // User clicked stop

      let text = chunks[i].trim();
      
      // Prevent Punctuation Hallucination.
      // If the text is empty or contains NO letters/numbers (e.g. just a "." or ","), skip it!
      if (!text || !/[a-zA-Z0-9]/.test(text)) continue;

      const rawAudio = await tts.generate(text, { voice: voiceId });

      self.postMessage({
        status: 'chunk_complete',
        chunkIndex: i,
        audioData: rawAudio.audio,
        sampleRate: rawAudio.sampling_rate,
        text,
        generationId // Ensure ID is passed back so UI accepts it
      });
    }

    // FIX: You MUST pass the generationId here, otherwise the UI ignores the completion signal 
    // and the media controls get stuck forever!
    self.postMessage({ status: 'all_complete', generationId }); 
  } catch (error: any) {
    self.postMessage({ status: 'error', message: error.message, generationId });
  }
});