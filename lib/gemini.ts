import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const MODEL_NAME = "gemini-3-flash-preview";

export interface ProcessingResult {
  rawTranscript: string;
  cleanTranscript: string;
  structuredNotes: string;
  finalNotes: string;
}

export async function transcribeAudio(base64Data: string, mimeType: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured. Please add it to your environment variables.");
  }

  console.log(`[Gemini] Starting transcription for ${mimeType}. Data length: ${base64Data.length}`);
  
  try {
    // Gemini supports audio/mpeg, audio/mp3, audio/wav, audio/aac, audio/ogg, audio/flac
    // Ensure mimeType is one of these or fallback to audio/mpeg
    const supportedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm'];
    const safeMimeType = supportedTypes.includes(mimeType) ? mimeType : 'audio/mpeg';

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: safeMimeType,
              data: base64Data,
            },
          },
          {
            text: "Transcribe this audio file accurately. Detect the language automatically (supports Bangla and English). Identify different speakers and label them (e.g., Speaker 1, Speaker 2). Provide the transcript in a dialogue format.",
          },
        ],
      },
    });

    if (!response || !response.text) {
      console.warn("[Gemini] Empty response received from model.");
      return "No transcript could be generated.";
    }

    const text = response.text;
    console.log(`[Gemini] Transcription complete. Length: ${text.length}`);
    return text;
  } catch (error: any) {
    console.error("[Gemini] Transcription error details:", {
      message: error.message,
      stack: error.stack,
      status: error.status,
    });
    
    if (error.message?.includes("429")) {
      throw new Error("Rate limit exceeded. Please wait a moment and try again.");
    }
    if (error.message?.includes("400")) {
      throw new Error("Invalid request. The file might be too large or in an unsupported format.");
    }
    
    throw new Error(`Transcription failed: ${error.message || "Unknown error"}`);
  }
}

export async function processText(text: string): Promise<ProcessingResult> {
  // Step 1: Cleanup
  const cleanupResponse = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Clean the following transcript. Remove filler words, noise, repetition. Keep meaning intact.
    
    Transcript:
    ${text}`,
  });
  const cleanTranscript = cleanupResponse.text || "";

  // Step 2: Note Generation
  const generationResponse = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Convert the following cleaned transcript into structured notes with headings, bullet points, and key highlights. If multiple speakers are identified, attribute key points to the correct speaker where relevant.
    
    Cleaned Transcript:
    ${cleanTranscript}`,
  });
  const structuredNotes = generationResponse.text || "";

  // Step 3: Note Improvement
  const improvementResponse = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Improve the following notes professionally. Make it clearer, concise, and actionable. Ensure speaker attributions are preserved if they add value to the context.
    
    Structured Notes:
    ${structuredNotes}`,
  });
  const finalNotes = improvementResponse.text || "";

  return {
    rawTranscript: text,
    cleanTranscript,
    structuredNotes,
    finalNotes,
  };
}

export async function processFile(content: string): Promise<ProcessingResult> {
  // If it's a text file
  return processText(content);
}
