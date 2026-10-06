import Image from "next/image";
import type { ProviderId } from "@/config/models";
import { THEMES } from "@/config/themes";

// Company logo from public/providers (set in config/themes.ts). Plain-black logos turn white in dark mode.
// Falls back to a monogram on the provider's color (.tile-<provider> in globals.css) if no file is set.
export function ProviderLogo({ provider, size = 24 }: { provider: ProviderId; size?: number }) {
  const t = THEMES[provider];
  if (t.logo) {
    return (
      <Image src={t.logo} alt="" width={size} height={size} unoptimized
        className={`object-contain ${t.logoMono ? "logo-mono" : ""}`} style={{ width: size, height: size }} />
    );
  }
  return (
    <span aria-hidden className={`tile-${provider} grid place-items-center rounded-md font-semibold`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {t.monogram}
    </span>
  );
}
