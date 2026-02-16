export const todayString = () => new Date().toISOString().slice(0, 10);

export const formatError = (error: unknown) => {
  const raw = String(error);
  const status = raw.match(/\b(\d{3})\b/)?.[1];
  if (status != null) {
    return `通信エラー（HTTP ${status}）`;
  }
  return "通信エラー";
};
