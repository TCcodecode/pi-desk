/**
 * Queued follow-up list with inline edit / send-now actions.
 * Extracted from Composer.tsx; all state stays in the parent.
 */
export function ComposerQueuePanel({
  messages,
  editingIndex,
  editingText,
  actingIndex,
  canAct,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onSendNow,
  onEditingTextChange,
}: {
  messages: string[];
  editingIndex: number | null;
  editingText: string;
  actingIndex: number | null;
  /** Edit/send-now affordances are only offered when the runtime supports them. */
  canAct: boolean;
  onBeginEdit: (index: number) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSendNow: (index: number) => void;
  onEditingTextChange: (text: string) => void;
}) {
  return (
    <div className="composer-queue" aria-label="Queue">
      <div className="composer-queue-header">
        <span>Queue</span>
        <span className="composer-queue-count">{messages.length}</span>
      </div>
      <div className="composer-queue-list">
        {messages.map((message, index) => {
          const isEditing = editingIndex === index;
          const isActing = actingIndex === index;
          return (
            <div className={`composer-queue-item${isEditing ? " is-editing" : ""}`} key={index}>
              {isEditing ? (
                <textarea
                  className="composer-queue-editor"
                  aria-label={`Edit queued message ${index + 1}`}
                  value={editingText}
                  onChange={(event) => onEditingTextChange(event.target.value)}
                  disabled={isActing}
                  autoFocus
                />
              ) : (
                <div className="composer-queue-message">{message}</div>
              )}
              {canAct && (
                <div className="composer-queue-actions">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="composer-queue-action primary"
                        aria-label={`Save queued message ${index + 1}`}
                        disabled={isActing || !editingText.trim()}
                        onClick={() => onSaveEdit()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="composer-queue-action"
                        aria-label={`Cancel editing queued message ${index + 1}`}
                        disabled={isActing}
                        onClick={onCancelEdit}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="composer-queue-action"
                        aria-label={`Edit queued message ${index + 1}`}
                        disabled={actingIndex !== null || editingIndex !== null}
                        onClick={() => onBeginEdit(index)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="composer-queue-action primary"
                        aria-label={`Send queued message ${index + 1} now`}
                        disabled={actingIndex !== null || editingIndex !== null}
                        onClick={() => onSendNow(index)}
                      >
                        Send now
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
