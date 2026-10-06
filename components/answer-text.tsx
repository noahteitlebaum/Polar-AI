"use client";

import { Fragment, useState } from "react";

// An answer with its course-file references. [S1] markers become small numbered chips; the list under the
// answer shows exactly which file and page each one came from (only passages the answer actually cited).
export type Source = { n: number; fileId: string; fileName: string; page: number | null; label: string; excerpt: string };

export function AnswerText({ text, sources }: { text: string; sources?: Source[] }) {
  const byN = new Map((sources ?? []).map((s) => [s.n, s]));
  const parts = text.split(/(\[S\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[S(\d+)\]$/.exec(part);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const src = byN.get(Number(m[1]));
        return (
          <sup key={i} title={src?.label}
            className="mx-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-surface-300 px-1 align-[2px] font-sans text-[10px] font-semibold text-ink-muted">
            {m[1]}
          </sup>
        );
      })}
    </>
  );
}

export function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-medium text-ink-subtle">From your files</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <button key={s.n} type="button" onClick={() => setOpen(open === s.n ? null : s.n)} aria-expanded={open === s.n}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${open === s.n ? "border-line-strong bg-surface-300" : "border-line bg-surface-200 hover:bg-surface-300"}`}>
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-surface-000 px-1 text-[10px] font-semibold">{s.n}</span>
            {s.label}
          </button>
        ))}
      </div>
      {open != null && (
        <blockquote className="mt-2 rounded-xl border-l-2 border-brand bg-surface-200 px-3 py-2 text-xs leading-relaxed text-ink-muted">
          “{sources.find((s) => s.n === open)?.excerpt}…”
        </blockquote>
      )}
    </div>
  );
}
