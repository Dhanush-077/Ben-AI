import { useState, useEffect } from "react";

// Manages light/dark theme, persists choice in localStorage, and toggles
// the "dark" class on <html> so Tailwind's `dark:` variants take effect.
// Requires Tailwind dark mode set to class-based:
//   @custom-variant dark (&.dark);  — already in index.css
export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ben_ai_theme") || "light"
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("ben_ai_theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  return { theme, toggleTheme };
}