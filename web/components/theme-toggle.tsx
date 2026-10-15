"use client";

import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const subscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; render no selection on the server.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = OPTIONS.findIndex((option) => mounted && theme === option.value);
  const focusIndex = selectedIndex === -1 ? 0 : selectedIndex;

  function onKeyDown(event: KeyboardEvent, index: number) {
    let step = 0;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") step = 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") step = -1;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    setTheme(OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Color theme" className="flex border border-sidebar-border">
      {OPTIONS.map(({ value, label, icon: Icon }, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "grid h-9 flex-1 place-items-center text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground",
              "[&+&]:border-l [&+&]:border-sidebar-border",
              selected && "bg-sidebar-foreground text-sidebar hover:text-sidebar",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
