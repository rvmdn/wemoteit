import fs from "node:fs";
import path from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import {
  ExecutionProvider,
  ExecutionCapabilities,
  ExecutionRequest,
  ExecutionContext,
  ExecutionHandle,
  ExecutionStatus,
  CancellationResult,
} from "../../../ports/execution-provider.port.js";
import { ExecutionResult } from "../../../domain/result/result.entity.js";
import { ProviderError } from "../../../shared/errors/app-error.js";
import { logger } from "../../logging/logger.js";
import { redactSecrets } from "../../../shared/security/redactor.js";

export interface AntigravityProviderConfig {
  cliPath?: string;
  maxTimeoutMs?: number;
  executionMode?: "cli" | "sdk" | "ui_automation" | "mock";
}

interface ActiveProcessState {
  process?: ChildProcess;
  status: ExecutionStatus;
  startedAt: string;
  stdout: string;
  stderr: string;
  request: ExecutionRequest;
}

export class AntigravityExecutionProvider implements ExecutionProvider {
  public readonly provider = "antigravity";
  private activeJobs = new Map<string, ActiveProcessState>();

  constructor(private readonly config: AntigravityProviderConfig = {}) {}

  public async getCapabilities(): Promise<ExecutionCapabilities> {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportedLanguages: [
        "typescript",
        "javascript",
        "csharp",
        "python",
        "sql",
        "html",
        "css",
        "markdown",
      ],
      supportedTools: ["read_file", "write_to_file", "run_command", "view_file", "search"],
      maxTimeoutMs: this.config.maxTimeoutMs ?? 120000,
    };
  }

  public resolveCliPath(): string {
    if (this.config.cliPath) {
      if (fs.existsSync(this.config.cliPath)) {
        return this.config.cliPath;
      }
      throw new ProviderError(
        `Configured Antigravity CLI path does not exist: ${this.config.cliPath}`,
        this.provider
      );
    }

    // Default standard Windows install paths for Antigravity IDE
    const localAppData = process.env.LOCALAPPDATA || "C:\\Users\\822117\\AppData\\Local";
    const candidates = [
      path.join(localAppData, "Programs", "Antigravity", "bin", "antigravity-ide.cmd"),
      path.join(localAppData, "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd"),
      path.join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe"),
      "C:\\Program Files\\Antigravity IDE\\bin\\antigravity-ide.cmd",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new ProviderError(
      "Antigravity IDE CLI executable was not found. Please verify installation at 'Antigravity/bin/antigravity-ide.cmd'",
      this.provider,
      { checkedPaths: candidates }
    );
  }

  public async execute(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionHandle> {
    const handleId = `agy-${request.jobId}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const handle: ExecutionHandle = {
      id: handleId,
      provider: this.provider,
      startedAt,
    };

    const targetCwd = context.workingDirectory || request.repositoryPath || process.cwd();
    const timeoutMs = request.timeoutMs || this.config.maxTimeoutMs || 120000;

    let cliPath: string;
    try {
      cliPath = this.resolveCliPath();
    } catch (err: any) {
      const errorResult: ExecutionResult = {
        id: `res-${handleId}`,
        schemaVersion: 1,
        jobId: request.jobId,
        status: "failure",
        summary: `Antigravity CLI discovery failed: ${err.message}`,
        outputRef: null,
        artifacts: [],
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
        errorCode: "CLI_NOT_FOUND",
        correlationId: request.correlationId,
      };

      this.activeJobs.set(handleId, {
        status: {
          handleId,
          state: "failed",
          progressSummary: "CLI binary not found",
          result: errorResult,
        },
        startedAt,
        stdout: "",
        stderr: err.message,
        request,
      });

      return handle;
    }

    logger.info(
      { jobId: request.jobId, cliPath, targetCwd, timeoutMs },
      "Launching Antigravity agent process"
    );

    const mode = request.action === "review" ? "ask" : "agent";
    const prompt = request.prompt;
    const args = ["chat", "--reuse-window", "--mode", mode, prompt];

    const executable = cliPath.includes(" ") ? `"${cliPath}"` : cliPath;
    const child = spawn(executable, args, {
      cwd: targetCwd,
      env: {
        ...process.env,
        ...(context.environment || {}),
      },
      shell: true,
      windowsHide: true,
    });

    const activeState: ActiveProcessState = {
      process: child,
      status: {
        handleId,
        state: "running",
        progressSummary: `Executing mode '${mode}' on '${targetCwd}'`,
      },
      startedAt,
      stdout: "",
      stderr: "",
      request,
    };
    this.activeJobs.set(handleId, activeState);

    // Timeout guard
    const timer = setTimeout(() => {
      if (activeState.status.state === "running") {
        logger.warn({ jobId: request.jobId, handleId }, "Antigravity execution timed out; terminating");
        this.terminateChildProcess(child);
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - new Date(startedAt).getTime();

        activeState.status = {
          handleId,
          state: "failed",
          progressSummary: `Execution timed out after ${timeoutMs}ms`,
          result: {
            id: `res-${handleId}`,
            schemaVersion: 1,
            jobId: request.jobId,
            status: "timeout",
            summary: `Execution timed out after ${timeoutMs}ms.`,
            outputRef: null,
            artifacts: [],
            startedAt,
            completedAt,
            durationMs,
            errorCode: "EXECUTION_TIMEOUT",
            correlationId: request.correlationId,
          },
        };
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (activeState.stdout.length < 50000) {
        activeState.stdout += chunk.toString();
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (activeState.stderr.length < 50000) {
        activeState.stderr += chunk.toString();
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      logger.error({ jobId: request.jobId, error: err.message }, "Antigravity child process error");
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - new Date(startedAt).getTime();

      activeState.status = {
        handleId,
        state: "failed",
        progressSummary: `Process error: ${err.message}`,
        result: {
          id: `res-${handleId}`,
          schemaVersion: 1,
          jobId: request.jobId,
          status: "failure",
          summary: `Failed to spawn process: ${err.message}`,
          outputRef: null,
          artifacts: [],
          startedAt,
          completedAt,
          durationMs,
          errorCode: "PROCESS_ERROR",
          correlationId: request.correlationId,
        },
      };
    });

    child.on("close", (exitCode: number | null) => {
      clearTimeout(timer);
      if (activeState.status.state !== "running") return;

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - new Date(startedAt).getTime();
      const stdoutContent = activeState.stdout.trim();
      const isSuccess = exitCode === 0;
      const rawSummary = isSuccess
        ? stdoutContent || this.buildContextualSummary(targetCwd, request.prompt)
        : activeState.stderr.trim() || `Antigravity agent exited with non-zero exit code: ${exitCode}`;

      const safeSummary = redactSecrets(rawSummary.slice(0, 3000));

      const result: ExecutionResult = {
        id: `res-${handleId}`,
        schemaVersion: 1,
        jobId: request.jobId,
        status: isSuccess ? "success" : "failure",
        summary: safeSummary,
        outputRef: null,
        artifacts: [],
        startedAt,
        completedAt,
        durationMs,
        errorCode: isSuccess ? null : `EXIT_CODE_${exitCode}`,
        correlationId: request.correlationId,
      };

      activeState.status = {
        handleId,
        state: isSuccess ? "completed" : "failed",
        progressSummary: isSuccess ? "Task finished" : "Task failed",
        result,
      };

      logger.info(
        { jobId: request.jobId, exitCode, durationMs, success: isSuccess },
        "Antigravity process finished"
      );
    });

    return handle;
  }

  public async getStatus(handle: ExecutionHandle): Promise<ExecutionStatus> {
    const state = this.activeJobs.get(handle.id);
    if (!state) {
      return {
        handleId: handle.id,
        state: "failed",
        progressSummary: "Execution handle not found in active jobs registry",
      };
    }
    return state.status;
  }

  public async requestCancellation(handle: ExecutionHandle): Promise<CancellationResult> {
    const state = this.activeJobs.get(handle.id);
    if (!state) {
      return { cancelled: false, reason: "Handle not found" };
    }

    if (state.status.state !== "running") {
      return { cancelled: false, reason: `Job already in ${state.status.state} state` };
    }

    try {
      if (state.process && !state.process.killed) {
        this.terminateChildProcess(state.process);
      }
      state.status.state = "cancelled";
      state.status.progressSummary = "Cancellation requested by operator";
      return { cancelled: true };
    } catch (err: any) {
      return { cancelled: false, reason: err.message };
    }
  }

  private terminateChildProcess(child?: ChildProcess): void {
    if (!child || !child.pid || child.killed) return;
    if (process.platform === "win32") {
      try {
        // Kill entire process tree in Windows to prevent lingering child processes
        spawn("taskkill", ["/pid", child.pid.toString(), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore
        }
      }
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore
      }
    }
  }

  private buildContextualSummary(targetCwd: string, prompt: string): string {
    const lines: string[] = [
      `🚀 Antigravity IDE agent session dispatched for prompt: "${prompt}".`,
      `📂 Workspace: ${targetCwd}`,
    ];

    try {
      if (fs.existsSync(targetCwd)) {
        // 1. Check README.md
        const readmePath = path.join(targetCwd, "README.md");
        if (fs.existsSync(readmePath)) {
          const readmeContent = fs.readFileSync(readmePath, "utf-8").trim();
          const firstParagraph = readmeContent
            .split("\n")
            .filter((l) => l.trim().length > 0 && !l.startsWith("---") && !l.startsWith("```"))
            .slice(0, 4)
            .join("\n");
          if (firstParagraph) {
            lines.push(`\n📖 Project Summary:\n${firstParagraph}`);
          }
        }

        // 2. Check package.json
        const pkgPath = path.join(targetCwd, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            if (pkg.name || pkg.description) {
              lines.push(`\n📦 Package: ${pkg.name || "unnamed"} (v${pkg.version || "1.0.0"})`);
              if (pkg.description) lines.push(`• Description: ${pkg.description}`);
            }
          } catch {
            // Ignore
          }
        }

        // 3. Check manifest.json (e.g. extension)
        const manifestPath = path.join(targetCwd, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            lines.push(`\n🧩 Extension Manifest: ${manifest.name || "Browser Extension"} (v${manifest.version || "1.0.0"})`);
            if (manifest.description) lines.push(`• Description: ${manifest.description}`);
          } catch {
            // Ignore
          }
        }

        // 4. File Structure Preview
        const entries = fs.readdirSync(targetCwd, { withFileTypes: true });
        const visibleEntries = entries
          .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .slice(0, 10);
        if (visibleEntries.length > 0) {
          lines.push(`\n📁 Files (${visibleEntries.length}): ${visibleEntries.join(", ")}`);
        }
      }
    } catch {
      // Ignore filesystem inspection errors
    }

    return lines.join("\n");
  }
}

