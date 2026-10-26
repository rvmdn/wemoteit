import { describe, it, expect } from "vitest";
import { redactSecrets, redactObject } from "../../src/shared/security/redactor.js";

describe("Secret Redactor", () => {
  it("masks Bearer tokens", () => {
    const raw = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
    const redacted = redactSecrets(raw);
    expect(redacted).toBe("Authorization: Bearer [REDACTED]");
  });

  it("masks OpenAI and Google API keys", () => {
    const raw1 = "My secret key is sk-1234567890abcdef1234567890abcdef";
    const raw2 = "Google key AIzaSyD9876543210zyxwvutsrqponmlkjihgfedc";
    expect(redactSecrets(raw1)).toContain("sk-[REDACTED]");
    expect(redactSecrets(raw2)).toBe("Google key AIza[REDACTED]");
  });

  it("masks sensitive fields in structured objects", () => {
    const obj = {
      username: "antigravity_user",
      password: "SuperSecretPassword123!",
      api_key: "key-12345",
      config: {
        token: "tok-abc",
        host: "localhost",
      },
    };
    const redacted = redactObject(obj);
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.api_key).toBe("[REDACTED]");
    expect(redacted.config.token).toBe("[REDACTED]");
    expect(redacted.username).toBe("antigravity_user");
    expect(redacted.config.host).toBe("localhost");
  });
});
