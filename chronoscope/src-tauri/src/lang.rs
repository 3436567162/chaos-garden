// File extension to display language. Names must match the keys in
// `src/three/palette.ts`, otherwise every block falls back to Unknown.

/// Extension (lowercase, no dot) to language name.
const BY_EXT: &[(&str, &str)] = &[
    ("rs", "Rust"),
    ("ts", "TypeScript"),
    ("tsx", "TypeScript"),
    ("mts", "TypeScript"),
    ("cts", "TypeScript"),
    ("js", "JavaScript"),
    ("mjs", "JavaScript"),
    ("cjs", "JavaScript"),
    ("jsx", "JavaScript"),
    ("py", "Python"),
    ("pyi", "Python"),
    ("go", "Go"),
    ("c", "C"),
    ("h", "C"),
    ("cc", "C++"),
    ("cpp", "C++"),
    ("cxx", "C++"),
    ("hpp", "C++"),
    ("hh", "C++"),
    ("cs", "C#"),
    ("java", "Java"),
    ("kt", "Kotlin"),
    ("kts", "Kotlin"),
    ("swift", "Swift"),
    ("rb", "Ruby"),
    ("php", "PHP"),
    ("lua", "Lua"),
    ("dart", "Dart"),
    ("scala", "Scala"),
    ("sc", "Scala"),
    ("hs", "Haskell"),
    ("ex", "Elixir"),
    ("exs", "Elixir"),
    ("zig", "Zig"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("html", "HTML"),
    ("htm", "HTML"),
    ("css", "CSS"),
    ("scss", "SCSS"),
    ("sass", "SCSS"),
    ("less", "SCSS"),
    ("sh", "Shell"),
    ("bash", "Shell"),
    ("zsh", "Shell"),
    ("fish", "Shell"),
    ("ps1", "Shell"),
    ("sql", "SQL"),
    ("json", "JSON"),
    ("jsonc", "JSON"),
    ("yml", "YAML"),
    ("yaml", "YAML"),
    ("toml", "TOML"),
    ("xml", "XML"),
    ("svg", "XML"),
    ("plist", "XML"),
    ("md", "Markdown"),
    ("markdown", "Markdown"),
    ("mdx", "Markdown"),
    ("txt", "Text"),
    ("rst", "Text"),
    ("adoc", "Text"),
];

/// Whole-filename matches, for extensionless files that are still real code.
const BY_NAME: &[(&str, &str)] = &[
    ("dockerfile", "Dockerfile"),
    ("containerfile", "Dockerfile"),
    ("makefile", "Makefile"),
    ("gnumakefile", "Makefile"),
    ("cmakelists.txt", "Text"),
];

/// Language for a repository-relative path. Allocation-free: this runs once per
/// file per sampled commit.
pub fn of(path: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or(path);

    for (candidate, lang) in BY_NAME {
        if candidate.eq_ignore_ascii_case(name) {
            return lang;
        }
    }

    // `rsplit_once` on the name, so a dotted directory cannot masquerade as an
    // extension. A trailing dot yields an empty extension, which matches nothing.
    match name.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() && !ext.contains('/') => BY_EXT
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(ext))
            .map_or("Unknown", |(_, lang)| *lang),
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::of;

    #[test]
    fn maps_common_extensions() {
        assert_eq!(of("src/main.rs"), "Rust");
        assert_eq!(of("web/src/App.tsx"), "TypeScript");
        assert_eq!(of("a/b/c/style.scss"), "SCSS");
    }

    #[test]
    fn handles_extensionless_names_and_case() {
        assert_eq!(of("Dockerfile"), "Dockerfile");
        assert_eq!(of("docker/DOCKERFILE"), "Dockerfile");
        assert_eq!(of("Makefile"), "Makefile");
    }

    #[test]
    fn falls_back_to_unknown() {
        assert_eq!(of("LICENSE"), "Unknown");
        assert_eq!(of("weird.zzz"), "Unknown");
        assert_eq!(of("archive.tar.gz"), "Unknown");
    }
}