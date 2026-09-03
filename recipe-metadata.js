// Shared by the importer and the UI: unknown yield is blank, never zero.
export function normalizeYield(value) {
  const candidates = (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim())
    .filter((item) => item && !/^(?:unknown|n\/?a|none|null|not (?:provided|specified))$/i.test(item))
    .filter((item) => !/(?:^|\s|:)\s*-?0(?:\.0+)?(?:\s|$|[-–])/i.test(item));
  const text = candidates.find((item) => /[a-z]/i.test(item)) || candidates[0] || '';
  if (/^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?$/.test(text)) return `${text} servings`;
  return text;
}

export function yieldLabel(recipe, value = recipe.yield) {
  const text = normalizeYield(value);
  return text && recipe.metadataEstimates?.includes('yield') ? `≈ ${text}` : text;
}

export function timeIsEstimated(recipe) {
  const estimates = recipe.metadataEstimates || [];
  return recipe.totalMinutes ? estimates.includes('totalMinutes') : estimates.some((field) => field === 'prepMinutes' || field === 'cookMinutes');
}
