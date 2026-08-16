import { createHash } from "node:crypto";

import type { ReconcileClassCounterInput, ReconcileClassCounterResult } from "@gym-adr/data-access";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const MAX_ITEMS_PER_RUN = 25;

export interface ClassCounterReconciler {
  reconcileClassCounter(input: ReconcileClassCounterInput): Promise<ReconcileClassCounterResult>;
}

export interface BackfillCheckpoint {
  readonly manifestDigest: string;
  readonly nextOffset: number;
  readonly runId: string;
}

export interface RunClassCounterBackfillInput {
  readonly actorId: string;
  readonly checkpoint?: BackfillCheckpoint;
  readonly classIds: readonly string[];
  readonly limit: number;
  readonly reconciledAt: string;
  readonly runId: string;
}

export interface BackfillItemResult extends ReconcileClassCounterResult { readonly classId: string }
export interface ClassCounterBackfillResult {
  readonly checkpoint: BackfillCheckpoint;
  readonly complete: boolean;
  readonly items: readonly BackfillItemResult[];
}

export class ClassCounterBackfillError extends Error {
  readonly checkpoint: BackfillCheckpoint;
  override readonly cause: unknown;
  constructor(message: string, checkpoint: BackfillCheckpoint, cause: unknown) {
    super(message);
    this.name = "ClassCounterBackfillError";
    this.checkpoint = checkpoint;
    this.cause = cause;
  }
}

const identifier = (value: string, field: string): string => {
  if (!IDENTIFIER.test(value)) throw new Error(`${field} no es un identificador operativo válido.`);
  return value;
};
const timestamp = (value: string): string => {
  if (!Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) throw new Error("reconciledAt debe ser un timestamp UTC válido.");
  return value;
};
const digestManifest = (classIds: readonly string[]): string => createHash("sha256").update(JSON.stringify(classIds)).digest("hex");
const operationId = (prefix: string, runId: string, offset: number): string => `${prefix}-${createHash("sha256").update(`${runId}:${offset}`).digest("hex").slice(0, 24)}`;

export class SegmentedClassCounterBackfill {
  constructor(private readonly reconciler: ClassCounterReconciler) {}

  async run(input: RunClassCounterBackfillInput): Promise<ClassCounterBackfillResult> {
    const runId = identifier(input.runId, "runId");
    const actorId = identifier(input.actorId, "actorId");
    const reconciledAt = timestamp(input.reconciledAt);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_ITEMS_PER_RUN) throw new Error(`limit debe estar entre 1 y ${MAX_ITEMS_PER_RUN}.`);
    if (input.classIds.length === 0) throw new Error("El manifiesto debe contener al menos una clase explícita.");
    const classIds = input.classIds.map((classId) => identifier(classId, "classId"));
    if (new Set(classIds).size !== classIds.length) throw new Error("El manifiesto no admite clases duplicadas.");
    const manifestDigest = digestManifest(classIds);
    const offset = input.checkpoint?.nextOffset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > classIds.length || (input.checkpoint !== undefined && (input.checkpoint.runId !== runId || input.checkpoint.manifestDigest !== manifestDigest))) throw new Error("El checkpoint no corresponde al run ni al manifiesto actuales.");

    const end = Math.min(offset + input.limit, classIds.length);
    const items: BackfillItemResult[] = [];
    for (let index = offset; index < end; index += 1) {
      const classId = classIds[index];
      if (classId === undefined) throw new Error("El manifiesto operativo es inconsistente.");
      try {
        const result = await this.reconciler.reconcileClassCounter({ actorId, auditId: operationId("audit-reconcile", runId, index), classId, correlationId: operationId("run-reconcile", runId, index), reconciledAt });
        items.push({ classId, ...result });
      } catch (cause) {
        throw new ClassCounterBackfillError(`La reconciliación se detuvo antes de procesar ${classId}.`, { manifestDigest, nextOffset: index, runId }, cause);
      }
    }
    return { checkpoint: { manifestDigest, nextOffset: end, runId }, complete: end === classIds.length, items };
  }
}
