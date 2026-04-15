/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  Upload, 
  FileAudio, 
  FileText, 
  CheckCircle2, 
  Loader2, 
  Download, 
  Copy, 
  RefreshCcw,
  Mic,
  ChevronRight,
  FileJson,
  FileCode
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { transcribeAudio, processText, ProcessingResult, MODEL_NAME } from '@/lib/gemini';
import { cn } from '@/lib/utils';

// pdfmake imports
import * as pdfMake from "pdfmake/build/pdfmake";
import * as pdfFonts from "pdfmake/build/vfs_fonts";

// @ts-ignore
const pdfMakeLib = pdfMake.default || pdfMake;
// @ts-ignore
const pdfFontsLib = pdfFonts.default || pdfFonts;

if ((pdfFontsLib as any) && (pdfFontsLib as any).pdfMake) {
  (pdfMakeLib as any).vfs = (pdfFontsLib as any).pdfMake.vfs;
} else if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMakeLib as any).vfs = (pdfFonts as any).pdfMake.vfs;
}

type Step = 'idle' | 'uploading' | 'transcribing' | 'cleaning' | 'generating' | 'improving' | 'done' | 'error';

export default function App() {
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ProcessingResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([audioBlob], "recording.webm", { type: 'audio/webm' });
        
        setFileName("Voice Recording");
        setStep('uploading');
        setProgress(10);

        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setStep('transcribing');
          setProgress(30);
          
          try {
            const transcript = await transcribeAudio(base64, 'audio/webm');
            await runPipeline(transcript);
          } catch (err) {
            console.error(err);
            toast.error("Transcription failed.");
            setStep('error');
          }
        };
        reader.onerror = () => {
          toast.error("Failed to read recording data.");
          setStep('error');
        };
        reader.readAsDataURL(file);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.info("Recording started...");
    } catch (err) {
      console.error(err);
      toast.error("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      toast.info("Recording stopped. Processing...");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (Gemini inlineData limit is ~20MB)
    const MAX_FILE_SIZE = 18 * 1024 * 1024; // 18MB to be safe with base64 overhead
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Please upload a file smaller than 18MB.`);
      return;
    }

    setFileName(file.name);
    setStep('uploading');
    setProgress(10);

    try {
      const reader = new FileReader();
      
      if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.m4a')) {
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1];
            if (!base64) throw new Error("Could not extract base64 data from file.");

            setStep('transcribing');
            setProgress(30);
            
            // Ensure we have a valid mime type for Gemini
            const mimeType = file.type || (file.name.endsWith('.mp3') ? 'audio/mp3' : file.name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
            const transcript = await transcribeAudio(base64, mimeType);
            await runPipeline(transcript);
          } catch (err: any) {
            console.error("Transcription process error:", err);
            toast.error(err.message || "Transcription failed. Please try again.");
            setStep('error');
          }
        };
        reader.onerror = () => {
          toast.error("Failed to read file. The file might be corrupted.");
          setStep('error');
        };
        reader.readAsDataURL(file);
      } else if (file.type === 'text/plain') {
        reader.onload = async () => {
          try {
            const content = reader.result as string;
            await runPipeline(content);
          } catch (err: any) {
            console.error("Text processing error:", err);
            toast.error(err.message || "Processing failed.");
            setStep('error');
          }
        };
        reader.onerror = () => {
          toast.error("Failed to read text file.");
          setStep('error');
        };
        reader.readAsText(file);
      } else {
        toast.error("Unsupported file type. Please upload audio (MP3, WAV, M4A) or text files.");
        setStep('idle');
      }
    } catch (err: any) {
      console.error("File upload handler error:", err);
      toast.error("An error occurred while preparing the file.");
      setStep('error');
    }
  };

  const runPipeline = async (rawText: string) => {
    setStep('cleaning');
    setProgress(50);
    
    try {
      const result = await processText(rawText);
      setResults(result);
      setStep('done');
      setProgress(100);
      toast.success("Processing complete!");
    } catch (err) {
      console.error(err);
      toast.error("AI processing failed.");
      setStep('error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const downloadFile = (text: string, ext: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voicenote-export.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    if (!results) return;
    
    const docDefinition = {
      content: [
        { text: 'VoiceNote AI Assistant Export', style: 'header' },
        { text: `File: ${fileName}`, style: 'subheader' },
        { text: 'Final Improved Notes', style: 'sectionHeader' },
        { text: results.finalNotes },
        { text: '\n\nStructured Notes', style: 'sectionHeader' },
        { text: results.structuredNotes },
        { text: '\n\nRaw Transcript', style: 'sectionHeader' },
        { text: results.rawTranscript, style: 'small' }
      ],
      styles: {
        header: { fontSize: 18, bold: true, marginBottom: 10 },
        subheader: { fontSize: 14, marginBottom: 20, color: '#666' },
        sectionHeader: { fontSize: 14, bold: true, marginTop: 20, marginBottom: 10, color: '#2563eb' },
        small: { fontSize: 10, color: '#444' }
      }
    };

    (pdfMakeLib as any).createPdf(docDefinition).download(`voicenote-notes.pdf`);
  };

  const reset = () => {
    setStep('idle');
    setResults(null);
    setProgress(0);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 selection:text-primary-foreground">
      <Toaster position="top-center" />
      
      <div className="max-w-[1400px] mx-auto p-10 flex flex-col min-h-screen gap-8">
        {/* Header */}
        <header className="flex justify-between items-end border-b border-border pb-6">
          <div>
            <div className="text-[12px] uppercase tracking-[2px] text-muted-foreground mb-2">
              SYSTEM READY — PROCESSING {MODEL_NAME.toUpperCase()}
            </div>
            <h1 className="font-heading text-[72px] leading-[0.85] tracking-[-4px] uppercase text-primary">
              VOICENOTE<br />AI ASSISTANT
            </h1>
          </div>
          <div className="text-right">
            <div className="text-[12px] uppercase tracking-[2px] text-muted-foreground mb-1">
              SESSION: VN-{Math.floor(Math.random() * 9000) + 1000}
            </div>
            <div className="text-sm text-muted-foreground/60">
              English + Bangla Auto-Detect
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0">
          <AnimatePresence mode="wait">
            {step === 'idle' || step === 'error' ? (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-10 h-full"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-sm bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center">01</div>
                    <div className="text-[11px] uppercase tracking-[2px] text-muted-foreground font-bold">Upload Source</div>
                  </div>
                  
                  <div className="flex flex-col gap-4 flex-1">
                    <Card 
                      className={cn(
                        "flex-1 border border-border bg-card transition-all hover:border-primary group cursor-pointer flex flex-col items-center justify-center text-center p-8",
                        step === 'error' && "border-destructive"
                      )}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="text-4xl mb-4 opacity-50 group-hover:opacity-100 transition-opacity">⏏</div>
                      <p className="font-bold text-lg uppercase tracking-tight">Upload File</p>
                      <p className="text-[11px] text-muted-foreground mt-2">MP3, WAV, M4A or TXT</p>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden" 
                        accept="audio/*,.txt"
                      />
                    </Card>

                    <Card 
                      className={cn(
                        "flex-1 border border-border bg-card transition-all hover:border-primary group cursor-pointer flex flex-col items-center justify-center text-center p-8",
                        isRecording && "border-primary bg-primary/5 animate-pulse"
                      )}
                      onClick={isRecording ? stopRecording : startRecording}
                    >
                      <div className={cn(
                        "w-12 h-12 rounded-full flex items-center justify-center mb-4 transition-transform",
                        isRecording ? "bg-primary scale-110" : "bg-muted group-hover:scale-110"
                      )}>
                        <Mic className={cn("w-6 h-6", isRecording ? "text-primary-foreground" : "text-primary")} />
                      </div>
                      <p className="font-bold text-lg uppercase tracking-tight">{isRecording ? "Stop" : "Record"}</p>
                      <p className="text-[11px] text-muted-foreground mt-2">{isRecording ? "Click to stop" : "Use microphone"}</p>
                    </Card>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-sm bg-muted text-muted-foreground w-6 h-6 flex items-center justify-center">02</div>
                    <div className="text-[11px] uppercase tracking-[2px] text-muted-foreground font-bold opacity-50">Raw Transcript</div>
                  </div>
                  <Card className="flex-1 bg-card border border-border flex items-center justify-center p-8 opacity-20">
                    <p className="text-[11px] uppercase tracking-[2px] font-bold">Waiting for input...</p>
                  </Card>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-sm bg-muted text-muted-foreground w-6 h-6 flex items-center justify-center">03</div>
                    <div className="text-[11px] uppercase tracking-[2px] text-muted-foreground font-bold opacity-50">Improved Notes</div>
                  </div>
                  <Card className="flex-1 bg-card border border-border flex items-center justify-center p-8 opacity-20">
                    <p className="text-[11px] uppercase tracking-[2px] font-bold">Waiting for input...</p>
                  </Card>
                </div>
              </motion.div>
            ) : step === 'done' && results ? (
              <motion.div
                key="results"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_2fr] gap-10 h-full min-h-0"
              >
                {/* Col 1: Source */}
                <div className="flex flex-col gap-4 min-h-0">
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-sm bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center">01</div>
                    <div className="text-[11px] uppercase tracking-[2px] text-muted-foreground font-bold">Upload Source</div>
                  </div>
                  <Card className="flex-1 bg-card border border-border p-6 flex flex-col justify-center items-center text-center relative overflow-hidden">
                    <div className="text-4xl mb-4 text-primary">⏏</div>
                    <div className="text-lg font-black text-primary uppercase tracking-tight break-all px-4">{fileName}</div>
                    <div className="text-[11px] text-muted-foreground mt-2 uppercase tracking-widest">Processed successfully</div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={reset}
                      className="mt-6 border border-primary/30 hover:border-primary text-primary text-[10px] font-black uppercase tracking-widest"
                    >
                      <RefreshCcw className="w-3 h-3 mr-2" /> New Session
                    </Button>
                  </Card>
                </div>

                {/* Col 2: Raw Transcript */}
                <div className="flex flex-col gap-4 min-h-0">
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-sm bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center">02</div>
                    <div className="text-[11px] uppercase tracking-[2px] text-muted-foreground font-bold">Raw Transcript</div>
                  </div>
                  <Card className="flex-1 bg-card border border-border p-6 relative flex flex-col min-h-0">
                    <div className="absolute top-2 right-2 text-[9px] bg-muted px-2 py-0.5 text-muted-foreground uppercase font-bold tracking-widest">
                      {MODEL_NAME.toUpperCase()} CLEANED
                    </div>
                    <ScrollArea className="flex-1 mt-4">
                      <div className="font-mono text-[13px] leading-relaxed text-muted-foreground/80 pr-4 whitespace-pre-wrap">
                        {results.rawTranscript}
                      </div>
                    </ScrollArea>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => copyToClipboard(results.rawTranscript)}
                      className="absolute bottom-2 right-2 text-primary hover:bg-primary/10"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </Card>
                </div>

                {/* Col 3: Improved Notes */}
                <div className="flex flex-col gap-4 min-h-0">
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-sm bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center">03</div>
                    <div className="text-[11px] uppercase tracking-[2px] text-muted-foreground font-bold">Improved Notes</div>
                  </div>
                  <Card className="flex-1 bg-card border border-border p-8 relative flex flex-col min-h-0">
                    <div className="absolute top-2 right-2 text-[9px] bg-primary/20 px-2 py-0.5 text-primary uppercase font-bold tracking-widest">
                      AI REFINED
                    </div>
                    <ScrollArea className="flex-1 mt-4">
                      <div className="prose-bold pr-4">
                        <ReactMarkdown>{results.finalNotes}</ReactMarkdown>
                      </div>
                    </ScrollArea>
                    <div className="absolute bottom-4 right-4 flex gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => copyToClipboard(results.finalNotes)}
                        className="text-primary hover:bg-primary/10"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full py-20 space-y-10"
              >
                <div className="relative w-32 h-32">
                  <div className="absolute inset-0 border-2 border-muted"></div>
                  <motion.div 
                    className="absolute inset-0 border-2 border-primary border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Mic className="w-10 h-10 text-primary animate-pulse" />
                  </div>
                </div>
                
                <div className="text-center space-y-2">
                  <h3 className="font-heading text-4xl uppercase text-primary tracking-tight">{step}...</h3>
                  <p className="text-[11px] uppercase tracking-[3px] text-muted-foreground font-bold">Processing: {fileName}</p>
                </div>

                <div className="w-full max-w-md space-y-4">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">
                    <span>Pipeline Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-1 bg-muted" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer */}
        <footer className="flex justify-between items-center pt-6 border-t border-border">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground mr-4">Pipeline</span>
            {[1, 2, 3, 4, 5].map((i) => {
              const activeCount = Math.floor(progress / 20);
              return (
                <div 
                  key={i} 
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-all duration-500",
                    i <= activeCount ? "bg-primary shadow-[0_0_8px_#CBFF00]" : "bg-muted"
                  )} 
                />
              );
            })}
          </div>
          
          <div className="flex gap-4">
            {results && (
              <>
                <Button 
                  variant="outline" 
                  onClick={() => downloadFile(results.finalNotes, 'md')}
                  className="border-primary text-primary hover:bg-primary hover:text-primary-foreground font-black uppercase text-[11px] tracking-widest px-6"
                >
                  Copy Markdown
                </Button>
                <Button 
                  variant="outline" 
                  onClick={exportPDF}
                  className="border-primary text-primary hover:bg-primary hover:text-primary-foreground font-black uppercase text-[11px] tracking-widest px-6"
                >
                  Export PDF
                </Button>
              </>
            )}
            <Button 
              onClick={step === 'done' ? reset : () => {}}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-black uppercase text-[11px] tracking-widest px-8"
            >
              {step === 'done' ? 'New Recording' : 'System Ready'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
