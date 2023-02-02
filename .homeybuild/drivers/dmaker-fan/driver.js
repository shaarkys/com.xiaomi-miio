"use strict";

const Homey = require('homey');
const miio = require('miio');

class DmakerFanDriver extends Homey.Driver {

  onPair(socket) {
    socket.on('testConnection', function(data, callback) {
      miio.device({
          address: data.address,
          token: data.token
        }).then(device => {
          (async () => {
            try {
              const power = await device.power();
              const mode = await device.mode();
              const speed = await device.getState('fanSpeed');

              let result = {
                onoff: power,
                mode: mode,
                fanspeed: fanspeed
              }

              callback(null, result);
            } catch (error) {
              callback(error, null);
            }
          });
        }).catch(function (error) {
          callback(error, null);
        });
    });
  }

}

module.exports = DmakerFanDriver;
