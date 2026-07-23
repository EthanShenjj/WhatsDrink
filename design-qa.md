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
