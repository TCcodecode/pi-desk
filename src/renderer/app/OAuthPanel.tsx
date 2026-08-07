import { useMemo, useState } from "react";
import type { ProviderAuthStatus, ProviderLoginEvent, ProviderLoginPrompt } from "../../shared/protocol";
import { AppIcon } from "../ui/icons";

/**
 * Provider OAuth login progress panel: event log + interactive prompt form.
 * Extracted from SettingsDialog.tsx.
 */

export function OAuthProgressPanel({
  provider,
  state,
  answerAuthPrompt,
  cancelProviderLogin,
  openExternal,
}: {
  provider: ProviderAuthStatus;
  state: { status: "running" | "done" | "error"; events: ProviderLoginEvent[] };
  answerAuthPrompt?: (promptId: string, answer: string) => Promise<void>;
  cancelProviderLogin?: (providerId: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
}) {
  const lastPrompt = useMemo(() => {
    for (let index = state.events.length - 1; index >= 0; index -= 1) {
      const event = state.events[index];
      if (event.type === "prompt") return event.prompt;
    }
    return undefined;
  }, [state.events]);

  return (
    <div className="settings-oauth-panel">
      <div className="settings-oauth-log">
        {state.events.map((event, index) =>
          event.type === "prompt" ? null : <OAuthEventRow key={index} event={event} openExternal={openExternal} />,
        )}
      </div>
      {lastPrompt && (
        <OAuthPromptForm
          key={lastPrompt.promptId}
          prompt={lastPrompt}
          onSubmit={async (value) => {
            if (!answerAuthPrompt) return;
            await answerAuthPrompt(lastPrompt.promptId, value);
          }}
        />
      )}
      {cancelProviderLogin && (
        <div className="settings-provider-actions">
          <button
            type="button"
            className="settings-provider-btn danger"
            onClick={() => void cancelProviderLogin(provider.id)}
          >
            Cancel login
          </button>
        </div>
      )}
    </div>
  );
}

function OAuthEventRow({
  event,
  openExternal,
}: {
  event: ProviderLoginEvent;
  openExternal?: (url: string) => Promise<void>;
}) {
  switch (event.type) {
    case "auth_url":
      return (
        <div className="settings-oauth-event">
          <span className="settings-oauth-event-icon"><AppIcon name="externalLink" size="sm" /></span>
          <div className="settings-oauth-event-body">
            <p className="settings-oauth-event-text">
              {event.instructions ?? "Authorize in your browser to finish signing in."}
            </p>
            <button
              type="button"
              className="settings-oauth-link-btn"
              onClick={() => void openExternal?.(event.url)}
            >
              Open authorization page
            </button>
          </div>
        </div>
      );
    case "device_code":
      return (
        <div className="settings-oauth-event">
          <span className="settings-oauth-event-icon"><AppIcon name="keyboard" size="sm" /></span>
          <div className="settings-oauth-event-body">
            <p className="settings-oauth-event-text">
              Enter code <strong>{event.userCode}</strong> at{" "}
              <button
                type="button"
                className="settings-oauth-link-btn"
                onClick={() => void openExternal?.(event.verificationUri)}
              >
                {event.verificationUri}
              </button>
              {event.expiresInSeconds ? ` · expires in ${Math.max(1, Math.round(event.expiresInSeconds / 60))} min` : ""}
            </p>
          </div>
        </div>
      );
    case "info":
      return (
        <div className="settings-oauth-event">
          <span className="settings-oauth-event-icon"><AppIcon name="info" size="sm" /></span>
          <div className="settings-oauth-event-body">
            <p className="settings-oauth-event-text">{event.message}</p>
            {event.links?.map((link, index) => (
              <button
                key={index}
                type="button"
                className="settings-oauth-link-btn"
                onClick={() => void openExternal?.(link.url)}
              >
                {link.label ?? link.url}
              </button>
            ))}
          </div>
        </div>
      );
    case "progress":
      return (
        <div className="settings-oauth-event">
          <span className="settings-oauth-event-icon"><AppIcon name="circleDot" size="sm" /></span>
          <div className="settings-oauth-event-body">
            <p className="settings-oauth-event-text">{event.message}</p>
          </div>
        </div>
      );
    case "done":
      return (
        <div className="settings-oauth-event success">
          <span className="settings-oauth-event-icon"><AppIcon name="check" size="sm" /></span>
          <div className="settings-oauth-event-body">
            <p className="settings-oauth-event-text">Signed in to {event.name}.</p>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="settings-oauth-event error">
          <span className="settings-oauth-event-icon"><AppIcon name="circleAlert" size="sm" /></span>
          <div className="settings-oauth-event-body">
            <p className="settings-oauth-event-text">{event.message}</p>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function OAuthPromptForm({
  prompt,
  onSubmit,
}: {
  prompt: ProviderLoginPrompt;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(prompt.type === "select" ? (prompt.options?.[0]?.id ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    if (busy) return;
    if (prompt.type !== "select" && !value.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(value);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-oauth-prompt">
      <p className="settings-oauth-prompt-message">{prompt.message}</p>
      {prompt.type === "select" ? (
        <div className="settings-oauth-options" role="radiogroup" aria-label={prompt.message}>
          {prompt.options?.map((option) => (
            <label key={option.id} className="settings-oauth-option">
              <input
                type="radio"
                name={`oauth-select-${prompt.promptId}`}
                checked={value === option.id}
                onChange={() => setValue(option.id)}
              />
              <span className="settings-oauth-option-label">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <input
          type={prompt.type === "secret" ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          placeholder={prompt.placeholder ?? ""}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
      )}
      <div className="settings-provider-actions">
        <button
          type="button"
          className="settings-provider-btn primary"
          disabled={busy || (prompt.type !== "select" && !value.trim())}
          onClick={() => void submit()}
        >
          {busy ? "Submitting…" : "Continue"}
        </button>
      </div>
      {error && <p className="settings-providers-error">{error}</p>}
    </div>
  );
}
