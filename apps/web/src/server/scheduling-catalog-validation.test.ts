import { validateCreateSchedulingCatalog, validateSchedulingCatalogQuery, validateUpdateSchedulingCatalog } from "@gym-adr/validation";
import { describe, expect, it } from "vitest";

describe("scheduling catalog validation", () => {
  it("accepts bounded create/update commands and rejects protected fields", () => {
    expect(validateCreateSchedulingCatalog({ description: "Especialista", name: "Entrenadora Uno" })).toMatchObject({ success: true });
    expect(validateUpdateSchedulingCatalog({ expectedVersion: 1, name: "Cross training", status: "INACTIVE" })).toMatchObject({ success: true });
    expect(validateCreateSchedulingCatalog({ name: "Entrenador", role: "ADMIN" })).toMatchObject({ success: false });
    expect(validateUpdateSchedulingCatalog({ expectedVersion: 0, name: "Tipo", status: "DELETED" })).toMatchObject({ success: false });
  });

  it("binds list input to status and bounded cursor", () => {
    expect(validateSchedulingCatalogQuery(new URLSearchParams({ status: "ACTIVE" }))).toMatchObject({ success: true });
    expect(validateSchedulingCatalogQuery(new URLSearchParams({ status: "DELETED" }))).toMatchObject({ success: false });
    expect(validateSchedulingCatalogQuery(new URLSearchParams({ userId: "other" }))).toMatchObject({ success: false });
  });
});
