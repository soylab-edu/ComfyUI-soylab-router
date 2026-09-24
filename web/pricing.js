// Published Higgsfield token pricing is a direct API reference, not a Router quote.
export function tokenPriceReference(rule, resolution, ratio, duration) {
  const shortSide = Number(rule?.short_side_pixels?.[resolution]);
  const match = /^(\d+):(\d+)$/.exec(ratio);
  const fps = Number(rule?.fps);
  const usdPerThousand = Number(rule?.usd_per_1k_video_tokens);
  if (!match || !Number.isFinite(shortSide) || shortSide <= 0 || !Number.isFinite(fps) || fps <= 0
      || !Number.isFinite(usdPerThousand) || usdPerThousand <= 0 || !Number.isFinite(duration) || duration <= 0) return null;
  const horizontal = Number(match[1]);
  const vertical = Number(match[2]);
  if (!horizontal || !vertical) return null;
  const even = (value) => Math.round(value / 2) * 2;
  const width = horizontal <= vertical ? shortSide : even(shortSide * horizontal / vertical);
  const height = horizontal <= vertical ? even(shortSide * vertical / horizontal) : shortSide;
  const tokensPerSecond = width * height * fps / 1024;
  return {
    rate: tokensPerSecond / 1000 * usdPerThousand,
    total: Math.ceil(tokensPerSecond * duration) / 1000 * usdPerThousand,
  };
}
