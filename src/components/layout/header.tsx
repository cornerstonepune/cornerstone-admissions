"use client";

import { useAuth } from "@/hooks/use-auth";
import Link from "@/admissions/components/link";
import { BrandMark } from "@/admissions/components/brand-mark";
import { Icon } from "@/admissions/components/icons";

// The Cornerstone bar (S-frame): the dark band across the top. The mark links to Today; on the right the member's name and role,
// and Sign out. At 700 px or less the Menu button opens the sidebar's drawer and the name gives way.
interface HeaderProps {
  onOpenSidebar?: () => void;
}

const BAR_BUTTON =
  "inline-flex min-h-[var(--tap)] items-center gap-[var(--space-1)] rounded-[var(--radius-control)] px-[var(--space-2)] font-semibold text-[var(--bar-ink)] hover:bg-[var(--bar-hover)]";

export function Header({ onOpenSidebar }: HeaderProps) {
  const { profile, accountRole, signOut } = useAuth();
  const name = profile?.full_name ?? profile?.email ?? "";

  return (
    <header
      data-bar
      className="flex min-h-[calc(var(--tap)+var(--space-2))] shrink-0 items-center gap-[var(--space-3)] bg-[var(--bar)] px-[var(--space-4)] text-label text-[var(--bar-ink)] max-wide:gap-[var(--space-2)] max-wide:px-[var(--space-3)]"
    >
      {onOpenSidebar && (
        <button type="button" onClick={onOpenSidebar} aria-haspopup="dialog" className={`${BAR_BUTTON} wide:hidden`}>
          <Icon name="menu" />
          Menu
        </button>
      )}
      <Link href="/today" aria-label="Today" className="flex shrink-0 items-center rounded-[var(--radius-control)] no-underline">
        <BrandMark />
      </Link>
      <span className="flex-1" />
      {name ? (
        <span className="truncate max-wide:hidden">
          {name}
          {accountRole ? ` · ${accountRole}` : null}
        </span>
      ) : null}
      <button type="button" onClick={signOut} className={BAR_BUTTON}>
        <Icon name="sign-out" />
        Sign out
      </button>
    </header>
  );
}
