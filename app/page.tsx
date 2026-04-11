"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import type { StoredFileMeta } from "@/app/api/storage/upload/route";
import type {
  Claim, VerificationResult, Verdict,
  FoundSource, MissingSource, FindSourcesResult,
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
}: {
  claim: Claim; index: number;
  isSelected: boolean; isHovered: boolean;
  onSelect: () => void; onHover: () => void; onHoverEnd: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const cfg = VERDICT_CONFIG[claim.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE;
  const [rewriting, setRewriting] = useState(false);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const showActions = ["NOT_SUPPORTED", "OVERSTATED", "PARTIAL", "WRONG_SOURCE"].includes(claim.verdict);
  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(claim.claim)}`;

  const handleRewrite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRewriting(true); setRewritten(null);
    try {
      const res = await fetch("/api/rewrite-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.claim, citation: claim.citation, verdict: claim.verdict, why: claim.why }),
      });
      const data = await res.json();
      setRewritten(data.rewritten || "Could not generate a rewrite.");
    } catch { setRewritten("Error generating rewrite."); }
    finally { setRewriting(false); }
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
        background: isSelected ? cfg.badgeBg : isHovered ? `${cfg.badgeBg}55` : "transparent",
        borderLeft: `3px solid ${isSelected ? cfg.accent : isHovered ? `${cfg.accent}44` : "transparent"}`,
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

          {claim.fix && claim.fix !== "none needed" && !rewritten && (
            <div className="rounded-lg bg-[#F0F7FF] border border-[#BFDBFE] px-3 py-2.5">
              <p className="text-[9px] font-semibold text-[#1D4ED8] uppercase tracking-wider mb-1">Suggested fix</p>
              <p className="text-[12px] text-[#1E3A5F] leading-relaxed">{claim.fix}</p>
            </div>
          )}

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

          {showActions && !rewritten && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleRewrite}
                disabled={rewriting}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all disabled:opacity-50"
              >
                {rewriting ? <><Spinner size={10} /> Rewriting…</> : <>✏ Rewrite</>}
              </button>
              <a
                href={scholarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[#EBEBEA] bg-white px-2 py-2 text-[11px] font-medium text-[#5A5A58] hover:bg-[#F7F7F5] transition-all"
                onClick={e => e.stopPropagation()}
              >
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Find source
              </a>
            </div>
          )}
        </div>
      )}
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

  // Analysis pane interaction
  const [selectedClaimIdx, setSelectedClaimIdx] = useState<number | null>(null);
  const [hoveredClaimIdx, setHoveredClaimIdx]   = useState<number | null>(null);

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
        citationKey, title: original?.title ?? file.name.replace(/\.pdf$/i, ""),
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
    setTimeout(() => {
      const card = claimCardRefs.current[claimIdx];
      if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b overflow-hidden flex-shrink-0"
        style={{ background: "rgba(247,247,245,0.92)", backdropFilter: "blur(14px)", borderColor: "var(--border)" }}>
        <div className="max-w-7xl mx-auto px-10 h-14 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-[#1A1A18] tracking-tight">Claim Verifier</span>
          <StepIndicator current={currentStep} />
          <span className="text-xs text-[#9A9A98]">Powered by Claude</span>
        </div>
        <div className="h-0.5 transition-all duration-700 ease-out"
          style={{ width: `${(currentStep / 3) * 100}%`, background: "#1A1A18" }} />
      </header>

      {/* ── Step 1: Draft + References ── */}
      {currentStep === 1 && (
        <main className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-10 pt-12 pb-8 step-enter">
          <div className="mb-8">
            <h1 className="text-[32px] font-semibold tracking-tight text-[#1A1A18] mb-2">
              Verify your academic claims
            </h1>
            <p className="text-[15px] text-[#9A9A98]">
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
        </main>
      )}

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
              <h1 className="text-[28px] font-semibold tracking-tight text-[#1A1A18] mb-1">Sources</h1>
              <p className="text-[15px] font-medium text-[#5A5A58]">
                <span className="text-[#1A1A18] font-semibold">{resolvedSources}</span> of{" "}
                <span className="font-semibold text-[#1A1A18]">{totalSources}</span> retrieved
                {totalSources > 0 && <span className="text-[#9A9A98] font-normal"> · {Math.round((resolvedSources / totalSources) * 100)}% full text</span>}
              </p>
            </div>
          </div>

          <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 300px" }}>
            {/* Sources list */}
            <div className="space-y-5 min-w-0">
              {resolvedSources > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9A9A98] px-1 mb-2">Retrieved</p>
                  {[...foundSources, ...uploadedSources].map(s => (
                    <div key={s.citationKey} className="card px-4 py-3.5 flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-[#F0FDF4] border border-[#BBF7D0] flex items-center justify-center flex-shrink-0">
                        <span className="text-[#10B981] font-bold text-[10px]">✓</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A18]">{s.citationKey}</p>
                        <p className="text-[12px] text-[#9A9A98] leading-snug truncate">{s.title}</p>
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
                              {s.source === "uploaded" && (
                                <button
                                  onClick={() => { handleRemoveUploadFile(s.citationKey); setOpenMenuKey(null); }}
                                  className="w-full px-4 py-2.5 text-[13px] text-left text-[#3A3A38] hover:bg-[#F7F7F5] transition-colors">
                                  Remove uploaded file
                                </button>
                              )}
                              <div className="h-px mx-3" style={{ background: "var(--border)" }} />
                              <button
                                onClick={() => { handleDeleteSource(s.citationKey); setOpenMenuKey(null); }}
                                className="w-full px-4 py-2.5 text-[13px] text-left hover:bg-[#FEF5F5] transition-colors"
                                style={{ color: "#B54040" }}>
                                Delete source
                              </button>
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
                      uploading={uploadingKeys.has(m.citationKey)} />
                  ))}
                </div>
              )}

              {totalSources === 0 && (
                <p className="text-[15px] text-[#9A9A98] text-center py-20">No citations detected in your draft.</p>
              )}
            </div>

            {/* Right panel — summary + verify */}
            <div className="space-y-4">
              <div className="card p-5 space-y-4">
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
                className="inline-flex items-center gap-1 text-[13px] text-[#9A9A98] hover:text-[#5A5A58] transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Start over
              </button>
              <div className="w-px h-4 bg-[#E0E0DE]" />
              <h1 className="text-[18px] font-semibold tracking-tight text-[#1A1A18]">Analysis</h1>
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
              className="flex-shrink-0 overflow-y-auto border-r flex flex-col"
              style={{ width: "28%", borderColor: "var(--border)" }}
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
                            background: active ? f.badgeBg : `${f.badgeBg}70`,
                            color: active ? f.badgeText : `${f.accent}88`,
                            border: active
                              ? `1.5px solid ${f.accent}77`
                              : `1px solid ${f.accent}28`,
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
              className="flex-1 overflow-y-auto"
              style={{ padding: "28px 40px 40px" }}
            >
              {/* Minimal interaction hint — no legend needed, colors are self-explanatory */}
              <p className="text-[12px] text-[#C0C0BE] mb-5">Click any highlighted phrase to view details.</p>

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
                              ? `${cfg.badgeBg}DD`
                              : `${cfg.badgeBg}88`,
                          color: "inherit",
                          borderBottom: `2px solid ${isSelected ? cfg.accent : isHovered ? `${cfg.accent}CC` : `${cfg.accent}77`}`,
                          borderRadius: "2px",
                          padding: "1px 2px",
                          cursor: "pointer",
                          transition: "background 0.15s, border-color 0.15s",
                          outline: isSelected ? `2px solid ${cfg.accent}33` : undefined,
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
