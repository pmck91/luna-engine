# Luna Engine Text Colour Addendum

**Status:** Proposed specification addition  
**Scope:** Inline foreground colour in authored game text. This addendum covers only text colour markup and rendering.

## 1. Goal

Let a game designer emphasize a word or phrase with one of the terminal’s standard colours. For example:

```text
Out of the darkness, something emerges <red>RUNNNN</red>
```

The engine stores this as semantic markup in the game content and converts it to terminal colour when displaying text. ANSI escape sequences are never stored in project text, `.luna` bundles, or save files.

## 2. Supported colour names

Version 1 supports foreground colours from the terminal’s standard 16-colour palette. The names below are lowercase in authored markup; the editor may offer a palette picker instead of requiring designers to type tags.

| Colour | Markup tag |
|---|---|
| Black | `<black>...</black>` |
| Red | `<red>...</red>` |
| Green | `<green>...</green>` |
| Yellow | `<yellow>...</yellow>` |
| Blue | `<blue>...</blue>` |
| Magenta | `<magenta>...</magenta>` |
| Cyan | `<cyan>...</cyan>` |
| White | `<white>...</white>` |
| Bright black | `<bright-black>...</bright-black>` |
| Bright red | `<bright-red>...</bright-red>` |
| Bright green | `<bright-green>...</bright-green>` |
| Bright yellow | `<bright-yellow>...</bright-yellow>` |
| Bright blue | `<bright-blue>...</bright-blue>` |
| Bright magenta | `<bright-magenta>...</bright-magenta>` |
| Bright cyan | `<bright-cyan>...</bright-cyan>` |
| Bright white | `<bright-white>...</bright-white>` |

These names select palette slots, not fixed RGB values. The terminal or user’s terminal theme determines the actual shades. Uncoloured text uses the terminal’s default foreground.

## 3. Markup rules

- A colour span begins with a supported opening tag and ends with its matching closing tag, such as `<red>danger</red>`.
- Tags may span words and punctuation, but cannot be nested or overlap in version 1. Adjacent spans are allowed.
- Tag names are case-insensitive when loading content; the editor writes canonical lowercase names.
- Unknown tags and mismatched or unclosed tags are content validation errors. The editor identifies the text and offers a repair. Invalid colour markup must be fixed before bundle export.
- To show tag-like text literally, the editor provides an “insert literal text” action. In the stored text representation, literal angle brackets use `&lt;` and `&gt;`; literal ampersands use `&amp;`. The player sees the decoded characters.
- Colour markup affects presentation only. It does not change parser matching, game state, trigger order, or save data.

## 4. Editor behavior

- Text fields that support formatted output provide a colour control. Selecting text and choosing a colour wraps the selection in a semantic colour span; choosing “Default” removes the colour from the selection.
- The editor preview displays the span in its selected colour and remains readable when the preview theme differs from a player’s terminal palette.
- The editor provides a plain-text preview that shows the text after markup is removed and literal-text escapes are decoded.
- Validation reports malformed markup at the relevant text field and prevents export until it is corrected.

## 5. Runtime rendering

- In colour-enabled output, the engine emits the selected terminal foreground colour for the span and restores the surrounding/default foreground immediately at the closing tag.
- The engine resets styling at the end of each displayed message, including when the message contains a newline or an early rendering error, so colour never leaks into later output or the shell prompt.
- In plain output, the engine removes colour tags and prints their text content unchanged. Literal-text escapes are decoded in both modes.
- Automatic colour mode is the default: use colour for an interactive terminal and omit it for redirected or piped output. `NO_COLOR` being present and non-empty disables colour in automatic mode. The runner may provide `--color auto|always|never`; `never` disables colour and `always` enables it where the output destination can accept terminal control sequences.
- No background colours, RGB/truecolour values, bold, underline, blinking, or other text styles are included in this addition.

## 6. Bundle compatibility

Colour markup is part of authored text and is included unchanged in `.luna` game data. The bundle format version and content schema version remain responsible for declaring support for this markup. A runner that cannot interpret the colour syntax must fail validation with a clear compatibility error rather than print raw control sequences.

## 7. Acceptance examples

| Authored text | Colour-capable terminal | Plain output |
|---|---|---|
| `The door is <bright-red>OPEN</bright-red>.` | `OPEN` uses the terminal’s bright-red palette slot; surrounding text uses default colour. | `The door is OPEN.` |
| `The sign reads: &lt;red&gt;` | `The sign reads: <red>` | `The sign reads: <red>` |
| `<red>Stop!` | Rejected by editor validation; cannot export. | Rejected by editor validation; cannot export. |

## References

- Linux console SGR reference for standard and bright foreground colour codes: [console_codes(4)](https://man7.org/linux/man-pages/man4/console_codes.4.html)
- `NO_COLOR` convention: [no-color.org](https://no-color.org/)
