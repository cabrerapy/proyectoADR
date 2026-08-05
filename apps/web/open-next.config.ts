import type { OpenNextConfig } from "@opennextjs/aws/types/open-next";

const config = {
  dangerous: {
    disableIncrementalCache: true,
    disableTagCache: true,
  },
  default: {},
} satisfies OpenNextConfig;

export default config;
