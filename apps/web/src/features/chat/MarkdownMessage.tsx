import { useState, type AnchorHTMLAttributes, type ClassAttributes, type JSX } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@omniscience/ui";

/**
 * Schemes allowed in a rendered link/image `href`/`src`. Anything else
 * (most importantly `javascript:`/`data:`, the two schemes actually
 * exploitable from clickable/renderable Markdown) is stripped down to
 * `undefined` — see `urlTransform` below — before `react-markdown` ever
 * builds the element, not filtered after the fact.
 *
 * `react-markdown` itself never uses `dangerouslySetInnerHTML` (it
 * builds real React elements from the parsed AST, not an HTML string),
 * so it is not vulnerable to the classic "Markdown renderer as an XSS
 * vector" class of bug the way `marked`/`dangerouslySetInnerHTML` or a
 * raw-HTML-passthrough plugin (`rehype-raw`, deliberately not used
 * here) would be. This allow-list is the one additional guard worth
 * having on top of that: a scheme check on every link/image URL a
 * model's response could otherwise construct.
 */
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

function safeUrlTransform(url: string): string {
  // A same-document/relative fragment like `#section` has no scheme at
  // all and is always safe — `new URL()` would throw for it without a
  // base, so it's allowed through unparsed.
  if (url.startsWith("#") || url.startsWith("/")) {
    return url;
  }
  try {
    const parsed = new URL(url, window.location.origin);
    return ALLOWED_URL_SCHEMES.has(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

function CopyCodeButton({ code }: { code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={copied ? "Copied" : "Copy code"}
      className="omni-markdown-code__copy"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {
            // Clipboard permission denied or unavailable — no destructive
            // fallback (e.g. a hidden textarea + execCommand) worth the
            // complexity for a "copy code" affordance; the code remains
            // fully selectable by hand either way.
          },
        );
      }}
    >
      {copied ? "✓ Copied" : "⧉ Copy"}
    </Button>
  );
}

/** Extracts the flat text content of a fenced code block's children, for the copy button — code children are always plain strings from the parser, but this walks defensively rather than assuming a single string child. */
function flattenCodeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(flattenCodeText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return flattenCodeText((children as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

const components: Components = {
  // Fenced/indented code blocks render as `<pre><code>` (this override);
  // *inline* `code` (no surrounding `<pre>`) hits the plain `code`
  // override further down instead — react-markdown gives both the same
  // `code` component, distinguished here by `className` (a fenced block
  // gets a `language-xxx` class from remark; inline code never does) and
  // by whether a `\n` is present, which is what a fenced block with no
  // language tag still reliably has.
  pre({ children }) {
    return <>{children}</>;
  },
  code(props) {
    const { className, children, ...rest } = props;
    const isBlock = /language-|\n/.test(String(className ?? "")) || String(children).includes("\n");
    if (!isBlock) {
      return (
        <code className="omni-markdown-inline-code" {...rest}>
          {children}
        </code>
      );
    }
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    const text = flattenCodeText(children).replace(/\n$/, "");
    return (
      <div className="omni-markdown-code">
        <div className="omni-markdown-code__bar">
          <span className="omni-markdown-code__lang">{language ?? "code"}</span>
          <CopyCodeButton code={text} />
        </div>
        <pre className="omni-markdown-code__pre">
          <code className={className}>{children}</code>
        </pre>
      </div>
    );
  },
  table({ children }) {
    return (
      <div className="omni-markdown-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
  a(props: ClassAttributes<HTMLAnchorElement> & AnchorHTMLAttributes<HTMLAnchorElement>) {
    const { href, children, ...rest } = props;
    // A link an unresolvable scheme resolved to "" above renders as
    // plain text instead of a dead/no-op anchor — a link that can't go
    // anywhere shouldn't look clickable.
    if (!href) {
      return <>{children}</>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  },
};

/**
 * Renders an assistant message's content as real, styled Markdown —
 * headings, emphasis, lists, code blocks, blockquotes, tables (via
 * `remark-gfm`), links, and horizontal rules — instead of the raw
 * `**`/`#`/`-` syntax a plain-text bubble would show verbatim.
 *
 * Safe to call on a partially-streamed string: `react-markdown` parses
 * whatever text it's given fresh on every render (it holds no state of
 * its own across renders), so an in-progress construct — an unclosed
 * `**bold`, a fenced code block whose closing ``` hasn't arrived yet —
 * simply parses as the most sensible thing it can currently resolve to
 * (usually literal text, or an unclosed-but-still-valid code block)
 * rather than throwing or producing broken/unbalanced HTML. There is
 * deliberately no debouncing or "wait for a complete block" buffering
 * here: `MessageList`'s existing near-bottom auto-follow behavior
 * already depends on new content appearing the instant a `delta` event
 * arrives, and a Markdown parser re-run on every keystroke-sized chunk
 * is cheap enough not to need it.
 */
export function MarkdownMessage({ content }: { content: string }): JSX.Element {
  return (
    <div className="omni-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrlTransform} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
