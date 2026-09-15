import { useState } from "react";

const API_BASE = "http://127.0.0.1:8000"; // change to your deployed backend URL later

// Handles signup, login, logout, and persisting the JWT token in localStorage.
export function useAuth() {
  const [token, setToken] = useState(localStorage.getItem("ben_ai_token"));
  const [email, setEmail] = useState(localStorage.getItem("ben_ai_email") || "");
  const [error, setError] = useState("");

  function saveSession(data) {
    localStorage.setItem("ben_ai_token", data.token);
    localStorage.setItem("ben_ai_email", data.email);
    setToken(data.token);
    setEmail(data.email);
  }

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

  return { token, email, error, signup, login, logout, isLoggedIn: !!token, API_BASE };
}