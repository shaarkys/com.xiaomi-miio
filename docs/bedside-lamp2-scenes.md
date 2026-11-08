# Xiaomi Mi Bedside Lamp 2 scenes

The Bedside Lamp 2 device view provides Night Light, Sunrise, Sunset and Stop Effect.
The **Set lamp scene** Flow action provides the same controls and **Normal light**.
Existing paired lamps gain these capabilities during initialization without re-pairing.

- **Night Light:** uses the lamp's moonlight power mode. Turning the toggle off
  restores normal white light and turns the lamp on; use the main power switch to turn it off.
- **Sunrise:** about 15 minutes, from dim orange through warm white to 100% brightness.
  The lamp stays on after completion.
- **Sunset:** about 10 minutes, fading through warm white to dim orange, then turning off.
- **Stop Effect:** stops the lamp's current colour flow. The configured finish action
  applies: Sunrise stays on, Sunset turns off.
- A normal Homey power, brightness, temperature or colour command stops a scene
  started by this app before applying the requested change. Adjusting brightness or
  colour during Sunset keeps an already-on lamp on.

Effects run on the lamp, so Homey does not schedule transition timers or replay a
scene after an app restart. The Stop Effect command also works after a restart.
The Night Light toggle is synchronized from the lamp's actual active_mode and
power readings. Unsupported/empty optional mode readings do not imply a state change.

## Protocol references

- [Yeelight's local protocol](https://www.yeelight.com/download/Yeelight_Inter-Operation_Spec.pdf):
  set_power mode 5, set_scene with cf, transition count and finish action,
  stop_cf, and active_mode.
- [python-yeelight model profiles](https://yeelight.readthedocs.io/en/latest/_modules/yeelight/main.html):
  bslamp2 explicitly supports Night Light.
- [python-yeelight scenes](https://yeelight.readthedocs.io/en/latest/_modules/yeelight/flows.html):
  the standard Sunrise and Sunset sequences.
- [python-yeelight flow serialization](https://yeelight.readthedocs.io/en/latest/_modules/yeelight/flow.html):
  one three-step sequence uses a transition count of 3, not 1.

These references establish the command contracts. They do not prove that every
Bedside Lamp 2 firmware accepts those commands over miIO.

## TEST-version smoke test

1. Install the next TEST build containing this change. Confirm the controls appear
   on an existing paired lamp and ordinary power/brightness/colour controls still work.
2. Toggle Night Light on and off. Verify the physical mode and the Homey toggle,
   including after a physical power change and the next poll.
3. Start Sunrise with the lamp off. Check for a dim start and a gradual rise to
   warm white at full brightness after about 15 minutes.
4. Start Sunset. Check for a gradual fade and power-off after about 10 minutes.
5. Test Stop Effect, replacement with the other effect, and a manual brightness
   change during an effect.
6. Run each option from the Flow action. Restart the app during an effect, check
   that it is not restarted by Homey, and test Stop Effect afterward.
7. If a command fails, submit fresh diagnostics after the failed action. Do not
   include tokens or unredacted command lines.
