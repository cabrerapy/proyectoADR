const correlationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const correlationIdHeader = "x-correlation-id";

export const resolveCorrelationId = (headers: Headers): string => {
  const candidate = headers.get(correlationIdHeader)?.trim();

  return candidate && correlationIdPattern.test(candidate)
    ? candidate.toLowerCase()
    : crypto.randomUUID();
};
