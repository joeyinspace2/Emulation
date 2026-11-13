# Emulsion recipe version 1

Recipes are plain JSON objects. They contain no executable code and never resolve a source name to a file or URL.

```json
{
  "format": "emulsion-recipe",
  "version": 1,
  "name": "Soft daylight",
  "source": { "name": "photo.jpg" },
  "settings": { "exposure": 0.25, "film": "port400", "grain": 18 },
  "output": { "type": "image/jpeg", "quality": 0.92, "max": 0 }
}
```

`format`, `version`, and `settings` are required. `name`, `source`, `assets`, and `output` are optional. Unknown keys at every level are errors; unsupported values are never discarded or clamped. Only plain objects and dense arrays are accepted. Prototype keys (`__proto__`, `prototype`, `constructor`), symbols, accessors and hidden properties are rejected. Settings omitted from a recipe use fresh editor defaults, including nested grade/curve/crop values. Applying a recipe replaces the adjustments instead of retaining omitted current values.

`name` allows 1–256 characters; `source` contains only `name`, allowing 1–1024 characters. LUT names allow 1–256 characters and mask IDs 1–128 characters. These strings must contain visible non-whitespace text, must not contain ASCII control characters, and are otherwise preserved exactly. Mask IDs must be unique and cannot equal a prototype key. Source names are informational.

## Public pure module

`src/recipe.js` exports the same API as CommonJS and as `globalThis.EmulsionRecipe` in the concatenated browser build:

- `validate(recipe)` returns a complete, independently copied recipe or throws a descriptive `Error` identifying the field.
- `create(settings, options = {})` creates and validates a recipe. Options allow exactly `name`, `source`, `assets`, and `output` with the same shapes as recipe fields.
- `defaults()` returns fresh complete editor settings.
- `looks()` returns `{films:[{id,name,group,description}],scanners:[{id,name,description}],looks:[{name,settings}]}`. Look settings are independent copies of the built-in partial presets.

Numbers must be finite JavaScript numbers; numeric strings are rejected. Unless explicitly marked integer, fractions within the bounds are supported, independent of slider step size. Bounds are inclusive.

## Scalar settings

| Settings | Range or values |
| --- | --- |
| `temp tint contrast highlights shadows whites blacks texture clarity dehaze vibrance saturation distort caR caB lensVig vigAmount vigRound` | −100…100 |
| `exposure` | −5…5 |
| `sharpen` | 0…150 |
| `sharpRadius` | 0.5…3 |
| `sharpMask nrLuma nrColor vigMid vigFeather filmAmt halation halRadius bloom bloomThresh bloomRadius grain grainSize grainRough grainColor fade leak dust scratches border borderRound lutAmt` | 0…100 |
| `halThresh` | 20…100 |
| `halHue` | −20…60 |
| `leakHue` | 0…360 |
| `leakSeed fxSeed` | Integer 1…997 |
| `angle` | −45…45 degrees |
| `rot90` | Integer 0…3 |
| `bw flipH flipV` | Boolean |
| `film` | One of the IDs returned by `looks().films` |
| `scan` | `none`, `frontier`, `noritsu` (see Lab scanner) |
| `borderColor` | `white`, `cream`, `black` |
| `aspect` | `free`, `original`, `1:1`, `5:4`, `4:5`, `4:3`, `3:4`, `3:2`, `2:3`, `16:9`, `9:16`, `2:1`, `1:2` |
| `lut` | `null` or the embedded selected LUT name |

`hslH`, `hslS`, and `hslL` are arrays of exactly eight numbers in −100…100.

`grade` accepts `sh`, `mid`, `hi`, `blend`, and `balance`. Each of `sh`, `mid`, and `hi` accepts `h` (0…360), `s` (0…100), and `l` (−100…100). `blend` is 0…100 and `balance` is −100…100. Missing nested values use editor defaults.

`curve` accepts channels `rgb`, `r`, `g`, and `b`. Each channel is an array of 2…14 `[x,y]` pairs. Both coordinates are in 0…1; x values increase strictly, beginning at 0 and ending at 1. Missing channels default to `[[0,0],[1,1]]`.

`crop` accepts `cx`, `cy`, `w`, and `h`. Centers are 0…1 and dimensions are 0.000001…1 (the lower bound keeps affine transforms finite). The default is `{cx:0.5,cy:0.5,w:1,h:1}`. A source-independent recipe cannot check rotated crop corners against a particular photograph's aspect ratio.

## Lab scanner

`scan` chooses the machine that scans the film: `none` (the standard rendering), `frontier` (Fujifilm Frontier SP-3000) or `noritsu` (Noritsu HS-1800). The scanner reads the finished film frame, including grain, halation and dust, and draws the print border afterwards. Each machine has its own object of whole-number controls; both objects are always stored, and only the selected machine's is used. Omitted controls keep their defaults.

Both machines share the lab keys. One density step is 1/6 stop and one colour step is 1/12 stop, applied to the light before the machine's tone curve.

| Keys (both machines) | Range | Effect |
| --- | --- | --- |
| `d` | −15…15 | Density. Positive prints darker. |
| `c` `m` `y` | −15…15 | Positive adds cyan, magenta or yellow by holding back red, green or blue. |

| `frontier` | Range | Default | Effect |
| --- | --- | --- | --- |
| `hiTone` `shTone` | −1, 0, 1 | 0 | Tone adjustment for highlights and shadows: soft, standard, hard. |
| `hyperHi` `hyperSh` | 0…4 | 2 | Hypertone level: holds large bright areas, opens large dark areas. 0 is off. |
| `sat` | −5…5 | 0 | Saturation steps. |
| `sharp` | 0…5 | 2 | Sharpness on edges. |
| `grainSup` | 0…5 | 2 | Grain suppression in flat areas. |

| `noritsu` | Range | Default | Effect |
| --- | --- | --- | --- |
| `acOverall` | −5…5 | 0 | Auto contrast. Positive flattens the curve. |
| `acShadow` `acHighlight` | −5…5 | 0 | Positive opens shadows or holds highlights more. |
| `chroma` | 0…200 | 100 | Colour saturation in percent. |
| `sharp` | 0…10 | 4 | Auto sharpness. It also sharpens grain. |
| `grainSup` | 0…50 | 10 | Graininess suppression. |

```json
{"film":"port400","scan":"frontier","frontier":{"d":-1,"y":2,"shTone":-1}}
```

The scanners are models built from each machine's published controls and commonly described character. They are not measured profiles, and the automatic per-frame density and colour balance of the real machines is not simulated: set white balance and exposure in the develop settings. `looks().scanners` lists the IDs.

## Masks and heal spots

`masks` is an array of at most six objects, each with exactly the following supported fields:

```json
{
  "id": "mask-1",
  "type": "linear",
  "a": [0, 0, 1, 1],
  "feather": 50,
  "invert": false,
  "amount": 100,
  "adj": { "exposure": 0, "contrast": 0, "saturation": 0, "clarity": 0, "temp": 0, "tint": 0 },
  "data": null
}
```

`type` is `linear`, `radial`, or `brush`. `a` always contains exactly four finite coordinates in −1,000,000…1,000,000, allowing mask handles outside the photograph. For a linear mask, the array is `[x1,y1,x2,y2]`. For a radial mask it is `[cx,cy,rx,ry]`, with both radii at least 0.004. Brush geometry is retained. `feather` and `amount` are 0…100 and `invert` is Boolean. `adj.exposure` is −4…4; the other adjustment values are −100…100. Missing `adj` members use zero; `adj` itself is required. Other mask fields are required except `data`, which defaults to `null`.

A brush `data` value is `null` for a blank brush, or a `data:image/png;base64,...` URL. Only brush masks accept non-null data. PNG decoded file bytes must not exceed 4 MiB and each image dimension must be 1…1024 pixels. Base64, PNG signature, IHDR configuration, chunk framing, checksums and end marker are checked synchronously. Animated PNG and unknown critical chunks are rejected. The browser must also successfully decode compressed image pixels before applying the recipe. Remote URLs, SVG and other embedded image formats are rejected. Browser recipe export converts editor brush images to PNG.

`spots` is an array of at most 16 objects containing exactly `x`, `y`, `r`, `f`, `sx`, `sy`, and `o`. Position/source coordinates are −1,000,000…1,000,000 to retain out-of-frame UI moves. Radius `r` is 0.003…0.1 of the source long edge; feather `f` and opacity `o` are 0…1. All fields are required.

## Embedded LUT and output

A selected LUT must be embedded as `assets.lut` with exactly `name`, `size`, and `data`. `name` must match `settings.lut`; prototype keys and inherited Object property names are reserved. `size` is an integer 2…64. `data` is a dense JSON array of exactly `size³ × 3` numbers, each −65504…65504 (the renderer's finite half-float range). Finite HDR and negative samples are retained. A LUT asset without a matching selected LUT is an error. There is only one selected LUT per recipe, with no external asset references.

`output` accepts only `type`, `quality`, and `max`. When `output` is present, omitted members default to `image/jpeg`, `0.92`, and `0` respectively. Supported MIME types are `image/jpeg`, `image/png`, and `image/webp`. Quality is 0.4…1, including PNG recipes where the encoder does not use it. `max` is an integer 0…32768 specifying the maximum long edge; 0 requests full resolution. Browser/GPU allocation limits still apply. Omitting `output` leaves this optional field absent in the normalized recipe.
