import { useState } from "react";
import type { IndexStatus, SymbolHit, UsageHit } from "@pi-desk/code-index";
import { getPiApi } from "../app/piApi";
import { AppIcon, type AppIconName } from "../ui/icons";
import { formatRelativeTime } from "../ui/formatRelativeTime";
import { CollapsibleSection } from "../ui/CollapsibleSection";

/**
 * Code-index search panel (status + symbol search + usages).
 * Extracted from ResourceInspector.tsx; fully self-contained.
 */
export function IndexPanel({ cwd, indexStatus }: { cwd: string; indexStatus: IndexStatus | null }) {
  const api = getPiApi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolHit[]>([]);
  const [usages, setUsages] = useState<UsageHit[]>([]);
  const [selectedQualified, setSelectedQualified] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const [loadingUsages, setLoadingUsages] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || !cwd || !api) return;
    setSearching(true);
    setUsages([]);
    setSelectedQualified(null);
    setSelectedName("");
    try {
      const hits = await api.indexSearch(cwd, trimmed, { limit: 20 });
      setResults(hits);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleResultClick = async (hit: SymbolHit) => {
    if (!cwd || !api) return;
    setSelectedQualified(hit.qualified);
    setSelectedName(hit.name);
    setLoadingUsages(true);
    try {
      const hits = await api.indexFindUsages(cwd, hit.qualified);
      setUsages(hits);
    } catch {
      setUsages([]);
    } finally {
      setLoadingUsages(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!cwd || !api) return;
    try {
      // Incremental re-index (fast, hash-skipped) + status via store event.
      await api.indexRefresh(cwd);
    } catch {
      // status updates come through store events
    }
  };

  const kindIcon = (kind: string): AppIconName => {
    if (kind === "class") return "fileCode2";
    if (kind === "function" || kind === "method") return "braces";
    return "fileText";
  };

  const kindColor = (kind: string): string => {
    if (kind === "class") return "purple";
    if (kind === "function" || kind === "method") return "amber";
    return "";
  };

  return (
    <div className="inspector-content">
      <CollapsibleSection title="Status" defaultOpen>
        {!indexStatus ? (
          <div className="inspector-muted">
            <div>Not indexed yet</div>
            <button className="index-btn index-refresh-btn" onClick={handleRefreshStatus}>
              Refresh
            </button>
          </div>
        ) : (
          <>
            <div className="inspector-row">
              <span>State</span>
              <span className={`index-badge ${indexStatus.state}`}>{indexStatus.state}</span>
            </div>
            <div className="inspector-row">
              <span>Files</span>
              <strong>{indexStatus.filesIndexed}</strong>
            </div>
            <div className="inspector-row">
              <span>Symbols</span>
              <strong>{indexStatus.symbolsIndexed}</strong>
            </div>
            {indexStatus.lastIndexedAt && (
              <div className="inspector-row">
                <span>Indexed</span>
                <strong>{formatRelativeTime(indexStatus.lastIndexedAt)}</strong>
              </div>
            )}
            {indexStatus.state === "error" && indexStatus.error && (
              <div className="inspector-row">
                <span>Error</span>
                <strong className="index-error">{indexStatus.error}</strong>
              </div>
            )}
            <button className="index-btn index-refresh-btn" onClick={handleRefreshStatus}>
              Refresh
            </button>
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Search" defaultOpen>
        <div className="index-search">
          <input
            className="index-search-input"
            type="text"
            placeholder="Search symbols..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            className="index-search-btn"
            onClick={handleSearch}
            disabled={searching || !query.trim()}
          >
            {searching ? "..." : "Search"}
          </button>
        </div>

        {searching && <div className="inspector-muted">Searching...</div>}

        {!searching && searched && results.length === 0 && (
          <div className="inspector-muted">No symbols found</div>
        )}

        {results.length > 0 && (
          <div className="index-results">
            {results.map((hit, i) => (
              <button
                key={`${hit.qualified}-${i}`}
                className={`index-result-row ${selectedQualified === hit.qualified ? "selected" : ""}`}
                onClick={() => handleResultClick(hit)}
              >
                <span className={`resource-icon ${kindColor(hit.kind)}`}>
                  <AppIcon name={kindIcon(hit.kind)} size="sm" />
                </span>
                <span className="index-result-detail">
                  <strong>{hit.name}</strong>
                  <small>
                    {hit.file}:{hit.line}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {(usages.length > 0 || loadingUsages) && selectedQualified && (
        <CollapsibleSection title={`Usages of ${selectedName}`} count={usages.length} defaultOpen>
          {loadingUsages && <div className="inspector-muted">Loading usages...</div>}
          {usages.map((usage, i) => (
            <div className="resource-row" key={`${usage.file}-${usage.line}-${i}`}>
              <span className={`resource-icon ${kindColor(usage.kind)}`}>
                <AppIcon name={kindIcon(usage.kind)} size="sm" />
              </span>
              <span>
                <strong>{usage.name}</strong>
                <small>
                  {usage.file}:{usage.line}
                </small>
              </span>
              <em>{usage.edgeKind}</em>
            </div>
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}
