/**
 * Unit tests for R3FTouchAdapter
 *
 * These tests verify that touch events are routed to R3F object handlers
 * with the correct synthetic PointerEvent properties, including proper
 * pointer capture tracking for drag operations.
 */

import type {
	RNDriverGlobal,
	TouchEvent,
	TouchHandler,
} from "@0xbigboss/rn-playwright-driver/harness";
import type { ThreeEvent } from "@react-three/fiber";
import type { Object3D } from "three";
import { Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track cleanup functions from useEffect
let effectCleanup: (() => void) | undefined;

// Track ref values
let pointerIdRef = { current: 1 };
let captureMapRef = { current: new Map() };

// Mock React
vi.mock("react", () => ({
	useEffect: vi.fn((effect: () => (() => void) | undefined) => {
		const cleanup = effect();
		if (typeof cleanup === "function") {
			effectCleanup = cleanup;
		}
	}),
	useRef: vi.fn((initial: unknown) => {
		if (typeof initial === "number") {
			pointerIdRef = { current: initial };
			return pointerIdRef;
		}
		captureMapRef = { current: new Map() };
		return captureMapRef;
	}),
}));

// Mock useThree hook
vi.mock("@react-three/fiber", () => ({
	useThree: vi.fn(),
}));

// Import after mocking
import { useThree } from "@react-three/fiber";
import { R3FTouchAdapter } from "./R3FTouchAdapter";

describe("R3FTouchAdapter", () => {
	let capturedTouchHandler: TouchHandler | null = null;
	let handlerCalls: Array<{ name: string; event: ThreeEvent<PointerEvent> }> = [];
	let mockDriver: Partial<RNDriverGlobal>;
	let mockObject: Partial<Object3D> & { __r3f?: { handlers?: Record<string, unknown> } };
	let mockRaycaster: {
		setFromCamera: ReturnType<typeof vi.fn>;
		intersectObjects: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		capturedTouchHandler = null;
		handlerCalls = [];
		effectCleanup = undefined;
		pointerIdRef = { current: 1 };
		captureMapRef = { current: new Map() };

		// Create mock object with R3F handlers
		mockObject = {
			parent: null,
			__r3f: {
				handlers: {
					onPointerDown: vi.fn((e: ThreeEvent<PointerEvent>) => {
						handlerCalls.push({ name: "onPointerDown", event: e });
					}),
					onPointerMove: vi.fn((e: ThreeEvent<PointerEvent>) => {
						handlerCalls.push({ name: "onPointerMove", event: e });
					}),
					onPointerUp: vi.fn((e: ThreeEvent<PointerEvent>) => {
						handlerCalls.push({ name: "onPointerUp", event: e });
					}),
				},
			},
		};

		// Create mock raycaster
		mockRaycaster = {
			setFromCamera: vi.fn(),
			intersectObjects: vi.fn().mockReturnValue([
				{
					point: new Vector3(1, 2, 3),
					distance: 10,
					object: mockObject,
				},
			]),
		};

		// Mock useThree to return R3F state
		vi.mocked(useThree).mockReturnValue({
			camera: { updateMatrixWorld: vi.fn() },
			raycaster: mockRaycaster,
			scene: { children: [], updateMatrixWorld: vi.fn() },
			size: { width: 400, height: 800, left: 0, top: 0 },
		} as unknown as ReturnType<typeof useThree>);

		// Create mock driver
		mockDriver = {
			registerTouchHandler: vi.fn((_key: string, handler: TouchHandler) => {
				capturedTouchHandler = handler;
			}),
			unregisterTouchHandler: vi.fn(),
		};

		globalThis.__RN_DRIVER__ = mockDriver as RNDriverGlobal;
	});

	afterEach(() => {
		effectCleanup?.();
		delete (globalThis as { __RN_DRIVER__?: unknown }).__RN_DRIVER__;
	});

	it("calls object onPointerDown handler with correct event properties", () => {
		R3FTouchAdapter({});

		expect(mockDriver.registerTouchHandler).toHaveBeenCalledWith("r3f", expect.any(Function));
		expect(capturedTouchHandler).not.toBeNull();

		const touchEvent: TouchEvent = {
			x: 200,
			y: 400,
			type: "down",
			timestamp: Date.now(),
		};
		capturedTouchHandler!(touchEvent);

		expect(handlerCalls).toHaveLength(1);
		expect(handlerCalls[0].name).toBe("onPointerDown");

		const event = handlerCalls[0].event;
		expect(event.offsetX).toBe(200);
		expect(event.offsetY).toBe(400);
		expect(event.clientX).toBe(200);
		expect(event.clientY).toBe(400);
		expect(event.pointerId).toBe(1);
		expect(event.pointerType).toBe("touch");
	});

	it("calls object onPointerMove handler for move events", () => {
		R3FTouchAdapter({});

		const touchEvent: TouchEvent = {
			x: 150,
			y: 300,
			type: "move",
			timestamp: Date.now(),
		};
		capturedTouchHandler!(touchEvent);

		expect(handlerCalls).toHaveLength(1);
		expect(handlerCalls[0].name).toBe("onPointerMove");

		const event = handlerCalls[0].event;
		expect(event.offsetX).toBe(150);
		expect(event.offsetY).toBe(300);
	});

	it("calls object onPointerUp handler for up events", () => {
		R3FTouchAdapter({});

		const touchEvent: TouchEvent = {
			x: 100,
			y: 200,
			type: "up",
			timestamp: Date.now(),
		};
		capturedTouchHandler!(touchEvent);

		expect(handlerCalls).toHaveLength(1);
		expect(handlerCalls[0].name).toBe("onPointerUp");

		const event = handlerCalls[0].event;
		expect(event.offsetX).toBe(100);
		expect(event.offsetY).toBe(200);
	});

	it("includes button state in synthetic events", () => {
		R3FTouchAdapter({});

		// Button down during pointer down
		capturedTouchHandler!({ x: 0, y: 0, type: "down", timestamp: Date.now() });
		expect(handlerCalls[0].event.buttons).toBe(1);
		expect(handlerCalls[0].event.button).toBe(0);

		// Button still down during move
		capturedTouchHandler!({ x: 10, y: 10, type: "move", timestamp: Date.now() });
		expect(handlerCalls[1].event.buttons).toBe(1);

		// Button released on up
		capturedTouchHandler!({ x: 10, y: 10, type: "up", timestamp: Date.now() });
		expect(handlerCalls[2].event.buttons).toBe(0);
	});

	it("includes target with pointer capture methods for drag operations", () => {
		R3FTouchAdapter({});

		capturedTouchHandler!({ x: 100, y: 100, type: "down", timestamp: Date.now() });

		const event = handlerCalls[0].event;
		const target = event.target as unknown as {
			setPointerCapture: (id: number) => void;
			releasePointerCapture: (id: number) => void;
			hasPointerCapture: (id: number) => boolean;
		};
		expect(target).toBeDefined();
		expect(typeof target.setPointerCapture).toBe("function");
		expect(typeof target.releasePointerCapture).toBe("function");
		expect(typeof target.hasPointerCapture).toBe("function");

		// Should not throw when called
		expect(() => target.setPointerCapture(1)).not.toThrow();
		expect(() => target.releasePointerCapture(1)).not.toThrow();
	});

	it("routes pointerup to captured object even if raycast misses", () => {
		R3FTouchAdapter({});

		// Pointer down - object is hit
		capturedTouchHandler!({ x: 100, y: 100, type: "down", timestamp: Date.now() });
		expect(handlerCalls).toHaveLength(1);
		expect(handlerCalls[0].name).toBe("onPointerDown");

		// Simulate handler calling setPointerCapture
		const target = handlerCalls[0].event.target as unknown as {
			setPointerCapture: (id: number) => void;
		};
		target.setPointerCapture(1);

		// Configure raycaster to return no hits (simulating pointer moved off object)
		mockRaycaster.intersectObjects.mockReturnValue([]);

		// Pointer up - should still reach the captured object
		capturedTouchHandler!({ x: 500, y: 500, type: "up", timestamp: Date.now() });
		expect(handlerCalls).toHaveLength(2);
		expect(handlerCalls[1].name).toBe("onPointerUp");
	});

	it("routes pointermove to captured object during drag", () => {
		R3FTouchAdapter({});

		// Pointer down
		capturedTouchHandler!({ x: 100, y: 100, type: "down", timestamp: Date.now() });
		const target = handlerCalls[0].event.target as unknown as {
			setPointerCapture: (id: number) => void;
		};
		target.setPointerCapture(1);

		// Raycaster misses during drag
		mockRaycaster.intersectObjects.mockReturnValue([]);

		// Pointer move should still reach captured object
		capturedTouchHandler!({ x: 200, y: 200, type: "move", timestamp: Date.now() });
		expect(handlerCalls).toHaveLength(2);
		expect(handlerCalls[1].name).toBe("onPointerMove");
		expect(handlerCalls[1].event.offsetX).toBe(200);
		expect(handlerCalls[1].event.offsetY).toBe(200);
	});

	it("increments pointer ID after up event for gesture tracking", () => {
		R3FTouchAdapter({});

		// First gesture
		capturedTouchHandler!({ x: 0, y: 0, type: "down", timestamp: Date.now() });
		expect(handlerCalls[0].event.pointerId).toBe(1);

		capturedTouchHandler!({ x: 10, y: 10, type: "up", timestamp: Date.now() });
		expect(handlerCalls[1].event.pointerId).toBe(1);

		// Second gesture should have incremented pointer ID
		capturedTouchHandler!({ x: 20, y: 20, type: "down", timestamp: Date.now() });
		expect(handlerCalls[2].event.pointerId).toBe(2);
	});

	it("does not call handlers when no objects are hit", () => {
		// Configure raycaster to return no hits
		mockRaycaster.intersectObjects.mockReturnValue([]);

		R3FTouchAdapter({});
		capturedTouchHandler!({ x: 100, y: 200, type: "down", timestamp: Date.now() });

		expect(handlerCalls).toHaveLength(0);
	});

	it("registers with custom id for multi-canvas support", () => {
		R3FTouchAdapter({ id: "secondary" });

		expect(mockDriver.registerTouchHandler).toHaveBeenCalledWith(
			"r3f:secondary",
			expect.any(Function),
		);
	});

	it("clears capture after pointerup", () => {
		R3FTouchAdapter({});

		// Pointer down and capture
		capturedTouchHandler!({ x: 100, y: 100, type: "down", timestamp: Date.now() });
		const target = handlerCalls[0].event.target as unknown as {
			setPointerCapture: (id: number) => void;
		};
		target.setPointerCapture(1);

		// Raycaster misses
		mockRaycaster.intersectObjects.mockReturnValue([]);

		// Pointer up clears capture
		capturedTouchHandler!({ x: 500, y: 500, type: "up", timestamp: Date.now() });

		// Next pointer down should require a raycast hit
		capturedTouchHandler!({ x: 600, y: 600, type: "down", timestamp: Date.now() });

		// Only 2 calls - the third down didn't hit anything
		expect(handlerCalls).toHaveLength(2);
	});

	it("routes events to parent handler when raycast hits child without handlers", () => {
		// Create parent with handlers and child without handlers
		const parentObject: Partial<Object3D> & { __r3f?: { handlers?: Record<string, unknown> } } = {
			parent: null,
			__r3f: {
				handlers: {
					onPointerDown: vi.fn((e: ThreeEvent<PointerEvent>) => {
						handlerCalls.push({ name: "onPointerDown", event: e });
					}),
					onPointerMove: vi.fn((e: ThreeEvent<PointerEvent>) => {
						handlerCalls.push({ name: "onPointerMove", event: e });
					}),
					onPointerUp: vi.fn((e: ThreeEvent<PointerEvent>) => {
						handlerCalls.push({ name: "onPointerUp", event: e });
					}),
				},
			},
		};

		const childObject: Partial<Object3D> = {
			parent: parentObject as Object3D,
			// No __r3f handlers - events should bubble to parent
		};

		// Raycaster hits the child (not the parent)
		mockRaycaster.intersectObjects.mockReturnValue([
			{
				point: new Vector3(1, 2, 3),
				distance: 10,
				object: childObject,
			},
		]);

		R3FTouchAdapter({});

		// Pointer down - hits child but handler is on parent
		capturedTouchHandler!({ x: 100, y: 100, type: "down", timestamp: Date.now() });
		expect(handlerCalls).toHaveLength(1);
		expect(handlerCalls[0].name).toBe("onPointerDown");

		// Call setPointerCapture (this is the bug fix - should store parent, not child)
		const target = handlerCalls[0].event.target as unknown as {
			setPointerCapture: (id: number) => void;
		};
		target.setPointerCapture(1);

		// Raycaster now misses entirely (pointer moved off screen)
		mockRaycaster.intersectObjects.mockReturnValue([]);

		// Pointer up - should still reach parent's handler via capture
		// Before the fix, this would fail because capture stored child (no handlers)
		capturedTouchHandler!({ x: 500, y: 500, type: "up", timestamp: Date.now() });
		expect(handlerCalls).toHaveLength(2);
		expect(handlerCalls[1].name).toBe("onPointerUp");
	});
});
