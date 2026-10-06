"use client";

import { useEffect, useRef, useState } from "react";

// Create / edit a project: a name plus instructions every chat in the project follows.
export function ProjectDialog({ open, appName, initial, onClose, onSave, onDelete }: {
  open: boolean;
  appName: string;
  initial?: { name: string; instructions: string };
  onClose: () => void;
  onSave: (v: { name: string; instructions: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setName(initial?.name ?? "");
      setInstructions(initial?.instructions ?? "");
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, initial]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,520px)] rounded-3xl border border-line bg-composer p-0 text-ink shadow-menu backdrop:bg-black/50"
    >
      <form
        className="p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          await onSave({ name: name.trim(), instructions });
          setSaving(false);
        }}
      >
        <h2 className="text-lg font-medium">{initial ? "Edit project" : `New ${appName} project`}</h2>
        <p className="mt-1 text-sm text-ink-muted">Group related chats. {appName} follows the project instructions in every chat inside it.</p>
        <label htmlFor="project-name" className="mt-5 block text-sm font-medium">Name</label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          placeholder="e.g. STATS 2244 — Assignment 2"
          className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface-000 px-3.5 py-2.5 outline-none focus:border-brand"
        />
        <label htmlFor="project-instructions" className="mt-4 block text-sm font-medium">Instructions <span className="font-normal text-ink-subtle">(optional)</span></label>
        <textarea
          id="project-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={8000}
          rows={6}
          placeholder="e.g. I'm in second-year stats. Explain step by step and use the course notation."
          className="mt-1.5 w-full resize-y rounded-xl border border-line-strong bg-surface-000 px-3.5 py-2.5 text-sm leading-relaxed outline-none focus:border-brand"
        />
        <div className="mt-6 flex items-center gap-2">
          {onDelete && (
            <button type="button" onClick={onDelete} className="rounded-full px-4 py-2 text-sm text-danger hover:bg-danger-surface">
              Delete project
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-4 py-2 text-sm font-medium hover:bg-surface-300">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-on-brand transition hover:bg-brand-strong disabled:opacity-40">
            {saving ? "Saving…" : initial ? "Save" : "Create project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
