import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Image as ImageIcon, Send, Sun, Moon, Copy, Share2, Menu, X, ArrowRight, Check, Sparkles, Users, Zap, Shield, Globe, BarChart3, Code2, MessageSquare, Heart } from "lucide-react";
import { useAuth } from "./useAuth";
import { useChatSession } from "./useChatSession";
import { useTheme } from "./useTheme";
import Login from "./Login";
import Greeting from "./Greeting";
import DeveloperFooter from "./DeveloperFooter";
import MarkdownMessage from "./MarkdownMessage";
import ImageStrip from "./ImageStrip";
import ConversationsSidebar from "./ConversationsSidebar";
import ProfileModal from "./ProfileModal";

export default function App() {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  const session = useChatSession(auth.token, auth.API_BASE);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState(null); // Issue 5: inline image preview
  const [profileOpen, setProfileOpen] = useState(false); // Issue 7
  const [lightboxImage, setLightboxImage] = useState(null); // Click to view uploaded image full size
  const [profile, setProfile] = useState(() => {
    // Read from localStorage first for instant display on re-login.
    try {
      const cached = JSON.parse(localStorage.getItem("ben_ai_profile") || "{}");
      return { displayName: cached.displayName || "", avatarUrl: cached.avatarUrl || "" };
    } catch { return { displayName: "", avatarUrl: "" }; }
  }); // Issue 7
  const [authModalOpen, setAuthModalOpen] = useState(true); // Controls landing-page auth modal
  const toastTimer = useRef(null);
  const scrollRef = useRef(null);
  const imageInputRef = useRef(null);

  // Close lightbox on Escape key
  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightboxImage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImage]);

  // Fetch user profile on login — localStorage first, then backend update (Issue 7).
  useEffect(() => {
    if (!auth.token) return;
    (async () => {
      try {
        const res = await fetch(`${auth.API_BASE}/profile`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const data = await res.json();
        const displayName = data.display_name || "";
        const avatarUrl = data.avatar_url || "";
        setProfile({ displayName, avatarUrl });
        // Cache in localStorage so it persists even if the backend table is missing.
        localStorage.setItem("ben_ai_profile", JSON.stringify({ displayName, avatarUrl }));
      } catch {
        /* profile is optional — localStorage cache is already loaded */
      }
    })();
  }, [auth.token, auth.API_BASE]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save profile to backend + localStorage (Issue 7). Verifies the backend
  // actually accepted it before showing the success toast — previously the
  // response was ignored, so a failed save still looked "saved" (and the name
  // silently reverted on next login / reload).
  const handleProfileSave = useCallback(async ({ displayName, avatarUrl }) => {
    const res = await fetch(`${auth.API_BASE}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName, avatar_url: avatarUrl }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).detail || "";
      } catch {
        /* non-JSON error body */
      }
      throw new Error(detail || `Profile save failed (HTTP ${res.status})`);
    }
    setProfile({ displayName, avatarUrl });
    localStorage.setItem("ben_ai_profile", JSON.stringify({ displayName, avatarUrl }));
    showToast("Profile saved!");
  }, [auth.token, auth.API_BASE]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2000);
  }

  async function copyMessage(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied!");
    } catch {
      showToast("Couldn't copy — select the text manually.");
    }
  }

  async function shareMessage(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return; // user cancelled — no toast
      }
    }
    // No Web Share API (or it failed) — fall back to copying.
    await copyMessage(text);
  }

  // Pre-login flow: premium landing page with working auth modal (Option B)
  if (!auth.isLoggedIn) {
    return (
      <>
        <LandingPage
          onGetStarted={() => setAuthModalOpen(true)}
          onLogin={() => setAuthModalOpen(true)}
        />

        {authModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#0B0C0E]/70 backdrop-blur-md">
            <div className="relative w-full max-w-md bg-white/10 dark:bg-[#0B0C0E]/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl ring-1 ring-white/20">
              <button
                onClick={() => setAuthModalOpen(false)}
                aria-label="Close authentication"
                className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 flex items-center justify-center shadow-lg hover:scale-105 transition-transform z-10"
              >
                <X size={16} />
              </button>
              <div className="w-full max-w-sm bg-[#F4F3EF]/95 dark:bg-[#0B0C0E]/95 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-white/10 p-6">
                <Login auth={auth} />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Show a loading screen while the OAuth token exchange completes (Issue 1).
  if (auth.oauthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
        <p className="text-sm text-stone-400 dark:text-stone-500 animate-pulse">Verifying your login…</p>
      </div>
    );
  }

  // Determine the greeting name: custom display name or email prefix.
  const greetingName = profile.displayName || auth.email.split("@")[0];

  // --- Send: text only, or text + pending image (Issue 5) ---
  function handleSend() {
    const text = input.trim();
    if (!text && !pendingImage) return;
    const message = text || "What is this?";

    if (pendingImage) {
      session.sendImage(message, pendingImage.file);
      setPendingImage(null);
    } else {
      session.sendMessage(message);
    }
    setInput("");
  }

  // --- Voice input (Issue 6): proper error handling + interim results ---
  function handleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice input isn't supported in this browser — try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showToast("Microphone permission denied — please allow microphone access in your browser settings.");
      } else if (event.error === "no-speech") {
        showToast("No speech detected — try again.");
      } else if (event.error === "network") {
        showToast("Voice recognition requires an internet connection.");
      } else {
        showToast("Voice input failed — try again.");
      }
    };

    recognition.onend = () => setListening(false);

    try {
      recognition.start();
    } catch {
      showToast("Could not start voice input — try refreshing the page.");
    }
  }

  // --- Image upload (Issue 5): inline preview instead of prompt() ---
  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast("Image must be under 8 MB.");
      e.target.value = "";
      return;
    }
    setPendingImage({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    });
    e.target.value = ""; // allow re-selecting the same file
  }

  function removePendingImage() {
    if (pendingImage?.preview) URL.revokeObjectURL(pendingImage.preview);
    setPendingImage(null);
  }

  return (
    <div className="h-screen overflow-hidden flex bg-white dark:bg-stone-950 transition-colors">
      <ConversationsSidebar
        conversations={session.conversations}
        currentId={session.currentId}
        onSelect={session.openConversation}
        onNew={() => {
          session.newConversation();
          setSidebarOpen(false);
        }}
        onRename={session.renameConversation}
        onTogglePin={session.togglePin}
        onDelete={session.deleteConversation}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userName={profile.displayName || auth.email}
      />

      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chats"
              className="text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 md:hidden"
            >
              <Menu size={18} />
            </button>
            <div className="w-8 h-8 rounded-lg bg-[#0B0C0E] dark:bg-[#F4F3EF] flex items-center justify-center">
              <span className="text-sm font-extrabold text-[#F4F3EF] dark:text-[#0B0C0E]">B</span>
            </div>
            <span className="font-semibold text-stone-800 dark:text-stone-100">Ben AI</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            {/* Issue 7: Profile button */}
            <button
              onClick={() => setProfileOpen(true)}
              aria-label="Edit profile"
              className="w-8 h-8 rounded-full overflow-hidden bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-stone-500 dark:text-stone-400 hover:ring-2 hover:ring-stone-300 dark:hover:ring-stone-600 transition-all"
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-semibold">
                  {(profile.displayName || auth.email).charAt(0).toUpperCase()}
                </span>
              )}
            </button>

            <button
              onClick={auth.logout}
              className="text-sm text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
            >
              Log out
            </button>
          </div>
        </header>

        {/* Quick-action chips */}
        <div className="flex gap-2 px-5 py-3 overflow-x-auto">
          {["💻 Coding Help", "📰 Latest News", "📈 Stock Price", "🏏 Live Scores"].map((label) => (
            <button
              key={label}
              onClick={() => setInput(label.split(" ").slice(1).join(" ") + ": ")}
              className="whitespace-nowrap text-sm px-3 py-1.5 rounded-full border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-900"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Chat area */}
        <main className="flex-1 overflow-y-auto px-5">
          {session.loading ? (
            <p className="text-center text-sm text-stone-400 dark:text-stone-500 mt-10">Loading your history…</p>
          ) : session.messages.length === 0 ? (
            <Greeting userName={greetingName} />
          ) : (
            <div className="max-w-2xl mx-auto py-4 space-y-4">
              {session.messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={m.role === "user" ? "" : "max-w-[78%]"}>
                    <div
                      className={`${
                        m.role === "user" ? "max-w-[75%] ml-auto" : ""
                      } rounded-2xl px-4 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                          : "bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-100"
                      }`}
                    >
                      {m.image_url && (
                        <img
                          src={m.image_url}
                          alt="Uploaded"
                          onClick={() => setLightboxImage(m.image_url)}
                          title="Click to view full size"
                          className="max-w-[240px] rounded-lg my-1 border border-black/10 dark:border-white/20 cursor-pointer hover:opacity-90 transition-opacity"
                        />
                      )}
                      {m.role === "assistant"
                        ? <MarkdownMessage content={m.content} />
                        : m.content.replace(/^\[image\]\s*/, "")}
                    </div>
                    {m.role === "assistant" && <ImageStrip images={m.images} />}
                    {m.role === "assistant" && (
                      <div className="flex items-center gap-2 mt-1 text-stone-400 dark:text-stone-500">
                        <button
                          onClick={() => copyMessage(m.content)}
                          aria-label="Copy reply"
                          title="Copy"
                          className="hover:text-stone-700 dark:hover:text-stone-200"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => shareMessage(m.content)}
                          aria-label="Share reply"
                          title="Share"
                          className="hover:text-stone-700 dark:hover:text-stone-200"
                        >
                          <Share2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {session.sending && <p className="text-sm text-stone-400 dark:text-stone-500">Ben AI is thinking…</p>}
              <div ref={scrollRef} />
            </div>
          )}
        </main>

        {/* Issue 5: Pending image preview chip */}
        {pendingImage && (
          <div className="px-5 pb-1">
            <div className="max-w-2xl mx-auto flex items-center gap-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2">
              <img
                src={pendingImage.preview}
                alt="Selected"
                className="w-12 h-12 rounded-lg object-cover"
              />
              <span className="text-xs text-stone-500 dark:text-stone-400 truncate flex-1">{pendingImage.name}</span>
              <button
                onClick={removePendingImage}
                className="text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
                aria-label="Remove image"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <label className="cursor-pointer text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200">
              <ImageIcon size={20} />
              <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} ref={imageInputRef} />
            </label>
            <button
              onClick={handleVoiceInput}
              aria-label="Voice input"
              className={`text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 ${listening ? "animate-pulse text-red-500 dark:text-red-400" : ""}`}
            >
              <Mic size={20} />
            </button>
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={pendingImage ? "Add a message about this image…" : "Ask anything…"}
                className={`w-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-800 dark:focus:ring-stone-300 ${listening ? "pl-10" : ""}`}
              />
              {listening && (
                <span
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 flex items-end gap-[3px] h-4 text-teal-600 dark:text-teal-400"
                  aria-label="Listening"
                >
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="wave-bar w-[3px] rounded-full bg-current"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </span>
              )}
            </div>
            <button
              onClick={handleSend}
              aria-label="Send"
              className="w-9 h-9 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 flex items-center justify-center hover:bg-stone-800 dark:hover:bg-stone-300"
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        <DeveloperFooter />

        {toast && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-sm px-4 py-2 rounded-full shadow-lg">
            {toast}
          </div>
        )}
      </div>

      {/* Issue 7: Profile modal */}
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        profile={profile}
        onSave={handleProfileSave}
        token={auth.token}
        API_BASE={auth.API_BASE}
      />

      {/* Full size lightbox modal for uploaded images */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxImage(null)}
              aria-label="Close image preview"
              title="Close (Esc)"
              className="absolute -top-10 right-0 p-1.5 text-white/80 hover:text-white rounded-full bg-black/50 hover:bg-black/70 transition-colors"
            >
              <X size={22} />
            </button>
            <img
              src={lightboxImage}
              alt="Full size preview"
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Premium landing page — black hero, teal accent, Notion/Squarespace
// style typography, feature ticker, CTA sections
// ------------------------------------------------------------------
function LandingPage({ onGetStarted, onLogin }) {
  return (
    <div className="min-h-screen bg-[#0B0C0E] text-[#F4F3EF] overflow-x-hidden">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#4FD1C5] flex items-center justify-center">
            <span className="text-sm font-extrabold text-[#0B0C0E]">B</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Ben AI</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={onLogin} className="text-sm text-stone-400 hover:text-white transition-colors">Log in</button>
          <button onClick={onGetStarted} className="text-sm font-medium bg-[#4FD1C5] text-[#0B0C0E] px-5 py-2 rounded-full hover:bg-[#3BB8AD] transition-colors">Get Started</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 lg:px-12 pt-20 pb-16 max-w-4xl mx-auto text-center">
        <p className="text-xs font-semibold tracking-widest uppercase text-[#4FD1C5] mb-4">AI-Powered Assistant</p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
          Your smartest
          <span className="block text-[#4FD1C5]">conversation partner</span>
        </h1>
        <p className="text-lg text-stone-400 max-w-2xl mx-auto leading-relaxed mb-8">
          Ask anything. Get instant answers with image understanding, real-time research, and deep reasoning — all in one chat.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={onGetStarted} className="font-medium bg-[#4FD1C5] text-[#0B0C0E] px-7 py-3 rounded-full hover:bg-[#3BB8AD] transition-colors text-sm">
            Start chatting — free
          </button>
          <button onClick={onLogin} className="font-medium border border-white/20 px-7 py-3 rounded-full hover:bg-white/5 transition-colors text-sm">
            Log in
          </button>
        </div>
        <p className="text-xs text-stone-500 mt-4">No credit card required. Google, GitHub, or email sign-in.</p>
      </section>

      {/* Feature ticker */}
      <div className="border-t border-white/10 border-b border-white/10 py-5 overflow-hidden">
        <div className="flex items-center gap-8 px-6 lg:px-12 max-w-5xl mx-auto text-sm text-stone-500">
          <span className="flex items-center gap-2"><Zap size={14} className="text-[#4FD1C5]" /> Instant responses</span>
          <span className="flex items-center gap-2"><ImageIcon size={14} className="text-[#4FD1C5]" /> Image upload & OCR</span>
          <span className="flex items-center gap-2"><Globe size={14} className="text-[#4FD1C5]" /> Live research</span>
          <span className="flex items-center gap-2"><Code2 size={14} className="text-[#4FD1C5]" /> Coding help</span>
          <span className="flex items-center gap-2"><Shield size={14} className="text-[#4FD1C5]" /> Secure & private</span>
        </div>
      </div>

      {/* Editorial — What is Ben AI */}
      <section className="px-6 lg:px-12 pt-20 pb-16 max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-widest uppercase text-[#4FD1C5] mb-4">What is Ben AI</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight mb-6">
          A chat interface that actually thinks
        </h2>
        <div className="space-y-4 text-stone-400 leading-relaxed">
          <p>Ben AI combines multiple AI providers — Gemini and Groq — to give you fast, accurate answers. Ask about code, current events, stock prices, or anything else and get a real reply, not a recycled one.</p>
          <p>Upload images and get OCR-powered answers. Keep your conversation history across sessions. Your data stays yours.</p>
        </div>
      </section>

      {/* Features grid */}
      <section className="px-6 lg:px-12 pb-20 max-w-5xl mx-auto">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: MessageSquare, title: "Smart chat", desc: "Natural, contextual replies with memory of your conversation." },
            { icon: ImageIcon, title: "Image understanding", desc: "Upload screenshots or photos — Ben reads and explains them." },
            { icon: Globe, title: "Live research", desc: "Search the web for current events, scores, and stock prices." },
            { icon: Code2, title: "Coding help", desc: "Debug, write, and review code across any language." },
            { icon: BarChart3, title: "Stock prices", desc: "Get real-time market data without leaving the chat." },
            { icon: Heart, title: "Always improving", desc: "Multiple AI providers with automatic fallback for reliability." },
          ].map((f) => (
            <div key={f.title} className="border border-white/10 rounded-xl p-6 hover:border-[#4FD1C5]/40 transition-colors group">
              <f.icon size={20} className="text-[#4FD1C5] mb-4" />
              <h3 className="font-semibold text-sm mb-2 group-hover:text-[#4FD1C5] transition-colors">{f.title}</h3>
              <p className="text-sm text-stone-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="px-6 lg:px-12 pb-20 max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-widest uppercase text-[#4FD1C5] mb-4">Who it's for</p>
        <h2 className="text-3xl font-bold tracking-tight mb-6">Everyone</h2>
        <ul className="space-y-3 text-stone-400">
          {[
            "Developers who want a pair-programming buddy",
            "Students who need explanations, not just answers",
            "Researchers who want live web results",
            "Teams who need fast, reliable AI without setup",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3">
              <Check size={18} className="text-[#4FD1C5] mt-0.5 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Final CTA */}
      <section className="border-t border-white/10 px-6 lg:px-12 py-16 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Ready to start?</h2>
        <p className="text-stone-400 mb-8 max-w-sm mx-auto">Join thousands of users having better conversations with Ben AI.</p>
        <button onClick={onGetStarted} className="font-medium bg-[#4FD1C5] text-[#0B0C0E] px-8 py-3 rounded-full hover:bg-[#3BB8AD] transition-colors text-sm">
          Get started free
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 lg:px-12 py-6 flex items-center justify-between text-xs text-stone-500">
        <span>Ben AI</span>
        <span>Powered by Gemini & Groq</span>
      </footer>
    </div>
  );
}
