---
"@0xbigboss/rn-playwright-driver": minor
---

feat(driver): unified gesture API with native touch backend support

- Add native-module touch backend using @0xbigboss/rn-driver-touch
- Implement touch backend priority: xctest > native-module > cli > harness
- Add getTouchBackendInfo() API for backend discovery
- Add gesture builder with timing, easing, and multi-touch support
- Add frame delays between pointer events for React state timing
- Remove harness-backend.ts (replaced by native-module backend)
