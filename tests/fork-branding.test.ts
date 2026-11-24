import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { t, initLanguage } from "../src/language/index.ts";
import {
  brandText,
  enableForkBranding,
} from "../src/language/fork-branding.ts";
import { parseJson } from "../src/utils/json.ts";

const LocaleSchema = Type.Record(Type.String(), Type.String());

function locale(lang: "en" | "zh-CN"): Record<string, string> {
  const text = readFileSync(
    new URL(`../src/language/locales/${lang}.json`, import.meta.url),
    "utf8",
  );
  return Value.Parse(LocaleSchema, parseJson(text));
}

void test("brandText renames the assistant Pi to the AI in English", () => {
  assert.equal(
    brandText("Pi wants to use a tool", true),
    "The AI wants to use a tool",
  );
  assert.equal(
    brandText("Allow Pi to search the web", true),
    "Allow the AI to search the web",
  );
  assert.equal(brandText("Pi's rules", true), "The AI's rules");
  assert.equal(
    brandText("How much of Pi's memory this conversation is using.", true),
    "How much of the AI's memory this conversation is using.",
  );
  assert.equal(
    brandText("Reload Pi. Pi keeps your rules.", true),
    "Reload the AI. The AI keeps your rules.",
  );
  assert.equal(brandText("Pi for Excel proxy", true), "AI for Excel proxy");
  assert.equal(
    brandText("Run npx pi-for-excel-proxy@latest", true),
    "Run npx pi-for-excel-proxy@latest",
  );
  assert.equal(brandText("No name here", true), "No name here");
});

void test("brandText renames Pi to AI in Chinese and leaves other text alone", () => {
  assert.equal(brandText("压缩后被 Pi 看到", false), "压缩后被 AI 看到");
  assert.equal(brandText("Pi for Excel", false), "AI for Excel");
  assert.equal(brandText("没有名字的文案", false), "没有名字的文案");
});

void test("upstream copy reaches tests and automated browsers unchanged", () => {
  initLanguage("en");
  enableForkBranding();
  assert.equal(t("input.placeholder.edit"), "Have Pi edit this workbook…");
});

void test("every locale string reaches the UI without the upstream assistant name", () => {
  enableForkBranding(true);
  for (const lang of ["en", "zh-CN"] as const) {
    const dict = locale(lang);
    initLanguage(lang);
    assert.ok(Object.keys(dict).some((key) => /\bPi\b/u.test(dict[key] ?? "")));
    for (const key of Object.keys(dict)) {
      assert.equal(
        /\bPi\b/u.test(t(key)),
        false,
        `${lang}:${key} still says Pi`,
      );
    }
  }
});
