# design/platform — frozen snapshot of the Cornerstone platform's design

Copied once on 2026-11-25 from `cornerstone-platform` at commit `dfedfe27c` (ADR 0003). That was the only access to
the platform repo; there is no link back. **Do not edit, import into `src/`, or refresh these files.** They are the
reference that port tickets (`design-port` label) copy from. Excluded from `tsconfig.json` and ESLint.

- Live tokens moved out to `design/tokens.css`. The design authority is root `DESIGN.md`; `DESIGN.md` and
  `PRINCIPLES.md` here are the platform's originals (PRINCIPLES.md is its older, superseded brand note; kept for history).
- What each component is and how to port it: `docs/design/platform-components.md`.
- Components that import platform modules not copied here (`@/lib/auth`, `menu`, `access`, `acting-as`, …) are
  rewritten against this repo's equivalents when ported.

## Manifest (sha256, first 16 hex · file here ← platform path)

| sha256 | File | Platform path |
|---|---|---|
| `6ddb3f39742518f2` | `DESIGN.md` | `docs/frontend/DESIGN.md` |
| `f484350dcc8b014a` | `PRINCIPLES.md` | `apps/web/design-system/PRINCIPLES.md` |
| `d7185f1e26fb29e5` | `brand/Cornerstone-logo-lockup-colour.svg` | `apps/web/public/brand/Cornerstone-logo-lockup-colour.svg` |
| `5436d5bc601632bc` | `brand/Cornerstone-logo-lockup-for-dark-backgrounds.svg` | `apps/web/public/brand/Cornerstone-logo-lockup-for-dark-backgrounds.svg` |
| `5e2a9ec712c3e8af` | `brand/Cornerstone-logo-mark-on-white-tile.svg` | `apps/web/public/brand/Cornerstone-logo-mark-on-white-tile.svg` |
| `b3468009a540998e` | `brand/Cornerstone-logo-mark.svg` | `apps/web/public/brand/Cornerstone-logo-mark.svg` |
| `78c67cb825ba1661` | `components/app-frame.tsx` | `apps/web/components/app-frame.tsx` |
| `9451333e6779d451` | `components/attention-strip.tsx` | `apps/web/components/attention-strip.tsx` |
| `30645ea17afc5780` | `components/blocks.css` | `apps/web/components/blocks.css` |
| `a05daf233d7beffd` | `components/brand-mark.tsx` | `apps/web/components/brand-mark.tsx` |
| `7432a16fc8caff1a` | `components/capture-bar.tsx` | `apps/web/components/capture-bar.tsx` |
| `73fb7ae6eacc6df8` | `components/cards.tsx` | `apps/web/components/cards.tsx` |
| `10e409765ff729fb` | `components/count-chip.tsx` | `apps/web/components/count-chip.tsx` |
| `c1195698871cfbf5` | `components/count.tsx` | `apps/web/components/count.tsx` |
| `87fd589f4e29eed8` | `components/crumbs.tsx` | `apps/web/components/crumbs.tsx` |
| `8dc4c52e46eac5c0` | `components/data-table.tsx` | `apps/web/components/data-table.tsx` |
| `807f58576d518564` | `components/detail-panel-client.tsx` | `apps/web/components/detail-panel-client.tsx` |
| `052dde75717dd0ed` | `components/detail-panel.tsx` | `apps/web/components/detail-panel.tsx` |
| `3db4a7b724e6debc` | `components/details.tsx` | `apps/web/components/details.tsx` |
| `b11eaaa478648e74` | `components/drop-zone.tsx` | `apps/web/components/drop-zone.tsx` |
| `bfba1e513d1d7dfb` | `components/empty-state.tsx` | `apps/web/components/empty-state.tsx` |
| `384c23384d42b277` | `components/filter-bar.tsx` | `apps/web/components/filter-bar.tsx` |
| `6d54fe94138e6346` | `components/fold.tsx` | `apps/web/components/fold.tsx` |
| `bed75a9ed14e3f45` | `components/form.tsx` | `apps/web/components/form.tsx` |
| `31291daacbd198b2` | `components/frame/foot-links.tsx` | `apps/web/components/frame/foot-links.tsx` |
| `6d9634976315afc6` | `components/frame/help-link.tsx` | `apps/web/components/frame/help-link.tsx` |
| `8ee971721c2ea456` | `components/frame/person.tsx` | `apps/web/components/frame/person.tsx` |
| `c9155975a40acbd0` | `components/frame/search-box.tsx` | `apps/web/components/frame/search-box.tsx` |
| `d3716ffd42489f81` | `components/frame/top-nav.tsx` | `apps/web/components/frame/top-nav.tsx` |
| `de609a0ef1a9558b` | `components/frame/walk.tsx` | `apps/web/components/frame/walk.tsx` |
| `498b3e0b12339217` | `components/heat-grid.tsx` | `apps/web/components/heat-grid.tsx` |
| `ed7891ddff4fe248` | `components/kanban-board.tsx` | `apps/web/components/kanban-board.tsx` |
| `19d37e7c3662e259` | `components/key-value.tsx` | `apps/web/components/key-value.tsx` |
| `0214b0d2a6a15b0b` | `components/kind-tile.tsx` | `apps/web/components/kind-tile.tsx` |
| `0387bc977c44dcef` | `components/level-bars.tsx` | `apps/web/components/level-bars.tsx` |
| `216428711837561a` | `components/link.tsx` | `apps/web/components/link.tsx` |
| `4e2f75012814b268` | `components/open-section.tsx` | `apps/web/components/open-section.tsx` |
| `922b8a93ac4297d3` | `components/outcome-states.ts` | `apps/web/components/outcome-states.ts` |
| `9941693c1c829afd` | `components/parts.tsx` | `apps/web/components/parts.tsx` |
| `c15191444d2a160c` | `components/spark.tsx` | `apps/web/components/spark.tsx` |
| `1a9cb0fd267691bc` | `components/stack-bar.tsx` | `apps/web/components/stack-bar.tsx` |
| `2c2ebcbfddb5629d` | `components/stat-tile.tsx` | `apps/web/components/stat-tile.tsx` |
| `494e950798186824` | `components/status-chip.tsx` | `apps/web/components/status-chip.tsx` |
| `c06468a40da38e14` | `components/stepper.tsx` | `apps/web/components/stepper.tsx` |
| `a4b313b85c3087e1` | `components/timeline.tsx` | `apps/web/components/timeline.tsx` |
| `7258028313b89d7e` | `components/trail.tsx` | `apps/web/components/trail.tsx` |
| `3452b8ec9835793f` | `components/trend.tsx` | `apps/web/components/trend.tsx` |
| `d18141563438ef90` | `components/ui/button.tsx` | `apps/web/components/ui/button.tsx` |
| `e2782aa8b288522d` | `components/ui/tabs.tsx` | `apps/web/components/ui/tabs.tsx` |
| `f83ff13be15f9094` | `globals.css` | `apps/web/app/globals.css` |
| `6b543bae1c57071e` | `lib/icons.tsx` | `apps/web/lib/icons.tsx` |
| `8d9d4e2e3ffa777a` | `lib/state-scale.ts` | `apps/web/lib/state-scale.ts` |
| `7c8c3dfc0cdd370d` | `lib/utils.ts` | `apps/web/lib/utils.ts` |
| `05d8bb8361c0ccdf` | `lib/ux-rules.ts` | `apps/web/lib/ux-rules.ts` |
| `1d0875d5328c7dde` | `tokens.json` | `docs/frontend/tokens.json` |
| `38dfe19d1e604b43` | `../tokens.css` (header rewritten) | `apps/web/design-system/tokens.css` |
