import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// Renders one assistant reply as formatted markdown:
//  - GFM support (tables, strikethrough, task lists, autolinks)
//  - Code blocks highlighted with SyntaxHighlighter, using whatever language
//    follows the ``` fences (```javascript, ```java, ```python, ... )
//  - Links open in a new tab (navigating away mid-chat loses state, so never
//    navigate the SPA away from the conversation).
function Code({ node, className, children, ...props }) {
  // react-markdown puts `language-<name>` in the className for fenced blocks.
  const match = /language-(\w+)/.exec(className || "");
  const text = String(children).replace(/\n$/, "");

  if (match) {
    return (
      <SyntaxHighlighter
        language={match[1]}
        style={oneDark}
        PreTag="div"
        customStyle={{
          margin: "0.5rem 0",
          borderRadius: "0.5rem",
          fontSize: "0.8rem",
          lineHeight: "1.5",
          overflowX: "auto",
          maxWidth: "100%",
        }}
        codeTagProps={{ style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" } }}
      >
        {text}
      </SyntaxHighlighter>
    );
  }

  // No language tag on the fence: treat it as a code block if it spans lines,
  // otherwise as inline code (backticks inside a paragraph).
  if (String(children).includes("\n")) {
    return (
      <pre className="markdown-plain-pre">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  }
  return (
    <code className="markdown-inline" {...props}>
      {children}
    </code>
  );
}

function Link({ node, href, children, ...props }) {
  const samePage = href && (href.startsWith("#") || href.startsWith("/"));
  return (
    <a
      href={href}
      {...props}
      {...(samePage ? {} : { target: "_blank", rel: "noopener noreferrer" })}
    >
      {children}
    </a>
  );
}

export default function MarkdownMessage({ content }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: Code, a: Link }}>
        {content}
      </ReactMarkdown>
    </div>
  );
}