/**
 * R3FTouchAdapter - Routes harness touch events through R3F's internal event system
 *
 * This adapter bridges the rn-playwright-driver harness pointer events to R3F's
 * pointer event system by calling R3F's internal event handlers directly.
 *
 * @example
 * ```tsx
 * import { Canvas } from '@react-three/fiber';
 * import { R3FTouchAdapter } from '@0xbigboss/rn-driver-r3f';
 *
 * function App() {
 *   return (
 *     <Canvas>
 *       {__DEV__ && <R3FTouchAdapter />}
 *       <MyScene />
 *     </Canvas>
 *   );
 * }
 * ```
 */

import type { TouchEvent } from "@0xbigboss/rn-playwright-driver/harness";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Camera, Intersection, Object3D } from "three";
import { Vector2 } from "three";

export type R3FTouchAdapterProps = {
	/**
	 * Adapter ID for multi-canvas support.
	 * Registers as 'r3f' (single canvas) or 'r3f:${id}' (multi-canvas).
	 */
	id?: string;
};

/**
 * Track captured objects for pointer routing.
 * Maps pointerId -> captured object info.
 */
type CaptureInfo = {
	object: Object3D;
	intersection: Intersection;
};

/**
 * Create a synthetic R3F-style pointer event with all required properties.
 * This event can be passed directly to React handlers (onPointerDown, etc.).
 */
function createR3FPointerEvent(
	touchEvent: TouchEvent,
	pointerId: number,
	intersection: Intersection,
	captureMap: Map<number, CaptureInfo>,
): ThreeEvent<PointerEvent> {
	let stopped = false;

	const event = {
		// Intersection data
		...intersection,
		eventObject: intersection.object,

		// Screen coordinates
		offsetX: touchEvent.x,
		offsetY: touchEvent.y,
		clientX: touchEvent.x,
		clientY: touchEvent.y,
		pageX: touchEvent.x,
		pageY: touchEvent.y,

		// Pointer identification
		pointerId,
		pointerType: "touch" as const,
		isPrimary: true,

		// Button state
		button: 0,
		buttons: touchEvent.type === "up" ? 0 : 1,

		// Capture methods that update our tracking map
		target: {
			setPointerCapture: (id: number) => {
				captureMap.set(id, { object: intersection.object, intersection });
			},
			releasePointerCapture: (id: number) => {
				captureMap.delete(id);
			},
			hasPointerCapture: (id: number) => captureMap.has(id),
		},
		currentTarget: {
			setPointerCapture: (id: number) => {
				captureMap.set(id, { object: intersection.object, intersection });
			},
			releasePointerCapture: (id: number) => {
				captureMap.delete(id);
			},
			hasPointerCapture: (id: number) => captureMap.has(id),
		},

		// Event control
		stopPropagation: () => {
			stopped = true;
		},
		get stopped() {
			return stopped;
		},
		preventDefault: () => {},
		defaultPrevented: false,
		nativeEvent: {} as PointerEvent,
	};

	return event as unknown as ThreeEvent<PointerEvent>;
}

export function R3FTouchAdapter({ id }: R3FTouchAdapterProps): null {
	// Access R3F state for raycasting
	const { camera, raycaster, scene, size } = useThree();

	// Track active pointer ID for gesture continuity
	const pointerIdRef = useRef<number>(1);

	// Track captured objects ourselves since R3F's internal capture
	// system doesn't work with synthetic events
	const captureMapRef = useRef<Map<number, CaptureInfo>>(new Map());

	useEffect(() => {
		if (!globalThis.__RN_DRIVER__) return;

		const { width, height } = size;

		/**
		 * Convert screen coords to NDC for raycasting.
		 */
		const screenToNdc = (x: number, y: number): Vector2 =>
			new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);

		/**
		 * Find objects with R3F event handlers via raycasting.
		 */
		const findHitObjects = (x: number, y: number): Intersection[] => {
			const ndc = screenToNdc(x, y);
			raycaster.setFromCamera(ndc, camera as Camera);
			return raycaster.intersectObjects(scene.children, true);
		};

		/**
		 * Find the R3F handler on an object or its ancestors.
		 */
		const findHandler = (
			object: Object3D,
			handlerName: string,
		): ((event: ThreeEvent<PointerEvent>) => void) | null => {
			let current: Object3D | null = object;
			while (current) {
				const r3f = (current as Object3D & { __r3f?: { handlers?: Record<string, unknown> } })
					.__r3f;
				if (r3f?.handlers?.[handlerName]) {
					return r3f.handlers[handlerName] as (event: ThreeEvent<PointerEvent>) => void;
				}
				current = current.parent;
			}
			return null;
		};

		const handler = (touchEvent: TouchEvent): void => {
			const pointerId = pointerIdRef.current;
			const captureMap = captureMapRef.current;

			// For pointerup/pointermove, check if this pointer is captured
			const captured = captureMap.get(pointerId);

			if (touchEvent.type === "up" || touchEvent.type === "move") {
				if (captured) {
					// Route to captured object
					const handlerName = touchEvent.type === "up" ? "onPointerUp" : "onPointerMove";
					const objectHandler = findHandler(captured.object, handlerName);

					if (objectHandler) {
						const event = createR3FPointerEvent(
							touchEvent,
							pointerId,
							captured.intersection,
							captureMap,
						);
						objectHandler(event);
					}

					// Clean up capture on pointer up
					if (touchEvent.type === "up") {
						captureMap.delete(pointerId);
						pointerIdRef.current += 1;
					}
					return;
				}
			}

			// For pointerdown (or uncaptured move/up), do raycasting
			const hits = findHitObjects(touchEvent.x, touchEvent.y);
			if (hits.length === 0) return;

			const handlerName =
				touchEvent.type === "down"
					? "onPointerDown"
					: touchEvent.type === "up"
						? "onPointerUp"
						: "onPointerMove";

			// Find first object with the appropriate handler
			for (const hit of hits) {
				const objectHandler = findHandler(hit.object, handlerName);
				if (objectHandler) {
					const event = createR3FPointerEvent(touchEvent, pointerId, hit, captureMap);
					objectHandler(event);

					// Stop after first handler (event didn't propagate)
					if (event.stopped) break;
					break; // Only call first matching handler
				}
			}

			// Increment pointer ID after uncaptured up event
			if (touchEvent.type === "up") {
				pointerIdRef.current += 1;
			}
		};

		// Register with unique key for multi-canvas support
		const handlerKey = id ? `r3f:${id}` : "r3f";
		globalThis.__RN_DRIVER__.registerTouchHandler(handlerKey, handler);

		return () => {
			globalThis.__RN_DRIVER__?.unregisterTouchHandler(handlerKey);
		};
	}, [camera, raycaster, scene, size, id]);

	return null;
}
