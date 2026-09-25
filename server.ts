/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// Initialize Google GenAI with environment GEMINI_API_KEY
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  console.warn('GEMINI_API_KEY is not defined in environment variables. Falling back to local responses.');
}

const ROSHAN_SYSTEM_INSTRUCTION = `
You are the Official AI Production Assistant for Roshan Devkota, an elite Multimedia Specialist, Video Editor & Digital Marketer based in Butwal-06 (Traffick Chowk), Nepal.

YOUR KNOWLEDGE BASE & FACTS:
1. Role & Identity:
   - Official AI Production Assistant for Roshan Devkota.
   - Multimedia Specialist, Video Editor & Digital Marketer located at Butwal-06, Traffick Chowk, Nepal.
   - Phone: +977-9866144098
   - WhatsApp: https://wa.me/9779866144098
   - Email: devkotaroshan89@gmail.com

2. Turnaround Times & Delivery Speed:
   - Reels / Short-Form Vertical Videos (Instagram, TikTok, YouTube Shorts): 24–48 hours turnaround.
   - Commercial Edits & Long-Form Video: 3–5 business days depending on complexity and footage volume.
   - Rush / Expedited delivery: Available upon request for urgent broadcast or campaign launches.

3. Codecs & Delivery Formats:
   - Master delivery: ProRes 422 / 422 HQ (Apple ProRes), DNxHR for broadcast and high-end mastering.
   - Web & Social delivery: H.264 / H.265 (MP4), vertical 9:16 (1080x1920 / 4K) for Reels/Shorts/TikTok, 16:9 widescreen for YouTube & Commercial Web.
   - Audio: Uncompressed 24-bit 48kHz WAV / Linear PCM with dual-system sync and Izotope RX noise reduction.
   - Color pipeline: S-Log3, Apple Log, ACES color management, DaVinci Resolve Studio 19, custom film emulation LUTs.

4. Work History & Academic Background:
   - Multimedia Specialist at Kathwall Creation (May 2026 – Present).
   - Video Editor Intern at Focus Creation (2024).
   - B.Sc. (Hons) Multimedia Technology from Islington College, Kathmandu (2022–2025).
   - Certified in Digital Marketing (SEO, Paid Meta & Google Campaigns, Analytics) by AITC Education.

5. Rates & Payment Structure:
   - Custom tiered pricing based on project scope, raw footage volume, motion graphics complexity, and revision cycles.
   - Standard milestone structure: 50% deposit upon project agreement to lock calendar bandwidth, 50% upon final delivery of unwatermarked master exports.
   - Domestic Payments (Nepal): eSewa, Khalti, direct Commercial Bank Wire (NPR).
   - International Payments: Wise (USD, EUR, GBP, AUD), Direct SWIFT Wire, Payoneer.

6. Tone & Instructions:
   - Be professional, cinematic, cyber-tactical, crisp, and helpful.
   - Never say "I have received your request. Let me know if you would like to book a project with Roshan!" as a generic canned text. Answer the user's specific questions accurately and dynamically using the facts above.
   - Format responses cleanly with bullet points, bold key specifications, and include direct links when relevant:
     * WhatsApp: [Chat on WhatsApp](https://wa.me/9779866144098)
     * Email: devkotaroshan89@gmail.com
     * Phone: +977-9866144098
`;

// Candidate models for text generation in order of priority (resilience against quota & availability)
const MODEL_CANDIDATES = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-1.5-flash'
];

// API endpoint: /api/chat
app.post('/api/chat', async (req, res) => {
  const { messages, userMessage, model: requestedModel, systemInstruction } = req.body || {};

  if (!userMessage && (!Array.isArray(messages) || messages.length === 0)) {
    return res.status(400).json({ error: 'Message content is required.' });
  }

  if (!ai) {
    console.warn('[AI Server] GEMINI_API_KEY is not configured on server.');
    const fallbackReply = `Roshan Devkota is fully available for commercial video editing, DaVinci Resolve color grading, and 9:16 vertical reels retention engineering. You can connect with Roshan directly via WhatsApp at https://wa.me/9779866144098 or email devkotaroshan89@gmail.com.`;
    return res.json({ 
      reply: fallbackReply, 
      offline: true,
      modelUsed: 'offline-dispatch' 
    });
  }

  // Format conversation history for Gemini API
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg && msg.text) {
        const isModel = msg.sender === 'assistant' || msg.role === 'model';
        contents.push({
          role: isModel ? 'model' : 'user',
          parts: [{ text: String(msg.text).trim() }],
        });
      }
    }
  }

  if (userMessage) {
    contents.push({
      role: 'user',
      parts: [{ text: String(userMessage).trim() }],
    });
  }

  // If a specific model was requested by the client (e.g. gemini-1.5-flash), prioritize it
  const activeCandidates = requestedModel && typeof requestedModel === 'string'
    ? [requestedModel, ...MODEL_CANDIDATES.filter(m => m !== requestedModel)]
    : MODEL_CANDIDATES;

  const instructionToUse = systemInstruction && typeof systemInstruction === 'string'
    ? systemInstruction
    : ROSHAN_SYSTEM_INSTRUCTION;

  // Attempt generation across model candidates (resilience against transient 503 high demand spikes)
  let lastError: any = null;
  for (const model of activeCandidates) {
    try {
      console.log(`[AI Server] Dispatching request to model: ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: instructionToUse,
          temperature: 0.7,
        },
      });

      const reply = response.text?.trim() || 'I have recorded your request. Feel free to contact Roshan directly via WhatsApp!';
      return res.json({ 
        reply, 
        modelUsed: model,
        success: true 
      });
    } catch (error: any) {
      lastError = error;
      console.error(`[AI Server] Model ${model} encountered an error:`, error?.message || error);
    }
  }

  // If all candidates failed, log full diagnostic and return helpful fallback with 503 status
  console.error('[AI Server] All Gemini model candidates failed. Detailed error:', lastError);
  const gracefulFallback = `Thank you for your message! Our AI production dispatch is currently experiencing heavy network traffic, but Roshan Devkota is directly reachable on WhatsApp at [+977-9866144098](https://wa.me/9779866144098) or email [devkotaroshan89@gmail.com](mailto:devkotaroshan89@gmail.com) for project bookings, commercial editing rates, and timelines.`;
  
  return res.status(503).json({
    error: 'AI service temporarily unavailable due to high model demand.',
    details: lastError?.message || String(lastError),
    fallbackReply: gracefulFallback,
    reply: gracefulFallback
  });
});

// API endpoint: /api/health
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString() 
  });
});

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
