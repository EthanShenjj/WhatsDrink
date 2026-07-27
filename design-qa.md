# Choice One Dual-Mode Design QA — 2026-07-26

**Source visual truth**

- Mode-toggle reference: `docs/audit/2026-07-26-choice-modes/reference-mode-toggle.png`
- Mode-toggle source pixels: `538 × 334`
- Claw-machine appliance reference: `docs/audit/2026-07-26-choice-modes/reference-claw-appliance.jpg`
- Claw-game interaction reference: `docs/audit/2026-07-26-choice-modes/reference-claw-game.jpg`
- Claw-game source pixels: `1080 × 2348`
- Reported overflow screenshot: `docs/audit/2026-07-26-choice-modes/reference-claw-overflow.png`
- Intended state: Choice One header with a two-option segmented control; wheel mode selected by default; claw mode shows a dense pile of generic cups while independently choosing every current candidate with equal probability, revealing the brand only after a cup is caught.

**Implementation evidence**

- Wheel mode: `docs/audit/2026-07-26-choice-modes/implementation-wheel-mode.png`
- Claw mode top: `docs/audit/2026-07-26-choice-modes/implementation-claw-mode-top.png`
- Claw machine interaction region: `docs/audit/2026-07-26-choice-modes/implementation-claw-machine.png`
- Motion checkpoints: `docs/audit/2026-07-26-choice-modes/implementation-claw-lowering.png`, `implementation-claw-gripping.png`, `implementation-claw-lifting.png`, `implementation-claw-releasing.png`, and `implementation-claw-rolling.png`
- Claw result: `docs/audit/2026-07-26-choice-modes/implementation-claw-result.png`
- Motion contact sheet: `docs/audit/2026-07-26-choice-modes/claw-motion-contact-sheet.png`
- Simulator pixels: `780 × 1506`
- CSS viewport: `390 × 753` at `2×`
- Runtime: WeChat Developer Tools
- Primary interactions tested: enter claw mode, verify `14` generic cups are rendered without inner labels, run a random grab through lowering → gripping → lifting → releasing → rolling → won, verify the revealed result belongs to the five logical candidates, verify the page scroll position does not move, and retain the “就喝这个” continuation.
- Automated result: visual cup count `14`; candidate labels `星巴克 / 瑞幸 / Manner / Tims / M Stand`; the final verification randomly grabbed `Manner`; scroll position stayed at `340` throughout the grab.
- Runtime exceptions during the final interaction capture: none.

**Normalization and comparison evidence**

- Mode-toggle comparison: `docs/audit/2026-07-26-choice-modes/mode-toggle-comparison.png`
  - The `538 × 334` reference was normalized to `780 × 484`.
  - The implementation header was cropped to the same `780 × 484` physical region.
- Claw-machine comparison: `docs/audit/2026-07-26-choice-modes/claw-machine-comparison.png`
  - The social-media/device chrome was removed from the reference using an `868 × 1350` content crop.
  - Reference and implementation claw-machine regions were normalized to `780 × 1214`.
  - The reference characters are treated as interaction/layout inspiration only; the implementation deliberately uses real WhatsDrink candidates and an original unbranded machine asset.
- Overflow fix comparison: `docs/audit/2026-07-26-choice-modes/claw-overflow-comparison.png`
  - The `514 × 636` reported screenshot and an equal-size post-fix implementation crop are shown side by side.
  - The fixed prize viewport follows the glass-chamber bounds and clips transformed candidates before the machine edge.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: both tabs match the reference hierarchy, weight, alignment, and short-label readability; active and inactive labels remain centered with no wrapping.
- Spacing and layout rhythm: the segmented control uses a compact content-fit width, a larger intentional gap below the intro, full pill radius, and clear active-state depth. The claw machine follows the reference’s vertical rail → claw → dense loose prize pile → control → tray hierarchy.
- Colors and visual tokens: the active mode uses existing coffee brown `#321F13`; the inactive surface stays warm white; the machine uses the same warm cream, terracotta, and coffee palette as the rest of the app.
- Image quality and asset fidelity: `miniprogram/assets/claw-machine-empty.webp`, `miniprogram/assets/claw-arm.webp`, and `miniprogram/assets/claw-prize-cup.webp` are optimized raster assets created for this app. The transparent arm and cup cutouts support physical motion without a duplicate baked-in claw; all runtime assets are below WeChat’s `200 KB` resource limit, and the lossless source PNGs remain in the audit archive.
- Copy and content: the exact requested labels “纠结转盘” and “抓娃娃机” are present. Claw instructions are product-specific and concise.
- Behavior and accessibility: both modes are functional tabs with selected state; the claw’s visual cup selection is independent from the validated uniform brand chooser, each logical candidate owns an equal-width random interval, repeated input is disabled throughout the motion, progress remains high-contrast on the primary button, claw completion no longer triggers haptics, and the random result is reused in “记一杯”.

**Comparison history**

- Pass 1
  - Earlier P1: the Stitch dual-mode switch was omitted, making the claw-machine experience inaccessible.
  - Fix: restored the segmented control and added a fully interactive claw mode using the same editable wheel candidates.
  - Post-fix evidence: `implementation-wheel-mode.png`, `implementation-claw-mode-top.png`, and successful automation output.
- Pass 2
  - Earlier P2: the first implementation used a `624rpx` full-width switch and a `48rpx` intro gap, which appeared wider and denser than the selected reference.
  - Fix: tightened the switch to `480rpx` and increased the intro gap to `72rpx`.
  - Post-fix evidence: `mode-toggle-comparison.png`.
- Pass 3
  - Earlier P2: the grabbed candidate reappeared in the prize row after the result state completed.
  - Fix: keep the selected candidate removed through both `grabbing` and `won` states; moving again resets the result and restores the carousel.
  - Post-fix evidence: `implementation-claw-result.png`.
- Pass 4
  - Earlier P1: the prize carousel viewport extended beyond the generated machine’s glass chamber, allowing transformed candidates to appear outside the cabinet.
  - Fix: reduced the horizontal prize viewport from `70rpx` to `132rpx` side insets, recalculated the centered track offset from `214rpx` to `148rpx`, removed the unreliable gradient mask, and forced the overflow container into its own clipped paint layer.
  - Post-fix evidence: `claw-overflow-comparison.png`, `implementation-claw-machine.png`, and `implementation-claw-result.png`.
- Pass 5
  - Earlier P1: the claw behaved like a directed carousel, so users could aim at a chosen brand instead of receiving a random result.
  - Fix: removed directional controls and target-index resolution; render every active-wheel brand in the machine pool and resolve each grab through the shared uniform random chooser.
  - Post-fix evidence: automation reported `poolCount = candidateCount = 5`, returned a result contained in the pool, continued to `pages/record-form/index`, and recorded zero exceptions.
- Pass 6
  - Earlier P1: the complete pool was rendered as an orderly grid of white cards, visually attached to the glass instead of behaving like prizes in a real claw machine.
  - Fix: generated a transparent photorealistic drink-cup asset, placed brand names on the cup labels, removed all card surfaces, and scattered the cups at varied rotations, scales, overlap depths, and floor offsets inside the clipped cabinet.
  - Post-fix evidence: `claw-machine-comparison.png`, `implementation-claw-machine.png`, and `implementation-claw-result.png`.
- Pass 7
  - Earlier P2: the “池中 5 个品牌” status pill added unnecessary UI chrome across the physical machine controls.
  - Fix: removed the status pill entirely; grabbing progress remains visible on the single primary button and the final result panel.
  - Post-fix evidence: `implementation-claw-machine.png` and `implementation-claw-result.png`.
- Pass 8
  - Earlier P1: a baked-in static claw could only make the selected cup disappear; it did not communicate a physical grab.
  - Fix: separated the empty machine background, mechanical claw, and drink prize into real raster layers; added a timed lowering → gripping → lifting → releasing → rolling state machine; the selected cup follows the claw, drops, and rolls out of the lower chute before the result appears.
  - Post-fix evidence: `claw-motion-contact-sheet.png`, the five motion-state captures, successful continuation to `pages/record-form/index`, and zero runtime exceptions.
- Pass 9
  - Earlier P1: five branded cups looked sparse, overlapping labels were obstructed, the disabled progress button lost contrast, and the claw-completion vibration was perceived as a screen shake.
  - Fix: decoupled the `14` generic visual cups from the logical candidate array, removed all labels inside the cabinet, reveal the selected brand only on the carried/output cup and final result, restored a dark high-contrast busy button, and removed claw haptics.
  - Probability check: deterministic unit coverage confirms each candidate maps to an equal-width interval; the independently chosen visual cup index cannot change the selected brand.
  - Stability check: automation reported `scrollTopBeforeGrab = 340` and `scrollTopAfterResult = 340`, with zero runtime exceptions.
  - Post-fix evidence: `implementation-claw-machine.png`, `implementation-claw-releasing.png`, and `implementation-claw-result.png`.

**Implementation checklist**

- Two-mode switch restored and state persisted.
- Wheel canvas redraws when returning from claw mode.
- Dense generic cup pool, equal-probability candidate selection, articulated claw sequence, brand reveal, chute roll-out, stable viewport, and reduced motion implemented.
- Existing wheel editing and record-prefill flows reused.
- Original empty-machine, mechanical-claw, and transparent drink-prize raster assets saved in the project.
- Unit tests cover first/last resolution and equal-width random intervals for every candidate.
- Simulator comparison and interaction checks passed.

final result: passed

---

# WhatsDrink Stitch Global UI Design QA — 2026-07-26

**Source visual truth**

- Stitch project: `https://stitch.withgoogle.com/projects/15755825131981699103`
- Exported home reference: `docs/audit/2026-07-26-stitch-global-ui/reference-home.png`
- Exported design tokens: `docs/audit/2026-07-26-stitch-global-ui/source/DESIGN.md`
- Exported screen implementations: `docs/audit/2026-07-26-stitch-global-ui/source/screen-1.html` through `screen-7.html`
- Source home pixels: `780 × 1668`
- Source home CSS viewport: `390 × 834` at `2×`
- Source state: 2026-07-26, one Starbucks latte record, one unknown-calorie record

**Implementation evidence**

- Home: `docs/audit/2026-07-26-stitch-global-ui/implementation-home.png`
- Calendar: `docs/audit/2026-07-26-stitch-global-ui/implementation-calendar.png`
- Choice One: `docs/audit/2026-07-26-stitch-global-ui/implementation-choice.png`
- Profile: `docs/audit/2026-07-26-stitch-global-ui/implementation-profile.png`
- Profile edit: `docs/audit/2026-07-26-stitch-global-ui/implementation-profile-edit.png`
- Record form/login state: `docs/audit/2026-07-26-stitch-global-ui/implementation-record-form.png`
- Wheel editor: `docs/audit/2026-07-26-stitch-global-ui/implementation-wheel-edit.png`
- Core-screen contact sheet: `docs/audit/2026-07-26-stitch-global-ui/core-screens-contact-sheet.png`
- Implementation pixels: `780 × 1506` per screen
- Implementation CSS viewport: `390 × 753` at `2×`
- Runtime: WeChat Developer Tools simulator
- Primary interaction tested: standard-motion wheel spin completed and produced a valid `瑞幸` result
- Runtime exceptions observed during final four-screen capture: none

**Density and viewport normalization**

- The source home includes a `56px` prototype-only custom header while the mini program uses native navigation.
- The source was normalized by cropping `112` physical pixels from the top, producing a `780 × 1506` content image.
- The normalized source and implementation were then compared at the same physical size and `2×` density.
- Full comparison: `docs/audit/2026-07-26-stitch-global-ui/home-comparison.png`
- Focused overview-card comparison: `docs/audit/2026-07-26-stitch-global-ui/home-summary-focused-comparison.png`

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the Stitch hierarchy, display scale, caps labels, weights, wrapping, and truncation are preserved. The native mini program intentionally uses PingFang/system fallbacks instead of remote Manrope and Be Vietnam Pro web fonts; this is an expected runtime constraint.
- Spacing and layout rhythm: `40rpx` page gutters, spacious white cards, pill controls, rounded `32–48rpx` surfaces, cloud shadows, and bottom safe-area spacing consistently follow the reference. No overlap or horizontal clipping is visible at `390px`.
- Colors and visual tokens: the implementation maps the warm `#FDFCFB` surface, dark coffee `#321F13`, terracotta `#97472C`, muted `#4F453F`, and outline `#81756E` palette across pages, controls, navigation, and wheel segments.
- Image quality and asset fidelity: existing local drink and profile assets remain sharp and correctly masked. Dynamic user/product imagery is intentionally retained instead of replacing real app data with Stitch sample imagery.
- Copy and content: the app keeps its existing product copy and business data while adopting the Stitch hierarchy. Choice One now includes the Stitch “纠结转盘 / 抓娃娃机” mode labels and uses the same editable candidate data in both experiences.
- Icons and controls: existing local icon components remain visually consistent, with practical touch targets and accessible labels. No emoji, placeholder illustration, or new handcrafted SVG substitute was introduced.
- Interaction and accessibility: the wheel now paints through the mini-program legacy canvas commit path, supports reduced motion, completes its primary spin flow, and returns a usable result. Native controls retain semantic roles, labels, disabled states, and safe-area spacing.

**Comparison history**

- Pass 1
  - Earlier findings: profile-edit title alignment and native save width drifted; the record form used a compact photo row; core cards and tab navigation still carried the previous paper/orange visual language.
  - Fixes: applied the Stitch palette and global spacing tokens; rebuilt titles, cards, form fields, photo upload, actions, and tab bar around the exported design system.
  - Post-fix evidence: the seven implementation screenshots listed above.
- Pass 2
  - Earlier finding: the Choice One wheel occupied layout space but rendered transparent, a P1 failure of the core experience.
  - Fix: replaced the cross-component node-canvas path with page-owned native `canvas-id` drawing and explicit `context.draw()` commits, while preserving standard and reduced-motion behavior.
  - Post-fix evidence: `implementation-choice.png`; automation also completed a standard-motion spin and returned `瑞幸`.
- Pass 3
  - Earlier finding: the home “记一杯” CTA retained a native intrinsic width, a P2 mismatch against the full-width Stitch action.
  - Fix: added an explicit full-width native-button override with reset margins and no max width.
  - Post-fix evidence: `home-comparison.png` and `home-summary-focused-comparison.png`; final button size is `300 × 54` CSS px inside the `300px` card content width.

**Open questions / accepted variances**

- P3: native PingFang/system text has slightly different glyph metrics from the web-only Manrope and Be Vietnam Pro fonts.
- P3: live drink/profile images and dynamic content differ from the static Stitch samples by design.
- The source and implementation use different navigation runtimes; the comparison removes the prototype-only header and retains the native mini-program navigation behavior.

**Implementation checklist**

- Global tokens, page background, navigation, cards, buttons, and typography updated.
- Home, calendar, Choice One, profile, profile edit, record form, wheel editor, privacy popup, and reusable login surface aligned.
- Core wheel drawing and spin interaction verified.
- Source/implementation full comparison and focused comparison inspected.
- Project validation, TypeScript, and automated tests passed.
- Final simulator capture reported zero runtime exceptions.

final result: passed

---

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

# WhatsDrink Login Sheet Design QA

**Source visual truth**

- Reported defect screenshot: `/var/folders/bp/yjy37w_x5tgc2rp4yq9r4t4h0000gn/T/codex-clipboard-2d764fb9-2211-4761-8bbe-077c162808f6.png`
- Source pixels: `604 × 468`
- Intended outcome: replace the compressed avatar card and overlapping horizontal actions with a clean, stable mobile login layout
- State: unauthenticated user opening “记一杯”

**Implementation evidence**

- Full simulator screenshot: `/private/tmp/whatsdrink-login-sheet-latest.png`
- Normalized simulator screenshot: `/private/tmp/whatsdrink-login-sheet-latest-small.png`
- Focused side-by-side comparison: `/private/tmp/whatsdrink-login-comparison.png`
- Simulator pixels: `780 × 1506`
- Normalized viewport: `390 × 753` CSS px at `2×` capture density
- State: record form with the reusable WeChat login sheet visible
- Console exceptions checked through the mini-program automation connection: none
- Primary rendered state checked: sheet opening, avatar selector layout, nickname field, primary action, cancel action

**Findings**

- No remaining P0, P1, or P2 visual issues in the requested region.
- The avatar selector is now an independent `120rpx` circular control with a camera badge and no native-button card width dependency.
- The primary and cancel actions are vertically separated. The primary action spans the form width and the cancel action is a lightweight text button, so the previous overlap mechanism is absent.

**Required fidelity surfaces**

- Fonts and typography: existing system font stack is preserved; title, field label, helper text, and actions have distinct readable weights without truncation.
- Spacing and layout rhythm: avatar, helper copy, nickname field, primary action, and cancel action follow a consistent vertical rhythm; no horizontal overflow is visible.
- Colors and visual tokens: the existing warm paper, brown accent, muted gray, and near-black action colors remain consistent with the product.
- Image quality and asset fidelity: the selected avatar uses a circular image mask; the existing local user and camera icons render sharply with no placeholder asset substitution.
- Copy and content: avatar purpose, required nickname state, confirmation, cancellation, and privacy note remain visible and understandable.

**Comparison history**

- Pass 1: the reported screenshot showed a P1 compressed avatar card caused by a native `button` carrying the full card layout, plus P1 overlapping horizontal actions caused by native button intrinsic widths.
- Fix: moved the native avatar button into a fixed circular control inside a regular Flex row; changed actions to a vertical primary-button and text-cancel hierarchy; added explicit native-button width overrides.
- Pass 2: the post-fix simulator screenshot at `390 × 753` shows the avatar selector at its intended size, the primary action aligned with the nickname field, and no action overlap.

**Focused region comparison**

- The side-by-side comparison isolates the reported avatar and action region. It is sufficient because the request concerns only the login sheet and all relevant typography, controls, spacing, icons, and states are readable in the focused crop.

**Implementation checklist**

- Avatar selector no longer depends on native button card sizing.
- Primary and cancel actions no longer share a horizontal row.
- Narrow-screen spacing remains controlled by the existing media query.
- Login behavior and required-field validation remain unchanged.

**Follow-up polish**

- No blocking polish remains for this request.

final result: passed

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
