// TextChunker.ts

export class TextChunker {
  static optimizeForStreaming(rawText: string): string[] {
    const sanitizedText = rawText
      .replace(/-\s*[\r\n]+\s*/g, '')      
      .replace(/[\r\n]+/g, ' ')            
      .replace(/[^\x20-\x7E]/g, ' ')       
      .replace(/\s+/g, ' ')                
      .trim();

    if (!sanitizedText) return [];

    // Split by natural boundaries
    const rawChunks = sanitizedText.match(/[^.,!?;:]+[.,!?;:]*/g)?.map(s => s.trim()).filter(s => s.length > 0) || [sanitizedText];
    
    const optimalChunks: string[] = [];
    let currentBatch = "";
    let isFirstChunk = true;

    for (const chunk of rawChunks) {
      // THE PRIMER: Force the first chunk to be extremely small (e.g., first 4 words).
      // This satisfies the paper's requirement for a minimal first-chunk latency.
      if (isFirstChunk) {
        const words = chunk.split(' ');
        if (words.length > 5) {
            optimalChunks.push(words.slice(0, 4).join(' '));
            currentBatch = words.slice(4).join(' ');
        } else {
            optimalChunks.push(chunk);
        }
        isFirstChunk = false;
        continue;
      }

      // THE SUSTAINERS: Batch the rest to maximize hardware throughput.
      currentBatch += (currentBatch ? " " : "") + chunk;
      const wordCount = currentBatch.split(/\s+/).length;
      
      if (wordCount >= 15 || /[.!?]$/.test(chunk)) {
         optimalChunks.push(currentBatch);
         currentBatch = ""; 
      }
    }
    
    if (currentBatch) optimalChunks.push(currentBatch);
    return optimalChunks;
  }
}