import { logger } from "../adapters/logging/logger.js";

export interface ClosableResource {
  name: string;
  close: () => Promise<void> | void;
}

export class LifecycleManager {
  private resources: ClosableResource[] = [];
  private isShuttingDown = false;

  public register(resource: ClosableResource): void {
    this.resources.push(resource);
  }

  public setupSignalHandlers(): void {
    const handleSignal = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      logger.info({ signal }, "Shutdown signal received; initiating clean teardown");

      const timeout = setTimeout(() => {
        logger.error("Teardown timed out after 10s; forcing exit");
        process.exit(1);
      }, 10000);

      try {
        await this.shutdown();
        clearTimeout(timeout);
        process.exit(0);
      } catch (err: any) {
        clearTimeout(timeout);
        logger.error({ error: err.message }, "Error during graceful shutdown");
        process.exit(1);
      }
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
  }

  public async shutdown(): Promise<void> {
    logger.info(`Closing ${this.resources.length} registered system resources`);
    // Close in reverse order of registration
    for (let i = this.resources.length - 1; i >= 0; i--) {
      const res = this.resources[i];
      try {
        logger.debug({ resource: res.name }, "Closing resource");
        await res.close();
      } catch (err: any) {
        logger.warn({ resource: res.name, error: err.message }, "Failed to cleanly close resource");
      }
    }
    logger.info("All resources closed successfully");
  }
}
