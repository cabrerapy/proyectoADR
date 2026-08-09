import type { OpenNextConfig } from "@opennextjs/aws/types/open-next";

const config = {
  buildCommand: "node scripts/build-next-for-opennext.mjs",
  dangerous: {
    disableIncrementalCache: true,
    disableTagCache: true,
  },
  default: {},
} satisfies OpenNextConfig;

export default config;
