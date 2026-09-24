import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tokenPriceReference } from "../web/pricing.js";

const catalog = JSON.parse(readFileSync(new URL("../web/router-data.json", import.meta.url), "utf8"));
const seedance = catalog.models.find((model) => model.model_id === "byteplus/dreamina-seedance-2-5-260628");
const rule = seedance.pricing.alternates.higgsfield.token_pricing;

test("Higgsfield reference tracks selected duration and resolution", () => {
  const four = tokenPriceReference(rule, "480p", "9:16", 4);
  const seven = tokenPriceReference(rule, "480p", "9:16", 7);
  assert.equal((four.total * catalog.comfy_credits_per_usd).toFixed(1), "173.5");
  assert.equal((seven.total * catalog.comfy_credits_per_usd).toFixed(1), "303.7");
  assert.ok(seven.total > four.total);
  assert.ok(tokenPriceReference(rule, "720p", "9:16", 4).total > four.total);
  assert.equal(tokenPriceReference(rule, "1080p", "9:16", 4), null);
});
