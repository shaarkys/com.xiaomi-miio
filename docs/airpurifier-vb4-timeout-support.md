# Air Purifier 4 Pro timeout follow-up

## Evidence and scope

The new diagnostic `a09e657e-6128-4d3d-9417-00724b8b9eca` reports app
3.5.49 on Homey Pro (2026), with two correctly identified `zhimi.airp.vb4`
purifiers. It contains 82 polling timeout entries, two handshake timeouts and
one on/off timeout logged twice. Failures continue after an app restart.
The reporter confirms reserved IP addresses and independently observed outages.
Some logged failures also coincide; that does not identify their root cause.

The driver previously used one two-second transport attempt for each read/write.
A failed poll immediately marked the device unavailable, stopped polling and
scheduled an untracked reconnect after 60 seconds.

## Implemented change

- Only `zhimi.airp.vb4` gets up to three total attempts for transport timeouts on
  property reads and absolute property writes. Each attempt retains the installed
  miio library's two-second deadline. This is not a six-second receive window.
- vb4 polls, state publication and writes run in order on each connection, so an
  older retried write cannot overtake a newer command and a poll cannot publish
  old state after an intervening driver write. Failed requests do not block later
  queued work. A replacement connection has its own queue.
- vb4 write acknowledgements must contain the matching property and success code.
  Protocol errors and malformed responses are not retried.
- The Advanced MIoT purifier driver suppresses overlapping polls and ignores
  stale replies/failures after connection replacement, deletion or shutdown.
  Remaining retries and queued commands are cancelled for obsolete connections.
- Poll reconnect timers are tracked through the existing Wi-Fi lifecycle cleanup
  and guarded against reconnecting an obsolete connection. Genuine failed polls
  still mark the device unavailable and retain the existing 60-second reconnect
  delay. Existing connection setup can still mark a device available before its
  first property poll; this change does not redesign the shared connection layer.
- Retry logs identify the operation and attempt number without tokens or payloads.
  Exhausted polling failures retain the underlying error and reconnect delay.

Other models retain one attempt per request and existing batching/mappings.
No dependencies, versions, manifests, device identities, capabilities, settings
keys or Flow contracts change. Existing pairings need no migration.

## Validation and limitations

Focused regression coverage exercises transient recovery, exhaustion, write order,
settings retries, invalid acknowledgements, overlapping polls, stale callbacks,
deletion/shutdown, connection replacement during publication, and other models.
These are mocked tests, not proof of physical purifier behavior. No app was
installed or published and no real device was contacted for this change.

The change mitigates brief missed replies; it does not establish or fix a proven
Wi-Fi/firmware root cause. A timed-out absolute write can have reached the device
even without acknowledgement. Requests queued behind a retried request may take
longer to complete. An already-started Homey SDK update cannot be cancelled, but
subsequent publication is stopped when the connection becomes obsolete.

## Manual TEST-build checks

1. Install the next TEST build containing this change, keeping both existing
   pairings. Restart the Homey app once if it did not restart during the update.
2. Check on/off, mode, fan level and one reversible setting on each purifier;
   verify the physical state and Homey readings agree.
3. Observe for at least one hour (preferably several hours), including normal
   polling and the hourly connection refresh. Note device names and outage times.
4. After any recurring failure, submit diagnostics before restarting again.
   Include each purifier's firmware version and whether Xiaomi Home could still
   control the affected device at that moment.
5. During a separately authorized development smoke test, verify reconnection
   after temporary loss of connectivity and that removing a test pairing or
   stopping the app cancels pending reconnect work.

## One-row changelog

Improved Xiaomi Air Purifier 4 Pro (zhimi.airp.vb4) timeout recovery with bounded retries and ordered commands, and fixed stale polling/reconnect handling in the Advanced MIoT purifier driver.

## Prepared reply (not sent)

Hi Sergey,

Thank you for testing and sending the new diagnostics. They confirm that the
timeouts continue after the restart, including when sending an on/off command.

I have prepared a driver change for your Air Purifier 4 Pro model. It retries
timed-out reads and controls up to twice before giving up, keeps requests in
order, and prevents old polling/reconnect work from interfering with a new
connection.

This should make brief communication failures less disruptive, but it still
needs testing on your purifiers; the diagnostics do not establish the underlying
cause of the missed replies.

Once the next TEST version containing this change is available, please update
without removing your existing devices. Test on/off, mode and fan speed on each
purifier, then leave them running for at least an hour, ideally several hours.
If the issue returns, please submit diagnostics before restarting the app again,
and include the firmware version of each purifier and whether Xiaomi Home could
still control the affected device at that moment.

Best regards,
Břetislav
