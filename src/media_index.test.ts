import assert from "node:assert/strict";
import test from "node:test";
import { needsReindex, type IndexEntry } from "./tenant_media_index.ts";

const indexed: IndexEntry = {
  key: "product/hero.png",
  width: 1600,
  height: 900,
  format: "png",
  indexedAt: "2026-09-13T08:00:00.000Z",
};

test("reindexes an asset when its bytes describe different dimensions", () => {
  assert.equal(needsReindex(indexed, { width: 1600, height: 900, format: "PNG" }), false);
  assert.equal(needsReindex(indexed, { width: 1200, height: 1200, format: "png" }), true);
});
