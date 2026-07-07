Checkbox for platform/multi-select pickers (e.g. TikTok / Reels destination toggles). Renders a filled accent square with a "✓" glyph when checked — not a native checkbox.

```jsx
<Checkbox checked={platforms.tiktok} label="TikTok" onChange={(v) => setPlatform("tiktok", v)} />
```
