export function resolveSameOriginURL(value: unknown, origin: string): string {
  const fallback = new URL("/", origin);
  if (typeof value !== "string" || value.trim() === "") {
    return fallback.toString();
  }

  try {
    const target = new URL(value, fallback);
    if (
      target.origin !== fallback.origin ||
      (target.protocol !== "https:" && target.protocol !== "http:")
    ) {
      return fallback.toString();
    }
    return target.toString();
  } catch {
    return fallback.toString();
  }
}
