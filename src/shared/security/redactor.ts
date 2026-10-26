const SENSITIVE_PATTERNS: Array<{ regex: RegExp; replaceWith: string }> = [
  // Bearer tokens
  { regex: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, replaceWith: "Bearer [REDACTED]" },
  // OpenAI / generic sk- tokens
  { regex: /sk-[A-Za-z0-9_-]{20,}/gi, replaceWith: "sk-[REDACTED]" },
  // Google API keys (AIza...)
  { regex: /AIza[0-9A-Za-z-_]{35,}/g, replaceWith: "AIza[REDACTED]" },
  // Key / Secret / Password / Token key-value pairs (excluding Bearer tokens already handled)
  {
    regex: /(["']?(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?)([^"' \r\n,;}{]+)(["']?)/gi,
    replaceWith: "$1[REDACTED]$3",
  },
  // Basic Auth URLs
  { regex: /:\/\/([^:]+):([^@]+)@/g, replaceWith: "://$1:[REDACTED]@" },
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let redacted = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern.regex, pattern.replaceWith);
  }
  return redacted;
}

export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return redactSecrets(obj) as unknown as T;
  }
  if (typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map((item) => redactObject(item)) as unknown as T;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (/password|secret|token|key|credential/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(val);
      }
    }
    return result as T;
  }
  return obj;
}
