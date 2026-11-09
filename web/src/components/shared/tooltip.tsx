"use client";

import { useId, type ReactNode } from "react";

/** Styled hover/focus tooltip (replaces the browser's default `title` bubble). */
export function Tooltip({
  text,
  children,
  align = "center",
}: {
  text: string;
  children: ReactNode;
  align?: "center" | "end";
}) {
  const id = useId();
  return (
    <span className="group relative inline-flex cursor-help" tabIndex={0} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-40 mb-2 w-max max-w-[16rem] rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-[var(--ink)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
