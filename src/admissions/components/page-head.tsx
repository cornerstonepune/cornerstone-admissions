// The page head every signed-in page opens with (S-frame; ported from the platform's PageHeader in parts.tsx): a small-caps
// eyebrow, the title, and one line saying what the page is for.
export function PageHead({ eyebrow, title, purpose }: { eyebrow: string; title: string; purpose: string }) {
  return (
    <header data-page-head className="grid gap-[var(--space-1)] pb-[var(--space-2)]">
      <span className="text-eyebrow font-semibold uppercase text-[var(--ink-muted)]">{eyebrow}</span>
      <h1 className="font-[family-name:var(--font-title-page)] text-title-page font-[number:var(--weight-title-page)] text-[var(--ink)]">
        {title}
      </h1>
      <p data-purpose className="max-w-[70ch] text-lead text-[var(--ink-muted)]">
        {purpose}
      </p>
    </header>
  );
}
