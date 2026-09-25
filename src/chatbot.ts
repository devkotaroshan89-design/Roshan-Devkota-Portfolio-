/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  submitInquiryToFirestore, 
  createOrUpdateChatSession, 
  appendChatMessage, 
  loginWithGoogle, 
  logoutUser, 
  onAuthStatusChange 
} from './firebase';
import type { User } from 'firebase/auth';

/**
 * Chat Message Structure
 */
export interface ChatMessageItem {
  id?: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

/**
 * System Instructions & Grounded Knowledge Base for Roshan Devkota
 * Official AI Production Assistant Persona
 */
export const ROSHAN_DEVKOTA_SYSTEM_INSTRUCTION = `
You are the Official AI Production Assistant for Roshan Devkota, an elite Multimedia Specialist, Video Editor & Digital Marketer based in Butwal-06 (Traffick Chowk), Nepal.

OFFICIAL PROFILE & KNOWLEDGE BASE:
1. Role & Identity:
   - Official AI Production Assistant for Roshan Devkota.
   - Multimedia Specialist, Commercial Video Editor & Digital Marketer.
   - Studio Location: Butwal-06, Traffick Chowk, Lumbini Province, Nepal (UTC+5:45).
   - Phone / Direct Line: +977-9866144098
   - WhatsApp: https://wa.me/9779866144098
   - Email: devkotaroshan89@gmail.com

2. Turnaround Times & Delivery Speed:
   - Reels / Short-Form Vertical Videos (Instagram Reels, TikTok, YouTube Shorts): 24–48 hours standard delivery.
   - Commercial Edits & Long-Form Video: 3–5 business days depending on footage volume, visual complexity, and motion design depth.
   - Rush / Expedited delivery: Available upon request for urgent commercial campaign deadlines and broadcast schedules.

3. Codecs & Delivery Formats:
   - Master delivery: Apple ProRes 422 / 422 HQ, Avid DNxHR for broadcast and archival mastering.
   - Web & Social delivery: High-bitrate H.264 / H.265 (MP4), vertical 9:16 (1080x1920 / 4K) for Reels/Shorts/TikTok, 16:9 widescreen for YouTube & Commercial Web.
   - Audio: Uncompressed 24-bit 48kHz WAV / Linear PCM with dual-system sound sync and Izotope RX noise reduction.
   - Color pipeline: S-Log3, Apple Log, ACES color management, DaVinci Resolve Studio 19, custom film print LUT emulations.

4. Work History & Academic Background:
   - Multimedia Specialist at Kathwall Creation (May 2026 – Present).
   - Video Editor Intern at Focus Creation (2024).
   - B.Sc. (Hons) Multimedia Technology from Islington College, Kathmandu (2022–2025).
   - Certified in Digital Marketing (SEO, Paid Meta & Google Campaigns, Analytics) by AITC Education.

5. Rates & Payment Structure:
   - Custom tiered pricing based on project scope, raw footage volume, motion graphics requirements, and revision cycles.
   - Standard milestone structure: 50% deposit upon project agreement to lock calendar bandwidth, 50% upon final delivery of unwatermarked master exports.
   - Domestic Payments (Nepal): eSewa, Khalti, direct Commercial Bank Wire (NPR).
   - International Payments: Wise (USD, EUR, GBP, AUD), Direct SWIFT Wire, Payoneer.

6. Persona & Communication Guidelines:
   - Professional, cinematic, cyber-tactical, crisp, and helpful.
   - Dynamically answer prospective clients' questions regarding video editing, vertical retention techniques, motion graphics, turnaround times, and contract booking.
   - Never output hardcoded generic text like "I have received your request. Let me know if you would like to book a project with Roshan!" unless truly offline.
   - Format responses cleanly with bold text for specifications, bullet points for readability, and markdown links for contact channels:
     * WhatsApp: [Chat on WhatsApp](https://wa.me/9779866144098)
     * Email: [devkotaroshan89@gmail.com](mailto:devkotaroshan89@gmail.com)
     * Phone: [+977-9866144098](tel:+9779866144098)
`;

/**
 * Target Gemini Model for the client
 */
export const TARGET_GEMINI_MODEL = 'gemini-1.5-flash';

/**
 * Pre-defined Quick Reply Structure for Common User Inquiries
 */
export interface QuickReplyOption {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  badge?: string;
  colorScheme: 'cyan' | 'violet' | 'emerald' | 'amber' | 'pink';
}

/**
 * Pre-defined Quick Replies for prospective clients and visitors
 */
export const PREDEFINED_QUICK_REPLIES: QuickReplyOption[] = [
  {
    id: 'pricing',
    label: 'View Pricing',
    icon: 'fa-solid fa-coins',
    prompt: 'What are your commercial video editing rates, milestone payment terms, and monthly retainers?',
    badge: 'Rates',
    colorScheme: 'cyan',
  },
  {
    id: 'availability',
    label: 'Available Today?',
    icon: 'fa-solid fa-calendar-check',
    prompt: 'Are you currently available for new video editing projects or emergency 24H rush sprints?',
    badge: 'Live',
    colorScheme: 'emerald',
  },
  {
    id: 'portfolio',
    label: 'Portfolio Access',
    icon: 'fa-solid fa-folder-open',
    prompt: 'Can you provide direct Google Drive portfolio access links and breakdown details for your video and reels work?',
    badge: 'Drive',
    colorScheme: 'violet',
  },
  {
    id: 'reels',
    label: '9:16 Reels Retention',
    icon: 'fa-solid fa-mobile-screen',
    prompt: 'How do you engineer high-retention 9:16 vertical reels for Instagram & TikTok?',
    badge: 'Viral',
    colorScheme: 'pink',
  },
  {
    id: 'turnaround',
    label: 'Turnaround Times',
    icon: 'fa-solid fa-stopwatch',
    prompt: 'What are your standard turnaround timelines and delivery codecs for short-form and commercial projects?',
    colorScheme: 'amber',
  },
  {
    id: 'whatsapp',
    label: 'Direct WhatsApp',
    icon: 'fa-brands fa-whatsapp',
    prompt: 'Where is Roshan located and how do I contact him on WhatsApp right now?',
    badge: 'Fast',
    colorScheme: 'emerald',
  },
];

/**
 * Roshan AI Chatbot HUD Terminal & Gemini Client
 */
export class RoshanAIChatbot {
  private isOpen: boolean = false;
  private isThinking: boolean = false;
  private sessionId: string;
  private messages: ChatMessageItem[] = [];
  private currentUser: User | null = null;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
    this.initAuth();
    this.initDOM();
    this.initContactFormSync();
    this.loadInitialMessages();
  }

  /**
   * Ensure a unique session ID for the guest or authenticated client
   */
  private getOrCreateSessionId(): string {
    const existing = localStorage.getItem('roshan_ai_session_id');
    if (existing) return existing;
    const newId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem('roshan_ai_session_id', newId);
    return newId;
  }

  /**
   * Monitor Firebase Auth changes and sync with Firestore session document
   */
  private initAuth() {
    onAuthStatusChange((user) => {
      this.currentUser = user;
      this.updateAuthUI();
      if (user) {
        createOrUpdateChatSession({
          sessionId: this.sessionId,
          userId: user.uid,
          userEmail: user.email || '',
          clientName: user.displayName || 'Prospective Client',
          messageCount: this.messages.length,
        }).catch((err) => {
          console.warn('[AI Chat] Could not sync user session:', err);
        });
      }
    });
  }

  /**
   * Load messages from localStorage or initialize with welcome prompt
   */
  private loadInitialMessages() {
    const stored = localStorage.getItem(`roshan_chat_${this.sessionId}`);
    if (stored) {
      try {
        this.messages = JSON.parse(stored);
        this.renderMessages();
        return;
      } catch (e) {
        console.warn('[AI Chat] Error parsing stored messages:', e);
      }
    }

    // Default welcome briefing
    this.messages = [
      {
        sender: 'assistant',
        text: `**Welcome to Roshan Devkota's Production Dispatch.** ✦\n\nI am Roshan's tactical AI assistant, powered by Google Gemini & Firestore. Whether you are planning a **4K commercial video edit**, high-retention **9:16 vertical reels**, **motion graphics & VFX**, or a performance digital marketing campaign, I'm here to provide instant specs, rates, and booking parameters.\n\nTap any **Quick Reply** button below (such as **View Pricing**, **Available Today?**, or **Portfolio Access**) or type your inquiry directly.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: 'gemini-1.5-flash',
      },
    ];
    this.renderMessages();
  }

  /**
   * Persist conversation history to localStorage
   */
  private saveMessagesLocally() {
    localStorage.setItem(`roshan_chat_${this.sessionId}`, JSON.stringify(this.messages));
  }

  /**
   * Inject UI HUD into DOM
   */
  private initDOM() {
    const container = document.createElement('div');
    container.id = 'roshan-ai-assistant-container';
    container.innerHTML = `
      <!-- Floating Trigger Button -->
      <div class="fixed bottom-6 right-6 z-50 flex items-center gap-3">
        <!-- Floating Tooltip Preview -->
        <div id="ai-chat-tooltip" class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 border border-cyan-500/40 text-[11px] font-mono text-cyan-300 shadow-glass animate-bounce pointer-events-none">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
          <span>Ask Roshan's AI · Rates &amp; Specs</span>
        </div>

        <button 
          id="ai-chat-toggle-btn" 
          type="button" 
          aria-label="Open Roshan AI Dispatch Terminal"
          class="relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 via-violet-600 to-cyan-400 p-[1.5px] shadow-[0_0_25px_rgba(6,182,212,0.4)] hover:shadow-[0_0_35px_rgba(6,182,212,0.6)] transform hover:scale-105 active:scale-95 transition-all focus:outline-none"
        >
          <div class="w-full h-full rounded-[14px] bg-[#090e18] flex items-center justify-center text-cyan-300 hover:text-white transition-colors relative overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-tr from-cyan-500/20 to-violet-500/20"></div>
            <i id="ai-chat-toggle-icon" class="fa-solid fa-headset text-xl relative z-10 transition-transform duration-300"></i>
            <span class="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#090e18] rounded-full"></span>
          </div>
        </button>
      </div>

      <!-- Chat HUD Window Drawer -->
      <div 
        id="ai-chat-drawer" 
        class="chat-drawer-closed fixed bottom-24 right-4 sm:right-6 z-50 w-[94vw] sm:w-[420px] max-h-[82vh] h-[640px] flex flex-col rounded-2xl glass-panel border border-cyan-500/40 bg-[#090d16]/95 backdrop-blur-2xl overflow-hidden"
      >
        <!-- HUD Header -->
        <div class="px-4 py-3 bg-slate-950/80 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-2.5 overflow-hidden">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-black font-display font-extrabold text-xs shadow-glow-cyan shrink-0">
              RD
            </div>
            <div class="truncate">
              <div class="flex items-center gap-2">
                <span class="font-display font-bold text-sm text-white truncate">AI Production Dispatch</span>
                <span class="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-[9px] font-mono text-cyan-300 font-semibold uppercase">Gemini 1.5 Flash</span>
              </div>
              <div class="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 truncate">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Firestore Synced · Guest Client Mode</span>
              </div>
            </div>
          </div>

          <!-- Header Actions -->
          <div class="flex items-center gap-1 shrink-0">
            <!-- Clear conversation -->
            <button id="ai-chat-clear-btn" type="button" title="Clear conversation" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 transition-colors">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
            <!-- Direct WhatsApp link -->
            <a href="https://wa.me/9779866144098" target="_blank" rel="noopener noreferrer" title="Chat on WhatsApp" class="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-950/40 transition-colors">
              <i class="fa-brands fa-whatsapp text-sm"></i>
            </a>
            <!-- Minimize -->
            <button id="ai-chat-close-btn" type="button" title="Minimize drawer" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
              <i class="fa-solid fa-chevron-down text-xs"></i>
            </button>
          </div>
        </div>

        <!-- Auth Status Bar -->
        <div id="ai-chat-auth-bar" class="px-4 py-2 bg-slate-900/60 border-b border-white/5 flex items-center justify-between text-[11px] font-mono shrink-0">
          <div id="ai-chat-auth-status" class="text-slate-400 flex items-center gap-1.5 truncate">
            <i class="fa-solid fa-shield-halved text-cyan-400"></i>
            <span class="truncate">Guest Client Mode</span>
          </div>
          <button id="ai-chat-auth-btn" type="button" class="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-cyan-300 border border-white/10 text-[10px] font-semibold transition-colors flex items-center gap-1.5 shrink-0">
            <i class="fa-brands fa-google text-[10px]"></i>
            <span id="ai-chat-auth-label">Sign In</span>
          </button>
        </div>

        <!-- Scrollable Message Feed -->
        <div id="ai-chat-messages" class="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs font-sans">
          <!-- Dynamic message history will be rendered here -->
        </div>

        <!-- Pre-Defined Quick Reply Inquiry Terminal -->
        <div id="ai-quick-replies-container" class="px-3.5 py-2.5 bg-[#060a12]/90 border-t border-white/10 shrink-0">
          <div class="flex items-center justify-between text-[10px] font-mono text-cyan-400 mb-1.5 px-0.5">
            <span class="flex items-center gap-1.5 font-semibold tracking-wider uppercase">
              <i class="fa-solid fa-bolt text-cyan-400 text-[10px]"></i> Quick Replies
            </span>
            <span class="text-slate-500 text-[9px] font-sans">Tap to ask instantly</span>
          </div>
          <div id="ai-quick-replies-list" class="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 whitespace-nowrap">
            <!-- Rendered dynamically by renderQuickReplies() -->
          </div>
        </div>

        <!-- Animated Loading Typing Indicator -->
        <div id="ai-chat-typing" class="hidden px-4 py-2 bg-slate-950/60 border-t border-white/5 text-[11px] font-mono text-cyan-400 items-center gap-2 shrink-0">
          <span class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce"></span>
            <span class="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
            <span class="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
          </span>
          <span class="text-slate-400">Roshan's Gemini Dispatch is generating tactical response...</span>
        </div>

        <!-- Chat Input Form -->
        <form id="ai-chat-form" class="p-3 bg-slate-950 border-t border-white/10 flex items-center gap-2 shrink-0">
          <input 
            type="text" 
            id="ai-chat-input" 
            placeholder="Ask about rates, turnaround, codecs, or booking..." 
            autocomplete="off" 
            maxlength="1000"
            class="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-white placeholder-slate-500 text-xs transition-all focus:outline-none"
          />
          <button 
            type="submit" 
            id="ai-chat-send-btn" 
            aria-label="Send message"
            class="w-10 h-10 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black flex items-center justify-center font-bold shadow-glow-cyan transition-all transform active:scale-95 shrink-0"
          >
            <i class="fa-solid fa-paper-plane text-xs"></i>
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(container);

    // Bind Event Listeners
    const toggleBtn = document.getElementById('ai-chat-toggle-btn');
    const closeBtn = document.getElementById('ai-chat-close-btn');
    const clearBtn = document.getElementById('ai-chat-clear-btn');
    const form = document.getElementById('ai-chat-form');
    const authBtn = document.getElementById('ai-chat-auth-btn');

    toggleBtn?.addEventListener('click', () => this.toggleDrawer());
    closeBtn?.addEventListener('click', () => this.closeDrawer());
    clearBtn?.addEventListener('click', () => this.clearChat());
    authBtn?.addEventListener('click', () => this.handleAuthClick());

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleUserSubmit();
    });

    // Dismiss on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closeDrawer();
      }
    });

    // Dismiss when clicking outside of the drawer and trigger button
    document.addEventListener('pointerdown', (e) => {
      if (!this.isOpen) return;
      const target = e.target as Node;
      const drawer = document.getElementById('ai-chat-drawer');
      const toggleBtn = document.getElementById('ai-chat-toggle-btn');
      if (drawer && !drawer.contains(target) && toggleBtn && !toggleBtn.contains(target)) {
        this.closeDrawer();
      }
    });

    // Initialize Pre-Defined Quick Reply Buttons
    this.renderQuickReplies();
  }

  private toggleDrawer() {
    if (this.isOpen) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  private openDrawer() {
    this.isOpen = true;
    const drawer = document.getElementById('ai-chat-drawer');
    const toggleBtn = document.getElementById('ai-chat-toggle-btn');
    const icon = document.getElementById('ai-chat-toggle-icon');
    const tooltip = document.getElementById('ai-chat-tooltip');
    if (tooltip) tooltip.style.display = 'none';

    if (drawer) {
      drawer.classList.remove('chat-drawer-closed');
      drawer.classList.add('chat-drawer-open');
    }
    if (toggleBtn) {
      toggleBtn.classList.add('btn-active');
    }
    if (icon) {
      icon.className = 'fa-solid fa-xmark text-xl relative z-10 transition-transform duration-300';
    }

    setTimeout(() => {
      const input = document.getElementById('ai-chat-input');
      input?.focus();
    }, 250);

    this.scrollToBottom();
  }

  private closeDrawer() {
    this.isOpen = false;
    const drawer = document.getElementById('ai-chat-drawer');
    const toggleBtn = document.getElementById('ai-chat-toggle-btn');
    const icon = document.getElementById('ai-chat-toggle-icon');

    if (drawer) {
      drawer.classList.remove('chat-drawer-open');
      drawer.classList.add('chat-drawer-closed');
    }
    if (toggleBtn) {
      toggleBtn.classList.remove('btn-active');
    }
    if (icon) {
      icon.className = 'fa-solid fa-headset text-xl relative z-10 transition-transform duration-300';
    }
  }

  private updateAuthUI() {
    const statusEl = document.getElementById('ai-chat-auth-status');
    const labelEl = document.getElementById('ai-chat-auth-label');

    if (this.currentUser) {
      if (statusEl) {
        statusEl.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="truncate font-semibold text-emerald-300">${this.currentUser.displayName || this.currentUser.email}</span>
        `;
      }
      if (labelEl) labelEl.textContent = 'Sign Out';
    } else {
      if (statusEl) {
        statusEl.innerHTML = `
          <i class="fa-solid fa-shield-halved text-cyan-400"></i>
          <span class="truncate">Guest Client Mode</span>
        `;
      }
      if (labelEl) labelEl.textContent = 'Sign In';
    }
  }

  private async handleAuthClick() {
    if (this.currentUser) {
      await logoutUser();
    } else {
      try {
        await loginWithGoogle();
      } catch (e) {
        console.warn('[AI Chat] Google Sign-In dismissed or cancelled.');
      }
    }
  }

  private clearChat() {
    if (!confirm('Reset this conversation history?')) return;
    this.messages = [];
    localStorage.removeItem(`roshan_chat_${this.sessionId}`);
    this.sessionId = this.getOrCreateSessionId();
    this.loadInitialMessages();
  }

  /**
   * Main Handler: Dispatch user prompt, await Gemini 1.5-flash response, and update history
   */
  public async handleUserSubmit() {
    const input = document.getElementById('ai-chat-input') as HTMLInputElement;
    if (!input) return;
    const text = input.value.trim();
    if (!text || this.isThinking) return;

    input.value = '';
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Append user message to local history and UI immediately
    const userMsg: ChatMessageItem = {
      sender: 'user',
      text,
      timestamp: nowTime,
    };
    this.messages.push(userMsg);
    this.renderMessages();
    this.saveMessagesLocally();

    // 2. Persist message to Firestore asynchronously (Guest Client Mode safe)
    appendChatMessage(this.sessionId, 'user', text).catch((err) => {
      console.warn('[AI Chat] Background Firestore sync notice:', err);
    });

    // 3. Trigger animated loading state
    this.setThinking(true);

    try {
      console.log('[AI Chat] Dispatching prompt to Gemini API Client via /api/chat:', {
        model: TARGET_GEMINI_MODEL,
        sessionId: this.sessionId,
        promptLength: text.length,
      });

      // Execute request with proper JSON headers and structured history
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          model: TARGET_GEMINI_MODEL,
          systemInstruction: ROSHAN_DEVKOTA_SYSTEM_INSTRUCTION,
          userMessage: text,
          messages: this.messages.slice(-8), // Multi-turn history context
        }),
      });

      const rawResponseText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(rawResponseText);
      } catch (parseErr) {
        console.error('[AI Chat Diagnostics: Non-JSON Response from Server]', {
          status: res.status,
          statusText: res.statusText,
          rawResponse: rawResponseText,
          timestamp: new Date().toISOString()
        });
        throw new Error(`Server returned non-JSON payload (Status ${res.status}).`);
      }

      if (!res.ok) {
        console.error('[AI Chat Diagnostics: Non-200 Server Error]', {
          httpStatus: res.status,
          statusText: res.statusText,
          errorPayload: data,
          timestamp: new Date().toISOString()
        });
        throw new Error(data?.error || `HTTP ${res.status}: ${res.statusText}`);
      }

      // Extract dynamic reply (from server proxy or candidates)
      const dynamicReply = data?.reply || data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!dynamicReply || typeof dynamicReply !== 'string' || !dynamicReply.trim()) {
        console.error('[AI Chat Diagnostics: Empty Reply Content]', data);
        throw new Error('Received an empty reply payload from the Gemini model.');
      }

      const cleanReply = dynamicReply.trim();

      // 4. Append assistant response to message history
      const assistantMsg: ChatMessageItem = {
        sender: 'assistant',
        text: cleanReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: data?.modelUsed || TARGET_GEMINI_MODEL,
      };
      this.messages.push(assistantMsg);
      this.renderMessages();
      this.saveMessagesLocally();

      // 5. Persist assistant reply to Firestore subcollection
      appendChatMessage(this.sessionId, 'assistant', cleanReply).catch((err) => {
        console.warn('[AI Chat] Could not sync assistant reply to Firestore:', err);
      });

    } catch (networkOrApiError: any) {
      console.error('[AI Chat Diagnostics: API Execution Failure]', {
        name: networkOrApiError?.name,
        message: networkOrApiError?.message,
        timestamp: new Date().toISOString()
      });

      // Provide courteous tactical contact fallback on genuine network or model disconnect
      const fallbackMsg: ChatMessageItem = {
        sender: 'assistant',
        text: `Thank you for your message! Our AI production dispatch is currently experiencing network latency. For direct inquiries, project bookings, and quotes, you can connect directly with Roshan Devkota via **WhatsApp** at [+977-9866144098](https://wa.me/9779866144098) or email [devkotaroshan89@gmail.com](mailto:devkotaroshan89@gmail.com).`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: 'offline-dispatch'
      };
      this.messages.push(fallbackMsg);
      this.renderMessages();
      this.saveMessagesLocally();
    } finally {
      this.setThinking(false);
    }
  }

  /**
   * Toggle animated loading indicator and form interaction
   */
  private setThinking(thinking: boolean) {
    this.isThinking = thinking;
    const typingIndicator = document.getElementById('ai-chat-typing');
    const sendBtn = document.getElementById('ai-chat-send-btn') as HTMLButtonElement;
    const input = document.getElementById('ai-chat-input') as HTMLInputElement;

    if (typingIndicator) {
      if (thinking) {
        typingIndicator.classList.remove('hidden');
        typingIndicator.classList.add('flex');
      } else {
        typingIndicator.classList.add('hidden');
        typingIndicator.classList.remove('flex');
      }
    }

    if (sendBtn) {
      sendBtn.disabled = thinking;
      sendBtn.style.opacity = thinking ? '0.5' : '1';
    }

    // Toggle interactive state of quick reply buttons
    const quickReplyBtns = document.querySelectorAll('.quick-reply-btn') as NodeListOf<HTMLButtonElement>;
    quickReplyBtns.forEach((btn) => {
      btn.disabled = thinking;
      if (thinking) {
        btn.classList.add('opacity-40', 'pointer-events-none');
      } else {
        btn.classList.remove('opacity-40', 'pointer-events-none');
      }
    });

    if (input && !thinking) {
      input.focus();
    }

    this.scrollToBottom();
  }

  /**
   * Render Pre-Defined Quick Reply Buttons for Common Inquiries
   */
  private renderQuickReplies() {
    const listContainer = document.getElementById('ai-quick-replies-list');
    if (!listContainer) return;

    listContainer.innerHTML = PREDEFINED_QUICK_REPLIES.map((item) => {
      const { btnClasses, badgeClasses } = this.getThemeClassesForQuickReply(item.colorScheme);
      return `
        <button 
          type="button" 
          class="quick-reply-btn px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-medium transition-all duration-200 transform hover:scale-105 active:scale-95 flex items-center gap-1.5 shrink-0 shadow-sm focus:outline-none focus:ring-1 ${btnClasses}" 
          data-prompt="${this.escapeHtml(item.prompt)}"
          aria-label="Ask: ${this.escapeHtml(item.label)}"
        >
          <i class="${item.icon} text-xs"></i>
          <span>${this.escapeHtml(item.label)}</span>
          ${item.badge ? `<span class="px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold ${badgeClasses}">${item.badge}</span>` : ''}
        </button>
      `;
    }).join('');

    const buttons = listContainer.querySelectorAll('.quick-reply-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const prompt = btn.getAttribute('data-prompt');
        if (prompt) {
          this.sendQuickReply(prompt);
        }
      });
    });
  }

  /**
   * Helper for color scheme Tailwind classes
   */
  private getThemeClassesForQuickReply(color: string): { btnClasses: string; badgeClasses: string } {
    switch (color) {
      case 'cyan':
        return {
          btnClasses: 'bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 border-cyan-500/30 hover:border-cyan-400 focus:ring-cyan-400/50',
          badgeClasses: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
        };
      case 'emerald':
        return {
          btnClasses: 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-500/30 hover:border-emerald-400 focus:ring-emerald-400/50',
          badgeClasses: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
        };
      case 'violet':
        return {
          btnClasses: 'bg-violet-950/40 hover:bg-violet-900/60 text-violet-300 border-violet-500/30 hover:border-violet-400 focus:ring-violet-400/50',
          badgeClasses: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
        };
      case 'amber':
        return {
          btnClasses: 'bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border-amber-500/30 hover:border-amber-400 focus:ring-amber-400/50',
          badgeClasses: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
        };
      case 'pink':
        return {
          btnClasses: 'bg-pink-950/40 hover:bg-pink-900/60 text-pink-300 border-pink-500/30 hover:border-pink-400 focus:ring-pink-400/50',
          badgeClasses: 'bg-pink-500/20 text-pink-300 border border-pink-500/30',
        };
      default:
        return {
          btnClasses: 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-white/10 hover:border-white/20 focus:ring-cyan-400/50',
          badgeClasses: 'bg-white/10 text-white border border-white/10',
        };
    }
  }

  /**
   * Dispatch a pre-defined Quick Reply prompt
   */
  public sendQuickReply(prompt: string) {
    if (this.isThinking) return;
    const input = document.getElementById('ai-chat-input') as HTMLInputElement;
    if (input) {
      input.value = prompt;
    }
    this.handleUserSubmit();
  }

  /**
   * Render message bubbles to the scrollable HUD
   */
  private renderMessages() {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;

    container.innerHTML = this.messages
      .map((msg) => {
        const isUser = msg.sender === 'user';
        const formattedText = this.formatMarkdown(msg.text);

        if (isUser) {
          return `
            <div class="flex flex-col items-end space-y-1">
              <div class="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-gradient-to-r from-cyan-600 to-cyan-500 text-black font-medium shadow-md">
                ${this.escapeHtml(msg.text)}
              </div>
              <span class="text-[9px] font-mono text-slate-500">${msg.timestamp}</span>
            </div>
          `;
        } else {
          return `
            <div class="flex items-start gap-2.5 max-w-[92%]">
              <div class="w-6 h-6 rounded-lg bg-gradient-to-tr from-cyan-500 to-violet-600 flex items-center justify-center text-black font-display font-bold text-[10px] shrink-0 mt-0.5 shadow-sm">
                RD
              </div>
              <div class="space-y-1 flex-1">
                <div class="p-3.5 rounded-2xl rounded-tl-sm bg-slate-900/90 border border-white/10 text-slate-200 leading-relaxed shadow-sm space-y-2">
                  ${formattedText}
                </div>
                <div class="flex items-center justify-between text-[9px] font-mono text-slate-500 px-1">
                  <span>${msg.timestamp}</span>
                  <span class="text-cyan-400">Gemini 1.5 Flash</span>
                </div>
              </div>
            </div>
          `;
        }
      })
      .join('');

    this.scrollToBottom();
  }

  /**
   * Markdown Parser for structured tactical responses
   */
  private formatMarkdown(raw: string): string {
    let out = this.escapeHtml(raw);

    // Headings: ### Title or ## Title
    out = out.replace(/^###\s+(.*$)/gim, '<div class="text-cyan-300 font-bold text-xs uppercase tracking-wider mt-2.5 mb-1 pb-0.5 border-b border-white/10">$1</div>');
    out = out.replace(/^##\s+(.*$)/gim, '<div class="text-white font-bold text-xs mt-2.5 mb-1">$1</div>');

    // Horizontal Rule: ---
    out = out.replace(/^---$/gim, '<div class="my-2 border-t border-white/10"></div>');

    // Bold text: **text**
    out = out.replace(/\*\*(.*?)\*\*/g, '<strong class="text-cyan-300 font-bold">$1</strong>');
    
    // Markdown links: [title](url)
    out = out.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-cyan-400 underline hover:text-cyan-300 font-semibold inline-flex items-center gap-1">$1 <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i></a>');
    
    // Bullet points: * or -
    out = out.replace(/^\s*[\*\-]\s+(.*)/gim, '<div class="flex items-start gap-2 text-slate-300 my-0.5"><i class="fa-solid fa-circle-check text-cyan-400 text-[10px] mt-1 shrink-0"></i><span>$1</span></div>');
    
    // Line breaks
    out = out.replace(/\n\n/g, '<div class="h-2"></div>');
    out = out.replace(/\n/g, '<br/>');

    return out;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private scrollToBottom() {
    setTimeout(() => {
      const container = document.getElementById('ai-chat-messages');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }

  /**
   * Sync inquiries submitted via the Contact Form directly to Firestore
   */
  private initContactFormSync() {
    const contactForm = document.getElementById('contact-form') as HTMLFormElement;
    if (!contactForm) return;

    contactForm.addEventListener('submit', async () => {
      const nameInput = document.getElementById('name') as HTMLInputElement;
      const emailInput = document.getElementById('email') as HTMLInputElement;
      const phoneInput = document.getElementById('phone') as HTMLInputElement;
      const serviceSelect = document.getElementById('service') as HTMLSelectElement;
      const messageInput = document.getElementById('message') as HTMLTextAreaElement;

      if (!nameInput || !emailInput || !serviceSelect || !messageInput) return;

      const payload = {
        name: nameInput.value,
        email: emailInput.value,
        phone: phoneInput ? phoneInput.value : '',
        service: serviceSelect.value,
        message: messageInput.value,
        source: 'portfolio_contact_terminal',
      };

      try {
        const inqId = await submitInquiryToFirestore(payload);
        console.log('[AI Chat] Inquiry recorded in Firestore database:', inqId);
        
        const statusDiv = document.getElementById('form-status');
        if (statusDiv) {
          statusDiv.innerHTML = `
            <div class="p-3 rounded-xl bg-cyan-950/80 border border-cyan-400 text-cyan-200 flex items-center justify-between text-xs">
              <span class="flex items-center gap-2"><i class="fa-solid fa-circle-check text-cyan-400"></i> Brief Transmitted &amp; Saved to Cloud Database!</span>
              <span class="font-mono text-[10px] text-slate-400">REF: ${inqId.substring(0, 12)}</span>
            </div>
          `;
          statusDiv.classList.remove('hidden');
        }
      } catch (err) {
        console.warn('[AI Chat] Firestore brief submission note:', err);
      }
    });
  }
}

// Client initialization
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    new RoshanAIChatbot();
  });
}
