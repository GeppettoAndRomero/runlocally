import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Tokens = Map<string, string>;
type Rgb = [number, number, number];

function declarations(body: string): Tokens {
  const tokens: Tokens = new Map();
  for (const part of body.split(';')) {
    if (!part.trim()) continue;
    const match = part.match(/^\s*(--[\w-]+|color-scheme)\s*:\s*([\s\S]*?)\s*$/);
    if (!match) throw new Error(`Invalid token declaration: ${part.trim()}`);
    tokens.set(match[1], match[2]);
  }
  return tokens;
}

function parseThemes(css: string): { light: Tokens; dark: Tokens } {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light: Tokens = new Map();
  const overrides: Tokens = new Map();
  const stack: { header: string; start: number }[] = [];
  let segmentStart = 0;
  let darkRootCount = 0;
  for (const match of source.matchAll(/[{}]/g)) {
    const index = match.index;
    if (match[0] === '{') {
      stack.push({ header: source.slice(segmentStart, index).trim(), start: index + 1 });
    } else {
      const frame = stack.pop();
      if (!frame) throw new Error('Unmatched closing brace');
      if (frame.header === ':root') {
        const media = stack.map(parent => parent.header);
        const target = media.length === 0 ? light
          : media.length === 1 && media[0] === '@media (prefers-color-scheme: dark)' ? overrides
            : undefined;
        if (target) {
          const parsed = declarations(source.slice(frame.start, index));
          if (target === overrides) darkRootCount++;
          for (const [name, value] of parsed) target.set(name, value);
        }
      }
    }
    segmentStart = index + 1;
  }
  if (stack.length) throw new Error('Unmatched opening brace');
  if (!light.size || !darkRootCount || !overrides.size) throw new Error('Missing light or dark root tokens');
  return { light, dark: new Map([...light, ...overrides]) };
}

function resolve(tokens: Tokens, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular token reference: ${name}`);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Undefined token: ${name}`);
  if (!value.startsWith('var(')) return value;
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  if (!alias) throw new Error(`Unsupported token reference: ${name} = ${value}`);
  return resolve(tokens, alias[1], new Set([...seen, name]));
}

function color(value: string, backdrop?: Rgb): Rgb {
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  const rgba = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/);
  if (rgba) {
    if (!backdrop) throw new Error(`RGBA needs a backdrop: ${value}`);
    const channels = rgba.slice(1, 4).map(Number);
    const alpha = Number(rgba[4]);
    if (channels.some(channel => channel > 255) || alpha > 1) throw new Error(`Invalid color: ${value}`);
    return channels.map((channel, i) => channel * alpha + backdrop[i] * (1 - alpha)) as Rgb;
  }
  throw new Error(`Unsupported color: ${value}`);
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map(channel => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenColor(tokens: Tokens, name: string, backdrop?: Rgb): Rgb {
  return color(resolve(tokens, `--color-${name}`), backdrop);
}

describe('color tokens', () => {
  it('parses nested dark overrides, aliases, and comments', () => {
    const themes = parseThemes(`:root { --color-bg: #ffffff; --color-text: var(--color-bg); }
      @media (prefers-color-scheme: dark) { :root { /* override */ --color-bg: #000000; } }`);
    expect(resolve(themes.light, '--color-text')).toBe('#ffffff');
    expect(resolve(themes.dark, '--color-text')).toBe('#000000');
    expect(() => parseThemes(':root { --color-bg: #ffffff; }')).toThrow('Missing');
    expect(() => parseThemes(':root { --color-bg: #ffffff; } @media (prefers-color-scheme: dark) { :root {} }')).toThrow('Missing');
  });

  it('rejects undefined, circular, and unsupported color values', () => {
    expect(() => resolve(new Map([['--a', 'var(--missing)']]), '--a')).toThrow('Undefined');
    expect(() => resolve(new Map([['--a', 'var(--b)'], ['--b', 'var(--a)']]), '--a')).toThrow('Circular');
    expect(() => color('color-mix(in srgb, red, blue)')).toThrow('Unsupported');
    expect(() => color('rgba(0, 0, 0, 0.5)')).toThrow('backdrop');
  });

  it('uses linear sRGB and composites translucent colors over an explicit backdrop', () => {
    expect(contrast(color('#000000'), color('#ffffff'))).toBeCloseTo(21, 10);
    expect(color('rgba(0, 0, 0, 0.5)', color('#ffffff'))).toEqual([127.5, 127.5, 127.5]);
  });

  const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
  const themes = parseThemes(css);
  for (const [theme, tokens] of Object.entries(themes)) {
    it(`${theme} meets text and control contrast thresholds`, () => {
      const cases: [string, string, number][] = [];
      for (const background of ['bg', 'surface']) {
        for (const foreground of ['text', 'subtle', 'link', 'danger']) cases.push([foreground, background, 4.5]);
        for (const foreground of ['control-border', 'focus']) cases.push([foreground, background, 3]);
      }
      cases.push(['primary-ink', 'primary', 4.5], ['primary-ink', 'primary-hover', 4.5], ['danger-ink', 'danger', 4.5]);
      for (const [foreground, background, minimum] of cases) {
        const ratio = contrast(tokenColor(tokens, foreground), tokenColor(tokens, background));
        expect(ratio, `${theme} --color-${foreground} / --color-${background}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
      }
    });
  }
});
