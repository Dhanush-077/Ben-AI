import { useState, useEffect, useCallback } from "react";

// Handles conversations + messages for the logged-in user.
//  - lists conversations, opens one at a time (GET /history?conversation_id=)
//  - creates new chats (POST /conversations)
//  - sends text (POST /chat) and image messages (POST /chat-with-image)
//  - renames / pins a conversation (PATCH /conversations/{id})
export function useChatSession(token, API_BASE) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  // Free AI models intermittently stall for a minute or more, and the backend
  // has to exhaust several fallback models before giving up. Without a timeout
  // the chat bubble sits on "thinking…" for minutes or forever. Abort after a
  // generous window so the user always gets SOME reply quickly.
  async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function networkErrorMsg(err) {
    if (err?.name === "AbortError") {
      return "⚠️ The AI took too long to respond — please try again in a moment.";
    }
    return "⚠️ Could not reach the server — please check your connection and try again.";
  }

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders });
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      /* transient — the list will refresh on next interaction */
    }
  }, [token, API_BASE]); // eslint-disable-line react-hooks/exhaustive-deps

  // On login: load the conversation list for the sidebar, then always create
  // a fresh empty chat so the user starts with a blank slate. Previous chats
  // remain accessible via the sidebar.
  useEffect(() => {
    if (!token) {
      setMessages([]);
      setConversations([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }
    // Persist active conversation ID across refreshes.
    const savedId = localStorage.getItem("ben_ai_active_conv");
    if (savedId) {
      setCurrentId(savedId);
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Load existing conversations for the sidebar.
        const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders });
        const data = await res.json();
        if (cancelled) return;
        setConversations(data.conversations || []);

        // Reopen saved conversation instead of forcing new.
        const savedId = localStorage.getItem("ben_ai_active_conv");
        if (savedId) {
          const cres = await fetch(`${API_BASE}/history?conversation_id=${savedId}`, { headers: authHeaders });
          const cdata = await cres.json();
          if (!cancelled) {
            setCurrentId(savedId);
            setMessages(cdata.messages || []);
            setLoading(false);
          }
          return;
        }
        // Only create new when no saved conversation exists.
        const cres = await fetch(`${API_BASE}/conversations`, {
          method: "POST",
          headers: authHeaders,
        });
        const cdata = await cres.json();
        if (!cancelled) {
          setCurrentId(cdata.conversation_id);
          setMessages([]);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, API_BASE]);

  async function newConversation() {
    if (!token) return null;
    const res = await fetch(`${API_BASE}/conversations`, {
      method: "POST",
      headers: authHeaders,
    });
    const data = await res.json();
    setCurrentId(data.conversation_id);
    setMessages([]);
    localStorage.setItem("ben_ai_active_conv", data.conversation_id);
    await loadConversations();
    return data.conversation_id;
  }

  async function openConversation(id) {
    if (!token || id === currentId) return;
    setCurrentId(id);
    localStorage.setItem("ben_ai_active_conv", id);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/history?conversation_id=${id}`, { headers: authHeaders });
      const data = await res.json();
      setMessages(data.messages || []);
    } finally {
      setLoading(false);
    }
  }

  // Returns the id to send against, creating a chat first if needed.
  async function ensureConversation() {
    if (currentId) return currentId;
    return await newConversation();
  }

  async function sendMessage(text) {
    const id = await ensureConversation();
    if (!id) return;
    setMessages((prev) => [...prev, { role: "user", content: text, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/chat`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversation_id: id }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply, images: data.images || [], created_at: new Date().toISOString() }]);
      } else if (data.detail) {
        // Show the error as an assistant message so the user knows what happened.
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${data.detail}`, created_at: new Date().toISOString() }]);
      }
      await loadConversations(); // pick up the auto-generated title on chat 1
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: networkErrorMsg(err), created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  async function sendImage(text, file) {
    const id = await ensureConversation();
    if (!id) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("message", text);
      formData.append("conversation_id", String(id));
      formData.append("image", file);

      const res = await fetchWithTimeout(`${API_BASE}/chat-with-image`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      const data = await res.json();
      if (data.image_url) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: `[image] ${text}`, image_url: data.image_url, created_at: new Date().toISOString() },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: "user", content: `[image] ${text}`, created_at: new Date().toISOString() }]);
      }
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply, images: data.images || [], created_at: new Date().toISOString() }]);
      } else if (data.detail) {
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${data.detail}`, created_at: new Date().toISOString() }]);
      }
      await loadConversations();
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: networkErrorMsg(err), created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  async function renameConversation(id, title) {
    if (!title.trim()) return;
    await fetch(`${API_BASE}/conversations/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    await loadConversations();
  }

  async function togglePin(id, pinned) {
    await fetch(`${API_BASE}/conversations/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    });
    await loadConversations();
  }

  async function deleteConversation(id) {
    await fetch(`${API_BASE}/conversations/${id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    // If the deleted conversation was the active one, switch to a new chat.
    if (id === currentId) {
      await newConversation();
    }
    await loadConversations();
  }

  return {
    messages,
    loading,
    sending,
    conversations,
    currentId,
    loadConversations,
    openConversation,
    newConversation,
    sendMessage,
    sendImage,
    renameConversation,
    togglePin,
    deleteConversation,
  };
}