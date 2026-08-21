import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant/user markdown content. Links open in the system browser.
 *
 * `plain` avoids the (expensive) remark parse entirely: while an assistant
 * message is still streaming, each delta re-parses the whole accumulated
 * string, which is the dominant cost of a live turn. Stream as preformatted
 * text and parse once when the message completes.
 */
export const Markdown = memo(function Markdown({ content, plain = false }: { content: string; plain?: boolean }) {
  if (plain) {
    return <div className="markdown markdown-plain">{content}</div>;
  }
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (window.pi?.openExternal) {
                  void window.pi.openExternal(href ?? "");
                  return;
                }
                window.open(href, "_blank", "noopener,noreferrer");
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
