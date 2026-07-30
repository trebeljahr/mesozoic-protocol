import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Catalog-parity half of scripts/check-i18n.ts, wired into the test run so a
// missing translation key can't reach a store build. The length-overflow
// heuristic stays in the script — it warns, it doesn't gate.
const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const REFERENCE = "en";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const flatten = (value: Json, prefix = "", out: Record<string, string> = {}) => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = String(value);
  }
  return out;
};

const namespacesIn = (locale: string): string[] =>
  readdirSync(join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();

const load = (locale: string, ns: string): Record<string, string> =>
  flatten(JSON.parse(readFileSync(join(LOCALES_DIR, locale, `${ns}.json`), "utf8")) as Json);

const REFERENCE_NAMESPACES = namespacesIn(REFERENCE);
const LOCALES = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== REFERENCE)
  .map((e) => e.name)
  .sort();

describe("i18n catalogs", () => {
  it("has a reference locale with namespaces and translations to compare", () => {
    expect(REFERENCE_NAMESPACES.length).toBeGreaterThan(0);
    expect(LOCALES.length).toBeGreaterThan(0);
  });

  it.each(LOCALES)("%s ships the same namespace files as en", (locale) => {
    expect(namespacesIn(locale)).toEqual(REFERENCE_NAMESPACES);
  });

  it.each(LOCALES)("%s has exactly the keys en has — no missing, no extra", (locale) => {
    const missing: string[] = [];
    const extra: string[] = [];
    for (const ns of REFERENCE_NAMESPACES) {
      const reference = new Set(Object.keys(load(REFERENCE, ns)));
      const target = new Set(Object.keys(load(locale, ns)));
      for (const key of reference) if (!target.has(key)) missing.push(`${ns}.${key}`);
      for (const key of target) if (!reference.has(key)) extra.push(`${ns}.${key}`);
    }
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(LOCALES)("%s has no blank strings where en has text", (locale) => {
    const blank: string[] = [];
    for (const ns of REFERENCE_NAMESPACES) {
      const reference = load(REFERENCE, ns);
      const target = load(locale, ns);
      for (const [key, value] of Object.entries(target)) {
        if (reference[key]?.trim() !== "" && value.trim() === "") blank.push(`${ns}.${key}`);
      }
    }
    expect(blank).toEqual([]);
  });
});
