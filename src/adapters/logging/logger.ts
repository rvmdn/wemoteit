import pino from "pino";
import { redactSecrets } from "../../shared/security/redactor.js";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  hooks: {
    logMethod(inputArgs, method) {
      if (inputArgs.length >= 2 && typeof inputArgs[1] === "string") {
        inputArgs[1] = redactSecrets(inputArgs[1]);
      } else if (inputArgs.length === 1 && typeof inputArgs[0] === "string") {
        inputArgs[0] = redactSecrets(inputArgs[0]);
      }
      return method.apply(this, inputArgs as [any, ...any[]]);
    },
  },
});

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
