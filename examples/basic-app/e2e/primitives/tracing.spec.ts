/**
 * E2E tests for tracing APIs.
 *
 * Tests startTracing(), stopTracing(), and trace event collection.
 *
 * NOTE: Pointer tracing requires RNDriverTouchInjector to be installed.
 */

import type { DriverEvent } from "@0xbigboss/rn-playwright-driver";
import { expect, test } from "@0xbigboss/rn-playwright-driver/test";

test.describe("Tracing", () => {
  test("startTracing() and stopTracing() complete without error", async ({ device }) => {
    await device.startTracing();
    const result = await device.stopTracing();

    expect(result).toHaveProperty("events");
    expect(Array.isArray(result.events)).toBe(true);
  });

  test("stopTracing() returns events array", async ({ device }) => {
    await device.startTracing();

    // Perform some traceable operations (evaluate is always traced)
    await device.evaluate<number>("1 + 1");

    const result = await device.stopTracing();

    expect(result.events).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
  });

  test("traced events have required properties", async ({ device }) => {
    await device.startTracing();

    // Perform evaluations to generate events
    await device.evaluate<number>("1 + 1");
    await device.evaluate<string>("'hello'");

    const result = await device.stopTracing();

    // Each event should have type and timestamp
    for (const event of result.events) {
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("timestamp");
      expect(typeof event.type).toBe("string");
      expect(typeof event.timestamp).toBe("number");
    }
  });

  test("evaluate events are traced", async ({ device }) => {
    await device.startTracing();

    await device.evaluate<number>("1 + 1");

    const result = await device.stopTracing();

    // Should have evaluate events
    const evalEvents = result.events.filter((e: DriverEvent) => e.type === "evaluate");
    expect(evalEvents.length).toBeGreaterThan(0);
  });

  test("stopTracing() clears the trace buffer", async ({ device }) => {
    await device.startTracing();
    await device.evaluate<number>("1 + 1");
    const result1 = await device.stopTracing();

    // Start a fresh trace
    await device.startTracing();
    const result2 = await device.stopTracing();

    // Second trace should have fewer/no events (buffer was cleared)
    expect(result2.events.length).toBeLessThanOrEqual(result1.events.length);
  });

  test("startTracing() with includeConsole option", async ({ device }) => {
    await device.startTracing({ includeConsole: true });

    // Log something
    await device.evaluate<void>("console.log('test trace log')");

    const result = await device.stopTracing();

    // Console events should be captured if option is true
    // (depends on harness implementation)
    expect(result).toHaveProperty("events");
  });

  test("startTracing() without options uses defaults", async ({ device }) => {
    await device.startTracing();

    const result = await device.stopTracing();

    expect(result).toHaveProperty("events");
    expect(Array.isArray(result.events)).toBe(true);
  });

  test("timestamps are monotonically increasing", async ({ device }) => {
    await device.startTracing();

    // Generate multiple events via evaluate
    await device.evaluate<number>("1 + 1");
    await device.waitForTimeout(10);
    await device.evaluate<number>("2 + 2");
    await device.waitForTimeout(10);
    await device.evaluate<number>("3 + 3");

    const result = await device.stopTracing();

    // Verify timestamps are in order (if there are multiple events)
    const timestamps = result.events.map((e: DriverEvent) => e.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  // Pointer-specific tracing tests
  test.describe("Pointer Tracing", () => {
    test("pointer events are traced", async ({ device }) => {
      await device.startTracing();
      await device.pointer.tap(100, 100);

      const result = await device.stopTracing();

      // Should have pointer:down and pointer:up events from tap
      const pointerEvents = result.events.filter(
        (e: DriverEvent) => e.type === "pointer:down" || e.type === "pointer:up",
      );
      expect(pointerEvents.length).toBeGreaterThan(0);
    });

    test("pointer:move events are traced during drag", async ({ device }) => {
      await device.startTracing();
      await device.pointer.drag({ x: 0, y: 0 }, { x: 100, y: 100 }, { steps: 5 });

      const result = await device.stopTracing();

      const moveEvents = result.events.filter((e: DriverEvent) => e.type === "pointer:move");
      expect(moveEvents.length).toBeGreaterThan(0);
    });
  });
});
