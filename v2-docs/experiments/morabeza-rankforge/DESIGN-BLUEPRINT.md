# Design Blueprint

_Single-page marketing site with 4 routed pages (Home, About, Services, Contact) · SEO & Digital Growth Agency (B2B service agency), Nairobi-focused_

> Business Facts provenance: `onboarding-submission:fd8a09fe-3036-45e6-8769-47707257c59f#fact-snapshot` (immutable, supplied separately to the builder — this document deliberately does not own business content).

## 01 · Project Frame

- **Page job**: Turn a search-visits visitor into a booked strategy call: establish SEO expertise instantly, show the service catalog, prove outcomes, answer objections, then convert via contact/newsletter.
- **Design character**: Confident, modern agency-premium: cinematic dark-purple photography bands alternating with airy lavender/white card work; capsule geometry everywhere; small vivid-purple accents carrying all interactive energy; floating white data chips as the recurring proof motif.
- **Reference design thesis**: A cinematic dark-plum photographic hero with a floating dark glass panel anchors a page that then alternates pale lavender and white card bands; one vivid purple accent drives every action, and content lives in soft rounded cards with pale icon tiles and floating stat chips.

- **Anti-pattern**: The generic template to forbid: a generic white SaaS landing page — evenly spaced 3-card feature grid with gradient icon circles, a centered hero with one blue gradient button, stock-testimonial trio with gray avatars, and a navy footer. Equally forbidden: default-Tailwind blue/purple gradients on white, uniform card rows with no surface rhythm, and copy-led sections with no photographic anchor.

## 02 · Design DNA — Non-Negotiable Rules

- Full-bleed cinematic hero (~100vh) built on a duotone-washed photograph (deep purple-to-violet gradient overlay at ~0.75-0.85 opacity) with a dark inset panel on the left holding eyebrow chip + two-weight H1 + two short intro paragraphs + capsule CTA [OBSERVED]
- Purple rounded 'eyebrow chip' (pale lavender ground, dark purple label) precedes every section heading; H2 headings mix a light-weight opening phrase with a bold emphasis phrase [OBSERVED]
- Every primary action is a purple capsule (pill) button with a small trailing circular icon; secondary 'learn more' links are outlined capsules [OBSERVED]
- Section surfaces alternate: dark photographic hero → pale lavender band → white band → purple band → white → dark photographic → white → dark; cards always sit on white with soft diffuse shadows [OBSERVED]
- Service/feature cards use the same vocabulary everywhere: pale-lavender rounded icon tile (top-left), dark H3, ~15px gray body, purple capsule CTA; no gradients, no icon rivers, no shadows stronger than 0.08 alpha [OBSERVED]
- Data-callout motif: floating white rounded chips carrying a bold metric + small label, layered over photographs (a recurring signature in the Why-Choose band and testimonial cards) [OBSERVED]
- Indigo accordion bars with white labels for collapsed FAQ items; the expanded item flips to a white card with dark text and a leading indigo chip [OBSERVED]
- Dotted-grid / sparkle decorative motifs in pale purple punctuate empty corners of light sections; one flat-illustration contact motif allowed in the FAQ band [OBSERVED, lightly used]

## 03 · Design Tokens

### Color

| Role | Value | Usage |
|---|---|---|
| ground-dark | `#150A26` | hero wash base, header solid state, footer, contact band |
| ground-dark-2 | `#2A0E4F` | photo overlay gradient end / deep plum panels |
| surface-pale | `#F3EFFB` | about band, why-choose band, eyebrow chips |
| surface-lavender | `#E4DBF6` | icon tiles, checklist chips, decorative dots |
| card | `#FFFFFF` | all cards on light and inside dark bands |
| ink | `#1C1030` | H1/H2/H3 on light grounds |
| ink-soft | `#4A4360` | body text on light grounds |
| ink-muted | `#6F688A` | captions, card body |
| ink-on-dark | `#D9D0EE` | body text on dark grounds |
| primary | `#7C3AED` | all CTAs, active accents, collapsed FAQ bars, star fills |
| primary-deep | `#5B21B6` | CTA hover, gradient washes |
| accent-soft | `#E3DAF5` | card borders on light, input borders, hairlines |

### Typography

- **Display**: 'Inter', system-ui, -apple-system, sans-serif — 300 for light lead phrases, 700/800 for bold emphasis segments; tight leading 1.05–1.2
- **Body/UI**: 'Inter', system-ui, sans-serif — 400 body, 500 labels/buttons, 600 card headings, 700 bold display segments

| Element | Family/weight | Size | Line-height | Measure |
|---|---|---|---|---|
| Hero H1 | Inter 700 | `clamp(34px, 4.6vw, 56px)` | , | 22ch |
| H1 bold emphasis lines | Inter 800 | `same as hero` | , | 22ch |
| Section H2 | Inter 700 | `clamp(30px, 3.6vw, 44px)` | , | 26ch |
| Card H3 | Inter 700 | `20px` | , | 24ch |
| Body L | Inter 400 | `16px` | , | 62ch |
| Body | Inter 400 | `15px/1.65` | , | 60ch |
| Eyebrow chip label | Inter 600 | `12–13px` | , | 18ch |
| Nav link | Inter 400 | `15px` | , | 16ch |

### Shape & layout

- **Radius**: Chips/buttons: 999px (capsule). Cards: 16px. Photo/feature cards: 20px. Icon tiles: 14px. Stat chips: 12px. Header CTA: 
- **Shadows**: Cards: 0 6px 24px rgba(20,10,40,.06); hover lift: 0 12px 30px rgba(20,10,40,.10). Floating stat chips: 0 10px 30px rgba(20,10,40,.18). No inset or colored glows.

- **Container**: 1240px max, 24px side padding (5vw below 1280px)
- **Section spacing**: Dark/photographic bands: 120px vertical padding. Light bands: 96px. Between like-surface bands: 0 (bands are contiguous). Card grids: 24px gap, 32px on wide cards.
- **Image treatment**: All photos duotone-washed on dark grounds with purple gradient overlay (rgba(21,10,38,.55)→rgba(124,58,237,.35), 135deg); natural but slightly desaturated on light grounds. Cards radius 16px; photo cards radius 20px.

## 04 · Global Chrome

**Header** — Fixed header, full-width, no boxed container. Left: white wordmark (icon + 'RankForge Kenya') on a subtle dark scrim. Right: 6 nav links (white, 15px, 400wt, 32px gap) + capsule CTA button ('Book a Free Strategy Call' [ADAPTATION], purple, 15px, trailing arrow-circle icon) + white circle-outline hamburger button (48px) for mobile.

Header states:

- [OBSERVED] transparent over the hero with a very subtle dark gradient scrim top (rgba(0,0,0,.35) to transparent, 120px tall)
- [OBSERVED, INFERRED] solid state after scroll >80px: dark plum ground (#12081F) with a 1px rgba(255,255,255,.08) bottom hairline, 200ms ease transition
- [INFERRED] active-section nav link underlined in purple or 60% opacity for non-active

- **Navigation (desktop)**: Anchor-based nav over the one-page flow: Home, About, Services, Results, FAQ, Contact [ADAPTATION of observed nav set] plus capsule CTA. Hover: 400→600wt shift or purple underline grow, 200ms.
- **Navigation (mobile)**: Hamburger opens a full-screen dark plum drawer (slide from right, 300ms ease): stacked 18px white links with 24px spacing, capsule CTA at bottom, close ✕ top-right at the hamburger position. Focus trapped while open; body scroll locked.
- **Primary CTA**: Single persistent CTA: header capsule + hero capsule + section CTAs, all purple #7C3AED with white label and trailing 18px circle containing a 10px arrow; hover = darken to #6D28D9 + translateY(-1px); active = translateY(0)
- **Footer**: Structure: dark rounded-top panel (radius 24px) directly after the contact band, plus a pre-footer CTA column row. Top row = 4 columns: (1) logo tile (black tile with white glyph) + 6-line brand paragraph + social row of 4 white circle-outline icon buttons (facebook, instagram, X, linkedin); (2) 'Quick Links' list with purple chevron-right icons (Home, About, Services, Blog, Contact, Impressum) [ADAPTATION label: replace Impressum with a generic 'Resources']; (3) 'Useful Links' same treatment (SEO, Social Media, Online Advertising, Web Design, About, Contact) [ADAPTATION: map to replacement service names]; (4) 'Newsletter' heading + short paragraph + inline form (dark input with white placeholder + purple capsule 'Subscribe' button). Pre-footer row: 3 small columns — purple circle icon + 'Location' label + address line; purple circle icon + 'Book a free consultation' pill button; purple circle icon + 'Send an Email' label + address line [ADAPTATION: values from Business Facts]. Bottom legal row: privacy | terms links left, centered copyright with brand name right, separated by a 1px rgba(255,255,255,.12) hairline [OBSERVED].
- **Form behavior**: All forms POST to the WAZIBIZ Form Service: browser sends public site/form identity, visitor fields, Turnstile token and client-safe metadata only. Inline validation on blur; errors as 13px purple text with a small icon below the field; success state swaps the button label to a check + 'Thank you' message and disables resubmit. Newsletter consent checkbox must be checked before submit; contact form fields validated for required + email format.
- **Overlays**: Mobile nav drawer only; no modal dialogs, cookie banner unspecified. The reference's lead-magnet popup is NOT reproduced (treated as a reference artifact, not design DNA) [ADAPTATION].

## 05 · Motion & Interaction

- **header** (scroll >80px): Header transitions transparent → solid dark; scrim fades
- **section headings, cards, image blocks** (enter viewport (IntersectionObserver, threshold .15, once)): opacity 0→1, translateY 24px→0, 600ms cubic-bezier(.22,1,.36,1), staggered 90ms among siblings [INFERRED]
- **all capsule CTAs** (hover / focus-visible): background lightens to #6D28D9, translateY(-1px), shadow deepens, 200ms ease; trailing arrow nudges 4px right
- **FAQ accordion** (click / Enter / Space): height auto-animate ~350ms ease + chevron rotate 180°, 250ms; expanded item ground flips indigo→white [OBSERVED pattern]
- **service cards** (hover): card lifts 4px, shadow 0 12px 30px rgba(20,10,40,.10); icon tile bg deepens one step, 250ms ease
- **stat chips** (section enters viewport): stat chips fade/slide in from the photo edge (8px), 500ms, 150ms stagger after section reveal; subtle continuous float ±4px 6s ease-in-out alternate [INFERRED]
- **testimonial cards** (continuous / swipe): desktop: horizontal auto-scroll 40s linear loop, pause on hover; mobile: swipe track, snap
- **forms** (focus / submit): input border animates to purple 150ms; submit button shows 300ms success swap
- **mobile nav drawer** (hamburger tap): slide-in-right 300ms ease; links stagger-fade 40ms apart

**Reduced motion**: @media (prefers-reduced-motion: reduce): all reveals render instantly at final state; floating chips static; testimonial track becomes a swipeable static row (no auto-scroll); accordion switches without height animation; CTA hover keeps color change only.


## 06 · Home — Section Spec (in order)

#### HOME §1 — hero

Purpose: Immediate positioning + single CTA

Layout: Full-viewport dark band. Background: duotone photograph (hero-team-collab) covering right 100% with purple gradient wash; left panel is a dark rounded inset (radius 20px, width ~40% at desktop, padding 40px) floating over it, vertically centered, left margin equal to container gutter. Panel content stack: purple eyebrow chip → H1 (two-weight) → two 15px intro paragraphs (max 46ch, #E9E4F5) → capsule CTA. Desktop whole band inset in a rounded container with 16px viewport margin [OBSERVED] and radius 24px

- Visual mass: 1.0
- Surface: dark photographic
- Typography: H1 48/64 desktop → 34/44 mobile; paragraphs 15/24
- Media: hero-team-collab (CRITICAL)
- CTA: Capsule CTA 'Book a Free Strategy Call' with trailing arrow-circle
- Responsive: Mobile: photo becomes 55vh backdrop with stronger scrim; panel becomes full-width padded block anchored bottom-left; H1 steps down; CTA full-width

#### HOME §2 — aboutIntro

Purpose: Establish trust and method in one screen

Layout: Two-column 5/7 split, vertically centered, 96px py. Left: portrait photo card (radius 20px) over pale-lavender blob + dotted grid decoration top-left. Right: eyebrow chip 'About Us' [ADAPTATION] → H2 two-weight → intro line with 3px purple left-rule → body 15/26 → 2-row checklist, each row = pale-lavender rounded icon chip (44px, purple icon) + 15px semi-bold text, rows gap 20px

- Visual mass: 0.9
- Surface: pale lavender
- Typography: H2 clamp(30px,3.6vw,44px)/1.15; body 15/26
- Media: about-strategist (HIGH)
- CTA: None (soft nav via next section)
- Responsive: Tablet: columns 6/6; Mobile: stacked, photo first, checklist full-width

#### HOME §3 — servicesCollection

Purpose: Full service inventory with clear per-item action

Layout: White band, 96px py. Centered header block: eyebrow chip + two-weight H2 (max 22ch). Grid row 1: 4 equal cards. Grid row 2: one full-width (2-col span) wide card. Grid row 3: 4 equal cards. Card anatomy: white ground, radius 16px, 1px #EDE9FE border, shadow 0 6px 24px rgba(20,10,40,.06); padding 28px; top-left 56px pale-lavender rounded-square icon tile with purple line-icon; H3 20px/1.3 two lines; body 14px/1.65 #6B6580 clamp 3–4 lines; bottom-left small outlined capsule CTA with trailing purple circle-arrow. Wide card adds a right-side horizontal stat strip [OBSERVED wide-card pattern]

- Visual mass: 2.2
- Surface: white
- Typography: H2 centered; H3 20/1.3; card body 14/1.65
- Media: None (icons are vector, never photos)
- CTA: Per-card outlined capsule 'Learn More' → service detail [ADAPTATION of observed 'Ver Mais' pattern]
- Responsive: Tablet: 2×N grid, wide card spans full; Mobile: 1 column, wide card becomes normal

#### HOME §4 — whyChoose

Purpose: Convert trust into proof-flavored differentiators

Layout: Pale lavender band, 96px py. Two-column 6/6. Left: eyebrow chip 'Why Choose Us' [ADAPTATION] → H2 two-weight (light 'We turn search visibility', bold 'into a growth channel' [ADAPTATION copy shape]) → intro paragraph → 3 stacked value rows, each = 44px white rounded icon chip + 15px semi-bold heading + 14px/1.6 muted body, separated by 28px. Right: rounded photo card (radius 20px) with 2–3 floating white stat chips (radius 12px, shadow) absolutely positioned — one top-right (~120×90px: bold metric + 12px label), one bottom-left; chips carry an 18px purple line-icon + bold 22px metric + 12px gray label [OBSERVED stat-chip motif]

- Visual mass: 1.6
- Surface: pale lavender
- Typography: H2 same as aboutIntro; row headings 15/600; body 14/1.6
- Media: results-celebration (HIGH)
- CTA: Section-level capsule CTA 'Get Your Free SEO Audit' after the list [ADAPTATION]
- Responsive: Mobile: photo first (with chips inside bounds), then rows; chips scale to 96px wide

#### HOME §5 — faqAccordion

Purpose: Objection handling and long-tail SEO content

Layout: White band, 96px py. Two-column 5/7. Left: flat-illustration contact motif (envelope + device + paper planes + one tiny human figure, purple line style) — allowed flat illustration [OBSERVED motif, light use]. Right: eyebrow chip 'FAQ' → H2 two-weight centered-left → accordion: item 1 expanded (white card, radius 14px, 1px border, shadow; header row = dark 16px/600 question + purple circle-arrow; body 14px/1.7 with one bold inline lead) + 5 collapsed items (full-width purple (#7C3AED) bars, radius 14px, 14px white/600 label left + white circle-chevron right, 20px vertical padding, 12px gap between bars) [OBSERVED]

- Visual mass: 1.5
- Surface: white
- Typography: Question 16/600; body 14/1.7
- Media: None
- CTA: None
- Responsive: Mobile: illustration above stack, full-width bars, tap targets ≥48px

#### HOME §6 — testimonialBand

Purpose: Social proof in cinematic register

Layout: Full-bleed dark band (~90vh desktop). Background: duotone photo (testimonial-office) with heavier purple wash (85%). Left 55%: eyebrow chip 'Testimonials' [ADAPTATION] → white H2 two-weight ('What our clients' / bold 'are saying' [ADAPTATION copy shape]) → row of 2 white cards (radius 16px, padding 24px, shadow) visible, each: top row avatar (56px circle, 2px white ring) + name 15/700 white + role 12px purple-100; middle 5-star row (filled purple, partial); body 14/1.65 dark #2A2440 on white card; bottom-right 28px quote-glyph tile (purple ground, white “). Cards ride slightly over the photo on the left; a third card peeks from the right edge [OBSERVED carousel hint]

- Visual mass: 1.4
- Surface: dark photographic
- Typography: H2 40/1.15 white; card text as above
- Media: testimonial-office (CRITICAL)
- CTA: None
- Responsive: Mobile: single card horizontal scroll-snap; band ~70vh; H2 steps down

#### HOME §7 — newsletterSignup

Purpose: Low-commitment capture

Layout: White band, 80px py. Two-column 7/5. Left: eyebrow chip 'Newsletter' [ADAPTATION] + H3 two-weight ('Get growth tactics' / bold 'in your inbox' [ADAPTATION copy shape]) + small illustration of notification bell/paper plane (allowed flat style). Right: inline form card: 2-col row (First name, Last name inputs), full-width Email input, consent checkbox line 12px, capsule Submit button right-aligned. Inputs: 44px tall, radius 10px, 1px #D8CFF0 border, white ground, focus border #7C3AED + 3px rgba(124,58,237,.15) ring

- Visual mass: 0.8
- Surface: white
- Typography: H3 26/1.25; labels 13/600
- Media: None
- CTA: Capsule 'Subscribe' inside the form row
- Responsive: Mobile: stacked, inputs full-width, button full-width

#### HOME §8 — contactBand

Purpose: Final conversion push

Layout: Dark plum band, 120px py, centered stack: H2 two-weight ('Ready to be' / bold 'found?') [ADAPTATION copy shape] → 14px/1.7 #C9BEDF intro (max 60ch) → capsule email CTA with envelope icon → row of 3 info tiles (each: 40px purple circle icon + 14px/600 white label + 12px #B7A9D6 subline), separated by 24px gap, top border hairline above the row [OBSERVED]

- Visual mass: 1.2
- Surface: dark (solid)
- Typography: H2 44/1.15 centered white
- Media: None
- CTA: One capsule email CTA + three info tiles
- Responsive: Tiles stack vertically; H2 32px

## 07 · About

#### ABOUT §1 — pageHeader

Purpose: Anchor the page and restate positioning in one line

Layout: Header banner: full-width pale lavender ground, 200px min-height, breadcrumb-style eyebrow chip + H1 (two-weight pattern), centered-left within container

- Visual mass: 0.5
- Surface: pale lavender
- Media: None; typography-led
- Responsive: Mobile: 140px min-height; type drops one step

#### ABOUT §2 — story

Purpose: Tell the agency's working philosophy in short paragraphs

Layout: Mirrored about split: text column left, rounded photo right (reuse DNA rules, flipped)

- Visual mass: 1.2
- Surface: white
- Media: about-strategist-2 (round-lg)
- Responsive: Stacks photo-first

#### ABOUT §3 — values

Purpose: Four working principles (evidence-led, technical depth, content craft, transparency) [ADAPTATION]

Layout: Values 2×2 grid using the standard card vocabulary with icon tiles

- Visual mass: 1.5
- Surface: white
- Media: None
- Responsive: 1 column

## 08 · Services

#### SERVICES §1 — pageHeader

Purpose: Frame the catalog

Layout: Header banner like about

- Visual mass: 0.5
- Surface: pale lavender
- Media: None
- Responsive: Compact

#### SERVICES §2 — servicesGrid

Purpose: Detailed per-service proof points

Layout: Cards in 2-column grid (6 cards): each card = icon tile + H3 + 2-line intro + 3-item bullet list (purple check icons, 14px) + outlined capsule CTA. Card min-height 340px

- Visual mass: 2.4
- Surface: white
- Media: None
- Responsive: 1 column mobile

#### SERVICES §3 — ctaBand

Purpose: Route to contact

Layout: Slim dark CTA band reusing contactBand pattern at 0.6 mass

- Visual mass: 0.8
- Surface: dark
- Media: None
- Responsive: Stacks

## 09 · Contact

#### CONTACT §1 — pageHeader

Purpose: Set the contact intent

Layout: Header banner like about

- Visual mass: 0.5
- Surface: pale lavender
- Media: None
- Responsive: Compact

#### CONTACT §2 — formSection

Purpose: Primary conversion path with full qualification fields

Layout: Two-column: left column with three stacked contact-method cards (icon tile + label + value, reusing card vocabulary); right column with the full form card (white, round-2xl, shadow) — fields: name, email, company (optional), service interest (select), message; consent checkbox; capsule submit full-width

- Visual mass: 2
- Surface: white
- Media: None
- Responsive: Stacks form first on mobile

## 10 · Signature Design Elements

1. Purple duotone photographic bands: every full-bleed photo section carries a deep-plum→violet gradient wash heavy enough to read as a designed ground, not a photo (hero + testimonial band) — instantly recognizable vs. plain photo sections
2. Eyebrow chip system: every section opens with a small rounded lavender chip with a dark-purple 12px uppercase-ish label, followed by a two-weight H2 (light lead phrase + bold punch phrase) — no section ever starts with a naked heading
3. Capsule action language: all buttons are pills; primary = solid purple with trailing circle-arrow, secondary = 1.5px purple outline on white; no rectangular buttons anywhere
4. Floating stat chips: white rounded cards with icon + bold metric + tiny label, layered over photographs in the Why-Choose band and echoed inside testimonial cards — the page's proof motif
5. Icon-tile cards: pale-lavender rounded-square tiles holding purple line icons sit at the top-left of every service/feature card, with equal 24px internal offset — cards never use photos, gradients or shadows heavier than a soft diffuse one

## 11 · Anti-Patterns (forbidden)

- No generic beige corporate template with serif headings and gold accents
- No rainbow icon soup — every icon sits in the same pale-lavender rounded tile with the same purple stroke
- No invented third-party client logos, award badges or rating-platform badges
- No flat white-on-white section flow — the dark/pale/white/photographic rhythm is part of the contract
- No sharp-cornered rectangles for cards, chips or buttons
- No default blue (#3B82F6/#2563EB) anywhere — the accent is violet-purple only
- No large low-contrast gray paragraphs on dark grounds
- No new claim or number not supplied by Business Facts — stat chips without supplied data are dropped, not invented
- No copying the reference's name, copy, testimonials, client names, contact details or imagery
- No carousels of meaningless feature cards in the hero; the hero panel carries eyebrow, heading, two paragraphs, one CTA

## 12 · Imagery Direction

**Grade**: Single warm-professional photographic grade: real teams in candid work moments, natural light from windows, warm neutrals in clothing/interiors, clean composition, no manufactured stock poses. Every photo receives the same purple duotone wash treatment when placed on dark grounds (gradient overlay #2A0E4F→#7C3AED at 70–85% opacity, multiply/soft-light blend feel); photos on light surfaces stay natural but slightly desaturated (-8%) with +5% contrast.

### `hero-team-collab` — home · hero · CRITICAL · composition 21:9 → generate 16:9
- Subject: A small diverse digital team (3–5 people) collaborating around laptops in a warm modern loft office, brick or industrial character, screens glowing but content illegible
- Composition: Wide cinematic group shot; team occupies right two-thirds; left third falls into shadow for panel overlay; laptops and screens visible, no readable text on screens; gentle depth of field
- Crop: Provider output 16:9 → object-fit: cover with object-position: 65% 35%; on mobile, keep subject in upper half as panel stacks above photo
- Alt: Diverse digital marketing team collaborating around laptops in a warm loft office
- KIE prompt: "Wide cinematic photo of a diverse digital agency team of four working together around laptops at a wooden table in a warm loft-style office, large windows casting soft evening light, deep purple ambient glow from screens and violet gradient wash over the scene, candid focused expressions, shallow depth of field, professional photography, no readable text or logos anywhere"
- Avoid: text, letters, words, logos, watermarks, stock-photo smiles at camera, cluttered background, harsh flash, low quality, distorted faces, extra fingers

### `about-strategist` — home · about · HIGH · composition 5:3 → generate 16:9
- Subject: One SEO strategist (any gender, 25–40) mid-thought at a laptop, one hand to chin or pointing at screen, plant and window light in background
- Composition: 3/4 body crop, subject on right third looking into laptop; negative space left for organic composition; warm tones, shallow depth of field
- Crop: 16:9 → cover, object-position: 70% center; ratio locked by container at desktop, ratio unlocked on mobile (4:3)
- Alt: SEO strategist reviewing a keyword plan on a laptop in a plant-filled office
- KIE prompt: "Young professional woman SEO strategist with curly hair reviewing analytics on a laptop beside a potted monstera plant in a bright modern office, soft natural window light, warm neutral tones with a purple jumper, thoughtful candid expression, shallow depth of field, professional photography, no readable text or logos on screen"
- Avoid: text, letters, numbers on screen, logos, watermarks, staged thumbs-up, clutter, harsh shadows, distorted hands

### `results-celebration` — home · results · HIGH · composition 5:3 → generate 16:9
- Subject: Two team members celebrating a win in front of a glowing laptop, dark office, screens providing the key light
- Composition: Team of two on right half reacting to a laptop; left half intentionally dark for stat chips; cool-warm mixed light; motion of genuine laughter
- Crop: 16:9 → cover, object-position: 75% center; chips overlay is DOM, not baked into image
- Alt: Growth team celebrating a campaign result in a dark modern office
- KIE prompt: "Two colleagues in a dim modern office celebrating in front of a laptop showing rising graphs, genuine laughter, one raising a fist, purple and warm screen glow on faces, shallow depth of field, cinematic professional photography, no readable text or logos"
- Avoid: text, letters, logos, watermarks, champagne bottles, confetti, exaggerated expressions, distorted faces

### `testimonial-office` — home · testimonials · CRITICAL · composition 4:3 → generate 16:9
- Subject: Handshake or handover moment between consultant and client across a desk with laptops, shot from behind one shoulder
- Composition: Tight over-shoulder shot, hands and laptops in frame, faces softly out of focus or mid-conversation; dark background for card readability
- Crop: 16:9 → cover, object-position: center 30%
- Alt: Client and consultant shaking hands after a successful project
- KIE prompt: "Over-the-shoulder photo of a client and consultant shaking hands across a desk with laptops in a dim modern office, warm and purple mixed lighting, faces softly out of focus, professional documentary style photography, no readable text or logos"
- Avoid: text, letters, logos, watermarks, sharp distorted hands, exaggerated grins, cluttered desk

### `newsletter-owner` — home · newsletter · HIGH · composition 3:2 → generate 16:9
- Subject: Business owner reviewing something encouraging on a tablet at dusk, screen glow lighting the face, workshop or small-office setting
- Composition: Medium close-up; tablet glow as key light; purple-warm duotone; subject on left third leaving space right
- Crop: 16:9 → cover, object-position: 30% center; newsletter copy overlays right, so keep left visual mass
- Alt: Business owner reviewing search rankings on a tablet
- KIE prompt: "Small business owner in a workshop office reviewing rankings on a tablet in the evening, screen glow lighting their face, purple and warm ambient tones, candid concentration, shallow depth of field, professional photography, no readable text or logos"
- Avoid: text, letters, logos, watermarks, brightness blown out, distorted fingers, stock pose

### `contact-presentation` — home · contact · HIGH · composition 16:9 → generate 16:9
- Subject: Consultant gesturing at a screen with abstract growth charts, small attentive audience, dark room with purple accent light
- Composition: Medium shot at slight angle, presenter on left gesturing toward screen, audience blurred foreground right; screen content abstract
- Crop: Provider native; cover fit, object-position: 40% center
- Alt: Marketing consultant presenting a growth plan on a screen
- KIE prompt: "Marketing consultant presenting a growth strategy on a large screen to a small business audience in a dark meeting room, gesturing toward abstract colorful charts, purple accent lighting, engaged listeners in soft focus foreground, cinematic professional photography, no readable text or logos"
- Avoid: text, letters, logos, watermarks, readable slides, distorted faces, harsh flash, clutter

## 13 · Responsive Specification

- **Desktop**: 12-col, 1240px container, gutters 24px; hero panel 40vw; services 4-col; sections 96px py; nav horizontal.
- **Tablet**: 768–1199px: container 92vw max 960px; about/why-choose split 6/6; services 2-col; wide card full-span; testimonial 1.5 cards visible; hero panel 55vw; H2 clamp keeps proportion; nav collapses to hamburger at <1024px.
- **Mobile**: ≤768px: single column everywhere; hero photo 55vh + full-width panel with H1 34px; services stacked with full-width CTAs; accordion tap targets 48px; testimonial horizontal scroll-snap; forms full-width; container gutter 20px; py 64px; drawer nav replaces header links.

## 14 · Accessibility & Performance

- **Reduced motion**: All reveal/stagger/float/pulse/marquee animations disabled; accordions and hover states switch instantly; content always visible
- **Focus**: 3px purple ring with 2px white offset on all interactive elements
- **Keyboard**: Header nav, all capsule CTAs, accordion buttons (aria-expanded), testimonial dots, newsletter and contact forms fully reachable in DOM order; focus trapped in mobile drawer while open
- **Forms**: Labels visible on contact/newsletter; required fields marked; errors as purple text with icon below field, aria-describedby, aria-invalid


## 15 · Acceptance Checklist

- [ ] Header is transparent over the hero with white wordmark/nav and a pill CTA with arrow, becomes solid dark on scroll
- [ ] Hero is full-bleed photography with a purple duotone wash and a dark inset panel on the left carrying eyebrow chip, two-weight H1, two intro paragraphs and a capsule CTA
- [ ] Hero sits in a rounded container inset from the viewport edge on desktop
- [ ] A pale lavender 'About' band with a rounded dark feature photo on the left, purple eyebrow chip, two-weight H1 and a checklist of two icon rows
- [ ] Services collection uses one card vocabulary throughout: light cards, pale-lavender icon tiles, H3 + body + 'Ver Mais'-style capsule outline CTA, laid out 4 / 2-wide / 4 in bands
- [ ] A results band with dark heading, three numbered/stacked outcome rows on the left and a rounded photo panel on the right carrying floating stat chips
- [ ] An accordion FAQ section: one item expanded showing rich body text and an indigo chip, remaining items as collapsed indigo/purple bars with chevron buttons
- [ ] A testimonial section over a dark full-bleed photo: purple eyebrow chip, white H2, light cards with round avatar, star row, body, name/role and a small card trailing a quote glyph
- [ ] A newsletter band with two-column layout and a form using bordered inputs (first name, last name, email) with consent checkbox and a Submit button
- [ ] Contact section: centered H2 on dark, single capsule email CTA, and three feature columns (availability, support, satisfaction) each with icon chip, label and small line
- [ ] Footer is 4-column: about text with social circles, two link lists with purple chevron icons, and a newsletter mini-form, on dark, with bottom legal row
- [ ] All primary CTAs are capsule/pill buttons in purple; hover states darken and translate the arrow
- [ ] Type scale uses a two-weight display pattern (light first line, bold emphasis lines) at clamp sizes with tight line-height on headings
- [ ] Palette matches spec: deep purple-black grounds, vivid purple primary #7C3AED-family, pale lavender surfaces #EDE9FE-family, white cards
- [ ] Accordion opens/closes with smooth height transition and rotates the chevron; one item may be open at a time
