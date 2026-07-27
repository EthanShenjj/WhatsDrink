---
name: Velvet Brew
colors:
  surface: '#fcf9f4'
  surface-dim: '#dcdad5'
  surface-bright: '#fcf9f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ee'
  surface-container: '#f0ede9'
  surface-container-high: '#ebe8e3'
  surface-container-highest: '#e5e2dd'
  on-surface: '#1c1c19'
  on-surface-variant: '#4f453f'
  inverse-surface: '#31302d'
  inverse-on-surface: '#f3f0eb'
  outline: '#81756e'
  outline-variant: '#d3c3bc'
  surface-tint: '#73594a'
  primary: '#321f13'
  on-primary: '#ffffff'
  primary-container: '#4a3427'
  on-primary-container: '#bb9c8b'
  inverse-primary: '#e1c0ae'
  secondary: '#97472c'
  on-secondary: '#ffffff'
  secondary-container: '#fe9978'
  on-secondary-container: '#772f16'
  tertiary: '#331f00'
  on-tertiary: '#ffffff'
  tertiary-container: '#503300'
  on-tertiary-container: '#ca9a54'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbc8'
  primary-fixed-dim: '#e1c0ae'
  on-primary-fixed: '#29170c'
  on-primary-fixed-variant: '#594234'
  secondary-fixed: '#ffdbd0'
  secondary-fixed-dim: '#ffb59d'
  on-secondary-fixed: '#390b00'
  on-secondary-fixed-variant: '#783017'
  tertiary-fixed: '#ffddb2'
  tertiary-fixed-dim: '#f2be73'
  on-tertiary-fixed: '#291800'
  on-tertiary-fixed-variant: '#624000'
  background: '#fcf9f4'
  on-background: '#1c1c19'
  surface-variant: '#e5e2dd'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Manrope
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  base: 8px
  container-padding: 20px
  gutter: 16px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 40px
---

## Brand & Style

The design system is centered on a "Creamy & Modern" aesthetic, tailored for a premium WeChat Mini Program experience. It targets health-conscious urban professionals who appreciate ritual and aesthetics in their daily habits.

The visual style is a blend of **Minimalism** and **Tactile Modernism**. It prioritizes high-quality negative space and a soft, organic feel. By utilizing generous rounded corners and a warm, low-contrast palette, the UI evokes a sense of calm and reliability. The emotional response should be one of "gentle encouragement"—making the act of tracking calories and caffeine feel like a moment of self-care rather than a chore.

## Colors

The palette is anchored by a warm, sophisticated foundation.
- **Primary:** Warm Brown (#4A3427), used for text, primary buttons, and structural icons to ensure readability and a "coffee-house" professional vibe.
- **Background:** Soft Cream (#F8F5F0), applied globally to reduce eye strain and provide a soft, paper-like canvas.
- **Accents:** A collection of muted, organic tones (Terracotta, Ochre, Sage, and Slate Blue) are used specifically to categorize drink types (e.g., Coffee, Tea, Juice, Water) in the choice wheel and summary charts.
- **Functional:** Success and Info states should use desaturated versions of the accent green and blue to maintain the calming atmosphere.

## Typography

The typography strategy focuses on a clean, modern hierarchy using **Manrope** for structure and **Be Vietnam Pro** for reading comfort.

- **Headlines:** Use Manrope with tight letter-spacing for a confident, architectural look.
- **Subheaders:** The "Label-Caps" style (e.g., "YOUR PROFILE") should be used sparingly above main titles to add a layer of editorial sophistication.
- **Body:** Be Vietnam Pro provides a friendly, contemporary feel for daily logs and descriptions. 
- **Hierarchy:** Ensure weight contrast is high; use Bold for primary data points (like calorie counts) and Regular for labels to guide the eye quickly to numerical values.

## Layout & Spacing

The layout follows a **Fluid Grid** model optimized for the WeChat Mini Program viewport.

- **Margins:** A consistent 20px horizontal margin ensures content doesn't feel cramped against the screen edges.
- **Rhythm:** An 8px base unit governs all spacing. Vertical stacks should favor larger gaps (24px+) to maintain the "airy" and "premium" brand promise.
- **Cards:** Use a 16px gutter between cards when presented in a list or grid.
- **Safe Areas:** Adhere strictly to the WeChat Top Bar and Bottom Tab Bar heights, ensuring the "Floating Action Button" (Add Drink) remains easily accessible within the thumb-zone.

## Elevation & Depth

Depth is achieved through **Tonal Layers** and **Ambient Shadows** rather than harsh borders.

- **Base Layer:** The Soft Cream (#F8F5F0) background.
- **Surface Layer:** Pure White (#FFFFFF) cards.
- **Shadows:** Use a "Cloud Shadow" technique—very high blur (20-30px), low opacity (8-12%), and a slight tint of the primary brown (#4A3427). This makes elements appear to float softly off the cream background.
- **Interaction:** On press, elements should slightly decrease in elevation (reduce shadow) to provide tactile feedback.

## Shapes

The shape language is **Ultra-Rounded**, mimicking organic forms found in ceramics and nature.

- **Main Containers:** A minimum of 24px border-radius for primary cards and content blocks.
- **Interactive Elements:** Buttons and input fields use a "Pill" or "Soft Rect" style (16px to 32px radius) to feel inviting and safe to touch.
- **Avatars & Icons:** Circular avatars with a soft outer stroke or subtle shadow to distinguish them from the background.

## Components

- **Buttons:** Primary buttons are solid Warm Brown (#4A3427) with white text. Secondary buttons use a Cream Dark (#EBE4D8) fill with brown text. Both feature 32px corner radii.
- **Input Fields:** Use a subtle background fill (#F2EEE8) instead of a border. Text should be inset 16px.
- **Cards:** White containers with 24px+ radius. Group related information (like "Today's Overview") into a single card to minimize visual clutter.
- **Progress Wheel/Calendar:** Use the defined accent colors for data visualization. Selected dates in the calendar should be indicated by a soft, tinted circle rather than a hard shape.
- **Tab Bar:** A frosted glass or solid cream bar with a subtle top border (#EBE4D8). Active states are indicated by the Primary Brown and a small 4px "pill" dash underneath the icon.
- **Chips/Filter:** Small pill-shaped buttons for quick categorization (e.g., "Hot", "Iced"), using a 50% opacity version of the primary color for unselected states.