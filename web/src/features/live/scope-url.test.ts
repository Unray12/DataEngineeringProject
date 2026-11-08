import { expect, it } from "vitest";
import { scopeUrl } from "./scope-url";
it("retains farm and unrelated filters across consecutive field changes", () => {
  const first = scopeUrl("/live", "?metric=rainfall", {
    farmId: "farm-north",
    fieldId: "",
  });
  const second = scopeUrl("/live", first.slice(first.indexOf("?")), {
    fieldId: "field-n01",
  });
  expect(second).toBe(
    "/live?metric=rainfall&farmId=farm-north&fieldId=field-n01",
  );
});
it("clears field scope when the farm is changed", () => {
  expect(
    scopeUrl("/devices", "?farmId=old&fieldId=old-field", {
      farmId: "new",
      fieldId: "",
    }),
  ).toBe("/devices?farmId=new");
});
