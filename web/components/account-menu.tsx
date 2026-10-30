"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LogOut } from "lucide-react";

import { signOut } from "@/app/auth/actions";
import type { Viewer } from "@/components/signed-in";

/** The home-page account control: the GitHub login, and Sign out underneath it. */
export function AccountMenu({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 max-w-48 min-w-0 items-center gap-2 px-1 text-sm"
      >
        <Image src={viewer.avatarUrl} alt="" width={28} height={28} className="size-7 shrink-0 border border-white/20" />
        <span className="truncate">{viewer.login}</span>
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-2 min-w-40 border border-white/15 bg-[#07090c] p-1">
          <form action={signOut}>
            <input type="hidden" name="returnTo" value="/" />
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/10"
            >
              <LogOut aria-hidden className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
