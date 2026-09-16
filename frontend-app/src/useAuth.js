import { useState, useEffect, useCallback } from "react";

const API_BASE = "http://127.0.0.1:8000"; // production Render URL overrides via .env

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

  // On mount: check for OAuth redirect (URL hash contains access_token).
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token")) return;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get("access_token");
    if (!accessToken) return;

    // Clear the hash immediately so a page refresh doesn't re-trigger this.
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
