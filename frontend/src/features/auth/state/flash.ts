const FLASH_STATUS_KEY = "kaji.flash.status";

export const writeFlashStatus = (message: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(FLASH_STATUS_KEY, message);
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
  return value;
};
