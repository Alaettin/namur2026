import { expect, test } from "@playwright/test";
import { raeumeExponateAuf } from "./exponate.js";
import { kameraOptionen, oeffneKamera } from "./kamera.js";

/** Ein Gerät mit nur einer Kamera zeigt keinen toten Wechselknopf. */

test.use(kameraOptionen(1));

test.afterEach(async ({ request }) => {
  await raeumeExponateAuf(request);
});

test("mit einer Kamera gibt es keinen Wechselknopf", async ({ page, request }) => {
  await oeffneKamera(page, request);
  await expect(page.getByRole("button", { name: "Kamera wechseln" })).toHaveCount(0);
});
