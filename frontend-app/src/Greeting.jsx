import { useState, useEffect } from "react";

// Time-of-day greeting with a typewriter effect on first load.
export default function Greeting({ userName = "" }) {
  const [text, setText] = useState("");

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  })();

  const fullText = userName
    ? `${greeting}, ${userName}. What's on your mind?`
    : `${greeting}. What's on your mind?`;

  // simple typewriter effect
  useEffect(() => {
    setText("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setText(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [fullText]);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#0B0C0E] dark:bg-[#F4F3EF] flex items-center justify-center mb-5">
        <span className="text-2xl font-extrabold text-[#F4F3EF] dark:text-[#0B0C0E]">B</span>
      </div>
      <h1 className="text-2xl font-semibold text-stone-800 dark:text-stone-100 min-h-[2rem]">
        {text}
        <span className="animate-pulse">|</span>
      </h1>
      <p className="text-sm text-stone-500 dark:text-stone-400 mt-2">
        Ask about code, news, stocks, or live scores — text, voice, or an image.
      </p>
    </div>
  );
}