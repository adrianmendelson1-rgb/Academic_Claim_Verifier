"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import type { StoredFileMeta } from "@/app/api/storage/upload/route";
import type {
  Claim, VerificationResult, Verdict,
  FoundSource, MissingSource, FindSourcesResult,
  EvidenceResult, FindSourceForClaimResult,
} from "@/lib/types";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const VERDICT_CONFIG: Record<Verdict, {
  icon: string; label: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}> = {
  SUPPORTED:    { icon: "✓",  label: "Supported",     accent: "#10B981", badgeBg: "#F0FDF4", badgeText: "#065F46", badgeBorder: "#BBF7D0" },
  PARTIAL:      { icon: "≈",  label: "Partial",        accent: "#F59E0B", badgeBg: "#FFFBEB", badgeText: "#78350F", badgeBorder: "#FDE68A" },
  OVERSTATED:   { icon: "↑",  label: "Overstated",     accent: "#F97316", badgeBg: "#FFF7ED", badgeText: "#7C2D12", badgeBorder: "#FED7AA" },
  NOT_SUPPORTED:{ icon: "✕",  label: "Not Supported",  accent: "#EF4444", badgeBg: "#FEF2F2", badgeText: "#7F1D1D", badgeBorder: "#FECACA" },
  UNVERIFIABLE: { icon: "?",  label: "Unverifiable",   accent: "#9CA3AF", badgeBg: "#F9FAFB", badgeText: "#374151", badgeBorder: "#E5E7EB" },
  WRONG_SOURCE: { icon: "⊘",  label: "Wrong Source",   accent: "#8B5CF6", badgeBg: "#F5F3FF", badgeText: "#4C1D95", badgeBorder: "#DDD6FE" },
};

const SOURCE_LABELS: Record<string, string> = {
  semantic_scholar: "Semantic Scholar",
  arxiv: "arXiv",
  unpaywall: "Unpaywall",
  core: "CORE",
  uploaded: "Uploaded",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
function Spinner({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke={color} strokeWidth="3" />
      <path className="opacity-80" fill={color} d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Badge({ config }: { config: typeof VERDICT_CONFIG[Verdict] }) {
  return (
    <span style={{ background: config.badgeBg, color: config.badgeText, borderColor: `${config.accent}55` }}
      className="inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide flex-shrink-0">
      <span className="font-bold">{config.icon}</span>
      {config.label}
    </span>
  );
}

// ─── Claim Nav Card (left panel) ──────────────────────────────────────────────
function ClaimNavCard({
  claim, index, isSelected, isHovered,
  onSelect, onHover, onHoverEnd, cardRef,
  allSources,
}: {
  claim: Claim; index: number;
  isSelected: boolean; isHovered: boolean;
  onSelect: () => void; onHover: () => void; onHoverEnd: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
  allSources: FoundSource[];
}) {
  const cfg = VERDICT_CONFIG[claim.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE;
  const [rewriting, setRewriting] = useState(false);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Evidence display state
  const [evidence, setEvidence] = useState<EvidenceResult | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  // Find source state
  const [findingSource, setFindingSource] = useState(false);
  const [sourceResult, setSourceResult] = useState<FindSourceForClaimResult | null>(null);

  // Custom rewrite instruction
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [showInstructionInput, setShowInstructionInput] = useState(false);

  // State-based behavior
  const isSupported = claim.verdict === "SUPPORTED";
  const isPartial = claim.verdict === "PARTIAL";
  const isNotSupported = claim.verdict === "NOT_SUPPORTED";
  const isOverstated = claim.verdict === "OVERSTATED";
  const isUnverifiable = claim.verdict === "UNVERIFIABLE";
  const isWrongSource = claim.verdict === "WRONG_SOURCE";
  const hasIssues = isPartial || isNotSupported || isOverstated || isWrongSource;

  // Find the matching source text for this claim's citation
  const matchedSource = allSources.find(s => {
    const key = s.citationKey.toLowerCase();
    const cit = (claim.citation ?? "").toLowerCase();
    return key === cit || cit.includes(key) || key.includes(cit.split(",")[0]);
  });
  const hasSourceText = !!(matchedSource?.text);

  const handleRewrite = async (e: React.MouseEvent, instruction?: string) => {
    e.stopPropagation();
    setRewriting(true); setRewritten(null);
    try {
      // Get evidence text from matched source for evidence-aware rewrite
      const evidenceText = evidence?.quotes?.map(q => q.text).join("\n") ?? matchedSource?.text?.slice(0, 2000) ?? "";
      const res = await fetch("/api/rewrite-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: claim.claim,
          citation: claim.citation,
          verdict: claim.verdict,
          why: claim.why,
          evidence: evidenceText,
          userInstruction: instruction || undefined,
        }),
      });
      const data = await res.json();
      setRewritten(data.rewritten || "Could not generate a rewrite.");
      setShowInstructionInput(false);
      setRewriteInstruction("");
    } catch { setRewritten("Error generating rewrite."); }
    finally { setRewriting(false); }
  };

  const handleShowEvidence = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (evidence) { setShowEvidence(!showEvidence); return; }
    if (!hasSourceText) return;
    setLoadingEvidence(true); setShowEvidence(true);
    try {
      const res = await fetch("/api/extract-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: claim.claim,
          sourceText: matchedSource!.text,
          sourceTitle: matchedSource!.title,
        }),
      });
      const data: EvidenceResult = await res.json();
      setEvidence(data);
    } catch { setEvidence({ quotes: [], summary: "Failed to extract evidence.", confidence: "low" }); }
    finally { setLoadingEvidence(false); }
  };

  const handleFindSource = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setFindingSource(true); setSourceResult(null);
    try {
      const res = await fetch("/api/find-source-for-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.claim, citation: claim.citation }),
      });
      const data: FindSourceForClaimResult = await res.json();
      setSourceResult(data);
    } catch { setSourceResult({ status: "not_found", message: "Search failed. Try again later." }); }
    finally { setFindingSource(false); }
  };

  const RELEVANCE_COLORS = {
    direct: { bg: "#F0FDF4", border: "#BBF7D0", text: "#065F46" },
    partial: { bg: "#FFFBEB", border: "#FDE68A", text: "#78350F" },
    tangential: { bg: "#F9FAFB", border: "#E5E7EB", text: "#374151" },
  };

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      className="border-b cursor-pointer transition-all"
      style={{
        borderColor: "var(--border)",
        background: isSelected ? cfg.badgeBg : isHovered ? `${cfg.badgeBg}70` : `${cfg.badgeBg}28`,
        borderLeft: `${isSelected ? 4 : isHovered ? 3 : 2}px solid ${isSelected ? cfg.accent : isHovered ? `${cfg.accent}66` : `${cfg.accent}28`}`,
        boxShadow: isSelected ? `inset 4px 0 18px ${cfg.accent}22, 0 2px 10px rgba(0,0,0,0.07)` : undefined,
      }}
    >
      {/* Compact summary — always visible */}
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Badge config={cfg} />
          <span className="text-[10px] text-[#C8C8C6] font-mono flex-shrink-0">#{index + 1}</span>
        </div>
        <p className={`text-[12px] text-[#2A2A28] italic leading-snug ${isSelected ? "" : "line-clamp-2"}`}>
          &ldquo;{claim.claim}&rdquo;
        </p>
        <p className="text-[11px] text-[#9A9A98] truncate">{claim.citation}</p>
      </div>

      {/* Expanded detail when selected */}
      {isSelected && (
        <div
          className="px-4 pb-4 pt-3 space-y-3 border-t"
          style={{ borderColor: `${cfg.accent}33` }}
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[13px] text-[#3A3A38] leading-relaxed">{claim.why}</p>

          {claim.citation && claim.citation !== "No citation" && (
            <div className="rounded-lg border px-3 py-2 bg-[#FAFAF9]" style={{ borderColor: "var(--border)" }}>
              <p className="text-[9px] font-semibold text-[#9A9A98] uppercase tracking-wider mb-0.5">Source accessed</p>
              <p className="text-[12px] font-medium text-[#1A1A18]">
                {SOURCE_LABELS[claim.source_accessed ?? ""] ?? claim.source_accessed ?? "Unknown"}
              </p>
            </div>
          )}

          {/* Evidence display — for SUPPORTED/PARTIAL when source text available */}
          {(isSupported || isPartial || isOverstated) && hasSourceText && (
            <button
              onClick={handleShowEvidence}
              disabled={loadingEvidence}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all disabled:opacity-50"
            >
              {loadingEvidence ? <><Spinner size={10} /> Extracting evidence…</> : showEvidence && evidence ? "Hide evidence" : "Show evidence"}
            </button>
          )}

          {showEvidence && evidence && (
            <div className="space-y-2">
              {evidence.quotes.map((q, qi) => {
                const rc = RELEVANCE_COLORS[q.relevance];
                return (
                  <div key={qi} className="rounded-lg border px-3 py-2.5" style={{ background: rc.bg, borderColor: rc.border }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: rc.text }}>
                        {q.relevance} match
                      </span>
                      {q.section && <span className="text-[9px] text-[#9A9A98]">· {q.section}</span>}
                    </div>
                    <p className="text-[11px] italic leading-relaxed" style={{ color: rc.text }}>&ldquo;{q.text}&rdquo;</p>
                    {q.context && <p className="text-[10px] text-[#9A9A98] mt-1">{q.context}</p>}
                  </div>
                );
              })}
              {evidence.summary && (
                <p className="text-[11px] text-[#5A5A58] leading-relaxed px-1">
                  <span className="font-semibold">Summary:</span> {evidence.summary}
                </p>
              )}
            </div>
          )}

          {/* Suggested fix — for issues, not when rewrite is showing */}
          {claim.fix && claim.fix !== "none needed" && !rewritten && hasIssues && (
            <div className="rounded-lg bg-[#F0F7FF] border border-[#BFDBFE] px-3 py-2.5">
              <p className="text-[9px] font-semibold text-[#1D4ED8] uppercase tracking-wider mb-1">Suggested fix</p>
              <p className="text-[12px] text-[#1E3A5F] leading-relaxed">{claim.fix}</p>
            </div>
          )}

          {/* Rewritten result */}
          {rewritten && (
            <div className="rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-[#065F46] uppercase tracking-wider">Rewritten</p>
                <button
                  onClick={() => { navigator.clipboard.writeText(rewritten); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="text-[10px] font-medium text-[#065F46] hover:text-[#047857] transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-[12px] text-[#14532D] leading-relaxed">{rewritten}</p>
              <button onClick={() => setRewritten(null)} className="text-[10px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors">
                Dismiss
              </button>
            </div>
          )}

          {/* Custom instruction input for rewrite */}
          {showInstructionInput && !rewritten && (
            <div className="rounded-lg border border-[#EBEBEA] bg-white px-3 py-2.5 space-y-2">
              <p className="text-[9px] font-semibold text-[#9A9A98] uppercase tracking-wider">Rewrite instruction</p>
              <input
                type="text"
                value={rewriteInstruction}
                onChange={e => setRewriteInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && rewriteInstruction.trim()) handleRewrite(e as unknown as React.MouseEvent, rewriteInstruction); }}
                placeholder="e.g. &quot;make more precise&quot;, &quot;weaken the causal claim&quot;…"
                className="w-full rounded-md border px-2.5 py-1.5 text-[11px] text-[#1A1A18] outline-none"
                style={{ borderColor: "var(--border)" }}
                autoFocus
              />
              <div className="flex gap-1.5">
                <button
                  onClick={(e) => handleRewrite(e, rewriteInstruction)}
                  disabled={rewriting || !rewriteInstruction.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-[#EBEBEA] bg-[#1A1A18] px-2 py-1.5 text-[10px] font-medium text-white hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {rewriting ? <><Spinner size={10} color="white" /> Rewriting…</> : "Apply"}
                </button>
                <button
                  onClick={() => { setShowInstructionInput(false); setRewriteInstruction(""); }}
                  className="px-2 py-1.5 rounded-md text-[10px] text-[#9A9A98] hover:text-[#5A5A58] hover:bg-[#F7F7F5] transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Source search result */}
          {sourceResult && (
            <div className={`rounded-lg border px-3 py-2.5 ${
              sourceResult.status === "found_full_text" ? "bg-[#F0FDF4] border-[#BBF7D0]" :
              sourceResult.status === "found_abstract" ? "bg-[#FFFBEB] border-[#FDE68A]" :
              "bg-[#F9FAFB] border-[#E5E7EB]"
            }`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider" style={{
                  color: sourceResult.status === "found_full_text" ? "#065F46" :
                         sourceResult.status === "found_abstract" ? "#78350F" : "#374151"
                }}>
                  {sourceResult.status === "found_full_text" ? "Full text found" :
                   sourceResult.status === "found_abstract" ? "Abstract only" : "Not found"}
                </span>
              </div>
              {sourceResult.title && <p className="text-[11px] font-medium text-[#1A1A18] mb-0.5">{sourceResult.title}</p>}
              <p className="text-[10px] text-[#5A5A58] leading-relaxed">{sourceResult.message}</p>
              {sourceResult.status === "found_abstract" && (
                <p className="text-[10px] text-[#B45309] mt-1.5 italic">Upload the full paper for confident verification.</p>
              )}
              <button onClick={() => setSourceResult(null)} className="text-[10px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors mt-1">
                Dismiss
              </button>
            </div>
          )}

          {/* Action buttons — state-based */}
          {!rewritten && !showInstructionInput && (
            <div className="space-y-1.5">
              {/* Rewrite actions for issues */}
              {hasIssues && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRewrite}
                    disabled={rewriting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all disabled:opacity-50"
                  >
                    {rewriting ? <><Spinner size={10} /> Rewriting…</> : <>✏ Rewrite</>}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowInstructionInput(true); }}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all"
                  >
                    Custom rewrite…
                  </button>
                </div>
              )}

              {/* For supported claims: only show evidence button (already shown above), and optional custom rewrite */}
              {isSupported && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInstructionInput(true); }}
                  className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#9A9A98] hover:text-[#5A5A58] hover:bg-[#F7F7F5] transition-all"
                >
                  Adjust wording…
                </button>
              )}

              {/* Find source — for unverifiable, not supported, wrong source */}
              {(isUnverifiable || isNotSupported || isWrongSource) && (
                <button
                  onClick={handleFindSource}
                  disabled={findingSource}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all disabled:opacity-50"
                >
                  {findingSource ? <><Spinner size={10} /> Searching…</> : (
                    <>
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                      </svg>
                      Find supporting source
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Missing paper row ─────────────────────────────────────────────────────────
function MissingRow({ source, onUpload, uploadError, uploading, openMenuKey, setOpenMenuKey, onEdit, onDelete }: {
  source: MissingSource;
  onUpload: (file: File) => void;
  uploadError?: string;
  uploading?: boolean;
  openMenuKey: string | null;
  setOpenMenuKey: (k: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuKey = `missing-${source.citationKey}`;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onUpload(f);
  };

  return (
    <div className="card px-6 py-5 space-y-3">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 text-[16px] flex-shrink-0" style={{ color: source.kind === "abstract_only" ? "#F59E0B" : "#EF4444" }}>
          {source.kind === "abstract_only" ? "≈" : "✕"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-[#1A1A18] truncate">{source.citationKey}</p>
          {source.title && <p className="text-[13px] text-[#9A9A98] truncate mt-0.5">{source.title}</p>}
          <p className="text-xs text-[#B45309] mt-1">{source.reason}</p>
        </div>
        {/* ⋯ menu for missing sources */}
        <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setOpenMenuKey(openMenuKey === menuKey ? null : menuKey)}
            title="More options"
            className="h-6 w-6 rounded-md flex items-center justify-center transition-all"
            style={{ color: "#C0C0BE" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#EBEBEA"; e.currentTarget.style.color = "#5A5A58"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C0C0BE"; }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/>
            </svg>
          </button>
          {openMenuKey === menuKey && (
            <div
              className="absolute right-0 top-full mt-1.5 bg-white rounded-xl overflow-hidden"
              style={{ border: "1px solid var(--border)", boxShadow: "0 4px 20px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.06)", minWidth: "176px", zIndex: 30 }}
            >
              <button
                onClick={() => { onEdit(); setOpenMenuKey(null); }}
                className="w-full px-4 py-2.5 text-[13px] text-left text-[#3A3A38] hover:bg-[#F7F7F5] transition-colors">
                Edit source
              </button>
              <div className="h-px mx-3" style={{ background: "var(--border)" }} />
              <button
                onClick={() => { onDelete(); setOpenMenuKey(null); }}
                className="w-full px-4 py-2.5 text-[13px] text-left hover:bg-[#FEF5F5] transition-colors"
                style={{ color: "#B54040" }}>
                Delete source
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed px-3 py-2.5 text-center cursor-pointer transition-all text-xs select-none
          ${dragging ? "border-indigo-400 bg-indigo-50" : "border-[#EBEBEA] hover:border-[#D8D8D6] hover:bg-[#F7F7F5]"}
          ${uploading ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input ref={inputRef} type="file" accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
        {uploading
          ? <span className="inline-flex items-center gap-2 text-[#9A9A98]"><Spinner size={12} /> Extracting text…</span>
          : <span className="text-[#9A9A98]">Drop PDF/DOCX or <span className="text-[#5A5A58] font-medium underline underline-offset-2">browse</span></span>
        }
      </div>
      {uploadError && <p className="text-xs text-red-600 leading-relaxed">{uploadError}</p>}
    </div>
  );
}

// ─── Input Card ───────────────────────────────────────────────────────────────
function InputCard({ label, value, onChange, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; disabled?: boolean;
}) {
  return (
    <div className={`input-card flex-1${value.length > 0 ? " is-filled" : ""}`}>
      <div className="input-card-label">{label}</div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

// ─── Step Indicator ────────────────────────────────────────────────────────────
const STEP_LABELS = ["Draft", "Sources", "Analysis"] as const;
function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const isDone = current > n;
        const isActive = current === n;
        return (
          <div key={n} className="flex items-center gap-1.5">
            {i > 0 && <div className={`step-connector${isDone ? " step-connector-done" : ""}`} />}
            <div className={`flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${
              isActive ? "text-[#1A1A18]" : isDone ? "text-[#10B981]" : "text-[#C8C8C6]"
            }`}>
              <div className={`step-dot ${isActive ? "step-dot-active" : isDone ? "step-dot-done" : "step-dot-pending"}`}>
                {isDone ? "✓" : n}
              </div>
              <span className="hidden sm:block">{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Error Banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ error }: { error: string }) {
  let msg = error;
  try {
    const m = error.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p?.error?.type === "overloaded_error") msg = "Claude is currently overloaded — please wait a moment and try again.";
      else if (p?.error?.message) msg = p.error.message;
    }
  } catch { /* keep original */ }
  const isOverload = msg.includes("overloaded");
  return (
    <div className={`card px-4 py-3.5 text-sm flex items-start gap-2.5 ${isOverload ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
      <span className="text-base mt-0.5 flex-shrink-0">{isOverload ? "⏳" : "⚠"}</span>
      <div><span className="font-semibold">{isOverload ? "API busy — " : "Error — "}</span>{msg}</div>
    </div>
  );
}

// ─── Annotated text helpers ────────────────────────────────────────────────────
// ─── Floating Selection Toolbar ───────────────────────────────────────────────
function FloatingToolbar({
  position,
  selectedText,
  claim,
  allSources,
  onRewritten,
  onClose,
}: {
  position: { top: number; left: number };
  selectedText: string;
  claim: Claim | null;
  allSources: FoundSource[];
  onRewritten: (text: string) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    if (!instruction.trim() || !claim) return;
    setRewriting(true);
    try {
      const matchedSource = allSources.find(s => {
        const key = s.citationKey.toLowerCase();
        const cit = (claim.citation ?? "").toLowerCase();
        return key === cit || cit.includes(key) || key.includes(cit.split(",")[0]);
      });
      const evidenceText = matchedSource?.text?.slice(0, 2000) ?? "";
      const res = await fetch("/api/rewrite-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: selectedText,
          citation: claim.citation,
          verdict: claim.verdict,
          why: claim.why,
          evidence: evidenceText,
          userInstruction: instruction,
        }),
      });
      const data = await res.json();
      if (data.rewritten) onRewritten(data.rewritten);
    } catch { /* ignore */ }
    finally { setRewriting(false); }
  };

  return (
    <div
      className="fixed z-50 rounded-xl border bg-white"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
        borderColor: "var(--border)",
        minWidth: 280,
        maxWidth: 360,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[9px] font-semibold text-[#9A9A98] uppercase tracking-wider">Edit selected text</p>
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onClose(); }}
            placeholder='e.g. "make more precise", "add hedging"...'
            className="flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] text-[#1A1A18] outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <button
            onClick={handleSubmit}
            disabled={rewriting || !instruction.trim()}
            className="rounded-lg bg-[#1A1A18] px-3 py-1.5 text-[10px] font-medium text-white hover:opacity-90 transition-all disabled:opacity-40"
          >
            {rewriting ? <Spinner size={10} color="white" /> : "Go"}
          </button>
        </div>
      </div>
    </div>
  );
}

type TextSegment = { type: "text"; content: string } | { type: "claim"; content: string; claim: Claim };

function buildTextSegments(text: string, claims: Claim[]): TextSegment[] {
  const matches: { start: number; end: number; claim: Claim }[] = [];
  for (const claim of claims) {
    const needle = claim.claim.slice(0, 80).toLowerCase();
    if (needle.length < 8) continue;
    const idx = text.toLowerCase().indexOf(needle);
    if (idx !== -1) {
      matches.push({ start: idx, end: Math.min(idx + claim.claim.length, text.length), claim });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const clean: typeof matches = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) { clean.push(m); cursor = m.end; }
  }
  const segs: TextSegment[] = [];
  let pos = 0;
  for (const m of clean) {
    if (m.start > pos) segs.push({ type: "text", content: text.slice(pos, m.start) });
    segs.push({ type: "claim", content: text.slice(m.start, m.end), claim: m.claim });
    pos = m.end;
  }
  if (pos < text.length) segs.push({ type: "text", content: text.slice(pos) });
  return segs;
}

// ─── Edit Source Modal ────────────────────────────────────────────────────────
function EditSourceModal({
  source, onSave, onClose,
}: {
  source: FoundSource;
  onSave: (title: string, year?: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(source.title);
  const [year, setYear] = useState(source.year?.toString() ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.25)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border shadow-2xl p-6 w-[420px] space-y-4"
        style={{ borderColor: "var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1A1A18]">Edit source</h3>
          <button onClick={onClose} className="text-[#BBBBB9] hover:text-[#5A5A58] text-2xl leading-none transition-colors">×</button>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9A9A98]">Citation key</p>
          <p className="text-sm text-[#5A5A58] font-mono bg-[#F7F7F5] px-3 py-2 rounded-lg">{source.citationKey}</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9A9A98]">Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-xl border px-3 py-2.5 text-sm text-[#1A1A18] outline-none transition-all"
            style={{ borderColor: "var(--border)" }}
            onFocus={e => (e.target.style.borderColor = "#A0A09E")}
            onBlur={e => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9A9A98]">
            Year <span className="normal-case font-normal text-[#C8C8C6]">(optional)</span>
          </label>
          <input
            type="number"
            value={year}
            onChange={e => setYear(e.target.value)}
            placeholder="e.g. 2021"
            className="w-full rounded-xl border px-3 py-2.5 text-sm text-[#1A1A18] outline-none transition-all"
            style={{ borderColor: "var(--border)" }}
            onFocus={e => (e.target.style.borderColor = "#A0A09E")}
            onBlur={e => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        <div className="flex gap-2.5 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border text-sm font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all"
            style={{ borderColor: "var(--border)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(title.trim() || source.title, year ? parseInt(year) : undefined)}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-all"
            style={{ background: "var(--text-primary)" }}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Google Picker types ───────────────────────────────────────────────────────
declare global {
  interface Window {
    gapi: { load: (api: string, cb: () => void) => void };
    google: {
      accounts: { oauth2: { initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void }) => { requestAccessToken: () => void } } };
      picker: {
        PickerBuilder: new () => {
          addView(v: unknown): ReturnType<typeof window.google.picker.PickerBuilder.prototype.addView>;
          setOAuthToken(t: string): ReturnType<typeof window.google.picker.PickerBuilder.prototype.setOAuthToken>;
          setDeveloperKey(k: string): ReturnType<typeof window.google.picker.PickerBuilder.prototype.setDeveloperKey>;
          setCallback(cb: (d: { action: string; docs?: Array<{ id: string; name: string }> }) => void): ReturnType<typeof window.google.picker.PickerBuilder.prototype.setCallback>;
          enableFeature(f: unknown): ReturnType<typeof window.google.picker.PickerBuilder.prototype.enableFeature>;
          build(): { setVisible: (v: boolean) => void };
        };
        View: new (id: unknown) => { setMimeTypes(t: string): ReturnType<typeof window.google.picker.View.prototype.setMimeTypes> };
        ViewId: { DOCS: unknown };
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: unknown };
      };
    };
  }
}

// ─── Landing Screen ───────────────────────────────────────────────────────────
function LandingScreen({ onUpload, onPaste }: { onUpload: () => void; onPaste: () => void }) {
  const cardResting = "0 2px 12px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)";
  const cardHover   = "0 24px 60px rgba(0,0,0,0.13), 0 8px 20px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)";

  const cardStyle: React.CSSProperties = {
    boxShadow: cardResting,
    padding: "44px 44px 52px",
    background: "rgba(255,255,255,0.84)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    transition: "transform 0.22s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.22s ease, background 0.22s ease",
    minHeight: 300,
  };

  const handleEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = "translateY(-8px) scale(1.018)";
    e.currentTarget.style.boxShadow = cardHover;
    e.currentTarget.style.background = "rgba(255,255,255,0.96)";
  };
  const handleLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = "translateY(0) scale(1)";
    e.currentTarget.style.boxShadow = cardResting;
    e.currentTarget.style.background = "rgba(255,255,255,0.82)";
  };

  return (
    <div
      className="relative min-h-screen flex flex-col overflow-hidden screen-enter"
      style={{ background: "#ECEAE4" }}
    >
      {/* Background: verdict-color radial glows — punchy but elegant */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: [
          "radial-gradient(ellipse 75% 60% at 3% 8%,  rgba(16,185,129,0.15) 0%, transparent 60%)",
          "radial-gradient(ellipse 70% 55% at 97% 95%, rgba(139,92,246,0.14) 0%, transparent 58%)",
          "radial-gradient(ellipse 60% 45% at 96% 5%,  rgba(245,158,11,0.11) 0%, transparent 55%)",
          "radial-gradient(ellipse 55% 45% at 3% 93%,  rgba(239,68,68,0.09) 0%, transparent 55%)",
          "radial-gradient(ellipse 90% 70% at 50% 50%, rgba(255,253,250,0.55) 0%, transparent 70%)",
        ].join(", "),
      }} />

      {/* Powered by Claude */}
      <div className="absolute top-5 right-8 z-10">
        <span className="text-xs text-[#9A9A98]">Powered by Claude</span>
      </div>

      {/* Hero — title near top */}
      <div className="relative text-center px-8 pt-[8vh] pb-0 z-10">
        <h1 className="font-bold tracking-tight text-[#1A1A18] leading-[1.08] mb-4"
          style={{ fontSize: "clamp(38px, 5vw, 58px)" }}>
          Academic Claim Verifier
        </h1>
        <p className="text-[17px] leading-relaxed" style={{ color: "#6A6A68" }}>
          Verify every claim in your paper against its cited source — automatically.
        </p>
      </div>

      {/* Cards — centered in remaining space */}
      <div className="relative flex-1 flex items-center justify-center px-10 pb-[4vh] z-10">
        <div className="grid grid-cols-2 w-full" style={{ maxWidth: 900, gap: 28 }}>

          {/* Upload document */}
          <button
            onClick={onUpload}
            className="text-left rounded-3xl"
            style={cardStyle}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            <div className="mb-7 rounded-2xl flex items-center justify-center"
              style={{ height: 68, width: 68, background: "rgba(16,185,129,0.12)", color: "#059669" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </div>
            <p className="text-[20px] font-bold text-[#1A1A18] mb-2.5 tracking-tight">Upload document</p>
            <p className="text-[14px] leading-relaxed" style={{ color: "#6A6A68" }}>
              Upload a PDF or Word doc — we'll extract the text and pre-fill your draft automatically.
            </p>
          </button>

          {/* Paste manually */}
          <button
            onClick={onPaste}
            className="text-left rounded-3xl"
            style={cardStyle}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            <div className="mb-7 rounded-2xl flex items-center justify-center"
              style={{ height: 68, width: 68, background: "rgba(139,92,246,0.11)", color: "#7C3AED" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </div>
            <p className="text-[20px] font-bold text-[#1A1A18] mb-2.5 tracking-tight">Paste manually</p>
            <p className="text-[14px] leading-relaxed" style={{ color: "#6A6A68" }}>
              Paste your draft text and reference list directly into the editor.
            </p>
          </button>

        </div>
      </div>
    </div>
  );
}

// ─── Upload Screen ─────────────────────────────────────────────────────────────
function isRefParagraph(p: string): boolean {
  const t = p.trim();
  if (t.length < 20) return false;
  // Numbered: "1. Author" or "[1] Author"
  if (/^(\[\d+\]|\d+\.\s)/.test(t)) return true;
  // Contains DOI or arXiv URL — very strong signal
  if (/https?:\/\/doi\.org\/|arxiv\.org|arXiv\s+preprint|doi:\s*10\./i.test(t)) return true;
  // APA surname pattern — allows hyphens AND a second capitalised word (e.g. "Ben-Zion" or "Hadar Shoval")
  // Surname = UpperLetter + (lower|upper|hyphen)+ with optional " UpperLetter(lower|upper|hyphen)+"
  const surnamePat = /^[A-ZÀ-Ü][A-Za-zÀ-ÿ\-]+(\s[A-ZÀ-Ü][A-Za-zÀ-ÿ\-]+)?,\s[A-Z]/;
  if (surnamePat.test(t) && /\(\d{4}\)/.test(t)) return true;
  return false;
}

function splitDraftAndReferences(text: string): { draft: string; references: string | null } {
  // 1. Try splitting at a reference section heading (unchanged — works perfectly)
  const headingPat = /\n[ \t]*(References|Bibliography|Works Cited|Literature Cited|Reference List)[ \t]*\n/i;
  const match = text.match(headingPat);
  if (match && match.index != null) {
    const draft = text.slice(0, match.index).trim();
    const refsBlock = text.slice(match.index + match[0].length).trim();
    if (draft.length > 100 && refsBlock.length > 30) {
      return { draft, references: refsBlock };
    }
  }

  // 2. No heading — find the first paragraph that looks like a ref, then confirm
  //    that the majority of what follows is also refs (prevents mid-body false splits)
  const paragraphs = text.split(/\n\s*\n/);
  for (let i = 1; i < paragraphs.length; i++) {
    if (!isRefParagraph(paragraphs[i])) continue;
    // Check: of the paragraphs from i onward, how many are refs?
    const tail = paragraphs.slice(i);
    const refCount = tail.filter(p => isRefParagraph(p)).length;
    if (refCount / tail.length >= 0.6) {
      const bodyPart = paragraphs.slice(0, i).join("\n\n").trim();
      if (bodyPart.length > 100) {
        return { draft: bodyPart, references: tail.join("\n\n").trim() };
      }
    }
  }

  return { draft: text, references: null };
}

function UploadScreen({
  onBack, onComplete, onPasteManually,
}: {
  onBack: () => void;
  onComplete: (draft: string, references: string | null) => void;
  onPasteManually: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isDocx = file.name.toLowerCase().endsWith(".docx");
    if (!isPdf && !isDocx) {
      setError("Please upload a PDF or Word (.docx) file."); return;
    }
    setUploading(true); setError(null); setUnreadable(false);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, name: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      const { draft, references } = splitDraftAndReferences(data.text);
      if (references === null) {
        setUnreadable(true);
        return;
      }
      onComplete(draft, references);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not extract text from this file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col screen-enter"
      style={{ background: "var(--background)" }}>
      {/* Powered by Claude */}
      <div className="absolute top-5 right-8 z-10">
        <span className="text-xs text-[#9A9A98]">Powered by Claude</span>
      </div>

      {/* Back */}
      <div className="absolute top-4 left-6 z-10">
        <button onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-all"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--border)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      {/* Full-height centered layout */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
        <div className="text-center mb-10">
          <h1 className="text-[36px] font-bold tracking-tight text-[#1A1A18] mb-2.5">Upload your paper</h1>
          <p className="text-[16px] text-[#9A9A98]">We'll extract the text and pre-fill your draft.</p>
        </div>

        {/* Drop zone — fills available width, tall */}
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          className="rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all select-none"
          style={{
            width: "100%",
            maxWidth: 680,
            height: 420,
            cursor: uploading ? "default" : "pointer",
            borderColor: dragging ? "#A0A09E" : "var(--border-strong)",
            background: dragging ? "#F0F0EE" : "var(--surface)",
            boxShadow: dragging ? "0 0 0 4px rgba(160,160,158,0.12)" : "var(--shadow-card)",
          }}
        >
          <input ref={inputRef} type="file" accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

          {uploading ? (
            <div className="flex flex-col items-center gap-4">
              <Spinner size={36} color="#9A9A98" />
              <p className="text-[16px] text-[#9A9A98]">Extracting text…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center px-10">
              <div className="h-20 w-20 rounded-2xl flex items-center justify-center mb-2"
                style={{ background: "rgba(16,185,129,0.08)", color: "#059669" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className="text-[18px] font-semibold text-[#1A1A18]">Drop your document here</p>
              <p className="text-[14px] text-[#9A9A98]">
                or <span className="text-[#5A5A58] underline underline-offset-2 font-medium">browse files</span>
              </p>
              <p className="text-[12px] text-[#C0C0BE] mt-1">PDF or Word (.docx)</p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-5 rounded-xl border px-4 py-3 text-[13px] text-[#B54040] max-w-[680px] w-full"
            style={{ borderColor: "#FECACA", background: "#FEF2F2" }}>
            {error}
          </div>
        )}

        {unreadable && (
          <div className="mt-5 rounded-xl border px-5 py-4 max-w-[680px] w-full"
            style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
            <p className="text-[14px] font-semibold text-[#92400E] mb-1">Couldn&apos;t read document structure</p>
            <p className="text-[13px] text-[#B45309] mb-3">
              The document text was extracted but we couldn&apos;t identify a clear draft and reference list. Please paste your text manually.
            </p>
            <button
              onClick={onPasteManually}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all"
              style={{ background: "#1A1A18", color: "white" }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
              Paste manually
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [screen, setScreen] = useState<"landing" | "upload" | "app">("landing");

  const [introText, setIntroText]   = useState("");
  const [references, setReferences] = useState("");

  const [findPhase, setFindPhase]         = useState<"idle"|"finding"|"done">("idle");
  const [findMsg, setFindMsg]             = useState("");
  const [foundSources, setFoundSources]   = useState<FoundSource[]>([]);
  const [missingSources, setMissingSources] = useState<MissingSource[]>([]);
  const [uploadedSources, setUploadedSources] = useState<FoundSource[]>([]);
  const [uploadingKeys, setUploadingKeys] = useState<Set<string>>(new Set());
  const [uploadErrors, setUploadErrors]   = useState<Record<string, string>>({});

  const [loading, setLoading]     = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [result, setResult]       = useState<VerificationResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Verdict | "ALL" | "ISSUES">("ALL");

  // Analysis pane interaction
  const [selectedClaimIdx, setSelectedClaimIdx] = useState<number | null>(null);
  const [hoveredClaimIdx, setHoveredClaimIdx]   = useState<number | null>(null);

  // Floating toolbar state
  const [floatingToolbar, setFloatingToolbar] = useState<{
    position: { top: number; left: number };
    selectedText: string;
    claim: Claim | null;
  } | null>(null);
  const [floatingRewriteResult, setFloatingRewriteResult] = useState<string | null>(null);

  // Sources screen UX
  const [openMenuKey, setOpenMenuKey]   = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<FoundSource | null>(null);

  const [driveLoading, setDriveLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [supabaseFiles, setSupabaseFiles] = useState<StoredFileMeta[]>([]);
  const [, startTransition] = useTransition();

  // Refs for two-pane scroll sync
  const leftPanelRef  = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const claimCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const claimMarkRefs = useRef<Record<number, HTMLElement | null>>({});

  // ── Session ID + Supabase restore on first load ─────────────────────────────
  useEffect(() => {
    let sid = localStorage.getItem("acv_session_id");
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem("acv_session_id", sid);
    }
    setSessionId(sid);

    fetch(`/api/storage/files?sessionId=${sid}`)
      .then(r => r.ok ? r.json() : [])
      .then((files: StoredFileMeta[]) => {
        if (Array.isArray(files) && files.length > 0) {
          setSupabaseFiles(files);
          setUploadedSources(files.map(f => ({
            citationKey: f.citationKey,
            title: f.title,
            year: typeof f.year === "number" ? f.year : undefined,
            accessLevel: "Full text",
            text: f.text,
            source: "uploaded" as const,
          })));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("acv_uploaded_sources", JSON.stringify(uploadedSources));
    } catch { /* ignore quota errors */ }
  }, [uploadedSources]);

  // Close three-dot menus on outside click
  useEffect(() => {
    if (!openMenuKey) return;
    const close = () => setOpenMenuKey(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuKey]);

  // Close floating toolbar on outside click
  useEffect(() => {
    if (!floatingToolbar) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".fixed.z-50")) return; // clicking inside toolbar
      setFloatingToolbar(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [floatingToolbar]);

  // ── handleFindSources ───────────────────────────────────────────────────────
  const handleFindSources = async () => {
    if (!introText.trim()) { setError("Please paste your introduction text."); return; }
    setFindPhase("finding"); setError(null);
    setFoundSources([]); setMissingSources([]); setUploadedSources([]); setResult(null);
    setActiveTab("ALL"); setSelectedClaimIdx(null); setHoveredClaimIdx(null);

    const msgs = ["Extracting citations…","Searching Semantic Scholar…","Downloading papers…","Extracting text…","Almost done…"];
    let mi = 0; setFindMsg(msgs[0]);
    const iv = setInterval(() => { mi = (mi + 1) % msgs.length; setFindMsg(msgs[mi]); }, 3000);

    try {
      const res = await fetch("/api/find-sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ introText, references }),
      });
      const data: FindSourcesResult & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to find sources");
      const found: FoundSource[] = data.found ?? [];
      const missing: MissingSource[] = data.missing ?? [];

      const autoMatched: FoundSource[] = [];
      const stillMissing: MissingSource[] = [];
      for (const m of missing) {
        const stored = supabaseFiles.find(f => f.citationKey === m.citationKey);
        if (stored && stored.text) {
          autoMatched.push({
            citationKey: m.citationKey, title: stored.title,
            year: typeof stored.year === "number" ? stored.year : undefined,
            accessLevel: "Full text",
            text: stored.text, source: "uploaded" as const,
          });
        } else {
          stillMissing.push(m);
        }
      }

      setFoundSources(found);
      setMissingSources(stillMissing);
      if (autoMatched.length > 0) setUploadedSources(p => [
        ...p.filter(u => !autoMatched.some(a => a.citationKey === u.citationKey)),
        ...autoMatched,
      ]);
      setFindPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setFindPhase("idle");
    } finally { clearInterval(iv); }
  };

  // ── handleMissingUpload ─────────────────────────────────────────────────────
  const handleMissingUpload = useCallback(async (file: File, citationKey: string) => {
    const base64: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

    setUploadingKeys(p => new Set([...p, citationKey]));
    setUploadErrors(p => { const n = {...p}; delete n[citationKey]; return n; });

    try {
      const res = await fetch("/api/extract-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, name: file.name }),
      });
      const data = await res.json();
      if (!res.ok) { setUploadErrors(p => ({...p, [citationKey]: data.error || "Extraction failed"})); return; }

      const original = missingSources.find(m => m.citationKey === citationKey);
      const newSource: FoundSource = {
        citationKey, title: original?.title ?? file.name.replace(/\.(pdf|docx)$/i, ""),
        year: original?.year, accessLevel: "Full text", text: data.text, source: "uploaded",
      };
      setUploadedSources(p => [...p.filter(s => s.citationKey !== citationKey), newSource]);
      setMissingSources(p => p.filter(m => m.citationKey !== citationKey));

      if (sessionId) {
        startTransition(() => {
          fetch("/api/storage/upload", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64, citationKey, title: newSource.title,
              year: newSource.year, text: data.text, sessionId,
            }),
          })
            .then(r => r.json())
            .then((meta: StoredFileMeta) => {
              if (meta.citationKey) {
                setSupabaseFiles(p => [...p.filter(f => f.citationKey !== citationKey), meta]);
              }
            })
            .catch(() => {});
        });
      }
    } finally {
      setUploadingKeys(p => { const n = new Set(p); n.delete(citationKey); return n; });
    }
  }, [missingSources, sessionId]);

  // ── Remove uploaded file (returns source to "needs upload" state) ───────────
  const handleRemoveUploadFile = useCallback((citationKey: string) => {
    const source = uploadedSources.find(s => s.citationKey === citationKey);
    if (!source) return;
    setUploadedSources(p => p.filter(s => s.citationKey !== citationKey));
    setMissingSources(p => [
      ...p,
      {
        citationKey: source.citationKey,
        title: source.title,
        year: source.year,
        reason: "Upload removed — drop a PDF to upload again",
        kind: "not_found" as const,
      },
    ]);
    // Intentionally NOT deleting from Supabase — file stays for future sessions
  }, [uploadedSources]);

  // ── Delete source entirely ──────────────────────────────────────────────────
  const handleDeleteSource = useCallback(async (citationKey: string) => {
    setUploadedSources(p => p.filter(s => s.citationKey !== citationKey));
    setFoundSources(p => p.filter(s => s.citationKey !== citationKey));
    setMissingSources(p => p.filter(m => m.citationKey !== citationKey));
    setSupabaseFiles(p => p.filter(f => f.citationKey !== citationKey));

    if (sessionId) {
      fetch("/api/storage/delete", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, citationKey }),
      }).catch(() => {});
    }

    try {
      const stored = JSON.parse(localStorage.getItem("acv_uploaded_sources") ?? "[]") as FoundSource[];
      localStorage.setItem("acv_uploaded_sources",
        JSON.stringify(stored.filter((s: FoundSource) => s.citationKey !== citationKey)));
    } catch {}
  }, [sessionId]);

  // ── Edit source ─────────────────────────────────────────────────────────────
  const handleSaveEdit = useCallback((title: string, year?: number) => {
    if (!editingSource) return;
    const citationKey = editingSource.citationKey;
    const update = (s: FoundSource) => s.citationKey === citationKey ? { ...s, title, year } : s;
    setUploadedSources(p => p.map(update));
    setFoundSources(p => p.map(update));
    setMissingSources(p => p.map(m => m.citationKey === citationKey ? { ...m, title, year } : m));
    setEditingSource(null);
  }, [editingSource]);

  // ── Analysis pane interaction handlers ─────────────────────────────────────
  const handleClaimNavClick = useCallback((claimIdx: number) => {
    setSelectedClaimIdx(prev => prev === claimIdx ? null : claimIdx);
    const mark = claimMarkRefs.current[claimIdx];
    const panel = rightPanelRef.current;
    if (mark && panel) {
      const panelRect = panel.getBoundingClientRect();
      const markRect = mark.getBoundingClientRect();
      const targetOffset = panelRect.height * 0.30;
      const markTopInPanel = markRect.top - panelRect.top + panel.scrollTop;
      panel.scrollTo({ top: Math.max(0, markTopInPanel - targetOffset), behavior: "smooth" });
    }
  }, []);

  const handleMarkClick = useCallback((claimIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!result) return;
    const claim = result.claims[claimIdx];
    setSelectedClaimIdx(claimIdx);
    // If filtered out, reset to ALL so the card becomes visible
    const isVisible = activeTab === "ALL" ||
      (activeTab === "ISSUES" && (claim.verdict === "PARTIAL" || claim.verdict === "OVERSTATED")) ||
      claim.verdict === activeTab;
    if (!isVisible) setActiveTab("ALL");
    // Scroll left panel so selected card appears near the top (~20px offset)
    setTimeout(() => {
      const card = claimCardRefs.current[claimIdx];
      const panel = leftPanelRef.current;
      if (card && panel) {
        const panelRect = panel.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const cardTopInPanel = cardRect.top - panelRect.top + panel.scrollTop;
        panel.scrollTo({ top: Math.max(0, cardTopInPanel - 20), behavior: "smooth" });
      }
    }, isVisible ? 0 : 50);
  }, [result, activeTab]);

  // ── handleVerify ────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    setLoading(true); setError(null); setResult(null);
    setActiveTab("ALL"); setSelectedClaimIdx(null); setHoveredClaimIdx(null);
    const msgs = ["Extracting claims…","Checking source texts…","Searching the web for missing sources…","Evaluating evidence…","Generating report…"];
    let mi = 0; setLoadingMsg(msgs[0]);
    const iv = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadingMsg(msgs[mi]); }, 4000);

    try {
      const sources = [
        ...foundSources.map(s => ({ citationKey: s.citationKey, title: s.title, text: s.text, accessLevel: s.accessLevel })),
        ...uploadedSources.map(s => ({ citationKey: s.citationKey, title: s.title, text: s.text, accessLevel: "Full text" })),
        ...missingSources.map(m => ({ citationKey: m.citationKey, title: m.title ?? m.citationKey,
            text: m.kind === "abstract_only" ? m.abstract : undefined,
            accessLevel: m.kind === "abstract_only" ? "Abstract only" : "Not found" })),
      ];
      const res = await fetch("/api/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ introText, references, sources }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      if (!data.claims) throw new Error(data.error || "Invalid response format");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { clearInterval(iv); setLoading(false); }
  };

  // ── handleExport ────────────────────────────────────────────────────────────
  const handleExport = async (format: "docx" | "pdf") => {
    if (!result) return;
    try {
      const res = await fetch(`/api/export/${format}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `claim-verification-report.${format}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed"); }
  };

  // ── Google Drive ────────────────────────────────────────────────────────────
  const handleGoogleDrive = useCallback(async () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const apiKey   = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!clientId || !apiKey) { setError("Google Drive credentials not configured in .env.local"); return; }
    setDriveLoading(true); setError(null);
    try {
      await new Promise<void>((resolve, reject) => {
        if (window.gapi) { resolve(); return; }
        const s = document.createElement("script"); s.src = "https://apis.google.com/js/api.js";
        s.onload = () => resolve(); s.onerror = () => reject(new Error("Failed to load Google API")); document.head.appendChild(s);
      });
      await new Promise<void>(r => window.gapi.load("picker", r));

      const accessToken = await new Promise<string>((resolve, reject) => {
        const init = () => {
          window.google.accounts.oauth2.initTokenClient({
            client_id: clientId, scope: "https://www.googleapis.com/auth/drive.readonly",
            callback: r => { if (r.error) reject(new Error(r.error)); else if (r.access_token) resolve(r.access_token); },
          }).requestAccessToken();
        };
        if (window.google?.accounts?.oauth2) { init(); } else {
          const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client";
          s.onload = init; s.onerror = () => reject(new Error("Failed to load GIS")); document.head.appendChild(s);
        }
      });

      const selections = await new Promise<Array<{ id: string; name: string }>>(resolve => {
        const view = new window.google.picker.View(window.google.picker.ViewId.DOCS);
        view.setMimeTypes("application/pdf");
        new window.google.picker.PickerBuilder()
          .addView(view).setOAuthToken(accessToken).setDeveloperKey(apiKey)
          .setCallback((d: { action: string; docs?: Array<{ id: string; name: string }> }) => {
            if (d.action === window.google.picker.Action.PICKED) resolve(d.docs ?? []);
            else if (d.action === window.google.picker.Action.CANCEL) resolve([]);
          })
          .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED).build().setVisible(true);
      });

      for (const sel of selections) {
        const res = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: sel.id, accessToken }) });
        const data = await res.json();
        if (data.base64 && data.name) {
          const key = missingSources.find(m => m.title && data.name.includes(m.title.slice(0, 15)))?.citationKey ?? sel.name;
          await handleMissingUpload(new File([Buffer.from(data.base64, "base64")], data.name, { type: "application/pdf" }), key);
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Google Drive error"); }
    finally { setDriveLoading(false); }
  }, [missingSources, handleMissingUpload]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const stats = result ? {
    total:        result.claims.length,
    supported:    result.claims.filter(c => c.verdict === "SUPPORTED").length,
    issues:       result.claims.filter(c => c.verdict === "PARTIAL" || c.verdict === "OVERSTATED").length,
    notSupported: result.claims.filter(c => c.verdict === "NOT_SUPPORTED").length,
    unverifiable: result.claims.filter(c => c.verdict === "UNVERIFIABLE").length,
  } : null;

  const filteredClaims = result
    ? (activeTab === "ALL"
        ? result.claims
        : activeTab === "ISSUES"
          ? result.claims.filter(c => c.verdict === "PARTIAL" || c.verdict === "OVERSTATED")
          : result.claims.filter(c => c.verdict === activeTab))
    : [];

  const totalSources    = foundSources.length + missingSources.length + uploadedSources.length;
  const resolvedSources = foundSources.length + uploadedSources.length;
  const currentStep: 1 | 2 | 3 = result ? 3 : findPhase === "done" ? 2 : 1;

  // ─────────────────────────────────────────────────────────────────────────────
  if (screen === "landing") {
    return (
      <LandingScreen
        onUpload={() => setScreen("upload")}
        onPaste={() => setScreen("app")}
      />
    );
  }

  if (screen === "upload") {
    return (
      <UploadScreen
        onBack={() => setScreen("landing")}
        onComplete={(draft, refs) => { setIntroText(draft); if (refs) setReferences(refs); setScreen("app"); }}
        onPasteManually={() => setScreen("app")}
      />
    );
  }

  if (screen === "app" && currentStep === 1) {
    return (
      <div className="relative min-h-screen flex flex-col screen-enter" style={{ background: "var(--background)" }}>
        {/* Powered by Claude */}
        <div className="absolute top-5 right-8 z-10">
          <span className="text-xs text-[#9A9A98]">Powered by Claude</span>
        </div>

        {/* Back button */}
        <div className="absolute top-4 left-6 z-10">
          <button
            onClick={() => setScreen("landing")}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-all"
            style={{ color: "var(--text-secondary)", background: "transparent" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--border)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>

        <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-10 pb-8" style={{ paddingTop: "80px" }}>
          <div className="mb-8">
            <h1 className="text-[36px] font-bold tracking-tight text-[#1A1A18] mb-2.5">
              Paste your draft
            </h1>
            <p className="text-[16px] text-[#9A9A98]">
              Paste your draft and reference list — we&apos;ll verify every claim against its cited source.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-5" style={{ flex: 1, minHeight: 0 }}>
            <InputCard
              label="Draft"
              value={introText}
              onChange={setIntroText}
              placeholder="Paste your academic introduction here, including inline citations…"
              disabled={findPhase === "finding"}
            />
            <InputCard
              label="Reference List"
              value={references}
              onChange={setReferences}
              placeholder={"1. Smith, J. et al. (2021). Full title. Journal, 12(3), 45–67.\n2. …"}
              disabled={findPhase === "finding"}
            />
          </div>

          <div className="mt-5 space-y-3">
            <button onClick={handleFindSources} disabled={findPhase === "finding" || !introText.trim()}
              className="btn-primary w-full h-14 rounded-xl text-[15px] font-semibold text-white flex items-center justify-center gap-2.5"
              style={{ background: "var(--text-primary)" }}>
              {findPhase === "finding"
                ? <><Spinner size={15} color="white" />{findMsg}</>
                : <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                    </svg>
                    Find Sources
                    <svg className="h-3.5 w-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </>}
            </button>
            {error && <ErrorBanner error={error} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b overflow-hidden flex-shrink-0"
        style={{ background: "rgba(247,247,245,0.92)", backdropFilter: "blur(14px)", borderColor: "var(--border)" }}>
        <div className="max-w-7xl mx-auto pr-10 h-14 flex items-center justify-between">
          <span className="text-[24px] font-semibold text-[#1A1A18] tracking-tight -ml-10">Claim Verifier</span>
          <StepIndicator current={currentStep} />
          <span className="text-xs text-[#9A9A98]">Powered by Claude</span>
        </div>
        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, #10B981 0%, #1A1A18 35%, #1A1A18 65%, #8B5CF6 100%)", opacity: 0.85 }} />
      </header>

      {/* ── Step 2: Sources ── */}
      {currentStep === 2 && (
        <main className="flex-1 max-w-7xl mx-auto w-full px-10 pt-5 pb-10 step-enter">
          {/* Step header */}
          <div className="flex items-end justify-between mb-5">
            <div>
              <button
                onClick={() => { setFindPhase("idle"); setFoundSources([]); setMissingSources([]); setUploadedSources([]); setResult(null); setError(null); }}
                className="inline-flex items-center gap-1 text-[13px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors mb-2">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Draft
              </button>
              <h1 className="text-[32px] font-bold tracking-tight text-[#1A1A18] mb-1.5">Sources</h1>
              <p className="text-[12px] text-[#9A9A98]">
                {resolvedSources} of {totalSources} retrieved
                {totalSources > 0 && <span> · {Math.round((resolvedSources / totalSources) * 100)}% full text</span>}
              </p>
            </div>
          </div>

          <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 320px" }}>
            {/* Sources list */}
            <div className="space-y-5 min-w-0">
              {resolvedSources > 0 && (
                <div className="space-y-2">
                  {[...foundSources, ...uploadedSources].map(s => (
                    <div key={s.citationKey} className="card px-6 py-5 flex items-center gap-4">
                      <div className="h-8 w-8 rounded-full bg-[#F0FDF4] border border-[#BBF7D0] flex items-center justify-center flex-shrink-0">
                        <span className="text-[#10B981] font-bold text-[12px]">✓</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold text-[#1A1A18]">{s.citationKey}</p>
                        <p className="text-[13px] text-[#9A9A98] leading-snug truncate mt-0.5">{s.title}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] font-medium rounded-full px-2.5 py-0.5"
                          style={{ background: "#F0FDF4", color: "#065F46", border: "1px solid #BBF7D0" }}>
                          {SOURCE_LABELS[s.source ?? ""] ?? s.source}
                        </span>
                        {/* Single ⋯ menu for all sources */}
                        <div className="relative" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setOpenMenuKey(openMenuKey === s.citationKey ? null : s.citationKey)}
                            title="More options"
                            className="h-6 w-6 rounded-md flex items-center justify-center transition-all"
                            style={{ color: "#C0C0BE" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#EBEBEA"; e.currentTarget.style.color = "#5A5A58"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C0C0BE"; }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                              <circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/>
                            </svg>
                          </button>
                          {openMenuKey === s.citationKey && (
                            <div
                              className="absolute right-0 top-full mt-1.5 bg-white rounded-xl overflow-hidden"
                              style={{
                                border: "1px solid var(--border)",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.06)",
                                minWidth: "176px",
                                zIndex: 30,
                              }}
                            >
                              <button
                                onClick={() => { setEditingSource(s); setOpenMenuKey(null); }}
                                className="w-full px-4 py-2.5 text-[13px] text-left text-[#3A3A38] hover:bg-[#F7F7F5] transition-colors">
                                Edit source
                              </button>
                              <div className="h-px mx-3" style={{ background: "var(--border)" }} />
                              <button
                                onClick={() => { handleDeleteSource(s.citationKey); setOpenMenuKey(null); }}
                                className="w-full px-4 py-2.5 text-[13px] text-left hover:bg-[#FEF5F5] transition-colors"
                                style={{ color: "#B54040" }}>
                                Delete source
                              </button>
                              {s.source === "uploaded" && (
                                <button
                                  onClick={() => { handleRemoveUploadFile(s.citationKey); setOpenMenuKey(null); }}
                                  className="w-full px-4 py-2.5 text-[13px] text-left text-[#3A3A38] hover:bg-[#F7F7F5] transition-colors">
                                  Remove uploaded file
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {missingSources.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9A9A98]">
                      Needs upload ({missingSources.length})
                    </p>
                    <button onClick={handleGoogleDrive} disabled={driveLoading}
                      className="inline-flex items-center gap-1.5 text-xs text-[#5A5A58] hover:text-[#1A1A18] transition-colors disabled:opacity-50">
                      {driveLoading ? <Spinner size={12} /> : (
                        /* Official Google Drive icon colors */
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                          <path d="M4.5 19L8.5 12H11.5L7.5 19H4.5Z" fill="#34A853"/>
                          <path d="M12 4.5L8.5 11H15.5L12 4.5Z" fill="#4285F4"/>
                          <path d="M15.5 12L19.5 19H12.5L15.5 12Z" fill="#FBBC04"/>
                          <path d="M7.5 19H16.5" stroke="#34A853" strokeWidth="0"/>
                        </svg>
                      )}
                      Google Drive
                    </button>
                  </div>
                  {missingSources.map(m => (
                    <MissingRow key={m.citationKey} source={m}
                      onUpload={f => handleMissingUpload(f, m.citationKey)}
                      uploadError={uploadErrors[m.citationKey]}
                      uploading={uploadingKeys.has(m.citationKey)}
                      openMenuKey={openMenuKey}
                      setOpenMenuKey={setOpenMenuKey}
                      onEdit={() => setEditingSource({ citationKey: m.citationKey, title: m.title ?? m.citationKey, year: m.year, accessLevel: "Not found" })}
                      onDelete={() => handleDeleteSource(m.citationKey)} />
                  ))}
                </div>
              )}

              {totalSources === 0 && (
                <p className="text-[15px] text-[#9A9A98] text-center py-20">No citations detected in your draft.</p>
              )}
            </div>

            {/* Right panel — summary + verify */}
            <div className="space-y-4">
              <div className="card p-6 space-y-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9A9A98]">Summary</p>
                <div className="space-y-3">
                  {[
                    { label: "Total citations", value: totalSources, color: "#1A1A18" },
                    { label: "Full text", value: resolvedSources, color: "#10B981" },
                    ...(missingSources.length > 0 ? [{ label: "Need upload", value: missingSources.length, color: "#F59E0B" }] : []),
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-[14px] text-[#5A5A58]">{row.label}</span>
                      <span className="text-[14px] font-bold tabular-nums" style={{ color: row.color }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="h-1.5 rounded-full bg-[#F0F0EE] overflow-hidden">
                  <div className="h-full rounded-full bg-[#10B981] transition-all duration-700"
                    style={{ width: totalSources > 0 ? `${(resolvedSources / totalSources) * 100}%` : "0%" }} />
                </div>
              </div>

              <button onClick={handleVerify} disabled={loading || totalSources === 0}
                className="btn-primary w-full h-14 rounded-xl text-[15px] font-semibold text-white flex items-center justify-center gap-2.5"
                style={{ background: "var(--text-primary)" }}>
                {loading
                  ? <><Spinner size={15} color="white" />{loadingMsg}</>
                  : <>
                      Verify all claims
                      <svg className="h-4 w-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </>}
              </button>
              {missingSources.length > 0 && !loading && (
                <p className="text-[12px] text-[#9A9A98] text-center leading-relaxed">
                  {missingSources.length} source{missingSources.length > 1 ? "s" : ""} will be searched via web
                </p>
              )}
              {error && <ErrorBanner error={error} />}
            </div>
          </div>
        </main>
      )}

      {/* ── Step 3: Analysis (two-pane) ── */}
      {currentStep === 3 && result && (
        <div className="step-enter flex flex-col" style={{ height: "calc(100vh - 57px)", overflow: "hidden" }}>

          {/* Analysis header bar */}
          <div className="flex items-center justify-between px-8 py-3.5 border-b flex-shrink-0"
            style={{ borderColor: "var(--border)", background: "var(--background)" }}>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setFindPhase("idle"); setFoundSources([]); setMissingSources([]);
                  setUploadedSources([]); setResult(null); setError(null);
                  setActiveTab("ALL"); setSelectedClaimIdx(null); setHoveredClaimIdx(null);
                }}
                className="inline-flex items-center gap-1 text-[14px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Start over
              </button>
              <div className="w-px h-4 bg-[#E0E0DE]" />
              <h1 className="text-[20px] font-semibold tracking-tight text-[#1A1A18]">Analysis</h1>
            </div>

            {/* Export buttons */}
            <div className="flex items-center gap-2">
              {/* Word export */}
              <button
                onClick={() => handleExport("docx")}
                className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--surface)" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="2" width="14" height="16" rx="2" fill="#185ABD" fillOpacity="0.15"/>
                  <path d="M3 6h14" stroke="#185ABD" strokeWidth="1.2" strokeOpacity="0.4"/>
                  <path d="M6 10l1.2 5L10 11l2.8 4L15 10" stroke="#185ABD" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Word
              </button>
              {/* PDF export */}
              <button
                onClick={() => handleExport("pdf")}
                className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--surface)" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="2" width="14" height="16" rx="2" fill="#DC2626" fillOpacity="0.12"/>
                  <path d="M3 6h14" stroke="#DC2626" strokeWidth="1.2" strokeOpacity="0.4"/>
                  <path d="M6.5 10h3c.8 0 1.5.7 1.5 1.5S10.3 13 9.5 13H6.5v-3zM13 10v3M11 11.5h2" stroke="#DC2626" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                PDF
              </button>
            </div>
          </div>

          {/* Two-pane layout */}
          <div className="flex flex-1 min-h-0">

            {/* ── Left panel: Claims navigation ── */}
            <div
              ref={leftPanelRef}
              className="flex-shrink-0 overflow-y-auto border-r flex flex-col panel-scroll panel-scroll-left"
              style={{ width: "28%", borderColor: "var(--border-strong)" }}
            >
              {/* Filter pills */}
              {stats && (() => {
                // Three-tier color system: same hues, different intensity
                // LOW  = inactive (muted tint of the verdict color)
                // STRONG = active (richer tint, saturated border, full text color)
                const filterItems = [
                  { key: "ALL" as const,           label: "All",          value: stats.total,        accent: "#6B7280", badgeBg: "#F3F4F6", badgeText: "#374151" },
                  { key: "SUPPORTED" as const,     label: "Supported",    value: stats.supported,    accent: VERDICT_CONFIG.SUPPORTED.accent,     badgeBg: VERDICT_CONFIG.SUPPORTED.badgeBg,     badgeText: VERDICT_CONFIG.SUPPORTED.badgeText },
                  { key: "ISSUES" as const,        label: "Issues",       value: stats.issues,       accent: VERDICT_CONFIG.PARTIAL.accent,       badgeBg: VERDICT_CONFIG.PARTIAL.badgeBg,       badgeText: VERDICT_CONFIG.PARTIAL.badgeText },
                  { key: "NOT_SUPPORTED" as const, label: "Not supported",value: stats.notSupported, accent: VERDICT_CONFIG.NOT_SUPPORTED.accent, badgeBg: VERDICT_CONFIG.NOT_SUPPORTED.badgeBg, badgeText: VERDICT_CONFIG.NOT_SUPPORTED.badgeText },
                  { key: "UNVERIFIABLE" as const,  label: "Unverifiable", value: stats.unverifiable, accent: VERDICT_CONFIG.UNVERIFIABLE.accent,  badgeBg: VERDICT_CONFIG.UNVERIFIABLE.badgeBg,  badgeText: VERDICT_CONFIG.UNVERIFIABLE.badgeText },
                ];
                return (
                  <div className="px-4 py-3 border-b flex flex-wrap gap-1.5 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
                    {filterItems.map(f => {
                      const active = activeTab === f.key;
                      return (
                        <button key={f.key} onClick={() => setActiveTab(f.key)}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all"
                          style={{
                            // STRONG (active): full badge color — clearly selected, still refined
                            // LOW (inactive): very subtle tint of same hue
                            background: active ? f.badgeBg : `${f.badgeBg}60`,
                            color: active ? f.badgeText : `${f.accent}70`,
                            border: active
                              ? `1.5px solid ${f.accent}AA`
                              : `1px solid ${f.accent}22`,
                          }}>
                          <span className="tabular-nums font-bold">{f.value}</span>
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Claim nav cards */}
              <div className="flex-1">
                {filteredClaims.length === 0 ? (
                  <p className="text-xs text-center py-10 text-[#9A9A98] px-4">No claims in this category.</p>
                ) : (
                  filteredClaims.map(claim => {
                    const globalIdx = result.claims.indexOf(claim);
                    return (
                      <ClaimNavCard
                        key={globalIdx}
                        claim={claim}
                        index={globalIdx}
                        isSelected={selectedClaimIdx === globalIdx}
                        isHovered={hoveredClaimIdx === globalIdx}
                        onSelect={() => handleClaimNavClick(globalIdx)}
                        onHover={() => setHoveredClaimIdx(globalIdx)}
                        onHoverEnd={() => setHoveredClaimIdx(null)}
                        cardRef={el => { claimCardRefs.current[globalIdx] = el; }}
                        allSources={[...foundSources, ...uploadedSources]}
                      />
                    );
                  })
                )}
              </div>

              {/* Overall Assessment — pinned at bottom of left panel */}
              {result.summary && (
                <div className="border-t p-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[#9A9A98] mb-2">Overall Assessment</p>
                  <p className="text-[12px] leading-relaxed text-[#3A3A38]">{result.summary}</p>
                </div>
              )}
            </div>

            {/* ── Right panel: Annotated text ── */}
            <div
              ref={rightPanelRef}
              className="flex-1 overflow-y-auto panel-scroll"
              style={{ padding: "28px 40px 40px" }}
              onMouseUp={() => {
                // Detect text selection for floating toolbar
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || !sel.toString().trim()) {
                  // Don't close toolbar if user clicks inside it
                  return;
                }
                const text = sel.toString().trim();
                if (text.length < 5) return;

                // Find which claim this selection belongs to
                const range = sel.getRangeAt(0);
                const markEl = range.startContainer.parentElement?.closest("mark");
                if (!markEl) return;

                // Find the claim from mark refs
                let matchedClaim: Claim | null = null;
                for (const [idx, el] of Object.entries(claimMarkRefs.current)) {
                  if (el === markEl) {
                    matchedClaim = result.claims[parseInt(idx)];
                    break;
                  }
                }
                if (!matchedClaim) return;

                const rect = range.getBoundingClientRect();
                setFloatingToolbar({
                  position: { top: rect.bottom + 8, left: rect.left + rect.width / 2 },
                  selectedText: text,
                  claim: matchedClaim,
                });
                setFloatingRewriteResult(null);
              }}
            >
              {/* Floating toolbar */}
              {floatingToolbar && (
                <FloatingToolbar
                  position={floatingToolbar.position}
                  selectedText={floatingToolbar.selectedText}
                  claim={floatingToolbar.claim}
                  allSources={[...foundSources, ...uploadedSources]}
                  onRewritten={(text) => {
                    setFloatingRewriteResult(text);
                    setFloatingToolbar(null);
                  }}
                  onClose={() => { setFloatingToolbar(null); setFloatingRewriteResult(null); }}
                />
              )}

              {/* Inline rewrite result banner */}
              {floatingRewriteResult && (
                <div className="mb-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-[#065F46] uppercase tracking-wider">Suggested rewrite</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { navigator.clipboard.writeText(floatingRewriteResult); }}
                        className="text-[10px] font-medium text-[#065F46] hover:text-[#047857] transition-colors"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => setFloatingRewriteResult(null)}
                        className="text-[10px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] text-[#14532D] leading-relaxed">{floatingRewriteResult}</p>
                </div>
              )}

              {/* Annotated text */}
              <div className="card p-8 cursor-default">
                <p className="text-[15px] text-[#2A2A28] leading-[2] whitespace-pre-wrap">
                  {buildTextSegments(introText, result.claims).map((seg, i) => {
                    if (seg.type === "text") return <span key={i}>{seg.content}</span>;
                    const globalIdx = result.claims.indexOf(seg.claim);
                    const cfg = VERDICT_CONFIG[seg.claim.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE;
                    const isSelected = selectedClaimIdx === globalIdx;
                    const isHovered = hoveredClaimIdx === globalIdx;
                    return (
                      <mark
                        key={i}
                        ref={el => { if (el) claimMarkRefs.current[globalIdx] = el; }}
                        onClick={e => handleMarkClick(globalIdx, e)}
                        onMouseEnter={() => setHoveredClaimIdx(globalIdx)}
                        onMouseLeave={() => setHoveredClaimIdx(null)}
                        style={{
                          background: isSelected
                            ? cfg.badgeBg
                            : isHovered
                              ? `${cfg.badgeBg}F0`
                              : `${cfg.badgeBg}BB`,
                          color: "inherit",
                          borderBottom: `${isSelected ? 3 : 2}px solid ${isSelected ? cfg.accent : isHovered ? `${cfg.accent}DD` : `${cfg.accent}AA`}`,
                          borderRadius: "2px",
                          padding: "1px 2px",
                          cursor: "pointer",
                          transition: "background 0.15s, border-color 0.15s",
                          outline: isSelected ? `2px solid ${cfg.accent}44` : undefined,
                          outlineOffset: "1px",
                        }}
                        title={cfg.label}
                      >
                        {seg.content}
                      </mark>
                    );
                  })}
                </p>
              </div>

              {error && <div className="mt-4"><ErrorBanner error={error} /></div>}
            </div>
          </div>
        </div>
      )}

      {/* Edit Source Modal */}
      {editingSource && (
        <EditSourceModal
          source={editingSource}
          onSave={handleSaveEdit}
          onClose={() => setEditingSource(null)}
        />
      )}
    </div>
  );
}
