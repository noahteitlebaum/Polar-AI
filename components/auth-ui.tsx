import Link from "next/link";
import type { ReactNode } from "react";
import { OrbitBackdrop, Wordmark } from "./brand";

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface-200 px-4 py-3 text-base text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand focus:shadow-focus";
export const primaryButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 font-medium text-on-brand transition hover:bg-brand-strong hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";
export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-3 font-medium text-ink transition hover:bg-surface-300 disabled:cursor-not-allowed disabled:opacity-45";
export const linkButtonClass =
  "text-sm font-medium text-brand underline underline-offset-[3px] disabled:opacity-45";

export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <OrbitBackdrop className="min-h-dvh">
      <main className="flex min-h-dvh items-center justify-center px-4 py-10 text-ink">
        <div className={`w-full ${wide ? "max-w-md" : "max-w-sm"}`}>
          <p className="mb-6 text-center"><Wordmark className="text-[22px]" /></p>
          {children}
        </div>
      </main>
    </OrbitBackdrop>
  );
}

export function AuthCard({ title, subtitle, children, footer }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <AuthShell>
      <div className="rounded-2xl border border-line bg-surface-100 p-6 shadow-card">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-4 text-center text-sm text-ink-muted">{footer}</div>}
    </AuthShell>
  );
}

export function Field({ label, id, hint, ...input }: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} name={id} className={inputClass} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && <p id={`${id}-hint`} className="text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}

export function FormAlert({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p role="status" className="rounded-lg border border-line bg-info-surface px-3 py-2 text-sm text-ink">
        {message}
      </p>
    );
  }
  return null;
}

export function TextLink({ href, muted = false, children }: { href: string; muted?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`underline underline-offset-[3px] ${muted ? "text-ink-muted" : "font-medium text-brand"}`}
    >
      {children}
    </Link>
  );
}
