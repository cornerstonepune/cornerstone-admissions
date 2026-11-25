# Cornerstone Admissions: the design language

The design authority for this repo (ADR 0003). It is the Cornerstone platform's design language ("B rich"), copied
once on 25 Nov 2026 and adapted to admissions. The original is kept unedited in `design/platform/DESIGN.md` for
reference. Values live in `design/tokens.css`; this file names them and says how to use them. Where the two disagree,
`design/tokens.css` wins and this file is wrong.

## 1. Tokens: by name, never by value

Every colour, size, radius, shadow and motion is a token in `design/tokens.css`. Code and wireframes name the token
(`var(--state-ok)`); nobody types a hex. CI rejects raw hex, `rgb()`, `hsl()` and arbitrary `-[12px]` values in
frontend code. Project overrides go only in `design/brand.css`, only for the tokens in `.loop.json → brand_overridable`
(today: none overridden).

| Family | Tokens | Meaning |
|---|---|---|
| Neutrals | `ground` `surface` `panel` `ink` `ink-muted` `line` `line-control` `link` `focus` `highlight` | the page, a sunken box, a card, text, hairlines, a control's edge, links (always underlined) |
| Frame | `menu` `menu-ink` `menu-ink-muted` `menu-hover` · `bar` `bar-ink` `bar-hover` `bar-pill` `bar-badge` | the sidebar and the top bar (basalt) |
| Main action | `action` `action-ink` `action-hover` `action-soft` `action-soft-ink` | the one filled button on a page; the active menu item; "now" |
| Brand | `brand-clay` `brand-basalt` `brand-olive` `brand-bamboo` `brand-haldi` `brand-monsoon` `brand-bark` `brand-sand` | the mark and a section's icon tile only; never a state |
| Work states | `state-ok` `state-wait` (+ `state-wait-fill`) `state-late` `state-quiet`, each with `-bg` | green, amber, red, grey; always with icon and word (§3) |
| Kinds | `kind-period` `-child` `-activity` `-objective` `-skill` `-assessment` `-note`, each with `-bg` | which kind of thing a tile or card is. Admissions maps its own kinds onto these (§4) |
| Subjects | `subject-*` | the school's subjects. Not used in admissions |

**Type** (`--text-<name>`, `--lh-<name>`, `--weight-<name>`, `--font-<name>`): `title-page` (the one h1), `title-section`,
`title-small`, `lead` (the purpose line), `body`, `label`, `eyebrow` (caps), `caption` (timestamps and sources only,
never a status or action). **Source Serif 4** for titles, **Source Sans 3** for everything else, loaded with
`next/font/google` so no page asks a font host for anything. Tabular figures in every column of numbers.

**Spacing** `--space-0`…`--space-7` = 4 / 6 / 12 / 20 / 32 / 48 / 64 / 96 px, plus `--space-card` 20, `--space-card-tight` 16
and `--tap` 44 (least size of anything tappable). `space-0` hairlines inside a chart or strip; `space-1` icon to its word;
`space-2` between rows and chips; `space-3` inside a card and the phone gutter; `space-4` between blocks and the main
column's padding; `space-5` above a section and between main column and panel; `space-6` under the title block;
`space-7` page bottom. Every gap, padding and margin is one of these (or 0 or auto).

**Radii** `--radius-card` (cards, rows, cells), `--radius-control` (buttons, inputs, tiles), `--radius-small`,
`--radius-pill` (chips, badges). **Shadow** `--shadow-card` is the one resting elevation and replaces a card's border;
`--shadow-lift` on hover of something you can open, `--shadow-pop` for menus and sheets; never on a chip, text or the
logo. **Motion** `.press`: `--press-transform` in `--press-transition` on `:active`; nothing else moves; removed under
`prefers-reduced-motion`.

**Light and dark.** `design/tokens.css` follows the system setting. Admissions holds light (`data-scheme="light"` on
`<html>`, brief §8) until Nimish asks for dark; the dark values stay in the file so nothing is lost.

## 2. The frame

```
┌ bar ──────────────────────────────────────────────────────────────────────────┐
│ [logo]                                         [search]  person  ?  Sign out │
├──────────────┬────────────────────────────────────────────────────────────────┤
│ [fold]       │ Today › Leads                           (trail: section › thing) │
│ TODAY (7)    │ EYEBROW · FACTS                        ┌ DetailPanel ─────────┐ │
│ INBOX        │ Title (h1)                             │ [tile] the lead  [×] │ │
│ PIPELINE     │ Purpose line, ≤140 characters          │ Move · Call · Edit   │ │
│ REPORTS      │ blocks… (a table, a board, a list)     │ Card | Calls | Chat  │ │
│ SETTINGS     │   choosing a thing opens it on the     └──────────────────────┘ │
│              │   right: ?open=<kind>:<id>&tab=…                                │
└──────────────┴────────────────────────────────────────────────────────────────┘
phone (≤700 px): Menu button, mark, search, person; the sidebar is a drawer; an open panel is a sheet over the page
```

- **Bar** (basalt): the brand mark links to Today; search; the person; help; sign out.
- **Sidebar** (`menu` ground): one heading per section with its icon in a tile of the section's colour; the current page
  `aria-current="page"`, filled with `action-soft`. It folds to one icon per section; on a phone it is a drawer. Only
  Today carries a count.
- **Trail**: the section, then the thing (two levels), plus the browser's Back.
- **DetailPanel** (right): the chosen thing in tabs, the same tabs for the same kind. Escape or × closes it and focus
  returns to the thing. With nothing chosen there is no panel; the page's stat tiles are a band under the title. This
  is brief §8's "detail one click away in a right-side panel".
- wacrm's own layout (`src/components/layout/`) is restyled to this frame; it is not replaced wholesale.

## 3. The state rule

A state is **an icon, a word and a colour, never one alone** (a chip with `data-state=`).

| `data-state` | Colour | Admissions words (examples) |
|---|---|---|
| `late` | red | overdue, no-show, missed call back |
| `wait` | amber | due today, to confirm, deciding |
| `ok` | green | visited, applied, admitted, done |
| `quiet` | grey | not started, dormant, lost |
| `unseen` | grey on panel, dashed edge | not seen yet |

**Red is for work, never for a family or a child.** A lost or dormant lead is grey. If two things on a screen are red,
one is wrong. A chip on a tinted cell gets `.on-tint`. Brief §8's "highlight what is off or overdue" means: the late
rows first, in red, with their word.

## 4. Kinds and icons

Kinds (`data-kind`) give a tile its colour and icon. Admissions' kinds are named in `GLOSSARY.md` when their screens are
drawn and each takes one of the existing kind tokens (for example a lead on `kind-child`, a visit on `kind-period`,
a call or note on `kind-note`); no new colour is added without an ADR.

**Icons**: Lucide only, stroke 1.9, 16 / 20 / 24 px. Screens name a concept (`<Icon name="lead">`) from one icon map
(ported from `design/platform/lib/icons.tsx`); no screen names a Lucide icon directly.

## 5. One main action, one purpose

Each page: one eyebrow (kind icon + two or three facts), one h1 equal to the screen's title, one purpose line of at
most 140 characters, **exactly one main action** (filled with `action`), one next step. No button over every row; an
action on a row is the row's own link.

## 6. Names

**No real family's, child's or staff member's name or phone number is ever in git**: not in a wireframe, fixture, test
or screenshot. Sample data uses invented names only. A name is shown only on screens that need it, read at render
time; it never goes into a URL or a log (the address carries the lead's id).

## 7. A page is full, insight first

1. **No empty-looking region.** A blank stretch gets a second block built from data the tables really hold (counts by
   state, the last calls, a week strip). A figure no table can give is a gap, not an invention.
2. **Every table says what to notice**: a one-line takeaway, the outlier marked, a yardstick on each key number, worst
   first, sortable and filterable (brief §8). A flat grid of numbers is unfinished work.
3. **Anything that moves through stages is also a board.** The pipeline is wacrm's drag-and-drop board, restyled; a
   table of the same leads sits beside it behind a Table | Board toggle. A lane's count equals the table's rows in it.

## 8. Wireframes

A wireframe is `design/wireframes/<screen-id>.html`, drawn at 1440 and 400 px wide with the same markup, linking
`../tokens.css` and `../platform/components/blocks.css` and using only those blocks' classes. No `<script>`; no raw
colour or size. Every shown number names its source (`data-source="<table>.<column>"`); anything the schema cannot give
is marked `data-gap`. Nimish approves it with `loop approve <screen-id>`; only then is it built, and a build that
differs from it is a wireframe change first, approved again.

## 9. Components

Port, don't reinvent: `docs/design/platform-components.md` lists every platform component, whether it fits this stack,
and the ticket that ports it. wacrm's `src/components/ui/` (shadcn on Base UI) stays the base for controls (button,
input, select, dialog, sheet, table, tabs); they take this look through the theme bridge (shadcn names mapped onto
these tokens), not by being rewritten.
