"use client";

import { GLOSSARY } from "../glossary";

export function Glossary() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {GLOSSARY.map((entry) => (
        <details key={entry.term} className="device-card">
          <summary className="cursor-pointer text-sm font-semibold">
            {entry.label}
            <span className="muted ml-2 text-xs font-normal">{entry.term}</span>
          </summary>
          <p className="muted mt-2 text-sm">{entry.plain}</p>
          {entry.detail && <p className="muted mt-2 text-xs">{entry.detail}</p>}
        </details>
      ))}
    </div>
  );
}
