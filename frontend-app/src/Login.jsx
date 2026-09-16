import { useState } from "react";
import { supabase } from "./supabase";

export default function Login({ auth }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [oauthLoading, setOauthLoading] = useState(null); // "google" | "github" | null

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === "login") {
      auth.login(email, password);
    } else {
      auth.signup(email, password);
    }
  }

  async function handleOAuth(provider) {
    setOauthLoading(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      auth.setError?.(error.message || "OAuth login failed");
      setOauthLoading(null);
    }
    // On success the browser redirects to the provider, then back to the app.
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950 px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white dark:bg-stone-900 rounded-xl shadow-sm p-6">
        <div className="w-12 h-12 rounded-xl bg-[#0B0C0E] dark:bg-[#F4F3EF] flex items-center justify-center mb-4">
          <span className="text-xl font-extrabold text-[#F4F3EF] dark:text-[#0B0C0E]">B</span>
        </div>
        <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-100">
          {mode === "login" ? "Log in to Ben AI" : "Create your account"}
        </h1>

        {/* OAuth buttons */}
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => handleOAuth("google")}
            disabled={!!oauthLoading}
            className="w-full flex items-center justify-center gap-2 border border-stone-200 dark:border-stone-700 rounded-lg py-2.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors disabled:opacity-50"
          >
            {oauthLoading === "google" ? (
              <span className="animate-pulse">Connecting…</span>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleOAuth("github")}
            disabled={!!oauthLoading}
            className="w-full flex items-center justify-center gap-2 border border-stone-200 dark:border-stone-700 rounded-lg py-2.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors disabled:opacity-50"
          >
            {oauthLoading === "github" ? (
              <span className="animate-pulse">Connecting…</span>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                Continue with GitHub
              </>
            )}
          </button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-stone-200 dark:border-stone-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white dark:bg-stone-900 text-stone-400 dark:text-stone-500">or</span>
          </div>
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmailInput(e.target.value)}
          required
          className="w-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-800 dark:focus:ring-stone-300"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="mt-3 w-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-800 dark:focus:ring-stone-300"
        />

        {auth.error && <p className="text-sm text-red-500 dark:text-red-400 mt-2">{auth.error}</p>}

        <button
          type="submit"
          className="mt-4 w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium py-2.5 rounded-lg hover:bg-stone-800 dark:hover:bg-stone-300 transition-colors"
        >
          {mode === "login" ? "Log in" : "Sign up"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-3 w-full text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
