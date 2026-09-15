import { useState } from "react";

export default function Login({ auth }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmailInput] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === "login") {
      auth.login(email, password);
    } else {
      auth.signup(email, password);
    }
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

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmailInput(e.target.value)}
          required
          className="mt-4 w-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-800 dark:focus:ring-stone-300"
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