import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // THE FIX: Tell Vite's compiler to completely ignore the AI libraries
  // during its aggressive pre-bundling phase.
  optimizeDeps: {
    exclude: [
      '@huggingface/transformers', 
      'kokoro-js', 
      'onnxruntime-web'
    ]
  }
});