import { useEffect, useState } from "react";

function getIsPageActive() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

export function usePageActivity() {
  const [isPageActive, setIsPageActive] = useState(getIsPageActive);

  useEffect(() => {
    const updatePageActivity = () => setIsPageActive(getIsPageActive());

    updatePageActivity();
    document.addEventListener("visibilitychange", updatePageActivity);
    window.addEventListener("focus", updatePageActivity);
    window.addEventListener("blur", updatePageActivity);
    window.addEventListener("pageshow", updatePageActivity);

    return () => {
      document.removeEventListener("visibilitychange", updatePageActivity);
      window.removeEventListener("focus", updatePageActivity);
      window.removeEventListener("blur", updatePageActivity);
      window.removeEventListener("pageshow", updatePageActivity);
    };
  }, []);

  return isPageActive;
}