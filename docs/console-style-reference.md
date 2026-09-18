# TypeSafe console style reference

Inspected the user's authenticated Chrome tabs on September 18, 2026: https://console.typesafe.ai/home and https://console.typesafe.ai/playground. Read-only inspection; no requests submitted or account settings changed. These are observations of rendered UI, not assumptions about its component framework.

## Observed visual choices

- Near-white body (#fafafa), white work areas, charcoal primary text (#171717).
- Inter for general UI; navigation 14px/400, home section headings 36px/500. Secondary text uses reduced opacity of charcoal.
- Light gray selected navigation, 6px rounded corners, small outline icons. Sidebar approximately 256px in the inspected desktop screenshot.
- Fine neutral dividers between full-height workspace panels. Mostly flat surfaces; sparse shadows, used for an instructional overlay.
- Solid black primary actions with white text, blue links and resource icons. Most workspace controls are small icon buttons or segmented toggles.
- Playground editors use system monospace at 14px; response JSON is denser at 12px. Line numbers, syntax colors and collapsible sections support dense inspection.
- Large home hero typography is marketing treatment; the playground's working areas use compact labels, breadcrumbs and toolbars.

## Suggested direction for Jevals

Bring the neutral palette, Inter typography, subtle dividers, compact controls and black primary actions into the existing workbench. Keep correctness/failure colors meaningful and accessible. Preserve generated state forms, reviewed answer controls, glossary, native dialogs and WebMCP. Use monospace for JSON/traces, not all content. Keep the current responsive form layout rather than importing a desktop-only multi-pane editor.

No restyling has been applied in this pass. A future implementation should compare the same populated desktop/mobile Jeval before and after changes and check focus visibility and contrast.
