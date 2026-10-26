import { describe, it, expect, beforeEach } from "vitest";
import { AntigravityExecutionProvider } from "../../src/adapters/agents/antigravity/antigravity-execution.provider.js";
import { ExecutionRequest, ExecutionContext } from "../../src/ports/execution-provider.port.js";

describe("Antigravity Execution Provider (Phase 4)", () => {
  let provider: AntigravityExecutionProvider;

  beforeEach(() => {
    provider = new AntigravityExecutionProvider({
      maxTimeoutMs: 5000,
      executionMode: "cli",
    });
  });

  it("exposes execution capabilities", async () => {
    const caps = await provider.getCapabilities();
    expect(caps.supportsCancellation).toBe(true);
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.supportedLanguages).toContain("typescript");
    expect(caps.supportedLanguages).toContain("python");
    expect(caps.maxTimeoutMs).toBe(5000);
  });

  it("resolves the local Antigravity IDE CLI binary path on Windows", () => {
    const cliPath = provider.resolveCliPath();
    expect(cliPath).toContain("Antigravity IDE");
    expect(cliPath.toLowerCase().endsWith(".cmd") || cliPath.toLowerCase().endsWith(".exe")).toBe(true);
  });

  it("handles non-existent CLI path gracefully without unhandled exceptions", async () => {
    const invalidProvider = new AntigravityExecutionProvider({
      cliPath: "C:\\NonExistentPath\\invalid-antigravity.cmd",
    });

    const request: ExecutionRequest = {
      jobId: "job-test-nonexistent",
      workspaceId: "ws-primary",
      repositoryPath: "F:/Project/Desktop/wedocit",
      action: "review",
      prompt: "Review parser code",
      arguments: {},
      correlationId: "corr-cli-test",
    };

    const context: ExecutionContext = {
      workingDirectory: "F:/Project/Desktop/wedocit",
    };

    const handle = await invalidProvider.execute(request, context);
    expect(handle).toBeDefined();

    const status = await invalidProvider.getStatus(handle);
    expect(status.state).toBe("failed");
    expect(status.result?.errorCode).toBe("CLI_NOT_FOUND");
  });

  it("supports cancellation request on running execution handle", async () => {
    const request: ExecutionRequest = {
      jobId: "job-cancel-test",
      workspaceId: "ws-primary",
      repositoryPath: "F:/Project/Desktop/wedocit",
      action: "review",
      prompt: "Quick review",
      arguments: {},
      correlationId: "corr-cancel-test",
    };

    const handle = await provider.execute(request, {});
    expect(handle.id).toBeDefined();

    const cancelResult = await provider.requestCancellation(handle);
    expect(cancelResult).toBeDefined();

    const status = await provider.getStatus(handle);
    expect(["cancelled", "failed", "completed"]).toContain(status.state);
  });
});
