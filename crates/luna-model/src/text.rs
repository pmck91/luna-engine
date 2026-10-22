//! The only supported markup is non-nested foreground colour spans.
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
pub const COLOURS: &[&str] = &[
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "bright-black",
    "bright-red",
    "bright-green",
    "bright-yellow",
    "bright-blue",
    "bright-magenta",
    "bright-cyan",
    "bright-white",
];
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Span {
    pub text: String,
    pub colour: Option<String>,
}
pub fn parse(text: &str) -> Result<Vec<Span>> {
    let mut result = vec![];
    let mut remaining = text;
    let mut buffer = String::new();
    let mut colour: Option<String> = None;
    while !remaining.is_empty() {
        if remaining.starts_with('<') {
            if !buffer.is_empty() {
                result.push(Span {
                    text: std::mem::take(&mut buffer),
                    colour: colour.clone(),
                });
            }
            let end = remaining.find('>').ok_or_else(|| {
                anyhow::anyhow!(
                    "Unclosed colour tag; insert literal text to display angle brackets"
                )
            })?;
            let tag = remaining[1..end].to_ascii_lowercase();
            if let Some(close) = tag.strip_prefix('/') {
                if colour.as_deref() != Some(close) {
                    bail!("Mismatched closing tag <{tag}>")
                };
                colour = None;
            } else {
                if !COLOURS.contains(&tag.as_str()) {
                    bail!("Unknown colour tag <{tag}>")
                }
                if colour.is_some() {
                    bail!("Colour spans cannot be nested")
                };
                colour = Some(tag);
            }
            remaining = &remaining[end + 1..];
        } else if remaining.starts_with('&') {
            let mut decoded = false;
            for (escaped, literal) in [("&lt;", '<'), ("&gt;", '>'), ("&amp;", '&')] {
                if let Some(rest) = remaining.strip_prefix(escaped) {
                    buffer.push(literal);
                    remaining = rest;
                    decoded = true;
                    break;
                }
            }
            if !decoded {
                bail!("Literal ampersands must be written as &amp;")
            }
        } else {
            let ch = remaining.chars().next().expect("not empty");
            if ch == '>' || (ch.is_control() && ch != '\n' && ch != '\t') {
                bail!("Unsupported literal/control character; use literal-text escapes")
            }
            buffer.push(ch);
            remaining = &remaining[ch.len_utf8()..];
        }
    }
    if colour.is_some() {
        bail!("Unclosed colour tag")
    }
    if !buffer.is_empty() {
        result.push(Span {
            text: buffer,
            colour: None,
        })
    };
    Ok(result)
}
pub fn plain(spans: &[Span]) -> String {
    spans.iter().map(|s| s.text.as_str()).collect()
}
pub fn render(spans: &[Span], colour: bool) -> String {
    if !colour {
        return plain(spans);
    }
    let mut out = String::new();
    for span in spans {
        if let Some(index) = span
            .colour
            .as_deref()
            .and_then(|c| COLOURS.iter().position(|v| *v == c))
        {
            let code = if index < 8 {
                30 + index
            } else {
                90 + index - 8
            };
            out.push_str(&format!("\x1b[{code}m"));
            out.push_str(&span.text);
            out.push_str("\x1b[39m");
        } else {
            out.push_str(&span.text)
        }
    }
    out.push_str("\x1b[0m");
    out
}
pub fn literal(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn markup() {
        let s = parse("The <BRIGHT-red>door</BRIGHT-red> &lt;red&gt; &amp;amp;").unwrap();
        assert_eq!(plain(&s), "The door <red> &amp;");
        assert!(render(&s, true).contains("\x1b[91mdoor\x1b[39m"));
    }
    #[test]
    fn invalid() {
        for t in [
            "<red>Stop!",
            "<red><blue>x</blue></red>",
            "<red>x</blue>",
            "<b>x</b>",
            "\x1b[31mx",
        ] {
            assert!(parse(t).is_err(), "{t}")
        }
    }
    #[test]
    fn all_colours() {
        for c in COLOURS {
            let s = parse(&format!("<{c}>text</{c}>")).unwrap();
            assert_eq!(plain(&s), "text");
            assert!(render(&s, true).ends_with("\x1b[0m"))
        }
    }
}
