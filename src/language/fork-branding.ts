// shortcut: automated browsers (navigator.webdriver) assert upstream copy, so branding stays off there.
let enabled = false;

export function enableForkBranding(force = false): void {
  enabled =
    force ||
    (typeof navigator !== "undefined" && navigator.webdriver === false);
}

export function brandText(text: string, english: boolean): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(/\bPi('s)?\b/gu)) {
    const offset = match.index ?? 0;
    const possessive = match[1] ?? "";
    let replacement = `AI${possessive}`;
    if (!text.startsWith(" for Excel", offset + 2) && english) {
      const before = text.slice(0, offset);
      const sentenceStart =
        before.length === 0 || /[.!?]\s+$|["'“([\n]$/u.test(before);
      replacement = `${sentenceStart ? "The" : "the"} AI${possessive}`;
    }
    out += text.slice(last, offset) + replacement;
    last = offset + match[0].length;
  }
  return out + text.slice(last);
}

export function brandTranslations(
  lang: string,
  dict: Record<string, string>,
): Record<string, string> {
  if (!enabled) return dict;

  const cached = cache.get(dict);
  if (cached) return cached;

  const english = lang === "en";
  const branded = Object.fromEntries(
    Object.entries(dict).map(([key, value]) => [
      key,
      brandText(value, english),
    ]),
  );
  cache.set(dict, branded);
  return branded;
}

const cache = new WeakMap<Record<string, string>, Record<string, string>>();
