"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icons";

const KEY = "shadermesh:theme";

// The theme lives on <html data-theme>, set before paint by the layout script.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.dataset.theme === "dark";

/** Switches between the light (default) and dark palettes and remembers the choice. */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !dark;
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Storage can be unavailable in private windows; the toggle still works.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted transition-colors duration-fast ease-out hover:border-line-strong hover:text-ink active:bg-active"
    >
      <Icon name={dark ? "sun" : "moon"} className="h-4 w-4" aria-hidden />
    </button>
  );
}
