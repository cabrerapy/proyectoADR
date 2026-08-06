import { assertOpaqueSegment } from "./model-validation";

export const SHARD_COUNT = 4 as const;
export const SHARDS = ["S00", "S01", "S02", "S03"] as const;

export type Shard = (typeof SHARDS)[number];

export const isShard = (value: string): value is Shard =>
  SHARDS.some((shard) => shard === value);

export const assertShard = (value: string): Shard => {
  if (!isShard(value)) {
    throw new Error(`Shard no válido: ${value}`);
  }

  return value;
};

export const shardForId = (id: string): Shard => {
  const validId = assertOpaqueSegment(id, "id");
  let hash = 2_166_136_261;

  for (const character of validId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  const shard = SHARDS[(hash >>> 0) % SHARD_COUNT];
  if (shard === undefined) {
    throw new Error("No fue posible calcular el shard.");
  }

  return shard;
};
