import { describe, expect, it, vi } from "vitest";
import { ClassCounterBackfillError, SegmentedClassCounterBackfill, type ClassCounterReconciler } from "./segmented-class-counter-backfill";

const result = { changed: false, confirmedCount: 2, previousCount: 2, version: 3 };

describe("SegmentedClassCounterBackfill", () => {
  it("procesa un lote limitado y reanuda desde un checkpoint verificable", async () => {
    const reconcileClassCounter = vi.fn<ClassCounterReconciler["reconcileClassCounter"]>().mockResolvedValue(result);
    const runner = new SegmentedClassCounterBackfill({ reconcileClassCounter });
    const input = { actorId: "system-reconciler", classIds: ["class-001", "class-002", "class-003"], limit: 2, reconciledAt: "2026-08-15T12:00:00Z", runId: "run-001" } as const;
    const first = await runner.run(input);
    expect(first).toMatchObject({ complete: false, checkpoint: { nextOffset: 2 }, items: [{ classId: "class-001" }, { classId: "class-002" }] });
    const second = await runner.run({ ...input, checkpoint: first.checkpoint });
    expect(second).toMatchObject({ complete: true, checkpoint: { nextOffset: 3 }, items: [{ classId: "class-003" }] });
    expect(reconcileClassCounter).toHaveBeenCalledTimes(3);
  });

  it("rechaza manifiestos alterados, duplicados o lotes sin límite", async () => {
    const runner = new SegmentedClassCounterBackfill({ reconcileClassCounter: vi.fn().mockResolvedValue(result) });
    const base = { actorId: "system-reconciler", classIds: ["class-001"], limit: 1, reconciledAt: "2026-08-15T12:00:00Z", runId: "run-001" } as const;
    const complete = await runner.run(base);
    await expect(runner.run({ ...base, checkpoint: complete.checkpoint, classIds: ["class-002"] })).rejects.toThrow("checkpoint");
    await expect(runner.run({ ...base, classIds: ["class-001", "class-001"] })).rejects.toThrow("duplicadas");
    await expect(runner.run({ ...base, limit: 26 })).rejects.toThrow("entre 1 y 25");
  });

  it("conserva el checkpoint anterior al elemento fallido", async () => {
    const failure = new Error("conflicto condicional");
    const reconcileClassCounter = vi.fn<ClassCounterReconciler["reconcileClassCounter"]>().mockResolvedValueOnce(result).mockRejectedValueOnce(failure);
    const runner = new SegmentedClassCounterBackfill({ reconcileClassCounter });
    const promise = runner.run({ actorId: "system-reconciler", classIds: ["class-001", "class-002"], limit: 2, reconciledAt: "2026-08-15T12:00:00Z", runId: "run-002" });
    await expect(promise).rejects.toMatchObject({ checkpoint: { nextOffset: 1, runId: "run-002" }, cause: failure });
    await expect(promise).rejects.toBeInstanceOf(ClassCounterBackfillError);
  });
});
