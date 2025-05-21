# Homey app for Xiaomi Mi Home devices
Use [Homey](https://www.athom.com/) to control WiFi devices which connect trough the Xiaomi Mi Home app. You can also use this app to control Xiaomi / Aqara Zigbee devices which are connected to a Xiaomi gateway. There are no restrictions to the number of connected Zigbee devices, since you can have multiple Mi Gateway devices and distribute all Zigbee devices between them.

## Important
Xiaomi does not officially support controlling devices from outside the Mi Home app. Additional steps are required for pairing these devices with Homey that require some technical knowledge. It also means not all available devices are supported. Also be aware that Xiaomi can make changes to it's eco system at any time resulting in Homey not being able to control these devices anymore.

## Adding miIO devices
For Homey to be able to communicate with devices over the miIO protocol a unique device token needs to be obtained. In some cases technical knowledge is needed for retrieving these tokens. See the instructions [here](https://github.com/shaarkys/com.xiaomi-miio/wiki/Obtain-token) on retrieving device tokens.

## (Un)supported devices
As mentioned not all available devices are supported. [Here](https://github.com/shaarkys/com.xiaomi-miio/wiki/Supported-Devices) is a list of identified devices that should work. If you want support for a specific device please read [this](https://github.com/jghaanstra/com.xiaomi-miio/wiki/Adding-new-devices).

## Support
Github is for bugs and features. If you need support, please use the community support forum and visit the [support topic](https://community.homey.app/t/app-pro-xiaomi-mi-home-app-for-wifi-devices/118) for further details.

## Donations
I enjoy creating apps for Homey and try to support them as best as I can. If you enjoy using my apps a [donation](https://www.paypal.me/bkubesa) in return for the time I put into this is much appreciated.
