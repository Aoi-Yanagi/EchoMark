import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, BookOpen, Volume2, Search, Highlighter, Menu, X, ChevronLeft, ChevronRight, Download, XCircle, Undo2, Redo2, Palette, AlertCircle, Trash2, ZoomIn, ZoomOut, Hand, Cpu, Play, Pause, Square, FileText, Copy, Check, Moon, Sun, Coffee, Info } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import { PDFDocument, rgb } from 'pdf-lib';
import localforage from 'localforage';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface ColorOption { name: string; ui: string; pdf: any; }
interface SelectionBox { viewportTop: number; viewportLeft: number; relativeTop: number; relativeLeft: number; width: number; height: number; text: string; color: ColorOption; }

// Upgraded StoredPDF to track exact modification types
interface StoredPDF { id: string; name: string; file: Blob; date: number; lastSeen: number; lastModified?: number; modType?: string; }
interface Particle { id: number; x: number; y: number; size: number; delay: number; duration: number; }

type ReadingMode = 'relaxed' | 'normal' | 'fast';
type ReadingTheme = 'light' | 'sepia' | 'dark';

const COLORS: ColorOption[] = [
  { name: 'Yellow', ui: 'bg-yellow-300', pdf: rgb(1, 0.9, 0.2) },
  { name: 'Green', ui: 'bg-green-300', pdf: rgb(0.4, 0.9, 0.4) },
  { name: 'Blue', ui: 'bg-blue-300', pdf: rgb(0.4, 0.8, 1.0) },
  { name: 'Pink', ui: 'bg-pink-300', pdf: rgb(1.0, 0.6, 0.8) },
];

const KOKORO_VOICES = [
  { id: 'af_heart', name: 'Heart (US Female - Warm)' },
  { id: 'af_sky', name: 'Sky (US Female - Clear)' },
  { id: 'am_adam', name: 'Adam (US Male - Deep)' },
  { id: 'bf_emma', name: 'Emma (UK Female - Posh)' },
  { id: 'hf_alpha', name: 'Alpha (Indian Female - Clear)' },
  { id: 'hm_omega', name: 'Omega (Indian Male - Deep)' },
  { id: 'af_bella', name: 'Bella (US Female - Confident)' },
  { id: 'af_nicole', name: 'Nicole (US Female - Soft/Casual)' },
  { id: 'am_michael', name: 'Michael (US Male - Professional)' },
  { id: 'bm_george', name: 'George (UK Male - Mature)' }
];

const floatAnimation = { y: [0, -6, 0], transition: { duration: 4, repeat: Infinity, ease: "easeInOut" } };

class TextChunker {
  static optimizeForStreaming(rawText: string): string[] {
    const sanitizedText = rawText
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')       
      .replace(/([a-zA-Z])\.(?=[a-zA-Z])/g, '$1') 
      .replace(/-\s*[\r\n]+\s*/g, '').replace(/[\r\n]+/g, ' ')            
      .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

    if (!sanitizedText) return [];
    const rawChunks = sanitizedText.match(/[^.,!?;:]+[.,!?;:]*/g)?.map(s => s.trim()).filter(s => s.length > 0) || [sanitizedText];
    const optimalChunks: string[] = [];
    let currentBatch = "";
    let isFirstChunk = true;

    for (const chunk of rawChunks) {
      if (isFirstChunk) {
        const words = chunk.split(' ');
        if (words.length > 5) {
            optimalChunks.push(words.slice(0, 4).join(' '));
            currentBatch = words.slice(4).join(' ');
        } else { optimalChunks.push(chunk); }
        isFirstChunk = false; continue;
      }
      currentBatch += (currentBatch ? " " : "") + chunk;
      if (currentBatch.split(/\s+/).length >= 15 || /[.!?]$/.test(chunk)) {
         optimalChunks.push(currentBatch); currentBatch = ""; 
      }
    }
    if (currentBatch) optimalChunks.push(currentBatch);
    return optimalChunks;
  }
}

export default function App() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [rawPdfFile, setRawPdfFile] = useState<File | Blob | null>(null);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [library, setLibrary] = useState<StoredPDF[]>([]);
  
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [zoom, setZoom] = useState<number>(1); 
  const [isPanning, setIsPanning] = useState<boolean>(false);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isHoveringColor, setIsHoveringColor] = useState<boolean>(false); 
  const [isMobileColorOpen, setIsMobileColorOpen] = useState<boolean>(false); 
  const [activeColor, setActiveColor] = useState<ColorOption>(COLORS[0]);
  
  const [readingMode, setReadingMode] = useState<ReadingMode>('normal');
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>('light');
  const [hasCopied, setHasCopied] = useState(false);
  
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [definition, setDefinition] = useState<{ word: string; text: string } | null>(null);
  const [history, setHistory] = useState<SelectionBox[][]>([[]]);
  const [historyStep, setHistoryStep] = useState<number>(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [pendingFile, setPendingFile] = useState<{ file: File | Blob; name?: string; id?: string } | null>(null);
  
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);

  const [aiStatus, setAiStatus] = useState<string>("Offline Engine Standby");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(KOKORO_VOICES[0].id);
  const [readingSelection, setReadingSelection] = useState<SelectionBox | null>(null);
  const [playbackState, setPlaybackState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [particles, setParticles] = useState<Particle[]>([]);

  const playbackStateRef = useRef<'idle' | 'playing' | 'paused'>('idle');
  const wasPlayingRef = useRef<boolean>(false); 
  const readingSelectionRef = useRef<SelectionBox | null>(null); 

  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const syncFrameRef = useRef<number>(0);
  const activeGenerationIdRef = useRef<number>(0);
  const isGenerationCompleteRef = useRef<boolean>(false);

  const currentHighlights = history[historyStep] || [];
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null); 
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setPlaybackStateSafe = (state: 'idle' | 'playing' | 'paused') => {
    playbackStateRef.current = state;
    setPlaybackState(state);
  };

  // --- REFRESH MANAGER & TAB SENSORS ---
  useEffect(() => {
    // 1. Warn user before refreshing the page
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (library.length > 0 || hasUnsavedChanges) {
        e.preventDefault();
        // The browser provides its own generic warning, but setting this guarantees it appears.
        e.returnValue = "All workspace files will be removed. Have you downloaded your modifications?"; 
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (playbackStateRef.current === 'playing') {
          wasPlayingRef.current = true;
          if (audioCtxRef.current && audioCtxRef.current.state === 'running') audioCtxRef.current.suspend();
          setPlaybackStateSafe('paused');
        } else { wasPlayingRef.current = false; }
      } else {
        if (wasPlayingRef.current && playbackStateRef.current === 'paused') {
          if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
          setPlaybackStateSafe('playing');
          wasPlayingRef.current = false;
        }
      }
    };

    const handleSelectionChange = () => {
      if (playbackStateRef.current !== 'idle') {
        const text = document.getSelection()?.toString().trim();
        if (!text || (readingSelectionRef.current && text !== readingSelectionRef.current.text)) stopReading();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // 1. Scroll PDF with Arrows
      if (pdfWrapperRef.current && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
        const scrollStep = 60;
        if (e.code === 'ArrowUp') pdfWrapperRef.current.scrollTop -= scrollStep;
        if (e.code === 'ArrowDown') pdfWrapperRef.current.scrollTop += scrollStep;
        if (e.code === 'ArrowLeft') pdfWrapperRef.current.scrollLeft -= scrollStep;
        if (e.code === 'ArrowRight') pdfWrapperRef.current.scrollLeft += scrollStep;
        return;
      }

      // 2. Play/Pause and Menu Control
      if (e.code === 'Space') {
        e.preventDefault();
        if (playbackStateRef.current === 'playing') pauseReading();
        else if (playbackStateRef.current === 'paused') resumeReading();
      } else if (e.code === 'Escape') {
        if (playbackStateRef.current !== 'idle') stopReading();
        setSelectionBox(null);
        window.getSelection()?.removeAllRanges();
      } 
      // 3. Switch Pages with PageUp/PageDown
      else if (e.code === 'PageDown') {
        e.preventDefault();
        setPageNumber(p => Math.min(p + 1, numPages || 1));
      } else if (e.code === 'PageUp') {
        e.preventDefault();
        setPageNumber(p => Math.max(p - 1, 1));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [numPages, library.length, hasUnsavedChanges]);

  // --- INITIALIZE WORKER & SESSION DATABASE ---
  useEffect(() => {
    const init = async () => {
      // CLEAR DATABASE ON BOOT (SESSION-ONLY MODE)
      const keys = await localforage.keys();
      for (const key of keys) {
        if (key.startsWith('pdf_')) await localforage.removeItem(key);
      }
      setLibrary([]); // Start strictly fresh

      workerRef.current = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current.onmessage = (event) => {
        const { status, message, audioData, sampleRate, generationId } = event.data;
        if (status === 'loading') setAiStatus(message);
        else if (status === 'ready') setAiStatus("Kokoro Engine Ready");
        else if (status === 'chunk_complete' && generationId === activeGenerationIdRef.current) scheduleAudioChunk(audioData, sampleRate);
        else if (status === 'all_complete' && generationId === activeGenerationIdRef.current) {
          setAiStatus("Generation Complete");
          isGenerationCompleteRef.current = true;
        } else if (status === 'error') {
          console.error("Kokoro Error:", message);
          setAiStatus("Error: " + message);
          stopReading();
        }
      };
    };
    init();
    return () => {
      workerRef.current?.terminate();
      if (audioCtxRef.current) audioCtxRef.current.close();
      cancelAnimationFrame(syncFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const measureWidth = () => { if (pdfWrapperRef.current) setContainerWidth(Math.min(pdfWrapperRef.current.clientWidth - 32, 800)); };
    measureWidth();
    window.addEventListener('resize', measureWidth);
    return () => window.removeEventListener('resize', measureWidth);
  }, [pdfUrl, pageNumber]);

  // --- AUDIO SCHEDULING ---
  const scheduleAudioChunk = (audioData: Float32Array, sampleRate: number) => {
    if (!audioCtxRef.current) return;
    const buffer = audioCtxRef.current.createBuffer(1, audioData.length, sampleRate);
    buffer.copyToChannel(audioData, 0);
    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    
    const speed = readingMode === 'fast' ? 1.25 : readingMode === 'relaxed' ? 0.85 : 1.0;
    source.playbackRate.value = speed;
    source.connect(audioCtxRef.current.destination);

    const currentTime = audioCtxRef.current.currentTime;
    if (nextStartTimeRef.current < currentTime) nextStartTimeRef.current = currentTime + 0.05;

    const start = nextStartTimeRef.current;
    source.start(start);
    nextStartTimeRef.current = start + (buffer.duration / speed);
    startCompletionCheck();
  };

  const startCompletionCheck = () => {
    cancelAnimationFrame(syncFrameRef.current);
    const checkTime = () => {
      if (!audioCtxRef.current || playbackStateRef.current === 'idle') return;
      if (isGenerationCompleteRef.current && audioCtxRef.current.currentTime >= nextStartTimeRef.current - 0.05) {
        stopReading(); return;
      }
      syncFrameRef.current = requestAnimationFrame(checkTime);
    };
    syncFrameRef.current = requestAnimationFrame(checkTime);
  };

  // --- BOUNDED SELECTION LOGIC ---
  const handleTextSelection = () => {
    if (isPanning) return; 
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      
      let isInsidePdf = false;
      if (selection && selection.anchorNode && pdfWrapperRef.current) {
        isInsidePdf = pdfWrapperRef.current.contains(selection.anchorNode);
      }
      
      if (text.length > 0 && isInsidePdf && selection && selection.rangeCount > 0 && pageContainerRef.current) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect(); 
        const containerRect = pageContainerRef.current.getBoundingClientRect();
        
        setSelectionBox({
          viewportTop: rect.top, viewportLeft: rect.left,
          relativeTop: (rect.top - containerRect.top) / zoom, 
          relativeLeft: (rect.left - containerRect.left) / zoom,
          width: rect.width / zoom, height: rect.height / zoom, 
          text: text, color: activeColor
        });
      } else if (playbackStateRef.current === 'idle' && (!text || !isInsidePdf)) {
        setSelectionBox(null); 
        setIsHoveringColor(false); 
        setIsMobileColorOpen(false);
      }
    }, 50); 
  };
  const touchStartXRef = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Prevent accidental page flip if the user is zoomed in and trying to pan laterally
    if (isPanning || zoom > 1) return; 
    
    const deltaX = touchStartXRef.current - e.changedTouches[0].clientX;
    if (deltaX > 50) setPageNumber(p => Math.min(p + 1, numPages || 1)); // Swipe Left -> Next Page
    else if (deltaX < -50) setPageNumber(p => Math.max(p - 1, 1)); // Swipe Right -> Prev Page
  };

  const handlePdfMouseDown = (e: React.MouseEvent) => {
    if (!isPanning || !pdfWrapperRef.current) return;
    setIsDraggingPdf(true);
    setDragStart({ x: e.clientX, y: e.clientY, scrollLeft: pdfWrapperRef.current.scrollLeft, scrollTop: pdfWrapperRef.current.scrollTop });
  };
  const handlePdfMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingPdf || !pdfWrapperRef.current) return;
    pdfWrapperRef.current.scrollLeft = dragStart.scrollLeft - (e.clientX - dragStart.x);
    pdfWrapperRef.current.scrollTop = dragStart.scrollTop - (e.clientY - dragStart.y);
  };
  const handlePdfMouseUp = () => setIsDraggingPdf(false);

  // --- ZERO-DUPLICATION FILE ROUTING ---
  const loadNewPdf = async (file: File | Blob, name: string = "Document", existingId?: string) => {
    let fileId = existingId;
    let fileEntry: StoredPDF;

    if (!fileId && file instanceof File) {
      const existing = library.find(p => p.name === file.name && p.file.size === file.size);
      if (existing) {
        fileId = existing.id;
        fileEntry = { ...existing, lastSeen: Date.now() };
      } else {
        fileId = `pdf_${Date.now()}`;
        fileEntry = { id: fileId, name: file.name, file, date: Date.now(), lastSeen: Date.now() };
      }
    } else if (fileId) {
      const existing = library.find(p => p.id === fileId);
      fileEntry = { ...existing!, lastSeen: Date.now() };
    } else { return; }

    await localforage.setItem(fileId, fileEntry);
    
    // Strict replacement logic prevents duplicates
    setLibrary(prev => {
      const filtered = prev.filter(p => p.id !== fileId);
      return [fileEntry, ...filtered].sort((a, b) => b.lastSeen - a.lastSeen);
    });
    
    setCurrentFileId(fileId);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    stopReading();
    setRawPdfFile(file); setPdfUrl(URL.createObjectURL(file)); 
    setPageNumber(1); setHistory([[]]); setHistoryStep(0); setHasUnsavedChanges(false); setDefinition(null); setPendingFile(null); setZoom(1); setIsPanning(false);
  };

  const attemptFileLoad = (file: File | Blob, name?: string, id?: string) => {
    if (file instanceof File && file.type !== "application/pdf") { alert("Only PDF files are supported!"); return; }
    if (pdfUrl) setPendingFile({ file, name, id }); else loadNewPdf(file, name, id);
  };

  const deleteFromLibrary = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); await localforage.removeItem(id); 
    setLibrary(prev => prev.filter(pdf => pdf.id !== id));
    if (currentFileId === id) { setPdfUrl(null); setCurrentFileId(null); setRawPdfFile(null); setHasUnsavedChanges(false); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { 
    const file = e.target.files?.[0]; 
    if (file) attemptFileLoad(file, file.name, library.find(p => p.name === file.name && p.file.size === file.size)?.id); 
    if (fileInputRef.current) fileInputRef.current.value = ''; 
  };
  
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDrop = (e: React.DragEvent) => { 
    e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; 
    if (file) attemptFileLoad(file, file.name, library.find(p => p.name === file.name && p.file.size === file.size)?.id);
  };

  const triggerBubbles = () => {
    const newParticles = Array.from({ length: 15 }).map((_, i) => ({
      id: Date.now() + i, x: (Math.random() - 0.5) * 200, y: -(Math.random() * 150 + 50), 
      size: Math.random() * 8 + 4, delay: Math.random() * 0.2, duration: Math.random() * 0.5 + 0.5
    }));
    setParticles(newParticles);
    setTimeout(() => setParticles([]), 1500); 
  };

  // --- TOOLBAR ACTIONS ---
  const readAloud = () => {
    if (!selectionBox || !workerRef.current) return;
    const activeTextSelection = selectionBox; 
    stopReading(); 
    
    setPlaybackStateSafe('playing'); 
    setAiStatus("Connecting to Kokoro Engine...");
    setReadingSelection(activeTextSelection); 
    readingSelectionRef.current = activeTextSelection; 
    
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new window.AudioContext({ sampleRate: 24000 });
    else audioCtxRef.current.resume();
    nextStartTimeRef.current = audioCtxRef.current.currentTime;
    isGenerationCompleteRef.current = false;

    activeGenerationIdRef.current++;
    workerRef.current.postMessage({ chunks: TextChunker.optimizeForStreaming(activeTextSelection.text), voiceId: selectedVoiceId, generationId: activeGenerationIdRef.current });
  };

  const pauseReading = () => { if (audioCtxRef.current) audioCtxRef.current.suspend(); setPlaybackStateSafe('paused'); };
  const resumeReading = () => { if (audioCtxRef.current) audioCtxRef.current.resume(); setPlaybackStateSafe('playing'); };
  const stopReading = () => {
    activeGenerationIdRef.current++; 
    if (audioCtxRef.current) audioCtxRef.current.close(); audioCtxRef.current = null;
    cancelAnimationFrame(syncFrameRef.current);
    if (playbackStateRef.current !== 'idle') triggerBubbles();
    setPlaybackStateSafe('idle'); setReadingSelection(null); readingSelectionRef.current = null; setAiStatus("Engine Standby");
  };

  const getDefinition = async () => {
    if (!selectionBox) return;
    const textToSearch = selectionBox.text.trim();
    if (!textToSearch) return;

    if (navigator.onLine) { window.open(`https://www.google.com/search?q=${encodeURIComponent(textToSearch)}`, '_blank');
    } else {
      const wordToDefine = textToSearch.replace(/-\s*[\r\n]+\s*/g, '').split(/[\s.,;:!?]+/)[0]; 
      if (!wordToDefine) return;
      try {
        setDefinition({ word: wordToDefine, text: "Internet connection is not available , only dictionary will work.\n\nSearching..." });
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${wordToDefine}`);
        if (!res.ok) throw new Error("Word not found");
        const data = await res.json();
        setDefinition({ word: wordToDefine, text: `Internet connection is not available , only dictionary will work.\n\nDefinition: ${data[0]?.meanings[0]?.definitions[0]?.definition || "Not found."}` });
      } catch { setDefinition({ word: wordToDefine, text: "Internet connection is not available , only dictionary will work.\n\nI couldn't find a definition for that word." }); }
    }
  };

  const copyTextToClipboard = async () => {
    if (!selectionBox) return;
    try {
      await navigator.clipboard.writeText(selectionBox.text);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    } catch (err) { console.error("Failed to copy", err); }
  };

  // --- MODIFICATION TRACKER ---
  const addHighlight = async (color: ColorOption) => {
    if (selectionBox) {
      const newBox = { ...selectionBox, color };
      const newHistory = history.slice(0, historyStep + 1);
      newHistory.push([...currentHighlights, newBox]);
      setHistory(newHistory); setHistoryStep(newHistory.length - 1); setHasUnsavedChanges(true); setActiveColor(color); 
      window.getSelection()?.removeAllRanges(); setSelectionBox(null); setIsHoveringColor(false); setIsMobileColorOpen(false);
      
      // Update Database with specific Modification Details
      if (currentFileId) {
        const entry = await localforage.getItem<StoredPDF>(currentFileId);
        if (entry) {
          entry.lastModified = Date.now();
          entry.modType = `${newHistory.length - 1} Highlights Applied`;
          await localforage.setItem(currentFileId, entry);
          setLibrary(prev => prev.map(p => p.id === currentFileId ? entry : p));
        }
      }
    }
  };
  
  const undo = () => setHistoryStep(s => Math.max(0, s - 1));
  const redo = () => setHistoryStep(s => Math.min(history.length - 1, s + 1));

  const downloadModifiedPdf = async () => {
    if (!rawPdfFile) return;
    try {
      const pdfDoc = await PDFDocument.load(await rawPdfFile.arrayBuffer());
      const pages = pdfDoc.getPages();
      const { height } = pages[pageNumber - 1].getSize();
      currentHighlights.forEach(hl => {
        pages[pageNumber - 1].drawRectangle({
          x: hl.relativeLeft, y: height - hl.relativeTop - hl.height, width: hl.width, height: hl.height, color: hl.color.pdf, opacity: 0.4,
        });
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([await pdfDoc.save()], { type: 'application/pdf' }));
      link.download = `Edited_${rawPdfFile instanceof File ? rawPdfFile.name : 'Document.pdf'}`;
      link.click();
      setHasUnsavedChanges(false); 
    } catch (error) { console.error("Export failed:", error); }
  };

  const getThemeStyles = () => {
    if (readingTheme === 'sepia') return { filter: 'sepia(0.6) contrast(0.9) brightness(0.9) hue-rotate(-15deg)' };
    if (readingTheme === 'dark') return { filter: 'invert(0.95) hue-rotate(180deg) contrast(0.9) brightness(0.85)' };
    return {};
  };

  return (
    <div 
      className={`relative flex h-screen w-full transition-colors duration-300 font-sans overflow-hidden ${readingTheme === 'dark' ? 'bg-gray-900 text-gray-200' : 'bg-gray-50 text-gray-800'}`} 
      onDragOver={onDragOver} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }} onDrop={onDrop}
      onMouseUp={handleTextSelection} onTouchEnd={handleTextSelection}
      onMouseDown={(e) => {
        if (!(e.target as Element).closest('.floating-menu') && playbackStateRef.current === 'idle') {
          setSelectionBox(null); setIsHoveringColor(false); setIsMobileColorOpen(false);
        }
      }}
    >
      
      {/* TOP CONTROLS */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="fixed top-4 right-4 md:top-6 md:right-6 z-40 flex flex-col md:flex-row items-end md:items-center gap-3">
        <motion.div animate={floatAnimation} className="bg-white/90 backdrop-blur-sm shadow-xl border border-gray-200 rounded-full p-1.5 flex items-center gap-1">
          {[ { id: 'light', icon: <Sun size={16}/>, label: 'Light' }, { id: 'sepia', icon: <Coffee size={16}/>, label: 'Sepia' }, { id: 'dark', icon: <Moon size={16}/>, label: 'Dark' } ].map((mode) => (
            <button key={mode.id} onClick={() => setReadingTheme(mode.id as ReadingTheme)} className={`relative px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors z-10 cursor-pointer ${readingTheme === mode.id ? 'text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`} title={mode.label}>
              {readingTheme === mode.id && <motion.div layoutId="theme_lever" className="absolute inset-0 bg-blue-100/50 rounded-full shadow-sm border border-black/5 -z-10" transition={{ type: "spring", stiffness: 300, damping: 25 }} />}
              {mode.icon}
            </button>
          ))}
        </motion.div>
        <motion.div animate={floatAnimation} className="bg-white/90 backdrop-blur-sm shadow-xl border border-gray-200 rounded-full p-1.5 flex items-center gap-1">
          {[ { id: 'relaxed', icon: '😇', color: 'bg-blue-100 text-blue-700', label: 'Relaxed' }, { id: 'normal', icon: '😊', color: 'bg-gray-100 text-gray-700', label: 'Normal' }, { id: 'fast', icon: '😈', color: 'bg-red-100 text-red-700', label: 'Fast' } ].map((mode) => (
            <button key={mode.id} onClick={() => setReadingMode(mode.id as ReadingMode)} className={`relative px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors z-10 cursor-pointer ${readingMode === mode.id ? mode.color : 'text-gray-500 hover:bg-gray-50'}`} title={mode.label}>
              {readingMode === mode.id && <motion.div layoutId="speed_lever" className="absolute inset-0 bg-white rounded-full shadow-sm border border-black/5 -z-10" transition={{ type: "spring", stiffness: 300, damping: 25 }} />}
              <span>{mode.icon}</span><span className="hidden md:inline">{mode.label}</span>
            </button>
          ))}
        </motion.div>
      </motion.div>

      {/* MENU PILL */}
      <AnimatePresence>
        {!isSidebarOpen && (
          <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="fixed top-4 left-4 md:top-6 md:left-6 z-40">
            <motion.button animate={floatAnimation} onClick={() => setIsSidebarOpen(true)} className="bg-white/90 backdrop-blur-sm shadow-xl border border-gray-200 rounded-full px-4 py-2 md:px-5 md:py-2.5 flex items-center gap-2 hover:bg-gray-50 text-sm font-semibold text-gray-800 cursor-pointer">
              <Menu size={18} /> <span className="hidden md:inline">Menu</span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SIDEBAR */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/10 backdrop-blur-sm z-40" />
            <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 250, damping: 25 }} className="fixed top-0 left-0 h-full w-80 md:w-96 bg-white/95 shadow-2xl z-50 flex flex-col rounded-r-3xl border-r border-gray-200 overflow-hidden text-gray-800">
              <div className="p-6 flex justify-between border-b border-gray-100"><h1 className="text-xl font-bold text-blue-600 flex items-center gap-2"><BookOpen size={24} /> EchoMark</h1><button onClick={() => setIsSidebarOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-full cursor-pointer"><X size={20} className="text-gray-500" /></button></div>
              
              <div className="m-4 p-4 bg-gray-50 rounded-xl border border-gray-200 shadow-inner">
                <p className="text-sm font-bold text-gray-700 flex items-center gap-2 mb-2"><Cpu size={16} className="text-blue-500"/> Voices </p>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-2 h-2 rounded-full ${aiStatus.includes('loading') || aiStatus.includes('Synthesizing') ? 'bg-blue-500 animate-pulse' : aiStatus.includes('Ready') ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                  <span className="text-xs text-gray-600 font-medium">{aiStatus}</span>
                </div>
                <label className="text-xs text-gray-500 mb-1 block">Cinematic Voice Model:</label>
                <select value={selectedVoiceId} onChange={(e) => setSelectedVoiceId(e.target.value)} className="w-full bg-white border border-gray-300 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 cursor-pointer mb-2">
                  {KOKORO_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 leading-tight">Advanced AudioContext Streaming is active. Models load instantly after first cache.</p>
              </div>

              <div className="flex-grow overflow-y-auto p-4 border-t border-gray-100">
                <p className="font-semibold text-sm text-gray-500 mb-3 px-2">Your Session Documents ({library.length})</p>
                {library.length === 0 ? <p className="text-xs text-gray-400 px-2">No documents stored locally yet.</p> : (
                  <ul className="space-y-2">
                    {library.map((doc) => (
                      <li key={doc.id} onClick={() => attemptFileLoad(doc.file, doc.name, doc.id)} className="bg-white border border-gray-200 p-3 rounded-xl hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group flex items-start justify-between gap-2">
                        <div className="flex flex-col overflow-hidden w-full">
                          <span className="text-sm font-medium text-gray-800 truncate">{doc.name}</span>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-[10px] text-gray-400">
                              Seen: {new Date(doc.lastSeen || doc.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                              {/* CLICKABLE MODIFICATION TRACKER */}
                              {doc.lastModified && (
                                <span 
                                  onClick={(e) => { e.stopPropagation(); alert(`Modifications on ${doc.name}:\n\n${doc.modType || 'Edits applied'}\n\nPlease click "Export" in the toolbar to save these changes to your device.`); }} 
                                  className="ml-1 text-blue-500 hover:underline font-medium flex items-center inline-flex"
                                >
                                  | Mod <Info size={10} className="ml-0.5" />
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        <button onClick={(e) => deleteFromLibrary(doc.id, e)} className="text-gray-300 hover:text-red-500 p-1 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"><Trash2 size={16} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* DROPZONE OVERLAY */}
      <AnimatePresence>
        {isDragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] bg-blue-600/10 backdrop-blur-sm border-4 border-dashed border-blue-500 m-4 rounded-3xl flex items-center justify-center pointer-events-none">
            <div className="bg-white px-8 py-6 rounded-2xl shadow-2xl text-center text-gray-800"><Upload size={48} className="mx-auto text-blue-500 mb-4 animate-bounce" /><h2 className="text-2xl font-bold">Drop PDF Here</h2></div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FILE SWITCH WARNING PROMPT */}
      <AnimatePresence>
        {pendingFile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full border border-gray-100 text-gray-800">
              <div className="flex items-center gap-3 text-amber-500 mb-4">
                <AlertCircle size={28} />
                <h2 className="text-xl font-bold">{hasUnsavedChanges ? "Unsaved Changes" : "Close Current Document?"}</h2>
              </div>
              <p className="text-gray-600 mb-6">{hasUnsavedChanges ? "You have modifications on this document. Loading a new file will erase them." : "Opening a new document will close the file you are currently reading. Are you sure you want to switch?"}</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setPendingFile(null)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer transition">Cancel</button>
                {hasUnsavedChanges ? (
                  <>
                    <button onClick={() => loadNewPdf(pendingFile.file, pendingFile.name, pendingFile.id)} className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg font-medium cursor-pointer transition">Discard & Switch</button>
                    <button onClick={async () => { await downloadModifiedPdf(); loadNewPdf(pendingFile.file, pendingFile.name, pendingFile.id); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md font-medium cursor-pointer transition">Download & Switch</button>
                  </>
                ) : (
                  <button onClick={() => loadNewPdf(pendingFile.file, pendingFile.name, pendingFile.id)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md font-medium cursor-pointer transition">Yes, Switch File</button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MEDIA CONTROLS */}
      <AnimatePresence>
        {playbackState !== 'idle' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-10 left-8 md:bottom-12 md:left-12 z-50 flex items-center justify-center gap-5 bg-gray-900 shadow-2xl px-6 py-3 rounded-full border border-gray-700"
          >
            {playbackState === 'playing' ? (
              <button onClick={pauseReading} className="flex items-center justify-center text-white hover:text-blue-400 transition-colors cursor-pointer"><Pause fill="currentColor" size={20} /></button>
            ) : (
              <button onClick={resumeReading} className="flex items-center justify-center text-white hover:text-blue-400 transition-colors cursor-pointer"><Play fill="currentColor" size={20} /></button>
            )}
            <div className="w-px h-6 bg-gray-700"></div>
            <div className="relative flex items-center justify-center">
              <button onClick={stopReading} className="flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors cursor-pointer"><Square fill="currentColor" size={18} /></button>
              <AnimatePresence>
                {particles.map(p => (
                  <motion.div key={p.id} initial={{ opacity: 1, x: 0, y: 0, scale: 0.5 }} animate={{ opacity: 0, x: p.x, y: p.y, scale: p.size }} exit={{ opacity: 0 }} transition={{ duration: p.duration, delay: p.delay, ease: "easeOut" }} className="absolute top-1/2 left-1/2 w-2 h-2 bg-blue-400 rounded-full pointer-events-none mix-blend-screen"/>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full relative flex flex-col items-center p-4 md:p-8 pb-36 pt-24 h-full overflow-hidden">
        {pdfUrl ? (
          <div 
             ref={pdfWrapperRef}
             onTouchStart={handleTouchStart}
             onTouchEnd={handleTouchEnd}
             onMouseDownCapture={() => {
               if (!isPanning) {
                 if (playbackStateRef.current !== 'idle') stopReading();
                 setSelectionBox(null); setIsHoveringColor(false); setIsMobileColorOpen(false);
               }
             }}
             onMouseDown={handlePdfMouseDown} onMouseMove={handlePdfMouseMove} onMouseLeave={handlePdfMouseUp} 
             className={`w-full max-w-5xl bg-white shadow-2xl rounded-xl relative overflow-auto transition-all duration-500 ${isPanning ? (isDraggingPdf ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-auto'} ${readingTheme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`} 
             style={{ height: 'calc(100vh - 160px)' }}
           >
             <div ref={pageContainerRef} className="relative mx-auto transition-all duration-500" style={{ width: containerWidth * zoom, ...getThemeStyles() }}>
               
               {/* 1. Permanent Highlights */}
               {currentHighlights.map((hl, index) => (
                  <div key={index} className={`absolute ${hl.color.ui} mix-blend-multiply opacity-50 pointer-events-none z-10 rounded-[2px]`} style={{ top: hl.relativeTop * zoom, left: hl.relativeLeft * zoom, width: hl.width * zoom, height: hl.height * zoom }} />
               ))}

               {/* 2. Active Reading Highlight */}
               <AnimatePresence>
                 {readingSelection && (
                   <motion.div 
                     initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}
                     className={`absolute bg-blue-400 mix-blend-multiply pointer-events-none z-10 rounded-[2px] ${playbackState === 'playing' ? 'animate-pulse opacity-40' : 'opacity-20'}`} 
                     style={{ top: readingSelection.relativeTop * zoom, left: readingSelection.relativeLeft * zoom, width: readingSelection.width * zoom, height: readingSelection.height * zoom }} 
                   />
                 )}
               </AnimatePresence>

               <div className={isPanning ? "pointer-events-none" : ""}>
                 <Document file={pdfUrl} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                   <Page pageNumber={pageNumber} renderTextLayer={true} renderAnnotationLayer={false} width={containerWidth * zoom} />
                 </Document>
               </div>
             </div>
           </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center px-4 text-center text-gray-400"><BookOpen size={64} className="mb-4 opacity-50" /><h2 className="text-xl md:text-2xl font-medium text-gray-500">Waiting for a document.</h2><p className="mt-2 text-sm md:text-base opacity-75">Drag & Drop a PDF, or pick one from your Library.</p></div>
        )}

        {/* DICTIONARY POPUP */}
        <AnimatePresence>
          {definition && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-32 md:bottom-28 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-white border border-gray-200 shadow-2xl rounded-2xl p-5 z-50 text-gray-800">
              <div className="flex justify-between items-start mb-2"><h3 className="font-bold text-lg text-blue-600 capitalize">{definition.word}</h3><button onClick={() => setDefinition(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><XCircle size={20} /></button></div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{definition.text}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FLOATING TEXT MENU */}
        <AnimatePresence>
          {selectionBox && !isPanning && (
            <motion.div 
              initial="hidden" animate="visible" exit="hidden" 
              variants={{ visible: { transition: { staggerChildren: 0.05 } } }} 
              onMouseDown={(e) => e.preventDefault()} onTouchStart={(e) => e.preventDefault()} 
              className="fixed flex flex-col items-start gap-2 z-50 floating-menu" 
              style={{ top: selectionBox.viewportTop - 55, left: Math.max(10, selectionBox.viewportLeft) }}
            >
              <div className="flex gap-2 items-center">
                <motion.button variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} onClick={readAloud} className="bg-gray-900 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-sm font-medium hover:bg-blue-600 transition-colors cursor-pointer"><Volume2 size={16} /> Read</motion.button>
                <motion.button variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} onClick={getDefinition} className="bg-gray-900 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-sm font-medium hover:bg-green-600 transition-colors cursor-pointer"><Search size={16} /> Define</motion.button>
                <motion.button variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} onClick={copyTextToClipboard} className="bg-gray-900 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-sm font-medium hover:bg-purple-600 transition-colors cursor-pointer">
                  {hasCopied ? <Check size={16} className="text-green-400"/> : <Copy size={16} />} {hasCopied ? 'Copied' : 'Copy'}
                </motion.button>

                <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="relative flex items-center gap-2" onMouseEnter={() => setIsHoveringColor(true)} onMouseLeave={() => setIsHoveringColor(false)}>
                  <div className="bg-gray-900 p-1 rounded-full shadow-2xl flex items-center">
                    <button onClick={() => addHighlight(activeColor)} className="text-white px-3 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium hover:bg-yellow-500 transition-colors cursor-pointer"><Highlighter size={16} /> Mark</button>
                    <div className="w-px h-5 bg-gray-700 mx-1"></div>
                    <button onClick={() => setIsMobileColorOpen(!isMobileColorOpen)} className="text-gray-300 hover:text-white px-2 py-1.5 cursor-pointer"><Palette size={16} /></button>
                  </div>
                  <AnimatePresence>
                    {(isHoveringColor || isMobileColorOpen) && (
                      <motion.div initial={{ opacity: 0, scale: 0.8, x: -10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.8, x: -10 }} className="absolute left-full ml-2 flex gap-1.5 bg-white p-1.5 rounded-full shadow-2xl border border-gray-100">
                        {COLORS.map(c => <button key={c.name} onClick={() => addHighlight(c)} className={`w-7 h-7 rounded-full ${c.ui} hover:scale-110 transition-transform shadow-inner border border-black/10 cursor-pointer ${activeColor.name === c.name ? 'ring-2 ring-offset-1 ring-gray-800' : ''}`} title={c.name} />)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* BOTTOM PAGINATION TOOLBAR */}
        <motion.div initial={{ y: 100 }} animate={{ y: 0 }} transition={{ delay: 0.2, type: "spring", stiffness: 120 }} className="fixed bottom-6 md:bottom-8 z-40 text-gray-800">
          <motion.div animate={floatAnimation} className="bg-white/90 backdrop-blur-sm shadow-2xl border border-gray-200 rounded-full px-4 py-2.5 md:px-6 md:py-3 flex items-center gap-3">
            {pdfUrl && (
              <>
                <div className="flex items-center gap-1 md:gap-2 border-r border-gray-200 pr-3">
                  <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} className="p-1.5 hover:bg-gray-100 rounded-full cursor-pointer transition text-gray-600"><ZoomOut size={18} /></button>
                  <span className="text-xs md:text-sm font-semibold w-10 text-center text-gray-500">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom(z => Math.min(z + 0.25, 3.0))} className="p-1.5 hover:bg-gray-100 rounded-full cursor-pointer transition text-gray-600"><ZoomIn size={18} /></button>
                  <button onClick={() => {setIsPanning(!isPanning); setSelectionBox(null);}} className={`p-1.5 rounded-full cursor-pointer transition ml-1 ${isPanning ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Pan Tool"><Hand size={18} /></button>
                </div>
                <div className="flex items-center gap-1 border-r border-gray-200 pr-3">
                  <button onClick={undo} disabled={historyStep === 0} className="p-1.5 hover:bg-gray-100 rounded-full disabled:opacity-30 cursor-pointer"><Undo2 size={18} /></button>
                  <button onClick={redo} disabled={historyStep === history.length - 1} className="p-1.5 hover:bg-gray-100 rounded-full disabled:opacity-30 cursor-pointer"><Redo2 size={18} /></button>
                </div>
                <div className="flex items-center gap-1 border-r border-gray-200 pr-3">
                  <button onClick={() => setPageNumber(p => Math.max(p - 1, 1))} className="p-1 hover:bg-gray-100 rounded-full cursor-pointer"><ChevronLeft size={20} /></button>
                  <span className="text-xs md:text-sm font-semibold w-8 md:w-12 text-center">{pageNumber}/{numPages}</span>
                  <button onClick={() => setPageNumber(p => Math.min(p + 1, numPages || 1))} className="p-1 hover:bg-gray-100 rounded-full cursor-pointer"><ChevronRight size={20} /></button>
                </div>
                <button onClick={downloadModifiedPdf} className="flex items-center gap-1 hover:bg-gray-100 text-green-600 font-semibold px-2 py-1 rounded-full cursor-pointer transition-colors border-r border-gray-200 pr-3"><Download size={18} /> <span className="hidden md:inline">Export</span></button>
              </>
            )}
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="application/pdf" className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full cursor-pointer transition-colors" title="Upload PDF"><Upload size={18} /></button>
          </motion.div>
        </motion.div>

        {/* ACTIVE DOCUMENT TRACKING DASHBOARD */}
        {currentFileId && (() => {
          const currentDoc = library.find(d => d.id === currentFileId);
          if (!currentDoc) return null;
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-30 flex flex-col items-end bg-white/90 px-3 py-2 rounded-xl border border-gray-200 shadow-sm backdrop-blur-sm pointer-events-auto text-gray-800">
              <span className="font-semibold text-xs mb-1 truncate max-w-[150px] md:max-w-[200px] flex items-center gap-1.5"><FileText size={12} className="text-blue-500" /> {currentDoc.name}</span>
              <span className="text-[10px] text-gray-500">Seen: {new Date(currentDoc.lastSeen || currentDoc.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
              {currentDoc.lastModified && (
                <span 
                  onClick={() => alert(`Modifications on ${currentDoc.name}:\n\n${currentDoc.modType || 'Edits applied'}\n\nPlease click "Export" in the toolbar to save these changes to your device.`)}
                  className="text-[10px] text-blue-500 hover:underline cursor-pointer flex items-center mt-0.5"
                >
                  Mod: {new Date(currentDoc.lastModified).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} <Info size={10} className="ml-1" />
                </span>
              )}
            </motion.div>
          );
        })()}

      </div>
    </div>
  );
}