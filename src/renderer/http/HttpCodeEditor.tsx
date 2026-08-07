import { useRef, type ReactNode, type UIEvent as ReactUIEvent } from "react";
import { AppIcon } from "../ui/icons";

export type HttpResponseInlay = {
  id: string;
  lineNumber: number;
  label: string;
  ok: boolean;
  onOpen: () => void;
  onDelete: () => void;
};

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+/i;

function isHttpRequestLine(line: string): boolean {
  return HTTP_METHOD_PATTERN.test(line.trim());
}

function highlightUrl(value: string): ReactNode {
  return value.split(/(\{\{[^}]+\}\})/g).map((part, index) => (
    /^\{\{[^}]+\}\}$/.test(part)
      ? <span key={index} className="http-code-variable">{part}</span>
      : part
  ));
}

function highlightLine(line: string, language: "http" | "json"): ReactNode {
  if (language === "json") {
    return line.split(/("(?:\\.|[^"\\])*")/g).map((part, index) => (
      /^"(?:\\.|[^"\\])*"$/.test(part)
        ? <span key={index} className={part.trimEnd().endsWith(":\"") ? "http-code-key" : "http-code-string"}>{part}</span>
        : part
    ));
  }
  if (/^\s*###/.test(line)) return <span className="http-code-heading">{line}</span>;
  if (/^\s*#/.test(line)) return <span className="http-code-comment">{line}</span>;
  if (/^\s*<>\s+\S+\s*$/.test(line)) return <span className="http-code-response-link">{line}</span>;
  const request = line.match(/^(\s*)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)(\s+)(.*)$/i);
  if (request) {
    return <>{request[1]}<span className="http-code-method">{request[2].toUpperCase()}</span>{request[3]}<span className="http-code-url">{highlightUrl(request[4])}</span></>;
  }
  const header = line.match(/^(\s*)([^:#\s][^:]*:)(\s*)(.*)$/);
  if (header) return <>{header[1]}<span className="http-code-header">{header[2]}</span>{header[3]}{highlightUrl(header[4])}</>;
  return line;
}

/**
 * Line-numbered code editor with syntax highlight and response inlays.
 * Extracted from HttpWorkbench.tsx; the gutter/highlight/inlay layers are
 * kept together because they share one textarea scroll position.
 */
export function HttpCodeEditor({
  value,
  onChange,
  ariaLabel,
  language,
  disabled = false,
  readOnly = false,
  onRunRequest,
  onSave,
  responseInlays = [],
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  language: "http" | "json";
  disabled?: boolean;
  readOnly?: boolean;
  onRunRequest?: (lineNumber: number) => void;
  onSave?: () => void;
  responseInlays?: HttpResponseInlay[];
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const responseInlaysRef = useRef<HTMLDivElement>(null);
  const lines = value.split("\n");
  const responseLineNumbers = new Set(responseInlays.map((inlay) => inlay.lineNumber));
  const syncScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    if (highlightRef.current) highlightRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    if (responseInlaysRef.current) responseInlaysRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
  };

  return (
    <div className="http-code-editor">
      <div className="http-code-gutter" ref={gutterRef}>
        <div className="http-code-gutter-spacer" />
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const requestLine = language === "http" && isHttpRequestLine(line);
          return (
            <div className="http-code-gutter-line" key={lineNumber}>
              {requestLine && onRunRequest ? (
                <button
                  type="button"
                  className="http-code-run-request"
                  aria-label={`Run request at line ${lineNumber}`}
                  title={`Run request at line ${lineNumber}`}
                  disabled={disabled}
                  onClick={() => onRunRequest(lineNumber)}
                >
                  <AppIcon name="play" size="xs" />
                </button>
              ) : <span className="http-code-run-placeholder" />}
              <span className="http-code-line-number">{lineNumber}</span>
            </div>
          );
        })}
      </div>
      <div className="http-code-editor-main">
        <pre ref={highlightRef} className="http-code-highlight" aria-hidden="true">
          {lines.map((line, index) => <span className="http-code-line" key={index}>{responseLineNumbers.has(index + 1) ? " " : highlightLine(line, language)}{index < lines.length - 1 ? "\n" : ""}</span>)}
        </pre>
        <textarea
          className="http-code-input"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (onSave && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              onSave();
            }
          }}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={disabled}
          readOnly={readOnly}
        />
        <div className="http-code-response-inlays" ref={responseInlaysRef} aria-label="HTTP response links">
          {responseInlays.map((inlay) => (
            <div className="http-code-response-inlay" key={inlay.id} style={{ top: `${12 + (inlay.lineNumber - 1) * 20}px` }}>
              <button type="button" className={inlay.ok ? "is-passed" : "is-failed"} onClick={inlay.onOpen} onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  inlay.onDelete();
                }
              }} aria-label={`Open response ${inlay.label}`} title="Open response">
                <span>&lt;&gt;</span> {inlay.label}
              </button>
              <button type="button" className="http-code-response-delete" onClick={inlay.onDelete} aria-label={`Delete response ${inlay.label}`} title="Delete response">
                <AppIcon name="trash" size="xs" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
