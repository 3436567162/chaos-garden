// Language colours: saturated for source code, pale porcelain tones for
// config / docs, so the "real" code reads first. sRGB hex.
const PALETTE: Record<string, string> = {
  Rust: '#ff8a5c',
  TypeScript: '#5aa9ff',
  JavaScript: '#ffd25e',
  Python: '#4fd1a5',
  Go: '#48d6e6',
  C: '#9aa6ff',
  'C++': '#c792ff',
  'C#': '#7ee081',
  Java: '#ff7a8a',
  Kotlin: '#b18cff',
  Swift: '#ff9f43',
  Ruby: '#ff5f7e',
  PHP: '#8f9bff',
  Lua: '#6c8cff',
  Dart: '#3fd0c9',
  Scala: '#ff6b6b',
  Haskell: '#a78bfa',
  Elixir: '#c084fc',
  Zig: '#f7b955',
  Vue: '#5ee0a0',
  Svelte: '#ff7849',
  HTML: '#ff9670',
  CSS: '#e58cff',
  SCSS: '#ff8fc8',
  Shell: '#a3e36b',
  SQL: '#ffc46b',
  JSON: '#d9d2b6',
  YAML: '#d6c4e8',
  TOML: '#e8c9b0',
  XML: '#c9d6e3',
  Markdown: '#e9edf5',
  Text: '#c2c8d4',
  Dockerfile: '#5cc8ff',
  Makefile: '#d8cf9a',
  Binary: '#5b6278',
  Unknown: '#8a91a6'
}

export const UNKNOWN_COLOR = PALETTE.Unknown

export function langColor(lang: string): string {
  return PALETTE[lang] ?? UNKNOWN_COLOR
}

export const SKY_ZENITH = '#05060f'
export const SKY_HORIZON = '#2a2550'
export const HORIZON_GLOW = '#ff7a59'
export const FOG_COLOR = '#14142a'
export const GROUND_COLOR = '#151830'
export const LOT_COLOR = '#1d2142'
export const GRID_MAJOR = '#3a3f74'
export const GRID_MINOR = '#23264a'
export const BACKGROUND_COLOR = SKY_ZENITH
