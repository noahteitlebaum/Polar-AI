"use client";

import { useEffect, useRef, useState } from "react";

// "+" menu in the message box: turn on tools such as image generation.
export function ToolsMenu({ imageLabel, imageMode, onImageMode, disabled }: {
  imageLabel: string | null; // null = this app can't make images
  imageMode: boolean;
  onImageMode: (on: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Tools"
        className={`grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-surface-300 hover:text-ink disabled:opacity-50 ${open ? "bg-surface-300 text-ink" : ""}`}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden className={`transition-transform ${open ? "rotate-45" : ""}`}>
          <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {imageMode && (
        <button
          type="button"
          onClick={() => onImageMode(false)}
          className="flex items-center gap-1.5 rounded-full bg-surface-300 py-1 pl-2.5 pr-2 text-xs font-medium text-ink"
          aria-label="Turn off image mode"
        >
          <ImageIcon /> Image
          <span aria-hidden className="text-ink-subtle">✕</span>
        </button>
      )}
      {open && (
        <div role="menu" className="model-menu absolute bottom-full left-0 z-40 mb-2 w-72 origin-bottom-left rounded-2xl border border-line bg-composer p-1.5 shadow-menu">
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={imageMode}
            disabled={!imageLabel}
            onClick={() => {
              onImageMode(!imageMode);
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-200"><ImageIcon /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Create image</span>
              <span className="block truncate text-xs text-ink-subtle">{imageLabel ?? "Not available in this app"}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="6.3" r="1.2" fill="currentColor" />
      <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
