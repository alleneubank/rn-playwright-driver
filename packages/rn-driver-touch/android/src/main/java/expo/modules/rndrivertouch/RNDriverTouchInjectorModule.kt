package expo.modules.rndrivertouch

import android.app.Instrumentation
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.CountDownLatch

private const val DEFAULT_SWIPE_DURATION_MS = 300L
private const val DEFAULT_LONG_PRESS_DURATION_MS = 500L
private const val FRAME_INTERVAL_MS = 16L

class RNDriverTouchInjectorModule : Module() {
    private var activeDownTime: Long? = null
    private var lastX: Float = 0f
    private var lastY: Float = 0f
    private var cachedInstrumentation: Instrumentation? = null

    override fun definition() = ModuleDefinition {
        Name("RNDriverTouchInjector")

        AsyncFunction("tap") { x: Double, y: Double ->
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, density ->
                    val downTime = SystemClock.uptimeMillis()
                    val xPx = (x * density).toFloat()
                    val yPx = (y * density).toFloat()
                    injectEvent(instrumentation, MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, xPx, yPx, 0))
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, downTime + 50, MotionEvent.ACTION_UP, xPx, yPx, 0),
                    )
                    successResult(null)
                }
            }
        }

        AsyncFunction("down") { x: Double, y: Double ->
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, density ->
                    val downTime = SystemClock.uptimeMillis()
                    val xPx = (x * density).toFloat()
                    val yPx = (y * density).toFloat()
                    activeDownTime = downTime
                    lastX = xPx
                    lastY = yPx
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, xPx, yPx, 0),
                    )
                    successResult(null)
                }
            }
        }

        AsyncFunction("move") { x: Double, y: Double ->
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, density ->
                    val downTime = activeDownTime
                        ?: return@withInstrumentation errorResult("No active touch sequence", "INTERNAL")
                    val eventTime = SystemClock.uptimeMillis()
                    val xPx = (x * density).toFloat()
                    val yPx = (y * density).toFloat()
                    lastX = xPx
                    lastY = yPx
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_MOVE, xPx, yPx, 0),
                    )
                    successResult(null)
                }
            }
        }

        AsyncFunction("up") {
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, _ ->
                    val downTime = activeDownTime
                        ?: return@withInstrumentation errorResult("No active touch sequence", "INTERNAL")
                    val eventTime = SystemClock.uptimeMillis()
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_UP, lastX, lastY, 0),
                    )
                    activeDownTime = null
                    successResult(null)
                }
            }
        }

        AsyncFunction("swipe") { fromX: Double, fromY: Double, toX: Double, toY: Double, durationMs: Double ->
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, density ->
                    val duration = if (durationMs > 0) durationMs.toLong() else DEFAULT_SWIPE_DURATION_MS
                    val steps = maxOf(10, (duration / FRAME_INTERVAL_MS).toInt())
                    val downTime = SystemClock.uptimeMillis()
                    val startX = (fromX * density).toFloat()
                    val startY = (fromY * density).toFloat()
                    val endX = (toX * density).toFloat()
                    val endY = (toY * density).toFloat()

                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, startX, startY, 0),
                    )

                    for (i in 1..steps) {
                        val t = i.toFloat() / steps
                        val x = startX + (endX - startX) * t
                        val y = startY + (endY - startY) * t
                        val eventTime = downTime + (duration * t).toLong()
                        injectEvent(
                            instrumentation,
                            MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_MOVE, x, y, 0),
                        )
                    }

                    val endTime = downTime + duration
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, endTime, MotionEvent.ACTION_UP, endX, endY, 0),
                    )
                    successResult(null)
                }
            }
        }

        AsyncFunction("longPress") { x: Double, y: Double, durationMs: Double ->
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, density ->
                    val duration = if (durationMs > 0) durationMs.toLong() else DEFAULT_LONG_PRESS_DURATION_MS
                    val downTime = SystemClock.uptimeMillis()
                    val xPx = (x * density).toFloat()
                    val yPx = (y * density).toFloat()
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, xPx, yPx, 0),
                    )
                    SystemClock.sleep(duration)
                    val upTime = SystemClock.uptimeMillis()
                    injectEvent(
                        instrumentation,
                        MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, xPx, yPx, 0),
                    )
                    successResult(null)
                }
            }
        }

        AsyncFunction("typeText") { text: String ->
            runOnUiThreadBlocking {
                withInstrumentation { instrumentation, _ ->
                    instrumentation.sendStringSync(text)
                    successResult(null)
                }
            }
        }
    }

    private fun withInstrumentation(
        block: (Instrumentation, Float) -> Map<String, Any?>,
    ): Map<String, Any?> {
        val instrumentation = requireInstrumentation()
            ?: return errorResult(
                "Instrumentation not available. Run under Android instrumentation or install the touch companion.",
                "NOT_SUPPORTED",
            )
        val density = getDensity()
            ?: return errorResult("React context not available", "INTERNAL")

        return try {
            block(instrumentation, density)
        } catch (e: Exception) {
            errorResult("Touch injection failed: ${e.message}", "INTERNAL")
        }
    }

    private fun requireInstrumentation(): Instrumentation? {
        if (cachedInstrumentation != null) {
            return cachedInstrumentation
        }
        cachedInstrumentation = resolveInstrumentation()
        return cachedInstrumentation
    }

    private fun resolveInstrumentation(): Instrumentation? {
        val registryClasses = listOf(
            "androidx.test.platform.app.InstrumentationRegistry",
            "androidx.test.InstrumentationRegistry",
        )
        for (className in registryClasses) {
            try {
                val registry = Class.forName(className)
                val method = registry.getMethod("getInstrumentation")
                val instrumentation = method.invoke(null)
                if (instrumentation is Instrumentation) {
                    return instrumentation
                }
            } catch (_: Exception) {
                // Ignore and try next
            }
        }
        return null
    }

    private fun getDensity(): Float? {
        val context = appContext.reactContext ?: return null
        return context.resources.displayMetrics.density
    }

    private fun injectEvent(instrumentation: Instrumentation, event: MotionEvent) {
        try {
            val automation = instrumentation.uiAutomation
            automation.injectInputEvent(event, true)
        } catch (_: Exception) {
            instrumentation.sendPointerSync(event)
        } finally {
            event.recycle()
        }
    }

    private fun <T> runOnUiThreadBlocking(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return block()
        }

        val latch = CountDownLatch(1)
        var result: T? = null
        var exception: Exception? = null

        Handler(Looper.getMainLooper()).post {
            try {
                result = block()
            } catch (e: Exception) {
                exception = e
            }
            latch.countDown()
        }

        latch.await()

        exception?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun successResult(data: Any?): Map<String, Any?> {
        return mapOf("success" to true, "data" to data)
    }

    private fun errorResult(error: String, code: String): Map<String, Any?> {
        return mapOf("success" to false, "error" to error, "code" to code)
    }
}
