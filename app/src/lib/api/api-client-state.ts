export type ApiRequestError = {
  name: "ApiRequestError";
  message: string;
  status: number;
  code?: string;
  currentEtag?: string;
};

export const isApiRequestError = (value: unknown): value is ApiRequestError => {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ApiRequestError>;
  return (
    candidate.name === "ApiRequestError" &&
    typeof candidate.message === "string" &&
    typeof candidate.status === "number"
  );
};

let latestTeamEtag = "";
let teamStateGeneration = 0;

export const getLatestTeamEtag = () => latestTeamEtag;
export const getTeamStateGeneration = () => teamStateGeneration;

export const setLatestTeamEtag = (value: string) => {
  const current = /^W\/"team:([^:]+):rev:(\d+)"$/.exec(latestTeamEtag);
  const next = /^W\/"team:([^:]+):rev:(\d+)"$/.exec(value);
  if (current && next && current[1] === next[1] && BigInt(next[2]) < BigInt(current[2])) return;
  // ログアウト・所属変更前の応答や待機中の操作を、次のチームへ持ち越さない。
  if (!value || (current && next && current[1] !== next[1])) teamStateGeneration++;
  latestTeamEtag = value;
};
