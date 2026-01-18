import ExpoModulesCore
import UIKit
import QuartzCore

// MARK: - Private UITouch/UIEvent extensions for touch synthesis
// These use the same approach as KIF and EarlGrey testing frameworks
// Only available in DEBUG builds to avoid App Store rejection

#if DEBUG
private extension UITouch {
    func setTimestampValue(_ timestamp: TimeInterval) {
        setValue(timestamp, forKey: "timestamp")
    }

    func setPhaseValue(_ phase: UITouch.Phase) {
        setValue(phase.rawValue, forKey: "phase")
    }

    func setTapCountValue(_ count: Int) {
        setValue(count, forKey: "tapCount")
    }

    func setWindowValue(_ window: UIWindow?) {
        setValue(window, forKey: "window")
    }

    func setViewValue(_ view: UIView?) {
        setValue(view, forKey: "view")
    }

    func setLocationInWindow(_ location: CGPoint, resetPrevious: Bool) {
        // Use the private API for setting location
        let selector = NSSelectorFromString("_setLocationInWindow:resetPrevious:")
        if responds(to: selector) {
            let methodIMP = method(for: selector)
            typealias SetLocationFunc = @convention(c) (Any, Selector, CGPoint, Bool) -> Void
            let setLocation = unsafeBitCast(methodIMP, to: SetLocationFunc.self)
            setLocation(self, selector, location, resetPrevious)
        }
    }

    func setIsFirstTouchForView(_ isFirst: Bool) {
        let selector = NSSelectorFromString("_setIsFirstTouchForView:")
        if responds(to: selector) {
            let methodIMP = method(for: selector)
            typealias SetFirstTouchFunc = @convention(c) (Any, Selector, Bool) -> Void
            let setFirstTouch = unsafeBitCast(methodIMP, to: SetFirstTouchFunc.self)
            setFirstTouch(self, selector, isFirst)
        }
    }
}

private extension UIApplication {
    var touchesEventInternal: UIEvent? {
        let selector = NSSelectorFromString("_touchesEvent")
        if responds(to: selector) {
            return perform(selector)?.takeUnretainedValue() as? UIEvent
        }
        return nil
    }
}

private extension UIEvent {
    func clearTouchesInternal() {
        let selector = NSSelectorFromString("_clearTouches")
        if responds(to: selector) {
            perform(selector)
        }
    }

    func addTouchInternal(_ touch: UITouch, forDelayedDelivery delayed: Bool) {
        let selector = NSSelectorFromString("_addTouch:forDelayedDelivery:")
        if responds(to: selector) {
            let methodIMP = method(for: selector)
            typealias AddTouchFunc = @convention(c) (Any, Selector, UITouch, Bool) -> Void
            let addTouch = unsafeBitCast(methodIMP, to: AddTouchFunc.self)
            addTouch(self, selector, touch, delayed)
        }
    }
}
#endif

// MARK: - Touch Injector Module

public class RNDriverTouchInjectorModule: Module {
    #if DEBUG
    // State for ongoing touch sequences (only needed in DEBUG)
    private var activeTouch: UITouch?
    private var targetWindow: UIWindow?
    private var touchActive = false
    #endif

    private static let releaseError = "Touch injection disabled in release builds. Use DEBUG builds for E2E testing."
    private static let releaseCode = "NOT_SUPPORTED"

    public func definition() -> ModuleDefinition {
        Name("RNDriverTouchInjector")

        AsyncFunction("tap") { (x: Double, y: Double) -> [String: Any] in
            #if DEBUG
            return self.runOnMainThread {
                self.performTap(at: CGPoint(x: x, y: y))
            }
            #else
            return self.errorResult(Self.releaseError, code: Self.releaseCode)
            #endif
        }

        AsyncFunction("down") { (x: Double, y: Double) -> [String: Any] in
            #if DEBUG
            return self.runOnMainThread {
                self.performTouchDown(at: CGPoint(x: x, y: y))
            }
            #else
            return self.errorResult(Self.releaseError, code: Self.releaseCode)
            #endif
        }

        AsyncFunction("move") { (x: Double, y: Double) -> [String: Any] in
            #if DEBUG
            return self.runOnMainThread {
                self.performTouchMove(to: CGPoint(x: x, y: y))
            }
            #else
            return self.errorResult(Self.releaseError, code: Self.releaseCode)
            #endif
        }

        AsyncFunction("up") { () -> [String: Any] in
            #if DEBUG
            return self.runOnMainThread {
                self.performTouchUp()
            }
            #else
            return self.errorResult(Self.releaseError, code: Self.releaseCode)
            #endif
        }

        AsyncFunction("swipe") { (fromX: Double, fromY: Double, toX: Double, toY: Double, durationMs: Double, promise: Promise) in
            #if DEBUG
            let from = CGPoint(x: fromX, y: fromY)
            let to = CGPoint(x: toX, y: toY)
            let duration = max(0.05, durationMs / 1000.0)

            DispatchQueue.main.async {
                self.performSwipe(from: from, to: to, duration: duration) { result in
                    promise.resolve(result)
                }
            }
            #else
            promise.resolve(self.errorResult(Self.releaseError, code: Self.releaseCode))
            #endif
        }

        AsyncFunction("longPress") { (x: Double, y: Double, durationMs: Double, promise: Promise) in
            #if DEBUG
            let point = CGPoint(x: x, y: y)
            let duration = max(0.0, durationMs / 1000.0)

            DispatchQueue.main.async {
                self.performLongPress(at: point, duration: duration) { result in
                    promise.resolve(result)
                }
            }
            #else
            promise.resolve(self.errorResult(Self.releaseError, code: Self.releaseCode))
            #endif
        }

        AsyncFunction("typeText") { (text: String) -> [String: Any] in
            #if DEBUG
            return self.runOnMainThread {
                self.performTypeText(text)
            }
            #else
            return self.errorResult(Self.releaseError, code: Self.releaseCode)
            #endif
        }
    }

    // MARK: - Result Helpers (always available)

    private func successResult(_ data: Any) -> [String: Any] {
        return ["success": true, "data": data]
    }

    private func errorResult(_ error: String, code: String) -> [String: Any] {
        return ["success": false, "error": error, "code": code]
    }

    // MARK: - DEBUG-only implementation

    #if DEBUG
    private func runOnMainThread<T>(_ block: @escaping () -> T) -> T {
        if Thread.isMainThread {
            return block()
        }

        var result: T!
        DispatchQueue.main.sync {
            result = block()
        }
        return result
    }

    private func keyWindow() -> UIWindow? {
        // Get the key window, accounting for iOS 15+ scene API
        if #available(iOS 15.0, *) {
            for scene in UIApplication.shared.connectedScenes {
                if scene.activationState == .foregroundActive,
                   let windowScene = scene as? UIWindowScene {
                    for window in windowScene.windows {
                        if window.isKeyWindow {
                            return window
                        }
                    }
                }
            }
        }

        // Fallback for older iOS
        return UIApplication.shared.windows.first { $0.isKeyWindow }
            ?? UIApplication.shared.windows.first
    }

    private func createTouch(at point: CGPoint, in window: UIWindow, phase: UITouch.Phase) -> UITouch {
        let touch = UITouch()

        // Find the view at this point
        let hitView = window.hitTest(point, with: nil) ?? window

        // Set properties using our extensions
        touch.setTimestampValue(CACurrentMediaTime())
        touch.setPhaseValue(phase)
        touch.setTapCountValue(1)
        touch.setLocationInWindow(point, resetPrevious: true)
        touch.setWindowValue(window)
        touch.setViewValue(hitView)
        touch.setIsFirstTouchForView(true)

        return touch
    }

    private func sendTouchEvent(_ touch: UITouch) {
        guard let event = UIApplication.shared.touchesEventInternal else {
            return
        }

        event.clearTouchesInternal()
        event.addTouchInternal(touch, forDelayedDelivery: false)
        UIApplication.shared.sendEvent(event)
    }

    private func performTap(at point: CGPoint) -> [String: Any] {
        guard let window = keyWindow() else {
            return errorResult("No key window available", code: "INTERNAL")
        }

        // Touch began
        let touch = createTouch(at: point, in: window, phase: .began)
        sendTouchEvent(touch)

        // Small delay between phases
        Thread.sleep(forTimeInterval: 0.01)

        // Touch ended
        touch.setPhaseValue(.ended)
        touch.setTimestampValue(CACurrentMediaTime())
        sendTouchEvent(touch)

        return successResult(NSNull())
    }

    private func performTouchDown(at point: CGPoint) -> [String: Any] {
        guard let window = keyWindow() else {
            return errorResult("No key window available", code: "INTERNAL")
        }

        targetWindow = window
        activeTouch = createTouch(at: point, in: window, phase: .began)
        touchActive = true

        if let touch = activeTouch {
            sendTouchEvent(touch)
        }

        return successResult(NSNull())
    }

    private func performTouchMove(to point: CGPoint) -> [String: Any] {
        guard touchActive, let touch = activeTouch, let window = targetWindow else {
            // If no active touch, start a new one
            return performTouchDown(at: point)
        }

        // Update touch for move phase
        touch.setPhaseValue(.moved)
        touch.setTimestampValue(CACurrentMediaTime())
        touch.setLocationInWindow(point, resetPrevious: false)

        // Update view at new location
        if let hitView = window.hitTest(point, with: nil) {
            touch.setViewValue(hitView)
        }

        sendTouchEvent(touch)

        return successResult(NSNull())
    }

    private func performTouchUp() -> [String: Any] {
        guard touchActive, let touch = activeTouch else {
            return successResult(NSNull())
        }

        touch.setPhaseValue(.ended)
        touch.setTimestampValue(CACurrentMediaTime())
        sendTouchEvent(touch)

        activeTouch = nil
        targetWindow = nil
        touchActive = false

        return successResult(NSNull())
    }

    private func performSwipe(from: CGPoint, to: CGPoint, duration: TimeInterval, completion: @escaping ([String: Any]) -> Void) {
        guard let window = keyWindow() else {
            completion(errorResult("No key window available", code: "INTERNAL"))
            return
        }

        // Number of intermediate points for smooth swipe
        let steps = max(5, Int(duration * 60)) // ~60 FPS
        let stepDelay = duration / Double(steps)

        // Start touch
        let touch = createTouch(at: from, in: window, phase: .began)
        sendTouchEvent(touch)

        // Calculate movement delta
        let dx = (to.x - from.x) / CGFloat(steps)
        let dy = (to.y - from.y) / CGFloat(steps)

        var currentStep = 0

        // Use a timer for smooth animation
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: stepDelay)

        timer.setEventHandler { [weak self] in
            guard let self = self else {
                timer.cancel()
                return
            }

            currentStep += 1

            if currentStep >= steps {
                // Final move to exact end point
                touch.setPhaseValue(.moved)
                touch.setTimestampValue(CACurrentMediaTime())
                touch.setLocationInWindow(to, resetPrevious: false)
                self.sendTouchEvent(touch)

                // End touch after small delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
                    touch.setPhaseValue(.ended)
                    touch.setTimestampValue(CACurrentMediaTime())
                    self.sendTouchEvent(touch)
                    completion(self.successResult(NSNull()))
                }

                timer.cancel()
                return
            }

            // Intermediate move
            let currentPoint = CGPoint(
                x: from.x + dx * CGFloat(currentStep),
                y: from.y + dy * CGFloat(currentStep)
            )
            touch.setPhaseValue(.moved)
            touch.setTimestampValue(CACurrentMediaTime())
            touch.setLocationInWindow(currentPoint, resetPrevious: false)

            if let hitView = window.hitTest(currentPoint, with: nil) {
                touch.setViewValue(hitView)
            }

            self.sendTouchEvent(touch)
        }

        timer.resume()
    }

    private func performLongPress(at point: CGPoint, duration: TimeInterval, completion: @escaping ([String: Any]) -> Void) {
        guard let window = keyWindow() else {
            completion(errorResult("No key window available", code: "INTERNAL"))
            return
        }

        // Touch began
        let touch = createTouch(at: point, in: window, phase: .began)
        sendTouchEvent(touch)

        // Hold for duration, then release
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
            guard let self = self else { return }

            // Send stationary touch to maintain the press
            touch.setPhaseValue(.stationary)
            touch.setTimestampValue(CACurrentMediaTime())
            self.sendTouchEvent(touch)

            // Small delay before ending
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
                touch.setPhaseValue(.ended)
                touch.setTimestampValue(CACurrentMediaTime())
                self.sendTouchEvent(touch)
                completion(self.successResult(NSNull()))
            }
        }
    }

    private func performTypeText(_ text: String) -> [String: Any] {
        guard let window = keyWindow() else {
            return errorResult("No key window available", code: "INTERNAL")
        }

        // Find the first responder
        guard let firstResponder = findFirstResponder(in: window) else {
            return errorResult("No text field is focused. Tap on a text field first.", code: "INTERNAL")
        }

        guard let textInput = firstResponder as? UITextInput else {
            return errorResult("Focused element does not support text input", code: "INTERNAL")
        }

        // Insert the text
        textInput.insertText(text)

        return successResult(NSNull())
    }

    private func findFirstResponder(in view: UIView) -> UIResponder? {
        if view.isFirstResponder {
            return view
        }

        for subview in view.subviews {
            if let responder = findFirstResponder(in: subview) {
                return responder
            }
        }

        return nil
    }
    #endif
}
