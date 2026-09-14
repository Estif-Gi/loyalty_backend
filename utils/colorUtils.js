/**
 * OKLCH Color Space Utilities
 * 
 * Implements conversion between sRGB / Hex and OKLCH (Oklab cylindrical coordinates).
 * Conforms to CSS Color Module Level 4 specification:
 * oklch(L C H) where:
 *   L: Lightness [0..1]
 *   C: Chroma [0..~0.4]
 *   H: Hue angle in degrees [0..360)
 */

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [0, 0, 0];
  let clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(x => x + x).join('');
  }
  if (clean.length !== 6) return [0, 0, 0];
  const num = parseInt(clean, 16);
  if (isNaN(num)) return [0, 0, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Converts a hex string (#rrggbb or #rgb) to CSS oklch(L C H)
 */
function hexToOklch(hex) {
  const [r255, g255, b255] = hexToRgb(hex);
  const r = srgbToLinear(r255 / 255);
  const g = srgbToLinear(g255 / 255);
  const b = srgbToLinear(b255 / 255);

  // Linear sRGB to LMS
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  // LMS to Oklab
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bOklab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // Oklab to OKLCH
  const C = Math.sqrt(a * a + bOklab * bOklab);
  let H = Math.atan2(bOklab, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  // Round neatly for clean CSS output
  const lClean = Number(L.toFixed(3));
  const cClean = Number(C.toFixed(3));
  const hClean = Number(H.toFixed(1));

  return `oklch(${lClean} ${cClean} ${hClean})`;
}

/**
 * Converts CSS oklch(L C H) back to Hex string #rrggbb
 */
function oklchToHex(oklchStr) {
  if (!oklchStr || typeof oklchStr !== 'string') return '#7a4b2a';
  const match = oklchStr.match(/oklch\(\s*([\d.]+)(?:%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?/i);
  if (!match) return '#7a4b2a';

  let L = parseFloat(match[1]);
  if (oklchStr.includes('%') && L > 1) L = L / 100;
  const C = parseFloat(match[2]);
  const H = parseFloat(match[3]);

  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const bOklab = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bOklab;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bOklab;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bOklab;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLinear = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const rSrgb = Math.round(clamp01(linearToSrgb(rLinear)) * 255);
  const gSrgb = Math.round(clamp01(linearToSrgb(gLinear)) * 255);
  const bSrgb = Math.round(clamp01(linearToSrgb(bLinear)) * 255);

  return rgbToHex(rSrgb, gSrgb, bSrgb);
}

/**
 * Checks if a string is a valid oklch expression
 */
function isOklch(str) {
  if (!str || typeof str !== 'string') return false;
  return /^oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(?:deg)?(?:\s*\/\s*[\d.]+%?)?\s*\)$/i.test(str.trim());
}

// Brand default coffee brown in OKLCH
const DEFAULT_OKLCH_THEME = 'oklch(0.46 0.079 54.4)';

/**
 * Normalizes any color input (hex, existing OKLCH) to a canonical OKLCH string
 */
function normalizeToOklch(color) {
  if (!color || typeof color !== 'string') return DEFAULT_OKLCH_THEME;
  const trimmed = color.trim();

  // If already oklch, sanitize and return
  if (isOklch(trimmed)) {
    return trimmed;
  }

  // If hex string (e.g. #7A4B2A or #fff)
  if (/^#([0-9a-fA-F]{3}){1,2}$/.test(trimmed)) {
    return hexToOklch(trimmed);
  }

  // Fallback to default OKLCH
  return DEFAULT_OKLCH_THEME;
}

module.exports = {
  srgbToLinear,
  linearToSrgb,
  hexToRgb,
  rgbToHex,
  hexToOklch,
  oklchToHex,
  isOklch,
  normalizeToOklch,
  DEFAULT_OKLCH_THEME
};
