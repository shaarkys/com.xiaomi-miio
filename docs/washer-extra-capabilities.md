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

## Completion trigger (PR #346)

Pending TEST release changelog: Fixed missing washing-finished Flows when the Mijia Front Load Washer Dryer Pro (mibx5.washer.f05gl) automatically powers off at the end of a cycle.

Completion status 5 or a terminal run-status 15 can finish a cycle. When the washer goes straight from busy/paused to off or idle between polls, an increased completed-cycle counter supplies the completion evidence. Power-off or zero remaining time alone cannot distinguish completion from cancellation and does not fire the Flow. Maintenance completion statuses 6 and 7 are excluded.

A persisted `washer_cycle_handled` boolean prevents duplicate completion events after auto-off, a delayed counter update or an app restart. Existing `previous_status` remains observed telemetry. Old installations need no re-pairing or capability migration; the flag is initialized as readings arrive. Successful Homey stop/power-off commands suppress completion for that cycle, including paused cycles. Failed acknowledgements leave completion armed. Polls started before a command are discarded, and polling waits while cancellation is pending. Existing Flow IDs, arguments, device data and dependencies are unchanged.

Physical completion behavior remains unverified here. In the next TEST build:

1. Use a Flow with “Washing program finished” on an existing paired washer. Let a normal cycle finish and automatically power off. Confirm one event even when polling misses status 5.
2. Confirm no second event after subsequent off polls, a later cycle-count update or an app restart. Run another cycle and confirm it can fire again.
3. Pause and resume a cycle, then let it finish. Separately cancel an active or paused cycle using Homey stop/power-off; confirm neither cancellation fires “finished.”
4. Confirm powering off without a completed-cycle increment and finishing detergent-slot/drying-duct maintenance do not fire “Washing program finished.” If the completion counter cannot be read and status 5/run-status 15 are both missed, auto-off completion remains uncertain and is not reported.
