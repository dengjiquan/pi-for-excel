import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_PASTED_IMAGE_BYTES,
  readPastedImage,
  toImageContent,
} from "../src/ui/pasted-images.ts";

void test("readPastedImage converts clipboard image bytes to model image content", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
  const pasted = await readPastedImage(file, 0);

  assert.equal(pasted.mimeType, "image/png");
  assert.equal(pasted.data, "AQID");
  assert.deepEqual(toImageContent([pasted]), [{
    type: "image",
    data: "AQID",
    mimeType: "image/png",
  }]);
});

void test("readPastedImage rejects non-images and oversized images", async () => {
  const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
  await assert.rejects(() => readPastedImage(textFile, 0), /Only images/);

  const oversized = new File(
    [new Uint8Array(MAX_PASTED_IMAGE_BYTES + 1)],
    "large.png",
    { type: "image/png" },
  );
  await assert.rejects(() => readPastedImage(oversized, 0), /20 MB/);
});
