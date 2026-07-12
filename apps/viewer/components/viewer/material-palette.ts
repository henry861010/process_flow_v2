const MATERIAL_COLOR_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [["cu", "copper", "metal", "rdl", "via"], "#d29b2a"],
  [["solder", "snag", "sac", "bga", "c4", "ubump", "bump"], "#d8dee2"],
  [["silicon", "si", "die", "logic", "hbm", "interposer"], "#7f8788"],
  [["bt", "abf", "substrate", "panel", "carrier"], "#2e7d5b"],
  [["dielectric", "polyimide", "pi", "photo", "pm", "underfill"], "#2aa6b8"],
  [["mold", "molding", "emc", "epoxy", "resin"], "#b9c0bd"],
  [["glass", "wafer"], "#94c9cf"],
];

const FALLBACK_COLORS = [
  "#8f9894",
  "#7b72b8",
  "#bc5f58",
  "#3b82a0",
  "#8a9741",
  "#b77935",
  "#5d8f73",
  "#a15786",
] as const;

/**
 * Returns the canonical preview color for a material instance name.
 * Runtime `_dupN` suffixes deliberately keep the same material-family color.
 */
export function materialPreviewColor(material: unknown) {
  const normalized = String(material ?? "generic")
    .trim()
    .replace(/_dup\d+$/i, "")
    .toLowerCase();

  for (const [tokens, color] of MATERIAL_COLOR_RULES) {
    if (tokens.some((token) => materialMatches(normalized, token))) {
      return color;
    }
  }

  return FALLBACK_COLORS[stableHash(normalized) % FALLBACK_COLORS.length];
}

function materialMatches(material: string, token: string) {
  if (token === "sac") {
    return /(^|[^a-z0-9])sac([0-9]|[^a-z0-9]|$)/.test(material);
  }
  if (token.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`).test(
      material,
    );
  }
  return material.includes(token);
}

function stableHash(value: string) {
  let result = 0;
  for (const character of value) {
    result = (Math.imul(result, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return result;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
