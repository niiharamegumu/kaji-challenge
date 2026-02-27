const DEFAULT_USER_COLOR = "#1F2937";

export function resolveUserColor(colorHex?: string | null): string {
  const normalized = colorHex?.trim().toUpperCase() ?? "";
  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return normalized;
  }
  return DEFAULT_USER_COLOR;
}

function toLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

export function getReadableTextColor(bgHex: string): "#000000" | "#FFFFFF" {
  const normalized = resolveUserColor(bgHex);
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.55 ? "#000000" : "#FFFFFF";
}
