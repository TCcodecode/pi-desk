import { useEffect, useMemo, useRef, useState } from "react";
import type { PiApi, PlanArtifactSummary } from "../../shared/protocol";
import { AppIcon } from "../ui/icons";
import { Markdown } from "../ui/Markdown";

const PLAN_TEMPLATE =
  "# Implementation plan\n\n" +
  "## Goal\n\n" +
  "## Current understanding\n\n" +
  "## Decisions and trade-offs\n\n" +
  "## Implementation steps\n\n" +
  "## Verification\n\n" +
  "## Risks / open questions\n\n" +
  "## Execution handoff\n";

interface PlanInspectorProps {
  api?: PiApi;
  sessionId?: string;
  sessionKey?: string;
  activePlan?: PlanArtifactSummary;
  editable?: boolean;
  onOpenInspector: () => void;
  onOpenChanges: () => void;
  onClose: () => void;
  onError?: (message: string) => void;
}

function planBody(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  return end < 0 ? content : content.slice(end + "\n---".length).replace(/^\n/, "");
}

function titleFromContent(content: string): string {
  return /^#\s+(.+)$/m.exec(content)?.[1]?.trim() || "Implementation plan";
}

/** The single plan surface: review, edit, approve, and execute in the right pane. */
export function PlanInspector({
  api,
  sessionId,
  sessionKey,
  activePlan,
  editable = false,
  onOpenInspector,
  onOpenChanges,
  onClose,
  onError,
}: PlanInspectorProps) {
  const [plan, setPlan] = useState<PlanArtifactSummary | undefined>(activePlan);
  const [content, setContent] = useState(PLAN_TEMPLATE);
  const [revision, setRevision] = useState(activePlan?.revision ?? "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const sessionOpts = sessionKey ? { sessionKey } : undefined;
  const title = useMemo(() => titleFromContent(content), [content]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!sessionId || !activePlan?.id || !api?.listPlans || !api.readPlan) {
        setPlan(activePlan);
        setContent(PLAN_TEMPLATE);
        setRevision(activePlan?.revision ?? "");
        setDirty(false);
        setEditing(false);
        return;
      }
      setLoading(true);
      try {
        const available = await api.listPlans(sessionOpts);
        const target = available.find((item) => item.id === activePlan.id);
        if (!target) {
          if (!cancelled) {
            setPlan(undefined);
            setContent(PLAN_TEMPLATE);
            setRevision("");
            setDirty(false);
            setEditing(false);
          }
          return;
        }
        const loaded = await api.readPlan(target.id, sessionOpts);
        if (!cancelled) {
          setPlan(loaded.summary);
          setContent(loaded.content);
          setRevision(loaded.summary.revision);
          setDirty(false);
          setEditing(false);
        }
      } catch (cause) {
        if (!cancelled) onError?.(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [api, sessionId, sessionKey, activePlan?.id, onError]);

  const save = async (status: "draft" | "ready" = "draft"): Promise<void> => {
    if (!editable || !api?.savePlan) return;
    setSaving(true);
    try {
      const next = plan && status === "draft" && api.updatePlan
        ? { summary: await api.updatePlan(plan.id, content, revision, sessionOpts), content }
        : await api.savePlan(title, content, status, plan?.id, sessionOpts);
      setPlan(next.summary);
      setContent(next.content);
      setRevision(next.summary.revision);
      setDirty(false);
      setEditing(false);
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const startExecution = async (): Promise<void> => {
    if (!editable || !plan || plan.status !== "ready" || !api?.startExecution) return;
    setSaving(true);
    try {
      await api.startExecution(plan.id, sessionOpts);
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="inspector plan-inspector" aria-label="Plan review">
      <div className="inspector-header">
        <div className="right-pane-mode-tabs" role="tablist" aria-label="Right panel mode">
          <button type="button" role="tab" aria-selected="false" onClick={onOpenInspector}>Inspector</button>
          <button type="button" role="tab" aria-selected="true" className="selected">Plan</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenChanges}>Changes</button>
        </div>
        <div className="inspector-header-actions">
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close plan" title="Close plan">
            <AppIcon name="x" size="sm" />
          </button>
        </div>
      </div>

      <div className="plan-inspector-heading">
        <div className="plan-inspector-title">
          <AppIcon name="fileText" size="sm" />
          <div>
            <strong>{plan?.title || title}</strong>
            <span className={`plan-status plan-status-${plan?.status ?? "draft"}`}>{plan?.status ?? "draft"}</span>
          </div>
        </div>
        <div className="plan-inspector-toolbar">
          {dirty && <span className="plan-dirty">Unsaved</span>}
          {editable && (
            <>
            <button type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Preview" : "Edit"}</button>
            <button type="button" onClick={() => void save("draft")} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="ready" onClick={() => void save("ready")} disabled={!dirty || saving}>Mark ready</button>
            <button type="button" className="execute" onClick={() => void startExecution()} disabled={!plan || plan.status !== "ready" || dirty || saving}>Start execution</button>
            </>
          )}
        </div>
      </div>

      <div className="plan-inspector-content">
        {loading ? <p className="plan-inspector-empty">Loading plan…</p> : editable && editing ? (
          <textarea
            ref={editorRef}
            className="plan-inspector-editor"
            value={content}
            onChange={(event) => { setContent(event.target.value); setDirty(true); }}
            spellCheck={false}
            aria-label="Implementation plan Markdown"
          />
        ) : (
          <div className="plan-inspector-preview" role="region" aria-label="Plan preview" onDoubleClick={() => { if (editable) setEditing(true); }}>
            <Markdown content={planBody(content)} />
          </div>
        )}
      </div>

      <footer className="plan-inspector-footer">
        {plan?.path || "Not saved — draft plans are saved in .pai/plan"}
      </footer>
    </aside>
  );
}
