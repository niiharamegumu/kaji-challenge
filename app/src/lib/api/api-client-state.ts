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

export const getLatestTeamEtag = () => latestTeamEtag;

export const setLatestTeamEtag = (value: string) => {
  latestTeamEtag = value;
};
