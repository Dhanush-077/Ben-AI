// Offline functional check of the markdown pipeline used by MarkdownMessage.jsx.
// Runs the REAL react-markdown v10 + remark-gfm + react-syntax-highlighter with
// the same Code/Link renderer logic (written in createElement form to run in
// plain Node — the Vite build already proves the JSX component compiles).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism/index.js";

const Code = ({ className, children }) => {
  const match = /language-(\w+)/.exec(className || "");
  const text = String(children).replace(/\n$/, "");
  if (match) {
    return React.createElement(SyntaxHighlighter, {
      language: match[1],
      style: oneDark,
      PreTag: "div",
      customStyle: { margin: "0.5rem 0", borderRadius: "0.5rem", fontSize: "0.8rem", overflowX: "auto", maxWidth: "100%" },
      codeTagProps: { style: { fontFamily: "monospace" } },
    }, text);
  }
  if (String(children).includes("\n")) {
    return React.createElement("pre", null, React.createElement("code", { className }, children));
  }
  return React.createElement("code", { className }, children);
};

const Link = ({ href, children }) =>
  React.createElement(
    "a",
    { href, ...(href && href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" }) },
    children
  );

const md = `Here's a quick JS function:

\`\`\`javascript
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
\`\`\`

And a python one:

\`\`\`python
def greet(name): return f"hi {name}"
\`\`\`

Inline \`const x = 1\` stays inline.

Links: [GitHub]() and a table:

| A | B |
|---|---|
| 1 | 2 |
`;

const html = renderToStaticMarkup(
  React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: { code: Code, a: Link } }, md)
);

const jsRegion = html.slice(0, html.indexOf("And a python one"));
const pyRegion = html.slice(html.indexOf("And a python one"), html.indexOf("Inline"));
const checks = {
  "js fence: oneDark background applied":
    jsRegion.includes("background:hsl(220, 13%, 18%)"),
  "js fence: token spans present (highlighting happened)":
    /<span[^>]*class="[^"]*token/.test(jsRegion),
  "js fence: distinct token colors (language applied to tokenizer)":
    (jsRegion.match(/color:hsl\(/g) || []).length >= 3,
  "python fence: token spans present":
    /<span[^>]*class="[^"]*token/.test(pyRegion),
  "inline code rendered as <code> not <pre>":
    /<code[^>]*>\s*const x = 1/.test(html),
  "link has target=_blank":
    /<a href=""[^>]*target="_blank"/.test(html),
  "gfm table rendered":
    /<table>/.test(html),
};

let fail = false;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) fail = true;
}
console.log("\n--- code element + first tokens (js block) ---");
const j = jsRegion.indexOf("language-");
if (j === -1) {
  const k = jsRegion.indexOf("</div><code");
  if (k !== -1) console.log("code opening:", jsRegion.slice(k, k + 200));
  else {
    const z = jsRegion.indexOf("token");
    console.log("(no language- class found) first token-ish:", z === -1 ? "none" : jsRegion.slice(z - 120, z + 200));
  }
} else {
  console.log(jsRegion.slice(j - 20, j + 140));
}
process.exit(fail ? 1 : 0);