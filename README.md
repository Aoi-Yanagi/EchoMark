# 📖 EchoMark

An ultra-low latency, local-first PDF reader featuring an integrated, streaming Text-to-Speech (TTS) engine. Built entirely for the browser, it processes documents and synthesizes voice locally, ensuring complete privacy and zero server costs.

## ✨ Features

### 🎙️ Zero-Latency Streaming TTS (Kokoro Engine)
* **Asynchronous Pipeline:** Bypasses traditional batch-processing delays.
* **Smart Syntactic Chunking:** Slices text by natural boundaries, forcing micro-chunks at the start to achieve a Time-to-First-Byte (TTFB) of under 50ms.
* **AudioContext Ring Buffers:** Mathematically trims tensor silence and schedules exact chunk overlaps for flawless, gapless playback.
* **Background Processing:** Runs the FP32 neural engine entirely in a Web Worker to prevent UI thread blocking.

### 🧠 Smart Session & Storage Management
* **Zero-Duplication Routing:** Recognizes previously uploaded files via size and name, routing users back to existing sessions instead of cluttering storage.
* **Stateful Tracking:** Tracks `lastSeen` and `lastModified` timestamps. Clickable metadata provides instant summaries of document edits.
* **Stale Closure Protection:** Uses precise React Refs to manage audio boundaries, ensuring media controls instantly and accurately fade away when audio completes or tab context switches.

### 🛠️ Pro-Grade Document Tools
* **Non-Destructive Highlighting:** Mark up PDFs with multiple colors and export the modified file instantly. 
* **Smart Dictionary:** Seamlessly searches Google when online, and falls back to a free Dictionary API when offline.
* **Cinematic Reading Themes:** Hardware-accelerated CSS filters provide Light, Sepia (Blue-light reduction), and Dark (Hue-rotated invert) modes for eye care.
* **Zero-Drift Selection:** Translates DOM viewport coordinates to exact PDF document coordinates, keeping highlights anchored regardless of zoom or pan.

## 💻 Tech Stack
* **Frontend:** React, TypeScript, Tailwind CSS, Framer Motion
* **PDF Rendering & Editing:** `react-pdf`, `pdf-lib`
* **AI TTS Engine:** `kokoro-js` (ONNX WebAssembly)
* **Storage:** `localforage` (IndexedDB)
* **Icons:** Lucide React

## 🚀 Getting Started

### Prerequisites
* Node.js (v18+)
* npm or pnpm

### Installation
1. Clone the repository:
   ```bash
   git clone [https://github.com/yourusername/reader-pro.git](https://github.com/yourusername/reader-pro.git)
   cd reader-pro
