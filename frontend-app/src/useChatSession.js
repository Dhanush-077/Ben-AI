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

  // On login: load the list; open the most recent conversation if there is one,
  // otherwise create the first one so the user can type immediately.
  useEffect(() => {
    if (!token) {
      setMessages([]);
      setConversations([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders });
        const data = await res.json();
        if (cancelled) return;
        const list = data.conversations || [];
        setConversations(list);

        if (list.length > 0) {
          const first = list[0];
          setCurrentId(first.id);
          const hres = await fetch(`${API_BASE}/history?conversation_id=${first.id}`, { headers: authHeaders });
          const hdata = await hres.json();
          if (!cancelled) {
            setMessages(hdata.messages || []);
            setLoading(false);
          }
        } else {
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
    await loadConversations();
    return data.conversation_id;
  }

  async function openConversation(id) {
    if (!token || id === currentId) return;
    setCurrentId(id);
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
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversation_id: id }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply, images: data.images || [], created_at: new Date().toISOString() }]);
      }
      await loadConversations(); // pick up the auto-generated title on chat 1
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

      const res = await fetch(`${API_BASE}/chat-with-image`, {
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
      }
      await loadConversations();
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
  };
}