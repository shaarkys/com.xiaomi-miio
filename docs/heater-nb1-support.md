# Smartmi Smart Fan Heater nb1 support

## Findings

- The submitted forum report concerns `zhimi.heater.nb1` on app 3.5.49. The attached diagnostic is for two `zhimi.airp.vb4` air purifiers and identifies Homey Pro (2026), so it cannot establish the heater's failure or firmware behavior.
- The installed miio transport uses a two-second deadline per attempt, including the handshake, and interprets `retries` as the total number of attempts. The heater driver previously requested one attempt for both reads and writes. There is no supported per-call timeout option in this installed implementation.
- Both published nb1 specifications use `2/5` for target temperature and `9/7` for measured temperature, matching the existing driver. There is no evidence here for moving the measured temperature to another property or applying an offset.
- ICMP ping replies do not establish successful authenticated miIO UDP replies, or prove Wi-Fi power saving as the cause. A successful connection followed by a failed poll can explain the availability changes: the shared Wi-Fi driver marks a connection available before the first property read, and the heater reconnects 60 seconds after a failed poll.
- nb1's LED property is numeric brightness, not boolean. The existing driver sent a boolean and interpreted brightness zero as off. The comparable Home Assistant integration uses zero for on and two for off.

Sources checked:

- [nb1 MIoT specification v1](https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:heater:0000A01A:zhimi-nb1:1), [readable service tree](https://home.miot-spec.com/spec?type=urn:miot-spec-v2:device:heater:0000A01A:zhimi-nb1:1).
- [nb1 MIoT specification v2](https://home.miot-spec.com/spec/zhimi.heater.nb1).
- [Home Assistant nb1 customization](https://github.com/al-one/hass-xiaomi-miot/blob/master/custom_components/xiaomi_miot/core/device_customizes.py) (`brightness_for_on: 0`, `brightness_for_off: 2`).
- Installed `node_modules/miio/lib/device_info.js`, `call`, `_createDeadline`, `_retryOnTimeout`; `drivers/wifi_device.js`, `createDevice`; and the heater driver.

## Local change

- nb1 reads, capability writes and settings writes now allow three timeout attempts, using the existing transport. Successful requests return immediately. Protocol errors are not retried.
- nb1 polls read one property at a time, matching openHAB's explicit model profile (`maxProperties: 1`), rather than requesting all eight properties together. A failed property stops the poll without publishing partial readings. Other models retain their existing batches.
- nb1 requests run in order so an older command's retries cannot overtake a newer power-off request. Queued requests cannot run after deletion or connection replacement.
- Controls can run between individual polling reads rather than waiting for the entire eight-property poll.
- A poll spanning any nb1 write attempt is discarded so older power, target or settings readings cannot overwrite the command. This includes writes whose acknowledgement times out, since the heater may have applied them. The next regular poll reads fresh state.
- State publication uses the same nb1 queue, so a write cannot start halfway through applying an already validated snapshot to Homey.
- nb1 responses are matched by service/property address and checked for successful result codes and present values before publication. Temperatures must be finite numbers. Write failures now reach the caller rather than appearing successful.
- A diagnostic logs the measured and target temperature from the first successful poll per connection. It contains only property addresses and numeric temperatures.
- nb1 LED settings encode on/off as `0`/`2` and decode `0` and `1` as on.
- Polls cannot overlap, and a stale poll cannot publish its result or schedule a reconnect after deletion or connection replacement. Reconnect timers are tracked for existing lifecycle cleanup.
- Driver IDs, capability IDs, Flow contracts, pairing identity, settings keys, manifests, dependency versions and application versions are unchanged. Existing devices require no migration or re-pairing. Other heater models retain one-attempt calls and their existing property handling; poll lifecycle guards apply to the shared heater driver.

## Pending changelog (one row)

Improved Smartmi Smart Fan Heater (zhimi.heater.nb1) reliability with individual property reads and timeout retries, added temperature diagnostics, and fixed LED settings.

## Prepared forum reply — not posted

Thanks for the detailed tests. I checked the nb1 driver and found that it currently makes only one attempt per command. I've prepared a change for the next TEST version to allow up to three attempts when a request times out, for both polling and controls. Each attempt already has a roughly two-second timeout; successful requests return immediately.

I also compared other integrations and found that openHAB explicitly reads this model's properties one at a time. Our driver requested eight together, so I've changed nb1 polling to individual requests as well. This is a model-specific compatibility change; it still needs confirmation on your heater.

I also checked the temperature mapping: room temperature is read from `9/7`, while the target is `2/5`, as specified for this model. The update checks the returned property addresses and errors, and logs both readings to help investigate why yours shows 30 °C. I haven't confirmed the cause of that reading yet.

The ping results are useful, but they don't confirm that the heater answers authenticated miIO commands, so Wi-Fi power saving remains a possibility rather than a confirmed cause.

Once the next TEST version containing this change is available, please update without removing the device, restart the app once, and observe it for about 10 minutes. Try power, target temperature, heat level and oscillation, and check whether room temperature stays separate from the target. If it still fails, please send a fresh diagnostic report from the heater immediately afterwards, including its firmware version. Local tests pass, but this still needs confirmation on an actual nb1.

## Manual runtime checks

Runtime behavior is unverified. No Homey installation or physical-device commands were run.

1. Install the next TEST build containing this change and restart the app once. Keep the existing paired heater.
2. At the normal 60-second polling frequency, observe availability and readings for at least 10 minutes, including while the heater is idle.
3. Exercise power, target temperature, heat level and oscillation; confirm physical behavior and that failures are reported when the heater does not answer.
4. Set the target to a value different from room temperature. Check `measure_temperature` against the heater/Xiaomi Home reading and inspect `nb1 temperatures: room (9/7) ... C, target (2/5) ... C` in a fresh diagnostic.
5. Toggle LED, buzzer and child lock, confirming both the physical setting and the next poll. Dimmed LED brightness should still show LED enabled.
6. Restart the app and confirm one polling loop resumes. If testing deletion, remove only a spare test pairing and confirm no reconnect attempts continue afterwards.

Safe local verification is recorded in the task completion report. These checks do not prove hardware behavior.

## Further integration research

The initial comparison covered mapping and LED encoding. Follow-up research also checked request sizing, transport timeouts, retries and polling failure handling:

| Integration | Observed approach | Relevance |
| --- | --- | --- |
| [openHAB nb1 profile](https://github.com/openhab/openhab-addons/blob/main/bundles/org.openhab.binding.miio/src/main/resources/database/zhimi.heater.nb1-miot.json) | Explicit `maxProperties: 1`; normal MIoT commands; room temperature `9/7`, target `2/5`. Its basic handler splits reads using that setting and its transport sends queued commands sequentially. | Direct model-specific evidence for individual reads. Adopted locally. The source alone does not explain why this limit was chosen or prove it causes this reporter's failure. |
| [Homebridge MIoT transport](https://github.com/merdok/homebridge-miot/blob/main/lib/protocol/MiioProtocol.js) and [polling](https://github.com/merdok/homebridge-miot/blob/main/lib/protocol/MiotDevice.js) | Four-second default request timeout, two additional retries, five-second handshake timeout; four consecutive poll failures before reconnecting; default read chunks of 14. | More tolerant timeout/reconnect policy than our original one-attempt driver. Its nb1 class does not override the default read chunk size and uses the same temperature addresses. |
| [python-miio transport](https://github.com/rytilahti/python-miio/blob/master/miio/miioprotocol.py) | Five-second default receive timeout; `retry_count=3` allows additional retries; a receive error resets discovery so the retry performs a fresh handshake. Generic MIoT reads support configurable chunks (default 15). | Longer per-attempt waiting is different from three two-second attempts. Generic library behavior is not evidence of a specific nb1 workaround. |
| [Home Assistant Xiaomi MIoT](https://github.com/al-one/hass-xiaomi-miot/blob/master/custom_components/xiaomi_miot/core/device.py) | Supports configurable property chunks, per-service polling and cloud fallback when configured. Its current nb1 customization addresses numeric LED encoding. | Cloud success does not demonstrate successful local UDP control. No nb1-specific timeout override was found in the inspected customization. |

The [open nb1 improvement PR #3008](https://github.com/al-one/hass-xiaomi-miot/pull/3008/files) was inspected in full. Its nb1 changes concern oscillation (`heater.mode`) and climate presentation; it does not introduce a timeout workaround or change the room-temperature address. Cloud polling changes in that PR concern another model.

No inspected implementation established Wi-Fi power saving as this report's root cause, or supplied an alternative room-temperature address. Longer per-attempt deadlines and consecutive-poll failure thresholds remain separate options; the current patch adopts bounded retries and the directly evidenced nb1 read-size restriction. The installed transport does not expose a per-call deadline override, so that would require a separate shared-library change.
