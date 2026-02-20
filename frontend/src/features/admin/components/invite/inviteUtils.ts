import {
  DATE_TIME_FORMAT_OPTIONS,
  NICKNAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
} from "../../constants/invite";

export const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, DATE_TIME_FORMAT_OPTIONS).format(
    date,
  );
};

export const getNicknameError = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length > NICKNAME_MAX_LENGTH) {
    return `ニックネームは${NICKNAME_MAX_LENGTH}文字以内で入力してください`;
  }
  return "";
};

export const getTeamNameError = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "チーム名を入力してください";
  }
  if (trimmed.length > TEAM_NAME_MAX_LENGTH) {
    return `チーム名は${TEAM_NAME_MAX_LENGTH}文字以内で入力してください`;
  }
  return "";
};
