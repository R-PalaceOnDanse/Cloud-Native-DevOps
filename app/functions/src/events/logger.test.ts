import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function captured() {
  const lines: Record<string, unknown>[] = [];
  const write = (line: string): void => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  };
  return { lines, write };
}

const now = () => new Date("2026-10-23T12:00:00.000Z");

describe("createLogger", () => {
  it("writes one JSON line with the names Cloud Logging reads", () => {
    const { lines, write } = captured();
    createLogger({ functionName: "draw-worker", correlationId: "corr-12345678", write, now }).info(
      "pixel processed",
      { x: 10, y: 20 },
    );
    expect(lines).toEqual([
      {
        severity: "INFO",
        message: "pixel processed",
        function: "draw-worker",
        correlation_id: "corr-12345678",
        timestamp: "2026-10-23T12:00:00.000Z",
        x: 10,
        y: 20,
      },
    ]);
  });

  it("omits the correlation ID when there is none yet", () => {
    const { lines, write } = captured();
    createLogger({ functionName: "proxy", write, now }).warning("rejected");
    expect(lines[0]).not.toHaveProperty("correlation_id");
    expect(lines[0]).toMatchObject({ severity: "WARNING" });
  });

  it("does not let a field overwrite the reserved names", () => {
    const { lines, write } = captured();
    createLogger({ functionName: "proxy", correlationId: "corr-12345678", write, now }).error("boom", {
      severity: "DEBUG",
      correlation_id: "forged",
      function: "other",
    });
    expect(lines[0]).toMatchObject({ severity: "ERROR", correlation_id: "corr-12345678", function: "proxy" });
  });

  it("adds the fields of a child logger to every line", () => {
    const { lines, write } = captured();
    const child = createLogger({ functionName: "worker", write, now }).child({ event_id: "e-1" });
    child.info("first");
    child.child({ step: "store" }).debug("second", { x: 1 });
    expect(lines[0]).toMatchObject({ event_id: "e-1" });
    expect(lines[1]).toMatchObject({ event_id: "e-1", step: "store", x: 1, severity: "DEBUG" });
  });
});
