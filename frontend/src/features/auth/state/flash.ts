const FLASH_STATUS_KEY = "kaji.flash.status";

export type FlashStatus = {
  message: string;
  kind: "info" | "login_success";
};

export const writeFlashStatus = (
  message: string,
  kind: FlashStatus["kind"] = "info",
) => {
  if (typeof window === "undefined") {
    return;
  }
  const payload: FlashStatus = { message, kind };
  window.localStorage.setItem(FLASH_STATUS_KEY, JSON.stringify(payload));
};

export const consumeFlashStatus = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(FLASH_STATUS_KEY);
  if (value == null || value === "") {
    return null;
  }
  window.localStorage.removeItem(FLASH_STATUS_KEY);
  try {
    const parsed = JSON.parse(value) as Partial<FlashStatus>;
    if (typeof parsed.message !== "string" || parsed.message === "") {
      return null;
    }
    const kind = parsed.kind === "login_success" ? "login_success" : "info";
    return { message: parsed.message, kind } satisfies FlashStatus;
  } catch {
    return { message: value, kind: "info" } satisfies FlashStatus;
  }
};
