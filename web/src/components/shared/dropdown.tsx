"use client";

import { useEffect, useId, useRef, useState } from "react";

type DropdownOption<T extends string | number> = { value: T; label: string; icon?: string };

type Props<T extends string | number> = {
  label: string;
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Fill the width of the parent (grid cells, mobile headers). */
  block?: boolean;
};

/**
 * A small styled listbox used instead of a native <select>, so the option list
 * matches the page and shows hover and keyboard focus. Keyboard: arrows, Home,
 * End, Enter/Space to choose, Escape to close.
 */
export function Dropdown<T extends string | number>({ label, value, options, onChange, disabled = false, block = false }: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = useState(selected);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          setActive(selected);
          setOpen(true);
        } else {
          setActive((index) => Math.min(last, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))));
        }
        break;
      }
      case "Home":
      case "End":
        if (open) {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : last);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(active);
        else {
          setActive(selected);
          setOpen(true);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const current = options[selected];

  return (
    <div ref={root} className={`relative ${block ? "w-full" : ""}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        aria-controls={listId}
        onClick={() => {
          setActive(selected);
          setOpen((state) => !state);
        }}
        onKeyDown={onKeyDown}
        className={`select-control flex ${block ? "w-full" : "min-w-[10rem]"} cursor-pointer items-center justify-between gap-3 text-sm font-medium normal-case tracking-normal transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span>
          {current?.icon ? <span aria-hidden="true">{current.icon} </span> : null}
          {current?.label}
        </span>
        <span aria-hidden="true" className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          className="absolute left-0 z-30 mt-1 min-w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)] ${
                index === active ? "bg-emerald-500/15" : ""
              } ${index === selected ? "font-semibold" : "font-normal"}`}
            >
              <span>
                {option.icon ? <span aria-hidden="true">{option.icon} </span> : null}
                {option.label}
              </span>
              {index === selected ? (
                <span aria-hidden="true" className="text-[var(--accent)]">
                  ✓
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
