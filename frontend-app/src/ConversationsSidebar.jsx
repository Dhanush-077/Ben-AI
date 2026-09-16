import { useState } from "react";
import { Plus, Pin, Pencil, X, Trash2 } from "lucide-react";

// Sidebar listing the user's conversations.
//  - "+ New Chat" creates a fresh conversation
//  - clicking a row opens that conversation's history
//  - the pencil renames in place; the pin icon pins/unpins (pinned sorts first)
//  - the trash icon deletes with confirmation
// Works as a fixed sidebar on desktop and as an overlay drawer on mobile.
export default function ConversationsSidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onRename,
  onTogglePin,
  onDelete,
  open,
  onClose,
  userName,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  function startRename(conv) {
    setEditingId(conv.id);
    setDraft(conv.title === "New chat" ? "" : conv.title);
  }

  function commitRename(id) {
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
    setDraft("");
  }

  return (
    <>
      {/* Mobile drawer backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 md:w-60 flex flex-col bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 transition-transform ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-stone-700 dark:text-stone-200 truncate">
            {userName ? `Hi, ${userName.split("@")[0]}` : "Chats"}
          </p>
          <button onClick={onClose} aria-label="Close sidebar" className="text-stone-400 hover:text-stone-700 md:hidden">
            <X size={18} />
          </button>
        </div>

        <button
          onClick={onNew}
          className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium py-2 hover:bg-stone-800 dark:hover:bg-stone-300 transition-colors"
        >
          <Plus size={16} /> New Chat
        </button>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-stone-400 dark:text-stone-500 px-2 py-3">No chats yet — start one above.</p>
          )}

          {conversations.map((conv) => {
            const active = conv.id === currentId;
            return (
              <div
                key={conv.id}
                onClick={() => {
                  onSelect(conv.id);
                  onClose();
                }}
                className={`group flex items-center gap-1 rounded-lg px-2 py-2 cursor-pointer text-sm ${
                  active
                    ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                    : "text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800/60"
                }`}
              >
                {editingId === conv.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(conv.id);
                      if (e.key === "Escape") {
                        setEditingId(null);
                        setDraft("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-600 rounded px-1.5 py-0.5 text-sm focus:outline-none"
                    placeholder="Chat name"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate">{conv.title}</span>
                )}

                <button
                  aria-label={conv.pinned ? "Unpin" : "Pin"}
                  title={conv.pinned ? "Unpin" : "Pin"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(conv.id, conv.pinned);
                  }}
                  className={`shrink-0 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity ${
                    conv.pinned ? "text-teal-600 dark:text-teal-400 opacity-100" : "text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                  }`}
                >
                  <Pin size={14} className={conv.pinned ? "fill-current" : ""} />
                </button>

                <button
                  aria-label="Rename"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(conv);
                  }}
                  className="shrink-0 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                >
                  <Pencil size={13} />
                </button>

                <button
                  aria-label="Delete"
                  title="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete "${conv.title}"? This cannot be undone.`)) {
                      onDelete(conv.id);
                    }
                  }}
                  className="shrink-0 text-stone-400 hover:text-red-500 dark:hover:text-red-400 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}