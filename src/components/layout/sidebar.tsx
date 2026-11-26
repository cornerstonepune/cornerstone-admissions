"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { Icon, type IconName } from "@/admissions/components/icons";

// The Cornerstone sidebar (S-frame, ADR 0014 §3): three groups of doors on the dark menu ground. The current page is lit with
// the action-soft fill and aria-current="page". From 701 px it sits beside the page and folds to its icons (the fold is kept in
// localStorage); at 700 px or less it is a drawer, a modal opened by the bar's Menu button. Hidden in v1: Broadcasts, AI Agents.
type Door = { href: string; label: string; icon: IconName; counted?: boolean };

export const MENU: readonly { group: string; doors: readonly Door[] }[] = [
  {
    group: "Daily work",
    doors: [
      { href: "/today", label: "Today", icon: "today" },
      { href: "/inbox", label: "Inbox", icon: "inbox" },
      { href: "/pipelines", label: "Pipeline", icon: "pipeline" },
      { href: "/contacts", label: "Parents", icon: "parents" },
      { href: "/notifications", label: "Notifications", icon: "notifications", counted: true },
    ],
  },
  {
    group: "Oversight",
    doors: [
      { href: "/report", label: "Report", icon: "report" },
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    ],
  },
  {
    group: "Set up",
    doors: [
      { href: "/admissions-settings", label: "Admissions settings", icon: "admissions-settings" },
      { href: "/flows", label: "Flows", icon: "flows" },
      { href: "/automations", label: "Automations", icon: "automations" },
      { href: "/settings", label: "Account settings", icon: "setup" },
    ],
  },
];

export const FOLD_KEY = "cs.sidebar.folded";

function readFold(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false; // storage refused (private window): start unfolded
  }
}

interface SidebarProps {
  /** The phone drawer, opened by the bar's Menu button. Never true from 701 px (the button is hidden there). */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const unread = useUnreadNotifications();
  // The shell only draws the frame on the client (after auth resolves), so reading storage here never mismatches a server render.
  const [folded, setFolded] = useState(readFold);
  const closeRef = useRef<HTMLButtonElement>(null);

  const toggleFold = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? "1" : "0");
    } catch {
      // storage refused: the fold lasts until reload
    }
  };

  // A picked door closes the drawer: it was opened to navigate.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The drawer is a modal: focus moves in, Escape closes, the page behind does not scroll, and focus returns on close.
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      back?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      {open ? (
        <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-[var(--menu)] opacity-60 wide:hidden" />
      ) : null}
      <div
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? "Menu" : undefined}
        data-folded={folded || undefined}
        className={cn(
          "flex shrink-0 flex-col overflow-y-auto bg-[var(--menu)] text-[var(--menu-ink)]",
          // phone: a drawer from the left, drawn only while open
          "max-wide:fixed max-wide:inset-y-0 max-wide:left-0 max-wide:z-40 max-wide:w-[calc(var(--space-7)*2.5)]",
          !open && "max-wide:hidden",
          folded ? "wide:w-[calc(var(--tap)+var(--space-2)*2)]" : "wide:w-[calc(var(--space-7)*2.5)]",
        )}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="m-[var(--space-2)] mb-0 inline-flex min-h-[var(--tap)] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-control)] px-[var(--space-2)] text-label font-semibold hover:bg-[var(--menu-hover)] wide:hidden"
        >
          <Icon name="close" />
          Close menu
        </button>
        <nav aria-label="Sections" className="grid flex-1 content-start gap-[var(--space-0)] px-[var(--space-2)] py-[var(--space-3)]">
          {MENU.map(({ group, doors }) => (
            <div key={group} className="grid gap-[var(--space-0)]">
              <h2
                className={cn(
                  "mt-[var(--space-3)] mb-[var(--space-0)] px-[var(--space-2)] text-eyebrow font-semibold uppercase text-[var(--menu-ink-muted)] first:mt-0",
                  folded && "wide:sr-only",
                )}
              >
                {group}
              </h2>
              {doors.map((d) => {
                const on = pathname === d.href || pathname.startsWith(d.href + "/");
                const count = d.counted && unread > 0 ? (unread > 9 ? "9+" : String(unread)) : null;
                return (
                  <NextLink
                    key={d.href}
                    href={d.href}
                    aria-current={on ? "page" : undefined}
                    title={folded ? d.label : undefined}
                    className={cn(
                      "flex min-h-[var(--tap)] items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] text-label font-semibold no-underline",
                      on ? "bg-[var(--action-soft)] text-[var(--action-soft-ink)]" : "text-[var(--menu-ink)] hover:bg-[var(--menu-hover)]",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-[var(--space-4)] shrink-0 place-items-center rounded-[var(--radius-control)]",
                        on ? "bg-[var(--action)] text-[var(--action-ink)]" : "bg-[var(--menu-hover)]",
                      )}
                    >
                      <Icon name={d.icon} size={16} />
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", folded && "wide:sr-only")}>{d.label}</span>
                    {count ? (
                      <b
                        className={cn(
                          "rounded-[var(--radius-pill)] bg-[var(--action)] px-[var(--space-1)] text-caption text-[var(--action-ink)] tabular-nums",
                          folded && "wide:sr-only",
                        )}
                      >
                        {count}
                        <span className="sr-only"> unread</span>
                      </b>
                    ) : null}
                  </NextLink>
                );
              })}
            </div>
          ))}
        </nav>
        <button
          type="button"
          onClick={toggleFold}
          aria-expanded={!folded}
          aria-label={folded ? "Unfold the sidebar" : "Fold the sidebar"}
          className="m-[var(--space-2)] mt-0 inline-flex min-h-[var(--tap)] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-control)] px-[var(--space-2)] text-label text-[var(--menu-ink-muted)] hover:bg-[var(--menu-hover)] max-wide:hidden"
        >
          <Icon name={folded ? "expand" : "collapse"} />
          {folded ? null : "Fold"}
        </button>
      </div>
    </>
  );
}
