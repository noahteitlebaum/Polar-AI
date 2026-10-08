import Image from "next/image";
import type { ReactNode } from "react";
import type { ProviderId } from "@/config/models";
import { THEMES } from "@/config/themes";

// Brand pieces from the Orbit AI design system: wordmark, orbit backdrop, provider dots.

export function Wordmark({ className = "text-lg", markSize = 24 }: { className?: string; markSize?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight text-ink ${className}`}>
      <Image src="/brand/orbit-mark.png" alt="" width={markSize} height={markSize} className="logo-mono" style={{ width: markSize, height: markSize }} />
      <span>Orbit <span className="text-brand">AI</span></span>
    </span>
  );
}

// Provider colors are only ever dots next to the model's name — never logos, never color alone.
export const PROVIDER_DOT: Record<ProviderId, string> = {
  openai: "bg-provider-openai",
  anthropic: "bg-provider-anthropic",
  google: "bg-provider-google",
  xai: "bg-provider-xai",
};

const PROVIDER_FILL: Record<ProviderId, string> = {
  openai: "fill-provider-openai",
  anthropic: "fill-provider-anthropic",
  google: "fill-provider-google",
  xai: "fill-provider-xai",
};

export function ProviderDot({ provider, className = "h-2 w-2" }: { provider?: ProviderId; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${PROVIDER_DOT[provider ?? "openai"]} ${className}`} />;
}

const NODES: [ProviderId, number, number][] = [
  ["openai", 20, 18],
  ["anthropic", 80, 18],
  ["google", 18, 80],
  ["xai", 82, 80],
];

/** The orbit from the brand image: soft blue glow, hairline rings, four provider logos. Decorative. */
export function OrbitBackdrop({ active, className = "", children }: {
  active?: ProviderId;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`orbit-glow relative overflow-hidden ${className}`}>
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <circle cx="50" cy="50" r="44" fill="none" strokeWidth="0.25" className="stroke-glow-ring" opacity="0.9" />
        <circle cx="50" cy="50" r="47" fill="none" strokeWidth="0.25" strokeDasharray="0.6 0.9" className="stroke-line-strong" opacity="0.5" />
        <circle cx="50" cy="50" r="27" fill="none" strokeWidth="0.25" className="stroke-glow-ring" opacity="0.55" />
        {/* Each orbit node is the provider's logo on a small badge (logos from config/themes.ts). */}
        {NODES.map(([p, x, y]) => {
          const r = active === p ? 4.6 : 3.8;
          const logo = THEMES[p].logo;
          return (
            <g key={p}>
              <circle cx={x} cy={y} r={r} strokeWidth="0.25" className="fill-surface-100 stroke-line-strong" />
              {logo ? (
                <image href={logo} x={x - r * 0.58} y={y - r * 0.58} width={r * 1.16} height={r * 1.16}
                  preserveAspectRatio="xMidYMid meet" className={THEMES[p].logoMono ? "logo-mono" : undefined} />
              ) : (
                <circle cx={x} cy={y} r={r * 0.4} className={PROVIDER_FILL[p]} />
              )}
            </g>
          );
        })}
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}
