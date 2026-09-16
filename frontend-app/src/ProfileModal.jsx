import { useState, useRef } from "react";
import { X, Camera } from "lucide-react";

export default function ProfileModal({ open, onClose, profile, onSave, token, API_BASE }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarPreview, setAvatarPreview] = useState(profile.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  if (!open) return null;

  async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Avatar must be under 5 MB.");
      return;
    }
    // Show local preview immediately.
    setAvatarPreview(URL.createObjectURL(file));

    // Upload to the backend.
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch(`${API_BASE}/profile/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.avatar_url) {
        setAvatarPreview(data.avatar_url);
      }
    } catch {
      alert("Failed to upload avatar. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ displayName: displayName.trim(), avatarUrl: avatarPreview || "" });
      onClose();
    } catch (err) {
      // Surface the real reason instead of closing silently (a failed backend
      // save previously looked successful and the name reverted on reload).
      alert(err?.message || "Failed to save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-stone-900 rounded-xl max-w-sm w-full p-6 relative shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-4">Your Profile</h2>

        {/* Avatar */}
        <div className="flex flex-col items-center mb-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="relative w-20 h-20 rounded-full overflow-hidden bg-stone-200 dark:bg-stone-700 group"
            disabled={uploading}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-stone-400 dark:text-stone-500">
                <Camera size={24} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera size={18} className="text-white" />
            </div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />
          {uploading && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Uploading…</p>}
        </div>

        {/* Display name */}
        <label className="block text-sm text-stone-600 dark:text-stone-400 mb-1">Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Dhanush"
          className="w-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-800 dark:focus:ring-stone-300"
        />
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
          Shown in greetings and sidebar. Leave empty to use your email.
        </p>

        <button
          onClick={handleSave}
          disabled={saving || uploading}
          className="mt-5 w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium py-2.5 rounded-lg hover:bg-stone-800 dark:hover:bg-stone-300 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}
