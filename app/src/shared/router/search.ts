// Preserve the existing URLSearchParams contract, including close=1 and date keys.
export const searchOptions = {
  parseSearch: (search: string) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search: Record<string, unknown>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search))
      if (value !== undefined) params.set(key, String(value));
    const result = params.toString();
    return result ? `?${result}` : "";
  },
};
