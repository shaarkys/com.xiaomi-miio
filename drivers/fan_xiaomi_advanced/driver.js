'use strict';

const Driver = require('../wifi_driver.js');
const engine = require('../../lib/fans-xiaomi/engine.js');

class AdvancedXiaomiFanMiotDriver extends Driver {

  onInit() {
    super.onInit();

    // All flow-card run listeners are registered once here, driven by the
    // feature registry in lib/fans-xiaomi/features.js. The runtime capability
    // guard (requireFeature) backs up the design-time picker filter.
    engine.registerFlowCards(this);
  }

}

module.exports = AdvancedXiaomiFanMiotDriver;
