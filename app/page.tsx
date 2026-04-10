"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  Claim, VerificationResult, Verdict,
  FoundSource, MissingSource, FindSourcesResult,
} from "@/lib/types";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const VERDICT_CONFIG: Record<Verdict, {
  icon: string; label: string;
  accent: string;        // left-border color
  badgeBg: string;       // badge background
  badgeText: string;     // badge text color
  badgeBorder: string;   // badge border
}> = {
  SUPPORTED:    { icon: "✓",  label: "Supported",     accent: "#10B981", badgeBg: "#F0FDF4", badgeText: "#065F46", badgeBorder: "#BBF7D0" },
  PARTIAL:      { icon: "≈",  label: "Partial",        accent: "#F59E0B", badgeBg: "#FFFBEB", badgeText: "#78350F", badgeBorder: "#FDE68A" },
  OVERSTATED:   { icon: "↑",  label: "Overstated",     accent: "#F97316", badgeBg: "#FFF7ED", badgeText: "#7C2D12", badgeBorder: "#FED7AA" },
  NOT_SUPPORTED:{ icon: "✕",  label: "Not Supported",  accent: "#EF4444", badgeBg: "#FEF2F2", badgeText: "#7F1D1D", badgeBorder: "#FECACA" },
  UNVERIFIABLE: { icon: "?",  label: "Unverifiable",   accent: "#9CA3AF", badgeBg: "#F9FAFB", badgeText: "#374151", badgeBorder: "#E5E7EB" },
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
    <span style={{ background: config.badgeBg, color: config.badgeText, borderColor: config.badgeBorder }}
      className="inline-flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs font-semibold tracking-wide">
      <span className="font-bold">{config.icon}</span>
      {config.label}
    </span>
  );
}

// ─── Claim Card ────────────────────────────────────────────────────────────────
function ClaimCard({ claim, index }: { claim: Claim; index: number }) {
  const cfg = VERDICT_CONFIG[claim.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE;
  const [rewriting, setRewriting] = useState(false);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const showActions = claim.verdict === "NOT_SUPPORTED" || claim.verdict === "OVERSTATED" || claim.verdict === "PARTIAL";
  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(claim.claim)}`;

  const handleRewrite = async () => {
    setRewriting(true);
    setRewritten(null);
    try {
      const res = await fetch("/api/rewrite-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.claim, citation: claim.citation, verdict: claim.verdict, why: claim.why }),
      });
      const data = await res.json();
      setRewritten(data.rewritten || "Could not generate a rewrite.");
    } catch {
      setRewritten("Error generating rewrite.");
    } finally {
      setRewriting(false);
    }
  };

  const handleCopy = () => {
    if (rewritten) {
      navigator.clipboard.writeText(rewritten);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="card fade-in overflow-hidden" style={{ borderLeft: `3px solid ${cfg.accent}` }}>
      <div className="p-5 space-y-3.5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <Badge config={cfg} />
          <span className="text-xs text-[#9A9A98] font-mono mt-0.5 flex-shrink-0">#{index + 1}</span>
        </div>

        {/* Claim text */}
        <p className="text-sm text-[#2A2A28] italic leading-relaxed">
          &ldquo;{claim.claim}&rdquo;
        </p>

        {/* Meta */}
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span className="text-xs text-[#9A9A98]">
            <span className="font-medium text-[#5A5A58]">Citation</span>{" "}
            {claim.citation}
          </span>
          <span className="text-xs text-[#9A9A98]">
            <span className="font-medium text-[#5A5A58]">Source</span>{" "}
            {claim.source_accessed}
          </span>
        </div>

        {/* Assessment */}
        <p className="text-sm text-[#4A4A48] leading-relaxed">
          {claim.why}
        </p>

        {/* Suggested fix (from verify route) */}
        {claim.fix && claim.fix !== "none needed" && !rewritten && (
          <div className="rounded-xl bg-[#F0F7FF] border border-[#BFDBFE] px-4 py-3">
            <p className="text-[10px] font-semibold text-[#1D4ED8] uppercase tracking-wider mb-1">Suggested fix</p>
            <p className="text-sm text-[#1E3A5F] leading-relaxed">{claim.fix}</p>
          </div>
        )}

        {/* Action buttons */}
        {showActions && (
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={handleRewrite}
              disabled={rewriting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEBEA] bg-white px-3 py-1.5 text-xs font-medium text-[#5A5A58] hover:bg-[#F7F7F5] hover:border-[#D8D8D6] transition-all disabled:opacity-50"
            >
              {rewriting ? <><Spinner size={12} /> Rewriting…</> : <>✏ Rewrite claim</>}
            </button>
            <a
              href={scholarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#EBEBEA] bg-white px-3 py-1.5 text-xs font-medium text-[#5A5A58] hover:bg-[#F7F7F5] hover:border-[#D8D8D6] transition-all"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Find better source
            </a>
          </div>
        )}

        {/* Rewrite result */}
        {rewritten && (
          <div className="slide-down rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-[#065F46] uppercase tracking-wider">Rewritten version</p>
              <button
                onClick={handleCopy}
                className="text-[10px] font-medium text-[#065F46] hover:text-[#047857] transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-sm text-[#14532D] leading-relaxed">{rewritten}</p>
            <button onClick={() => setRewritten(null)} className="text-[10px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors">
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Missing paper row ─────────────────────────────────────────────────────────
function MissingRow({ source, onUpload, uploadError, uploading }: {
  source: MissingSource;
  onUpload: (file: File) => void;
  uploadError?: string;
  uploading?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onUpload(f);
  };

  return (
    <div className="card px-4 py-3.5 space-y-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-sm flex-shrink-0" style={{ color: source.kind === "abstract_only" ? "#F59E0B" : "#EF4444" }}>
          {source.kind === "abstract_only" ? "≈" : "✕"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1A1A18] truncate">{source.citationKey}</p>
          {source.title && <p className="text-xs text-[#9A9A98] truncate mt-0.5">{source.title}</p>}
          <p className="text-xs text-[#B45309] mt-1">{source.reason}</p>
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
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
        {uploading
          ? <span className="inline-flex items-center gap-2 text-[#9A9A98]"><Spinner size={12} /> Extracting text…</span>
          : <span className="text-[#9A9A98]">Drop PDF or <span className="text-[#5A5A58] font-medium underline underline-offset-2">browse</span></span>
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
            <div className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
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
    const m = error.match(/\{.*\}/s);
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

// ─── Annotated Text ────────────────────────────────────────────────────────────
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

function ClaimInlinePopup({ claim, style, onClose }: {
  claim: Claim;
  style: React.CSSProperties;
  onClose: () => void;
}) {
  const cfg = VERDICT_CONFIG[claim.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE;
  const [rewriting, setRewriting] = useState(false);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(claim.claim)}`;
  const showActions = claim.verdict === "NOT_SUPPORTED" || claim.verdict === "OVERSTATED" || claim.verdict === "PARTIAL";

  const handleRewrite = async () => {
    setRewriting(true); setRewritten(null);
    try {
      const res = await fetch("/api/rewrite-claim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.claim, citation: claim.citation, verdict: claim.verdict, why: claim.why }),
      });
      const data = await res.json();
      setRewritten(data.rewritten || "Could not generate a rewrite.");
    } catch { setRewritten("Error generating rewrite."); }
    finally { setRewriting(false); }
  };

  return (
    <div
      style={{ ...style, maxHeight: "70vh", overflowY: "auto" }}
      className="bg-white rounded-2xl border shadow-2xl p-4 space-y-3 text-left"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <Badge config={cfg} />
        <button onClick={onClose} className="text-[#BBBBB9] hover:text-[#5A5A58] text-xl leading-none transition-colors flex-shrink-0">×</button>
      </div>

      {/* Claim snippet */}
      <p className="text-xs text-[#9A9A98] italic leading-relaxed line-clamp-2">&ldquo;{claim.claim}&rdquo;</p>

      {/* Why */}
      <p className="text-sm text-[#4A4A48] leading-relaxed">{claim.why}</p>

      {/* Referenced source */}
      {claim.citation && claim.citation !== "No citation" && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Referenced source</p>
          <div className="rounded-xl border border-[#EBEBEA] px-3 py-2.5 bg-[#FAFAF9] space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-[#9A9A98] uppercase tracking-wide">Article</span>
              <span className="text-[10px] font-medium" style={{ background: "#F0FDF4", color: "#065F46", border: "1px solid #BBF7D0", borderRadius: 999, padding: "1px 7px" }}>
                {SOURCE_LABELS[claim.source_accessed ?? ""] ?? claim.source_accessed ?? "Unknown"}
              </span>
            </div>
            <p className="text-xs font-medium text-[#1A1A18] leading-snug">{claim.citation}</p>
          </div>
        </div>
      )}

      {/* Suggested fix */}
      {claim.fix && claim.fix !== "none needed" && !rewritten && (
        <div className="rounded-xl bg-[#F0F7FF] border border-[#BFDBFE] px-3 py-2.5">
          <p className="text-[10px] font-semibold text-[#1D4ED8] uppercase tracking-wider mb-1">Suggested fix</p>
          <p className="text-xs text-[#1E3A5F] leading-relaxed">{claim.fix}</p>
        </div>
      )}

      {/* Rewrite result */}
      {rewritten && (
        <div className="rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-[#065F46] uppercase tracking-wider">Rewritten</p>
            <button onClick={() => { navigator.clipboard.writeText(rewritten); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="text-[10px] font-medium text-[#065F46] hover:text-[#047857] transition-colors">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-[#14532D] leading-relaxed">{rewritten}</p>
          <button onClick={() => setRewritten(null)} className="text-[10px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors">Dismiss</button>
        </div>
      )}

      {/* Actions */}
      {showActions && !rewritten && (
        <div className="flex items-center gap-2 pt-0.5">
          <button onClick={handleRewrite} disabled={rewriting}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#EBEBEA] bg-white px-3 py-2 text-xs font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all disabled:opacity-50">
            {rewriting ? <><Spinner size={11} /> Rewriting…</> : <>✏ Rewrite</>}
          </button>
          <a href={scholarUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#EBEBEA] bg-white px-3 py-2 text-xs font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Find source
          </a>
        </div>
      )}
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

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Home() {
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
  const [viewMode, setViewMode] = useState<"cards" | "annotated">("cards");
  const [popupClaim, setPopupClaim] = useState<Claim | null>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const [driveLoading, setDriveLoading] = useState(false);

  // ── handleFindSources ───────────────────────────────────────────────────────
  const handleFindSources = async () => {
    if (!introText.trim()) { setError("Please paste your introduction text."); return; }
    setFindPhase("finding"); setError(null);
    setFoundSources([]); setMissingSources([]); setUploadedSources([]); setResult(null); setActiveTab("ALL"); setViewMode("cards"); setPopupClaim(null);

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
      setFoundSources(data.found ?? []);
      setMissingSources(data.missing ?? []);
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
      setUploadedSources(p => [...p.filter(s => s.citationKey !== citationKey), {
        citationKey, title: original?.title ?? file.name.replace(/\.pdf$/i, ""),
        year: original?.year, accessLevel: "Full text", text: data.text, source: "uploaded",
      }]);
      setMissingSources(p => p.filter(m => m.citationKey !== citationKey));
    } finally {
      setUploadingKeys(p => { const n = new Set(p); n.delete(citationKey); return n; });
    }
  }, [missingSources]);

  // ── handleVerify ────────────────────────────────────────────────────────────
  const handleClaimClick = useCallback((claim: Claim, e: React.MouseEvent) => {
    e.stopPropagation();
    if (popupClaim?.claim === claim.claim) { setPopupClaim(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = 340;
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - w - 16));
    const top = rect.bottom + 8;
    setPopupStyle({ position: "fixed", top, left, width: w, zIndex: 50 });
    setPopupClaim(claim);
  }, [popupClaim]);

  useEffect(() => {
    if (!popupClaim) return;
    const close = () => setPopupClaim(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [popupClaim]);

  const handleVerify = async () => {
    setLoading(true); setError(null); setResult(null); setActiveTab("ALL"); setViewMode("cards"); setPopupClaim(null);
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
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b overflow-hidden flex-shrink-0"
        style={{ background: "rgba(247,247,245,0.92)", backdropFilter: "blur(14px)", borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-8 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[#1A1A18] flex items-center justify-center flex-shrink-0">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-[#1A1A18]">Claim Verifier</span>
          </div>
          {/* Step indicator */}
          <StepIndicator current={currentStep} />
          <span className="text-xs text-[#9A9A98]">Powered by Claude</span>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 transition-all duration-700 ease-out"
          style={{ width: `${(currentStep / 3) * 100}%`, background: "#1A1A18" }} />
      </header>

      {/* ── Step 1: Draft + References ── */}
      {currentStep === 1 && (
        <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-8 pt-10 pb-8 step-enter">
          {/* Hero */}
          <div className="mb-6">
            <h1 className="text-[26px] font-semibold tracking-tight text-[#1A1A18] mb-1.5">
              Verify your academic claims
            </h1>
            <p className="text-sm text-[#9A9A98]">
              Paste your draft and reference list — we'll verify every claim against its cited source.
            </p>
          </div>

          {/* Two-column inputs — grow to fill available height */}
          <div className="grid grid-cols-2 gap-4" style={{ flex: 1, minHeight: 0 }}>
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

          {/* Button + error */}
          <div className="mt-5 space-y-3">
            <button onClick={handleFindSources} disabled={findPhase === "finding" || !introText.trim()}
              className="btn-primary w-full h-12 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2.5"
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
        </main>
      )}

      {/* ── Step 2: Sources ── */}
      {currentStep === 2 && (
        <main className="flex-1 max-w-5xl mx-auto w-full px-8 py-10 step-enter">
          {/* Step header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight text-[#1A1A18] mb-1">Sources</h1>
              <p className="text-sm text-[#9A9A98]">
                {resolvedSources} of {totalSources} retrieved
                {totalSources > 0 && ` · ${Math.round((resolvedSources / totalSources) * 100)}% full text`}
              </p>
            </div>
            <button onClick={() => { setFindPhase("idle"); setFoundSources([]); setMissingSources([]); setUploadedSources([]); setResult(null); setError(null); }}
              className="text-xs text-[#9A9A98] hover:text-[#5A5A58] transition-colors mt-2">
              ← Back to Draft
            </button>
          </div>

          <div className="grid gap-8" style={{ gridTemplateColumns: "1fr 280px" }}>
            {/* Sources list */}
            <div className="space-y-5 min-w-0">
              {resolvedSources > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9A9A98] px-1">Retrieved</p>
                  {[...foundSources, ...uploadedSources].map(s => (
                    <div key={s.citationKey} className="card px-5 py-4 flex items-start gap-3">
                      <span className="text-[#10B981] font-bold text-sm mt-0.5 flex-shrink-0">✓</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate text-[#1A1A18]">{s.citationKey}</p>
                        <p className="text-xs truncate mt-0.5 text-[#9A9A98]">{s.title}</p>
                      </div>
                      <span className="text-[10px] font-medium rounded-full px-2.5 py-1 flex-shrink-0"
                        style={{ background: "#F0FDF4", color: "#065F46", border: "1px solid #BBF7D0" }}>
                        {SOURCE_LABELS[s.source ?? ""] ?? s.source}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {missingSources.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9A9A98]">
                      Needs upload ({missingSources.length})
                    </p>
                    <button onClick={handleGoogleDrive} disabled={driveLoading}
                      className="inline-flex items-center gap-1.5 text-xs text-[#5A5A58] hover:text-[#1A1A18] transition-colors disabled:opacity-50">
                      {driveLoading ? <Spinner size={12} /> : (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                          <path d="M4.5 18L8 12l3.5 6H4.5z" fill="#34A853"/>
                          <path d="M12 6L8 12H16l-4-6z" fill="#4285F4"/>
                          <path d="M16 12l3.5 6H8.5L12 12h4z" fill="#EA4335"/>
                        </svg>
                      )}
                      Google Drive
                    </button>
                  </div>
                  {missingSources.map(m => (
                    <MissingRow key={m.citationKey} source={m}
                      onUpload={f => handleMissingUpload(f, m.citationKey)}
                      uploadError={uploadErrors[m.citationKey]}
                      uploading={uploadingKeys.has(m.citationKey)} />
                  ))}
                </div>
              )}
              {totalSources === 0 && (
                <p className="text-sm text-[#9A9A98] text-center py-16">No citations detected in your draft.</p>
              )}
            </div>

            {/* Right panel */}
            <div className="space-y-4">
              <div className="card p-5 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9A9A98]">Summary</p>
                <div className="space-y-2.5">
                  {[
                    { label: "Total citations", value: totalSources, color: "#1A1A18" },
                    { label: "Full text", value: resolvedSources, color: "#10B981" },
                    ...(missingSources.length > 0 ? [{ label: "Need upload", value: missingSources.length, color: "#F59E0B" }] : []),
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-sm text-[#5A5A58]">{row.label}</span>
                      <span className="text-sm font-semibold" style={{ color: row.color }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="h-1.5 rounded-full bg-[#F0F0EE] overflow-hidden">
                  <div className="h-full rounded-full bg-[#10B981] transition-all duration-700"
                    style={{ width: totalSources > 0 ? `${(resolvedSources / totalSources) * 100}%` : "0%" }} />
                </div>
              </div>

              <button onClick={handleVerify} disabled={loading || totalSources === 0}
                className="btn-primary w-full h-12 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2.5"
                style={{ background: "var(--text-primary)" }}>
                {loading
                  ? <><Spinner size={15} color="white" />{loadingMsg}</>
                  : <>
                      Verify all claims
                      <svg className="h-3.5 w-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </>}
              </button>
              {missingSources.length > 0 && !loading && (
                <p className="text-[11px] text-[#9A9A98] text-center leading-relaxed">
                  {missingSources.length} source{missingSources.length > 1 ? "s" : ""} will be searched via web
                </p>
              )}
              {error && <ErrorBanner error={error} />}
            </div>
          </div>
        </main>
      )}

      {/* ── Step 3: Results ── */}
      {currentStep === 3 && result && (
        <main className="flex-1 max-w-5xl mx-auto w-full px-8 py-10 step-enter">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <h1 className="text-[26px] font-semibold tracking-tight text-[#1A1A18]">Analysis</h1>
              <button
                onClick={() => { setFindPhase("idle"); setFoundSources([]); setMissingSources([]); setUploadedSources([]); setResult(null); setError(null); setActiveTab("ALL"); setViewMode("cards"); setPopupClaim(null); }}
                className="text-xs text-[#9A9A98] hover:text-[#5A5A58] transition-colors">
                ← Start over
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                {(["cards", "annotated"] as const).map(mode => (
                  <button key={mode} onClick={() => { setViewMode(mode); setPopupClaim(null); }}
                    className="px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5"
                    style={{
                      background: viewMode === mode ? "var(--text-primary)" : "var(--surface)",
                      color: viewMode === mode ? "white" : "var(--text-secondary)",
                      borderRight: mode === "cards" ? `1px solid var(--border)` : undefined,
                    }}>
                    {mode === "cards"
                      ? <><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>Cards</>
                      : <><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>Annotated</>
                    }
                  </button>
                ))}
              </div>
              {(["docx","pdf"] as const).map(fmt => (
                <button key={fmt} onClick={() => handleExport(fmt)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--surface)" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  {fmt === "docx" ? "Word" : "PDF"}
                </button>
              ))}
            </div>
          </div>

          {/* Stat-filter cards */}
          {stats && (() => {
            const cards: { key: Verdict | "ALL" | "ISSUES"; label: string; value: number; color: string; activeBg: string; activeBorder: string }[] = [
              { key: "ALL",          label: "Total",         value: stats.total,        color: "var(--text-primary)", activeBg: "#F7F7F5", activeBorder: "var(--text-primary)" },
              { key: "SUPPORTED",    label: "Supported",     value: stats.supported,    color: "#10B981",             activeBg: "#F0FDF4", activeBorder: "#10B981" },
              { key: "ISSUES",       label: "Issues",        value: stats.issues,       color: "#F59E0B",             activeBg: "#FFFBEB", activeBorder: "#F59E0B" },
              { key: "NOT_SUPPORTED",label: "Not Supported", value: stats.notSupported, color: "#EF4444",             activeBg: "#FEF2F2", activeBorder: "#EF4444" },
              { key: "UNVERIFIABLE", label: "Unverifiable",  value: stats.unverifiable, color: "#9CA3AF",             activeBg: "#F9FAFB", activeBorder: "#9CA3AF" },
            ];
            return (
              <div className="grid grid-cols-5 gap-3 mb-6">
                {cards.map(c => {
                  const active = activeTab === c.key;
                  return (
                    <button key={c.key} onClick={() => setActiveTab(c.key)}
                      className="card px-3 py-4 text-center transition-all focus:outline-none"
                      style={{
                        background: active ? c.activeBg : "var(--surface)",
                        borderColor: active ? c.activeBorder : "var(--border)",
                        borderWidth: active ? "1.5px" : "1px",
                        transform: active ? "translateY(-1px)" : "none",
                        boxShadow: active ? `0 4px 12px ${c.color}22` : undefined,
                      }}>
                      <div className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</div>
                      <div className="text-[10px] font-medium mt-1 uppercase tracking-wide" style={{ color: active ? c.color : "var(--text-tertiary)" }}>{c.label}</div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Cards view */}
          {viewMode === "cards" && (
            <div className="space-y-3">
              {filteredClaims.length === 0
                ? <p className="text-sm text-center py-10 text-[#9A9A98]">No claims in this category.</p>
                : filteredClaims.map((claim, i) => (
                    <ClaimCard key={i} claim={claim} index={result.claims.indexOf(claim)} />
                  ))
              }
            </div>
          )}

          {/* Annotated text view */}
          {viewMode === "annotated" && (
            <div className="space-y-4">
              <p className="text-[11px] px-1 text-[#9A9A98]">Click any highlighted phrase to see details.</p>
              <div className="card p-6 cursor-default" onClick={() => setPopupClaim(null)}>
                <p className="text-sm text-[#2A2A28] leading-[1.9] whitespace-pre-wrap">
                  {buildTextSegments(introText, result.claims).map((seg, i) => {
                    if (seg.type === "text") return <span key={i}>{seg.content}</span>;
                    const cfg = VERDICT_CONFIG[seg.claim.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE;
                    const isActive = popupClaim?.claim === seg.claim.claim;
                    return (
                      <mark key={i} onClick={e => handleClaimClick(seg.claim, e)}
                        style={{ background: isActive ? cfg.badgeBg : `${cfg.badgeBg}99`, color: "inherit",
                          borderBottom: `2px solid ${cfg.accent}`, borderRadius: "2px", padding: "0 1px",
                          cursor: "pointer", transition: "background 0.15s" }}
                        title={cfg.label}>
                        {seg.content}
                      </mark>
                    );
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 px-1">
                {(Object.entries(VERDICT_CONFIG) as [Verdict, typeof VERDICT_CONFIG[Verdict]][]).map(([verdict, cfg]) => (
                  <span key={verdict} className="flex items-center gap-1.5 text-[11px] text-[#9A9A98]">
                    <span style={{ display: "inline-block", width: 10, height: 10, background: cfg.badgeBg, border: `2px solid ${cfg.accent}`, borderRadius: 2 }} />
                    {cfg.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Popup */}
          {popupClaim && viewMode === "annotated" && (
            <ClaimInlinePopup claim={popupClaim} style={popupStyle} onClose={() => setPopupClaim(null)} />
          )}

          {/* Summary */}
          <div className="card p-5 space-y-2 mt-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#9A9A98]">Overall Assessment</p>
            <p className="text-sm leading-relaxed text-[#5A5A58]">{result.summary}</p>
          </div>
          {error && <div className="mt-4"><ErrorBanner error={error} /></div>}
        </main>
      )}
    </div>
  );
}
