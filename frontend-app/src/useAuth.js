import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// Handles signup, login, logout, and persisting the JWT token in localStorage.
// Also handles OAuth redirect (extracts access_token from URL hash, exchanges it).
export function useAuth() {
  const [token, setToken] = useState(localStorage.getItem("ben_ai_token"));
  const [email, setEmail] = useState(localStorage.getItem("ben_ai_email") || "");
  const [error, setError] = useState("");
  const [oauthLoading, setOauthLoading] = useState(false);

  function saveSession(data) {
    localStorage.setItem("ben_ai_token", data.token);
    localStorage.setItem("ben_ai_email", data.email);
    setToken(data.token);
    setEmail(data.email);
  }

  // Restore Supabase session and listen to auth changes (OAuth callback fix).
  useEffect(() => {
    // On startup: restore session if URL contains OAuth hash.
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const user = session.user;
        if (user?.email) {
          saveSession({ token: session.access_token || session.refresh_token || "supabase", email: user.email });
        }
        // Remove hash after session created (only if OAuth redirect markers present).
        const hasOAuthMarkers = (window.location.hash && (window.location.hash.includes("access_token") || window.location.hash.includes("code"))) ||
                                (window.location.search && (window.location.search.includes("code=") || window.location.search.includes("access_token")));
        if (hasOAuthMarkers && window.location.hash && window.location.hash.includes("access_token")) {
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
          // Redirect to chat page when coming from OAuth.
          if (window.location.pathname !== "/" && !window.location.pathname.startsWith("/chat")) {
            window.location.replace(window.location.origin + "/");
          }
        }
      }
    })();

    // Listen to auth state changes (handles OAuth redirect + session refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        const user = session.user;
        if (user?.email) {
          saveSession({ token: session.access_token || session.refresh_token || "supabase", email: user.email });
        }
        // Clear hash and redirect to chat (only when actually OAuth redirect).
        if ((window.location.hash && (window.location.hash.includes("access_token") || window.location.hash.includes("code"))) ||
            (window.location.search && (window.location.search.includes("code=") || window.location.search.includes("access_token")))) {
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
          if (window.location.pathname !== "/" && !window.location.pathname.startsWith("/chat")) {
            window.location.replace(window.location.origin + "/");
          }
        }
      }
      if (event === "SIGNED_OUT") {
        setToken(null);
        setEmail("");
        localStorage.removeItem("ben_ai_token");
        localStorage.removeItem("ben_ai_email");
      }
    });

    return () => subscription?.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // OAuth callback (manual exchange) — ONLY when URL has OAuth markers.
  useEffect(() => {
    const hash = window.location.hash;
    const search = window.location.search;
    const hasOAuthInUrl = (hash && (hash.includes("access_token") || hash.includes("code"))) ||
                          (search && (search.includes("code=") || search.includes("access_token")));
    if (!hasOAuthInUrl) return;

    const hasSession = !!localStorage.getItem("ben_ai_token");
    if (hash && hash.includes("access_token") && !hasSession) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      if (accessToken) {
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
        setOauthLoading(true);
        (async () => {
          try {
            const res = await fetch(`${API_BASE}/auth/exchange`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ access_token: accessToken }),
            });
            const data = await res.json();
            if (!res.ok) {
              setError(data.detail || "OAuth login failed");
              return;
            }
            saveSession(data);
          } catch {
            setError("Could not verify OAuth login — please try again.");
          } finally {
            setOauthLoading(false);
          }
        })();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function signup(emailInput, password) {
    setError("");
    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput, password }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.detail || "Signup failed");
    saveSession(data);
  }

  async function login(emailInput, password) {
    setError("");
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput, password }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.detail || "Login failed");
    saveSession(data);
  }

  function logout() {
    localStorage.removeItem("ben_ai_token");
    localStorage.removeItem("ben_ai_email");
    setToken(null);
    setEmail("");
  }

  return {
    token,
    email,
    error,
    setError,
    oauthLoading,
    signup,
    login,
    logout,
    isLoggedIn: !!token,
    API_BASE,
  };
}
