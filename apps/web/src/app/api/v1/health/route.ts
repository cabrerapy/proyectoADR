import { createApiHandler } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(() =>
  Response.json({ data: { status: "ok" } }),
);
