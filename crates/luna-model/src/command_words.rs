use crate::normalize;
use std::{collections::BTreeSet, ops::RangeInclusive};

// Prefix handling is shared by the runtime matcher and command-overlap validation.
pub struct EntityWords {
    ignored: BTreeSet<String>,
}
impl EntityWords {
    pub fn new(words: &[String]) -> Self {
        Self {
            ignored: words
                .iter()
                .map(|word| normalize(word))
                .filter(|word| word.split_whitespace().count() == 1)
                .collect(),
        }
    }
    pub fn name(&self, name: &str) -> String {
        let normalized = normalize(name);
        let words = normalized.split_whitespace().collect::<Vec<_>>();
        let first = words.iter().position(|word| !self.ignored.contains(*word));
        // A name consisting entirely of prefix words still has to consume its name.
        first.map_or(normalized.clone(), |first| words[first..].join(" "))
    }
    pub fn starts(&self, tokens: &[&str], start: usize) -> RangeInclusive<usize> {
        let mut end = start;
        while end < tokens.len() && self.ignored.contains(tokens[end]) {
            end += 1;
        }
        start..=end
    }
    pub fn forms(&self, name: &str) -> Vec<String> {
        let name = self.name(name);
        if name.is_empty() {
            return vec![];
        }
        std::iter::once(name.clone())
            .chain(self.ignored.iter().map(|word| format!("{word} {name}")))
            .collect()
    }
}
