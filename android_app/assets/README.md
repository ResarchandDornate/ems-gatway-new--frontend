# Launcher icon and splash sources

Five SVGs, and everything under `android/app/src/main/res` is generated from
them. Regenerate with:

```
npm --prefix android_app run icons
```

Then commit the changed `res/` files — they are checked in, because the release
build must not depend on a generator run that someone might skip.

| File | Becomes |
|---|---|
| `icon-only.png` | the square legacy icon, all `mipmap-*` densities |
| `icon-foreground.png` | the adaptive icon's foreground layer |
| `icon-background.png` | the adaptive icon's background layer |
| `splash.png` | the light-theme splash, every orientation and density |
| `splash-dark.png` | the dark-theme splash |

PNG rather than SVG because the mark arrived as vector art inside a brand deck
and there is no vectoriser on this machine to get a path back out of it. 1024 is
the largest size anything downstream asks for — the Play listing icon is 512 and
`mipmap-xxxhdpi` is 192 — so a 1024 source is downsampled everywhere and
upsampled nowhere. If the original vector turns up, SVG sources still work and
are still preferable.

## The artwork

This is the real UnityESS mark: the "ICON ONLY" logo variation from
`UnityESS_Visual Langauge.pdf` p3, white Ü on brand teal **#12606B**. It was
rendered out of that PDF's vector art at 3200 px and cropped to the teal square
the deck itself draws, so the angled cuts on the diaeresis and the stems are the
designer's, not a redraw. The splash puts the same mark on **#070B1A**, which is
the colour the shell already holds in three places.

Two things any future replacement has to respect, both of which are easy to get wrong
and only visible on a device:

- **1024×1024, square.** Every density is downscaled from this one size.
- **The adaptive foreground needs a safe zone.** Android masks the icon to
  whatever shape the launcher uses — circle, squircle, teardrop — and crops to
  a centre circle of 66% diameter. Anything outside that can be cut off, so
  the mark occupies the middle two-thirds and the rest is padding. The current
  placeholder does this with a `scale(1.5)` about the centre; a replacement
  drawn full-bleed will lose its edges.

`icon-background.png` is a flat fill and normally needs no change.

`play-feature-graphic-1024x500.png` is the Play listing banner: exactly that
size, opaque, and deliberately carrying no text of its own — Play draws the app
name over it, and anything written here collides with it.

`play-listing-icon-512.png` is not part of the generated set — it is uploaded by
hand in the Play Console. It is deliberately **square and fully opaque**, unlike
`icon-only.png`: Play applies its own mask and rejects transparency, so a
pre-rounded icon uploaded there shows corner artefacts.
