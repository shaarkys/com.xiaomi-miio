# Washer extra capabilities (PR #344)

Pending TEST release changelog: Added washer cycle count, door/lock status, detergent and softener levels, and low-level Flow triggers for new and existing paired washers.

The existing washer capability migration adds the new sensors without changing device identity, settings or existing Flow cards. No dependency or app version changes are required. Water and energy meters remain excluded because the contributor reports zero values over local MIoT.

Failed or missing MIoT properties and unknown consumable values preserve the last valid readings. Low-level triggers fire only on a known normal-to-low transition, including a transition from a persisted normal reading after restart; an initial low reading does not fire. Unknown numeric door states display Unknown and preserve the previous lock alarm.

## Manual TEST-build checks

Physical Homey/washer behavior remains unverified. After installing the next TEST release:

1. Restart the app with an existing paired washer. Confirm all seven new sensors appear, with the same device, settings and existing Flows. Restart again and check for migration errors.
2. Confirm the reported cycle count, door state/lock and consumable levels against the washer or Xiaomi app. Check open, closed/unlocked and locked states during normal use; do not force the door.
3. Create Flows using the detergent and softener low triggers. Observe a normal-to-low transition during normal use: each should fire once, with no repeat on subsequent low polls or an app restart while still low. Refilling to normal should rearm the next low transition.
4. Confirm existing power, mode, spin speed, start/pause/stop and washing-started/finished Flows still work. Confirm polling recovers after temporary network loss.
