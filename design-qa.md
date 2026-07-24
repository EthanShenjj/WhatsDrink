# WhatsDrink Calendar Design QA

**Source visual truth**

- Selected concept: `docs/design/calendar-selected.png`
- Source pixels: `937 × 1678`
- Intended comparison region: calendar app content at `390 × 700` CSS px
- Source density: approximately `2.40×`
- State: July 2026, Thursday July 23 selected and marked as today, with coffee and milk-tea record stamps

**Implementation evidence**

- Implementation screenshot: unavailable
- Implementation surface: `miniprogram/pages/calendar/index`
- Intended simulator viewport: `390 × 844` CSS px, comparing the top `390 × 700` calendar region
- Primary interactions checked in code: previous month, next month, select date, add record, edit record
- Console errors checked: unavailable

**Findings**

- [P1] Native implementation cannot be visually compared yet
  - Location: calendar header, seven-column month grid, selected-day paper tab, drink stamps, and selected-day summary.
  - Evidence: the selected source visual is available and the implementation compiles, but WeChat Developer Tools CLI service access is disabled, so no post-change simulator screenshot can be captured.
  - Impact: the new non-native Flex grid removes the known button overflow mechanism, but exact typography, spacing, icon rendering, safe area, and visual fidelity cannot be confirmed from source code alone.
  - Fix: recompile the mini program, capture the calendar at `390 × 844` with July 23 selected, and compare its top `390 × 700` region with `docs/design/calendar-selected.png`.

**Required fidelity surfaces**

- Fonts and typography: code uses the existing Songti serif stack; rendered weight, fallback, wrapping, and antialiasing remain blocked.
- Spacing and layout rhythm: seven equal Flex columns and five-or-six week rows are implemented; rendered dimensions remain blocked.
- Colors and visual tokens: existing paper, ink, terracotta, brown, and blue tokens are used; rendered opacity remains blocked.
- Image quality and asset fidelity: selected-day record rows use existing drink photos and TDesign drink icons; final crop and sharpness remain blocked.
- Copy and content: month title, weekday labels, today marker, selected-day summary, and actions are statically checked.

**Comparison history**

- Pass 1: selected source inspected; implementation rebuilt around fixed-width Flex cells and non-native interactive views. Post-change visual capture unavailable, so no visual comparison was possible.

**Implementation checklist**

1. Recompile in WeChat Developer Tools.
2. Navigate to July 2026 and select July 23.
3. Capture the full simulator at `390 × 844`.
4. Compare the calendar region with the selected source.
5. Fix any remaining P0/P1/P2 typography, spacing, state, or icon differences.

**Follow-up polish**

- Confirm that five-week and six-week months both keep a balanced distance above the selected-day summary.
- Confirm the blue and brown drink stamps remain legible on Android font and icon rendering.

final result: blocked

---

# WhatsDrink Wheel Editor Delete Control QA

**Source visual truth**

- Requested source screenshot: `/var/folders/bp/yjy37w_x5tgc2rp4yq9r4t4h0000gn/T/codex-clipboard-61601cab-cd56-40b9-abdb-51a91dbee287.png`
- Source pixels: `340 × 422`
- State: wheel editor with five candidate rows
- Requested change: remove the visible “移除” copy and retain the delete icon

**Implementation evidence**

- Implementation surface: `miniprogram/pages/wheel-edit/index`
- Post-change screenshot: unavailable
- Static evidence: the visible text node was removed; the icon-only control retains its candidate-specific accessible label and a `72rpx × 72rpx` hit area

**Required fidelity surfaces**

- Fonts and typography: the unwanted “移除” label is absent from the template.
- Spacing and layout rhythm: the trailing action column was reduced from `100rpx` to `72rpx`.
- Colors and visual tokens: the existing danger color remains unchanged.
- Image quality and asset fidelity: the existing local delete icon remains unchanged.
- Copy and content: only the visible action copy was removed; the accessibility label remains.

**Verification**

- Project validation: passed
- TypeScript: passed
- Automated tests: 17 passed
- WXML structure check: 11 templates passed
- Post-change visual comparison: blocked because the WeChat Developer Tools simulator capture is unavailable

**Comparison history**

- Pass 1: source screenshot inspected, visible text removed, action column tightened, and static checks passed. A rendered simulator screenshot is still required for visual comparison.

final result: blocked

---

# WhatsDrink Wheel Editor Design QA

**Source evidence**

- Reported implementation screenshot: `docs/audit/2026-07-24-wheel-edit-review/01-editor-before.png`
- Implementation surface: `miniprogram/pages/wheel-edit/index`

**Fixes implemented**

- Split the eyebrow and page title into a stable vertical hierarchy.
- Rebuilt the add-candidate area as two labeled, full-width form rows.
- Replaced layout-sensitive native add/remove buttons with fixed-width accessible views and existing local icons.
- Rebuilt candidate rows as fixed three-column layouts.
- Normalized the save, copy, and delete action widths and hierarchy.

**Verification**

- Project validation: passed
- TypeScript: passed
- Automated tests: 17 passed
- WXML structure check: 11 templates passed
- Post-change implementation screenshot: unavailable
- Console errors after rendering: unavailable

**Remaining gate**

- Recompile and capture the editor with five candidates.
- Confirm that the title is on two lines, add actions stay fixed on the right, every remove action is right-aligned, and the save button spans the form width.

final result: blocked

---

# WhatsDrink Choice One Follow-up QA

**Source evidence**

- Reported implementation screenshot: `docs/audit/choice-one-toolbar-before.png`
- Second-pass implementation screenshot: `docs/audit/choice-one-panel-before-second-pass.png`
- Screenshot state: five candidates, standard motion, no result selected
- Implementation surface: `miniprogram/pages/choice/index`

**Visible findings and fixes**

- [P1] Current wheel name collapsed to an arrow-only control.
  - Cause: the native `picker` was used directly as a CSS Grid item and collapsed to its smallest intrinsic width in the mini-program renderer.
  - Pass 1 fix: placed the native control inside a regular Flex child with `flex: 1` and `min-width: 0`.
  - Pass 2 evidence: the native picker still collapsed when sharing the row with native buttons, leaving the label vertically wrapped.
  - Pass 2 fix: moved the picker to its own full-width row and placed the label outside the native control.
- [P2] Edit and create actions floated without a clear relationship to the selected wheel.
  - Pass 1 fix: grouped the wheel selector and actions inside one bordered panel.
  - Pass 2 fix: replaced the two native action buttons with fixed-width accessible views using the existing local icon component, preventing native intrinsic widths from spreading them across the panel.
- [P2] The motion preference looked like a primary action and consumed half the row.
  - Fix: moved it to the panel header as a compact secondary status pill while preserving its pressed state and accessible label.
- [P2] The eyebrow and page title shared one line and competed visually.
  - Fix: made both block-level and tightened the title scale and vertical rhythm.
- [P3] The wheel and CTA were slightly oversized relative to the information density.
  - Fix: reduced the wheel to `520rpx` and gave the CTA an explicit centered `440rpx` width.

**Verification**

- Project validation: passed
- TypeScript: passed
- Automated tests: 16 passed
- WXML structure check: 10 templates passed
- Post-change implementation screenshot: unavailable
- Console errors after rendering: unavailable

**Remaining gate**

- Recompile the mini program and capture Choice One in the same five-candidate state.
- Confirm the full wheel name occupies its own row, the action icons remain grouped at the bottom right, and the panel has no horizontal overflow.

final result: blocked
