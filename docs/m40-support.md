# Mijia Robot Vacuum M40 — issue #345

## Feasibility and driver choice

Support is feasible for `xiaomi.vacuum.d110ch`. The reporter already confirms local start/stop, battery and basic readings. The model has a published MIoT v2 schema and exact-model implementations in Dreame Vacuum and openHAB.

Use **Xiaomi Vacuum Cleaner MIoT MAX (WiFi)** (`vacuum_xiaomi_vacuum_max`). Its existing optional controls, status display, consumable handling and Flow actions match the required interface. Neither the generic Mija/Ijai profile used by the reporter nor the existing Advanced Dreame profiles describe M40's full property layout. Reusing an X20 Max profile would also be incorrect: M40 has different service/property addresses, enum offsets and fault codes.

Checked sources:

- [Issue #345](https://github.com/shaarkys/com.xiaomi-miio/issues/345).
- [M40 MIoT service tree, v2](https://home.miot-spec.com/spec/xiaomi.vacuum.d110ch) and [Xiaomi schema endpoint](https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:vacuum:0000A006:xiaomi-d110ch:2). The service tree was readable; the schema endpoint could not be downloaded from the local shell because DNS resolution failed.
- [openHAB exact-model mapping](https://github.com/openhab/openhab-addons/blob/main/bundles/org.openhab.binding.miio/src/main/resources/database/xiaomi.vacuum.d110ch-miot.json): individual property reads, state/fault meanings, totals and consumables.
- [Dreame supported devices](https://dv.tasshack.com/guide/more/supported-devices), [fault parser](https://github.com/Tasshack/dreame-vacuum/blob/master/custom_components/dreame_vacuum/dreame/device.py) (`_faults_changed`) and [error enums](https://github.com/Tasshack/dreame-vacuum/blob/master/custom_components/dreame_vacuum/dreame/types.py).
- Current repository, installed miio `call()` and shared MIoT helpers; [Homey SDK capability API](https://apps-sdk-v3.developer.homey.app/Device.html#addCapability).

Local app: `com.xiaomi-miio` 3.5.55, SDK v3, local platform, Homey >=12.2.0. Package metadata separately says 3.3.0. Versions are unchanged. No Homey Developer MCP tools are exposed in this session, so published TEST/live versions, builds and crash reports were not checked.

## Implemented behavior

| Function | M40 MIoT address / behavior |
| --- | --- |
| Start / pause | Actions 2/1 and 2/2 |
| Return to charger / locate | Actions 3/1 and 7/1 |
| Sweep/mop selection | Property 2/6, modes 1–4: sweep, mop, both, sweep before mop |
| Suction power | Property 2/3, device values 0–3 mapped to the existing Homey values 1–4 |
| Mop water level | Property 2/8, values 1–3 |
| Robot state / fault | Properties 2/1 and 2/2 |
| Additional faults | Property 4/18, comma-separated numeric codes |
| Battery | Property 3/1 |
| Brush / side brush / filter life | Properties 9/2, 10/2 and 11/1, percentages |
| Totals | Properties 12/2, 12/3 and 12/4; time in minutes and area in square metres |
| Dock actions | Service 2: collect dust (4), wash mop (6), stop washing (17), dry (8), stop drying (9) |
| Dock status | Derived from robot state: drying, washing, collection, self-cleaning or idle |

Polling uses the existing ordered/chunked helper with one property per request, matching openHAB's M40 setting. Existing Flow IDs and arguments are retained. No new dependency, capability, manifest or generated-manifest change is needed.

Robot faults and additional station faults are merged, deduplicated and sorted. The status sensor and existing **Status has changed** trigger (`statusVacuum`, string token `status`) report known faults, including obstructions and dirty-water faults. Unmapped codes remain visible as `M40 fault <code>` rather than appearing healthy. Identical fault sets do not repeatedly trigger the Flow.

Clean-water codes 107 and 116 activate `alarm_water_shortage`. Dirty-water code 108 is reported separately in status/Flow text; it does not imply a clean-water shortage. Tank-missing and wash-tray problems have separate messages. Missing, failed or malformed fault readings cannot clear a known water alarm; a complete successful fault poll is required. A safe warning is logged once until readings recover.

Room selection, map selection, repeat counts, path selection and carpet controls are disabled for this profile. The public room IDs are action inputs rather than a readable room catalogue, and extended settings have insufficient access/encoding details for these existing Homey controls. This implementation does not claim complete Xiaomi Home feature parity.

## Compatibility and pairing

Other model profiles, existing device identities, settings, capability IDs and Flow contracts are preserved. Existing devices using the basic Mija/Ijai driver stay with that driver; no automatic cross-driver migration is attempted.

Once a TEST build containing this change is available, add the M40 through **Xiaomi Vacuum Cleaner MIoT MAX (WiFi)** using its local IP and token. Keep the old pairing until the new device has passed basic checks. Recreate the relevant Flows for the new Homey device before removing the old pairing; Homey device references do not migrate automatically. Avoid leaving both pairings polling long-term.

## Pending changelog — one row

Added Mijia Robot Vacuum M40 support with mop and water-level controls, dock actions, and robot/water fault reporting through the MIoT MAX driver.

No released changelog entry or application version was changed; assign this line when preparing the next TEST release.

## Prepared issue reply — not posted

Thanks for the details. I checked the M40 specification and existing integrations and have implemented a dedicated `xiaomi.vacuum.d110ch` profile for **Xiaomi Vacuum Cleaner MIoT MAX (WiFi)** for the next TEST release.

It adds sweep/mop selection, mop water level, suction power and dock controls. Robot and station faults are shown in the status sensor and the existing **Status has changed** Flow trigger, including stuck/blocked, clean-water empty and dirty-water full conditions. The clean-water alarm is separate from dirty-water status.

Once a TEST build containing this change is available, please add the vacuum using the MIoT MAX driver. Keep the old pairing until the new one works, then move your Flows to the new device. Room/map selection is not included yet.

Local automated checks are complete, but I have not tested this on an actual M40. Please check start/pause/return, all four sweep/mop modes, the three water levels and the dock controls. When a water or stuck warning next occurs naturally, compare the status and Flow token with Xiaomi Home, then confirm it clears after resolving the problem. If anything differs, send a fresh diagnostic immediately afterwards with the firmware version; do not include the token.

## Verification and runtime checklist

The focused regression test exercises initialization/pairing capabilities, actual capability/Flow command listeners, individual-property polling configuration, enum round trips, dock states, combined faults, notification deduplication, recovery, unknown codes and failed/malformed fault responses.

Executed local checks:

- `node --check` for all five changed/new JavaScript source and test files: passed.
- `npm test -- --test-reporter=spec`: all 301 tests passed, including five M40 regressions.
- `homey app validate --level publish` (Homey CLI 4.6.3): passed after the final source change.
- Generated M40 helper and driver files were inspected and matched their source SHA-256 hashes. Generated `app.json` has no new change; the pre-existing `.homeybuild/app.json` modification was preserved byte-for-byte. Validation also regenerated the friendly-name addition in `.homeybuild/lib/util.js`.
- `git diff --check`: passed; actual source, new files and accumulated diffs inspected. Graft context refreshed locally.

No lint or separate build script is configured in `package.json`. No dependency/audit work was needed for this change; dependencies and lockfile are unchanged. Astra orchestration/review was unavailable because the required parent selection was unobservable and the skill's allowed delegation models differ from the host's model list; ordinary local verification was used.

Runtime is unverified. No app installation, device command, physical fault simulation or issue comment was performed.

1. Use a TEST build containing this change and pair through MIoT MAX as described above.
2. Compare battery, consumable life, state and totals with Xiaomi Home after two polling cycles.
3. Exercise start, pause and return to charger; compare all four sweep/mop modes, four power levels and three water levels in both directions.
4. Run dust collection, mop wash/stop and drying/stop from the existing dock action card. Check the base-station status during each operation.
5. Create a Flow using **Status has changed** and record its `status` token. When warnings occur naturally, check obstructions, empty clean-water and full dirty-water messages, including simultaneous faults. Do not deliberately damage or obstruct the robot for a test.
6. Resolve the warning and wait for a successful poll. Clean-water shortage must clear; a failed fault read must not clear it. Check that repeated unchanged warnings do not repeatedly trigger.
7. Restart the app and confirm the controls, existing Flows and one polling loop resume without initialization errors. Confirm another existing MAX-driver model still behaves normally.

The public Supported Devices wiki entry must remain marked **implemented locally; awaiting TEST release and physical verification** until publication and reporter confirmation.
