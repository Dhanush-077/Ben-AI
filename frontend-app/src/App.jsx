import { useState, useRef, useEffect } from "react";
import { Mic, Image as ImageIcon, Send, Sun, Moon, Copy, Share2, Menu } from "lucide-react";
import { useAuth } from "./useAuth";
import { useChatSession } from "./useChatSession";
import { useTheme } from "./useTheme";
import Login from "./Login";
import Greeting from "./Greeting";
import DeveloperFooter from "./DeveloperFooter";
import MarkdownMessage from "./MarkdownMessage";
import ImageStrip from "./ImageStrip";
import ConversationsSidebar from "./ConversationsSidebar";

export default function App() {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  const session = useChatSession(auth.token, auth.API_BASE);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toastTimer = useRef(null);
  const scrollRef = useRef(null);

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

  if (!auth.isLoggedIn) {
    return <Login auth={auth} />;
  }

  function handleSend() {
    if (!input.trim()) return;
    session.sendMessage(input.trim());
    setInput("");
  }

  function handleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input isn't supported in this browser — try Chrome.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
    };
    recognition.start();
  }

  async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const question = prompt("What do you want to ask about this image?") || "What is this?";
    await session.sendImage(question, file);
    e.target.value = ""; // allow re-selecting the same file next time
  }

  return (
    <div className="min-h-screen flex bg-white dark:bg-stone-950 transition-colors">
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
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userName={auth.email}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
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
            <Greeting userName={auth.email.split("@")[0]} />
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
                          className="max-w-[240px] rounded-lg my-1 border border-black/10 dark:border-white/20"
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

        {/* Input bar */}
        <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <label className="cursor-pointer text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200">
              <ImageIcon size={20} />
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
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
                placeholder="Ask anything…"
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
    </div>
  );
}