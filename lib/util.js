'use strict';

class Util {

  static modelToFriendlyNameWiFi = {
    'zhimi.airmonitor.v1': 'Mi Air Quality Monitor',
    'cgllc.airmonitor.b1': 'Mi Air Quality Monitor gen2',
    'cgllc.airmonitor.s1': 'Mi ClearGrass Air Detector',

    'zhimi.airpurifier.v1': 'Air Purifier',
    'zhimi.airpurifier.v2': 'Air Purifier v2',
    'zhimi.airpurifier.v3': 'Air Purifier v3',
    'zhimi.airpurifier.v5': 'Air Purifier v5',
    'zhimi.airpurifier.v6': 'Air Purifier Pro',
    'zhimi.airpurifier.v7': 'Air Purifier Pro v7',
    'zhimi.airpurifier.m1': 'Air Purifier 2 Mini',
    'zhimi.airpurifier.m2': 'Air Purifier Mini',
    'zhimi.airpurifier.ma1': 'Air Purifier 2S',
    'zhimi.airpurifier.ma2': 'Air Purifier 2S',
    'zhimi.airpurifier.sa1': 'Air Purifier Super/Max',
    'zhimi.airpurifier.sa2': 'Air Purifier Super/Max 2',
    'zhimi.airpurifier.mc1': 'Air Purifier 2S',
    'zhimi.airpurifier.mc2': 'Air Purifier 2H',

    'zhimi.airpurifier.ma4': 'Air Purifier 3', 
    'zhimi.airpurifier.mb3': 'Air Purifier 3H',
    'zhimi.airpurifier.mb3a': 'Air Purifier 3H',
    'zhimi.airp.mb3a': 'Air Purifier 3H',
    'zhimi.airpurifier.va1': 'Airpurifier Pro H',
    'zhimi.airpurifier.vb2': 'Airpurifier Pro H',
    'zhimi.airpurifier.mb4': 'Air Purifier 3C',
    'zhimi.airp.mb4a': 'Air Purifier 3C',
    'zhimi.airp.mb5': 'Air Purifier 4',
    'zhimi.airp.mb5a': 'Air Purifier 4',
    'zhimi.airp.va2': 'Air Purifier 4 Pro',
    'zhimi.airp.va4': 'Air Purifier 4 Pro',
    'zhimi.airp.vb4': 'Air Purifier 4 Pro',
    'zhimi.airpurifier.rma1': 'Air Purifier 4 Lite',
    'zhimi.airp.rmb1': 'Air Purifier 4 Lite',
    'zhimi.airpurifier.za1': 'Smartmi Air Purifier',
    'zhimi.airp.meb1': 'Xiaomi Smart Air Purifier Elite',
    'xiaomi.airp.cpa4': 'Xiaomi Smart Air Purifier 4 Compact',

    'zhimi.airfresh.va2': 'Smartmi Fresh Air System VA2',
    'zhimi.airfresh.va4': 'Smartmi Fresh Air System VA4',

    'zhimi.airfresh.ua1': 'Mi Fresh Air Ventilator C1-80',

    'airdog.airpurifier.x3': 'Airdog X3 Air Purifier',
    'airdog.airpurifier.x5': 'Airdog X5 Air Purifier',
    'airdog.airpurifier.x7sm': 'Airdog X7s Air Purifier',

    'dmaker.airfresh.t2017': 'Mi Air Purifier (MJXFJ-300-G1)',
    'dmaker.airfresh.a1': 'Mi Air Purifier (MJXFJ-150-A1)',

    'zhimi.humidifier.v1': 'Smartmi Humidifier',
    'zhimi.humidifier.ca1': 'Smartmi Evaporative Humidifier',
    'zhimi.humidifier.cb1': 'Smartmi Evaporative Humidifier',
    'zhimi.humidifier.cb2': 'Smartmi Evaporative Humidifier',
    'zhimi.humidifier.ca4': 'Smartmi Evaporative Humidifier v2',
    'zhimi.humidifier.jd1': 'Smartmi Humidifier Rainforest',

    'xiaomi.humidifier.airmx': 'Mijia Mistless Humidifier 3 Pro',
    'xiaomi.humidifier.3lite': 'Xiaomi Smart Humidifier 3 Lite',
    
    'deerma.humidifier.jsq': 'Mijia Smart Sterilization Humidifier JSQ',
    'deerma.humidifier.jsq1': 'Mijia Pure Smart Humidifier JSQ1',
    'deerma.humidifier.mjjsq': 'Mijia Smart Sterilization Humidifier MJJSQ',
    'deerma.humidifier.jsq4': 'Mi Smart Antibacterial Humidifier JSQ4',
    'deerma.humidifier.jsq5': 'Mi Smart Antibacterial Humidifier JSQ5',
    'deerma.humidifier.jsqs': 'Mi Smart Antibacterial Humidifier JSQS',
    'deerma.humidifier.jsq2w': 'Mi Smart Antibacterial Humidifier JSQ2W',

    'leshow.humidifier.jsq1': 'Xiaomi Humidifier Pro',
    'shuii.humidifier.jsq001': 'Humidifier JSQ001',

    'dmaker.derh.22ht': 'Xiaomi Smart Dehumidifier',

    'dmaker.fan.p5': 'DMaker Fan X1',
    'dmaker.fan.p9': 'Mi Smart Tower Fan',
    'dmaker.fan.p10': 'Mi Smart Standing Fan 2',
    'dmaker.fan.p11': 'Mi Smart Standing Fan Pro',
    'dmaker.fan.p15': 'Mi Smart Standing Fan Pro EU',
    'dmaker.fan.p18': 'Mi Smart Fan 2',
    'dmaker.fan.p33': 'Mi Smart Standing Fan 2 Pro',
    'dmaker.fan.p44': 'Mi Smart Evaporative Cooling Fan',
    'dmaker.fan.1c': 'Mi Smart Standing Fan 2 Lite',

    'zhimi.fan.v2': 'Smartmi DC Pedestal Fan v2',
    'zhimi.fan.v3': 'Smartmi DC Pedestal Fan v3',
    'zhimi.fan.sa1': 'Smartmi Standing Fan',
    'zhimi.fan.za1': 'Smartmi Inverter Pedestal Fan',
    'zhimi.fan.za3': 'Smartmi Standing Fan 2',
    'zhimi.fan.za4': 'Smartmi Standing Fan 2S',
    'zhimi.fan.za5': 'Smartmi Standing Fan 3',
    "xiaomi.fan.p45": "Xiaomi Smart Tower Fan 2",

    'zhimi.heater.mc2': 'Smart Space Heater S',
    'zhimi.heater.za2': 'Smart Space Heater 1S',
    'leshow.heater.bs1s': 'Smart Space Heater BS1S',
    'zhimi.heater.nb1': 'Smartmi Smart Fan Heater',
    'zhimi.heater.zb1a': 'Smartmi Smart Convector Heater 1S',

    'hyd.airer.znlyj4': 'Mijia Smart Clothes Drying Rack',

    'rockrobo.vacuum.v1': 'Roborock Vacuum v1',
    'roborock.vacuum.c1': 'Roborock Vacuum S5 Max',
    'rockrobo.vacuum.1s': 'Roborock Vacuum 1S',
    'roborock.vacuum.e2': 'Roborock Vacuum E2',
    'roborock.vacuum.s4': 'Roborock Vacuum S4',
    'roborock.vacuum.s5': 'Roborock Vacuum S5',
    'roborock.vacuum.s5e': 'Roborock Vacuum S5e',
    'roborock.vacuum.s6': 'Roborock Vacuum S6',
    'roborock.vacuum.t4': 'Roborock Vacuum T4',
    'roborock.vacuum.t6': 'Roborock Vacuum T6',
    'roborock.vacuum.a08': 'Roborock Vacuum S6 Pure',
    'roborock.vacuum.a09': 'Roborock Vacuum T7 Pro',
    'roborock.vacuum.a10': 'Roborock Vacuum S6 MaxV',
    'roborock.vacuum.a11': 'Roborock Vacuum T7',
    'roborock.vacuum.a14': 'Roborock Vacuum T7S',
    'roborock.vacuum.a15': 'Roborock Vacuum S7',
    'roborock.vacuum.a19': 'Roborock Vacuum S4 Max',
    'roborock.vacuum.a23': 'Roborock Vacuum T7S Plus',
    'roborock.vacuum.a26': 'Roborock Vacuum G10S Pro',
    'roborock.vacuum.a27': 'Roborock Vacuum S7 MaxV Ultra',
    'roborock.vacuum.a29': 'Roborock Vacuum G10',
    'roborock.vacuum.a34': 'Roborock Vacuum Q5',
    'roborock.vacuum.a38': 'Roborock Vacuum Q7 Max',
    'roborock.vacuum.a40': 'Roborock Vacuum Q7',
    'roborock.vacuum.a46': 'Roborock Vacuum G10S',
    'roborock.vacuum.a51': 'Roborock Vacuum S8',
    'roborock.vacuum.a62': 'Roborock Vacuum S7 Pro Ultra',
    'roborock.vacuum.a65': 'Roborock Vacuum S7 Max Ultra',
    'roborock.vacuum.a70': 'Roborock S8 Ultra Pro',
    'roborock.vacuum.a72': 'Roborock Q5 Pro',
    'roborock.vacuum.a73': 'Roborock Vacuum Q8 Max',
    'roborock.vacuum.a75': 'Roborock Revo Q',
    'roborock.vacuum.p5': 'Roborock Vacuum P5',
    'roborock.vacuum.m1s': 'Mijia Vacuum M1S',

    'dreame.vacuum.mc1808': 'Mijia Vacuum 1C',
    'dreame.vacuum.p2008': 'Dreame Robot Vacuum-Mop F9',
    'dreame.vacuum.p2009': 'Dreame Robot Vacuum D9',
    'dreame.vacuum.p2027': 'Dreame Bot W10 Pro',
    'dreame.vacuum.p2028': 'Dreame Bot Z10 Pro',
    'dreame.vacuum.p2041o': 'Mi Robot Vacuum-Mop 2 Pro+',
    'dreame.vacuum.p2150a': 'Mi Robot Vacuum-Mop 2 Ultra',
    'dreame.vacuum.p2150o': 'Mi Robot Vacuum-Mop 2 Ultra',
    'dreame.vacuum.p2029': 'Dreame Bot L10 Pro',
    'dreame.vacuum.p2041': 'Xiaomi Vacuum 1T',
    'dreame.vacuum.r2205': 'Dreame Bot D10 Plus',
    'dreame.vacuum.r2228o': 'Dreame Bot L10s Ultra',
    'dreame.vacuum.r2209': 'Xiaomi/Dreame Robot Vacuum X10',
    'dreame.vacuum.p2114a': 'Xiaomi/Dreame Robot Vacuum X10+',
    'dreame.vacuum.r2211o': 'Xiaomi/Dreame Robot Vacuum S10+',
    'dreame.vacuum.r2232c': 'Dreame Bot L10s Prime',
    'dreame.vacuum.r2338a': 'Dreame L10s Pro Ultra',
    'dreame.vacuum.r2416': 'Dreame X40 Ultra',
    'dreame.vacuum.r2449': 'Dreame X40 Ultra Complete',

    'mijia.vacuum.v1': 'Xiaomi Mijia G1 Robot Vacuum Mop v1',
    'mijia.vacuum.v2': 'Xiaomi Mijia G1 Robot Vacuum Mop v2',
    'mijia.vacuum.v3': 'Mi Robot Vacuum-Mop Essential',
    'mijia.vacuum.b108za': 'Mi Robot Vacuum-Mop 2S',
    'mijia.vacuum.b108zb': 'Mi Robot Vacuum-Mop 3S',

    'xiaomi.vacuum.b112gl': 'Xiaomi Robot Vacuum E12',
    'xiaomi.vacuum.b106eu': 'Xiaomi Robot Vacuum S12',
    'xiaomi.vacuum.b112': 'Xiaomi Robot Vacuum E10',
    'xiaomi.vacuum.c101': 'Xiaomi Self-Cleaning Vacuum Robot 2 C101',
    'xiaomi.vacuum.c102gl': 'Xiaomi Robot Vacuum X20+',
    'xiaomi.vacuum.d109gl': 'Xiaomi Robot Vacuum X20 Max',
    'xiaomi.vacuum.d102gl': 'Xiaomi Robot Vacuum X20 Pro',

    'ijai.vacuum.v1': 'Mi Robot Vacuum-Mop Pro',
    'ijai.vacuum.v2': 'Mi Robot Vacuum-Mop 2',
    'ijai.vacuum.v3': 'Mi Robot Vacuum-Mop 2 Pro',
    'ijai.vacuum.v10': 'Mi Robot Vacuum-Mop 2 Lite',
    'ijai.vacuum.v13': 'Mi Robot Vacuum-Mop 2 Pro',
    'ijai.vacuum.v14': 'Mi Robot Vacuum-Mop G1',
    'ijai.vacuum.v15': 'Mi Robot Vacuum-Mop 2 Pro',
    'ijai.vacuum.v16': 'Mi Robot Vacuum-Mop 2i',
    'ijai.vacuum.v17': 'Xiaomi Robot Vacuum S10',
    'ijai.vacuum.v18': 'Mi Robot Vacuum-Mop 3C',
    'ijai.vacuum.v19': 'Mi Robot Vacuum-Mop 2S',

    'viomi.vacuum.v7': 'Mi Robot Vacuum-Mop P v7',
    'viomi.vacuum.v8': 'Mi Robot Vacuum-Mop P v8',

    'roidmi.vacuum.v60': 'Roidmi Eve',
    'roidmi.vacuum.v66': 'Roidmi Eva',

    'chuangmi.plug.m1': 'Mi Smart Plug WiFi',
    'chuangmi.plug.m2': 'Mi Smart Plug WiFi',
    'chuangmi.plug.m3': 'Mi Smart Plug WiFi',
    'chuangmi.plug.v1': 'Mi Smart Plug With USB WiFi',
    'chuangmi.plug.v2': 'Mi Smart Plug With 2 USB WiFi',
    'chuangmi.plug.v3': 'Mi Smart Plug With 2 USB WiFi',
    'chuangmi.plug.hmi206': 'Mi Smart Plug WiFi',
    'qmi.powerstrip.v1': 'Mi Power Strip v1',
    'zimi.powerstrip.v2': 'Mi Power Strip v2',
    'cuco.plug.v2eur': 'Xiaomi Smart Plug 2',

    'philips.light.sread1': 'Eyecare Lamp 2',
    'philips.light.bulb': 'Philips Light Bulb',
    'philips.light.candle': 'Philips Candle',
    'philips.light.candle2': 'Philips Candle',
    'philips.light.ceiling': 'Philips Ceiling Light',
    'philips.light.zyceiling': 'Philips Ceiling Light',
    'philips.light.mono1': 'Philips Light Bulb',
    'philips.light.downlight': 'Philips Down Light',
    'philips.light.strip5': 'Philips / Xiaomi Smart Lightstrip Pro',
    
    'lumi.gateway.v2': 'Xiaomi Gateway v1',
    'lumi.gateway.v3': 'Xiaomi Gateway v2',
    'lumi.gateway.mcn001': 'Xiaomi Smart Home Hub 2',
    'lumi.acpartner.v1': 'Aqara Gateway v1',
    'lumi.acpartner.v2': 'Aqara Gateway v2',
    'lumi.acpartner.v3': 'Aqara Gateway v3',
    'chuangmi.remote.v2': 'Universal Intelligent IR Remote Controller',

    'mmgg.pet_waterer.s1': 'Xiaowan Smart Pet Water Dispenser', 
    'mmgg.pet_waterer.s4': 'Xiaowan Smart Pet Water Dispenser',
    'mmgg.pet_waterer.wi11': 'Xiaomi Smart Pet Fountain',
    'xiaomi.pet_waterer.iv02': 'Xiaomi Smart Pet Fountain 2',

    'mmgg.feeder.fi1': 'Xiaomi Smart Pet Food Feeder',
    'mmgg.feeder.inland': 'Xiaomi Smart Pet Food Feeder',
    'mmgg.feeder.spec': 'Xiaowan Smart Pet Feeder',
    'xiaomi.feeder.pi2001': 'Xiaomi Smart Pet Food Feeder 2',
    'xiaomi.feeder.iv2001': 'Mi Smart Pet Feeder 2 CN',

    'careli.fryer.maf05a': 'Xiaomi Smart Air Fryer Pro 4L',
    'careli.fryer.ybaf04': 'KitchenMi Smart Air Fryer 6007WAB',
    'careli.fryer.ybaf03': 'KitchenMi Smart Air Fryer 6007WA',
    'careli.fryer.maf02c': 'Mi Smart Air Fryer (3.5L)',
    'careli.fryer.maf07': 'Mi Smart Air Fryer (3.5L)',
    'careli.fryer.maf02': 'Mi Smart Air Fryer (3.5L)'
  }

  static modelToFriendlyNameSubdevice = {
    'remote.b186acn01': 'Aqara Wireless Wall Single Switch (Advanced)',
    'remote.b286acn01': 'Aqara Wireless Wall Double Switch (Advanced)',
    '86sw1': 'Aqara Wireless Wall Single Switch',
    '86sw2': 'Aqara Wireless Wall Double Switch',
    'sensor_switch.aq2': 'Aqara Wireless Button',
    'sensor_switch.aq3': 'Aqara Wireless Button (Advanced)',
    'sensor_switch': 'Aqara Wireless Button',
    'ctrl_ln1.aq1': 'Aqara Smart Wall Single Switch With Neutral',
    'switch_b1nacn02': 'Aqara Smart Wall Single Switch With Neutral',
    'ctrl_ln1.aq2': 'Aqara Smart Wall Double Switch With Neutral',
    'switch_b2nacn02': 'Aqara Smart Wall Double Switch With Neutral',
    'ctrl_neutral1': 'Aqara Smart Wall Single Switch No Neutral',
    'switch_b1lacn02': 'Aqara Smart Wall Single Switch No Neutral',
    'ctrl_neutral2': 'Aqara Smart Wall Double Switch No Neutral',
    'switch_b2lacn02': 'Aqara Smart Wall Double Switch No Neutral',
    'curtain': 'Aqara Curtain Motor',
    'curtain.hagl04': 'Aqara Curtain Motor',
    'curtain.aq2': 'Aqara Roller Shade Controller',
    'sensor_magnet.aq2': 'Aqara Magnet Sensor',
    'sensor_motion.aq2': 'Aqara Motion Sensor',
    'weather.v1': 'Aqara Temperature & Humidity Sensor',
    'sensor_wleak.aq1': 'Aqara Waterleak Sensor',
    'cube': 'Mi Aqara Cube',
    'sensor_cube.aqgl01': 'Mi Aqara Cube',
    'sensor_cube': 'Mi Aqara Cube',
    'switch': 'Mi Wireless Button',
    'magnet': 'Mi Magnet Sensor',
    'motion': 'Mi Motion Sensor',
    'sensor_ht': 'Mi Temperature & Humidity Sensor',
    'natgas': 'Miia Gas Leak Detector',
    'sensor_natgas': 'Miia Gas Leak Detector',
    'ctrl_86plug.aq1': 'Aqara Wall Outlet',
    'lumi.ctrl_86plug.aq1': 'Aqara Wall Outlet',
    'lumi.ctrl_86plug': 'Aqara Wall Outlet',
    'lock.aq1': 'Aqara Lock',
    'relay.c2acn01': 'Aqara 2 Channel Relay',
    'lumi.relay.c2acn01': 'Aqara 2 Channel Relay',
    'vibration': 'Vibration Sensor',
    'plug': 'Mi Smart Plug'
  }

  constructor(opts) {
    this.homey = opts.homey;
  }

  getFriendlyNameWiFi(model) {
    return Util.modelToFriendlyNameWiFi[model];
  }

  getFriendlyNameSubdevice(model) {
    return Util.modelToFriendlyNameSubdevice[model];
  }

	normalize(value, min, max) {
    var normalized = (value - min) / (max - min);
    return Number(normalized.toFixed(2));
  }

  denormalize(normalized, min, max) {
    var denormalized = ((1 - normalized) * (max - min) + min);
    return Number(denormalized.toFixed(0));
  }

  getRandomTimeout(max) {
    return ((Math.floor(Math.random() * Math.floor(max)) * 1000) + 2000);
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  sleep(ms) {
  	return new Promise(resolve => setTimeout(resolve, ms));
  }

}

module.exports = Util;
