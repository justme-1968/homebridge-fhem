// datapoint lookup and service type detection for HMCCUCHN/HMCCUDEV devices
var h = require('./helpers');
var device = h.device, mappingsFor = h.mappingsFor, section = h.section, check = h.check;
var CustomUUIDs = h.load().CustomUUIDs;

section('HmIP-PS switch (ccureadingformat=datapoint)');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Plug', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '3.STATE': 'false', '0.UNREACH': '0', '0.LOW_BAT': '0' },
    PossibleSets: 'on:noArg off:noArg toggle:noArg datapoint on-for-timer',
  }) );
  check( 'handled', r.handled === true );
  check( 'service is switch', r.accessory.service_name === 'switch', r.accessory.service_name );
  check( 'On reads 3.STATE', r.accessory.mappings.On.reading === '3.STATE', r.accessory.mappings.On.reading );
  check( 'cmdOn is on', r.accessory.mappings.On.cmdOn === 'on', r.accessory.mappings.On.cmdOn );
  check( 'low battery mapped', !!r.accessory.mappings.StatusLowBattery );
}

section('HmIP-PSM switch with power measurement (ccureadingformat=name)');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'PlugM', ccutype: 'HmIP-PSM', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { STATE: 'true', POWER: '42.5', CURRENT: '190.0', VOLTAGE: '231.2', ENERGY_COUNTER: '1234.0' },
    PossibleSets: 'on:noArg off:noArg datapoint',
  }) );
  var m = r.accessory.mappings;
  check( 'On reads STATE', m.On.reading === 'STATE', m.On.reading );
  check( 'power mapped', m[CustomUUIDs.Power] && m[CustomUUIDs.Power].reading === 'POWER' );
  check( 'current scaled mA to A', m[CustomUUIDs.Current] && m[CustomUUIDs.Current].factor === 0.001 );
  check( 'energy scaled Wh to kWh', m[CustomUUIDs.Energy] && m[CustomUUIDs.Energy].factor === 0.001 );
}

section('HmIP-BROLL shutter, LEVEL is 0.0-1.0');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Roll', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.35', '4.ACTIVITY_STATE': '3' },
    PossibleSets: 'on:noArg off:noArg pct:slider,0,1,100 up down stop datapoint',
  }) );
  var m = r.accessory.mappings;
  check( 'service is blind', r.accessory.service_name === 'blind', r.accessory.service_name );
  check( 'no On mapping', m.On === undefined );
  check( '0.35 becomes 35', m.CurrentPosition.reading2homekit('0.35') === 35, m.CurrentPosition.reading2homekit('0.35') );
  check( '1.0 becomes 100', m.CurrentPosition.reading2homekit('1.0') === 100, m.CurrentPosition.reading2homekit('1.0') );
  check( '0 becomes 0', m.CurrentPosition.reading2homekit('0') === 0, m.CurrentPosition.reading2homekit('0') );
  check( 'target uses set pct', m.TargetPosition.cmd === 'pct', m.TargetPosition.cmd );
  check( '50 stays 50 for set pct', m.TargetPosition.homekit2reading(50) === 50, m.TargetPosition.homekit2reading(50) );
  check( 'position state mapped', !!m.PositionState );
}

section('blind with attr ccuscaleval, HMCCU already scales LEVEL');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Roll2', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Attributes: { ccuscaleval: 'LEVEL:0:1:0:100' },
    Readings: { '4.LEVEL': '35' },
    PossibleSets: 'pct:slider,0,1,100 up down stop datapoint',
  }) );
  var m = r.accessory.mappings;
  check( '35 is not scaled twice', m.CurrentPosition.reading2homekit('35') === 35, m.CurrentPosition.reading2homekit('35') );
}

section('blind without set pct falls back to set datapoint');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Roll3', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.5' },
    PossibleSets: 'datapoint config',
  }) );
  var t = r.accessory.mappings.TargetPosition;
  check( 'cmd is datapoint 4.LEVEL', t.cmd === 'datapoint 4.LEVEL', t.cmd );
  check( '50 becomes 0.5', t.homekit2reading(50) === 0.5, t.homekit2reading(50) );
  check( '33 becomes 0.33', t.homekit2reading(33) === 0.33, t.homekit2reading(33) );
}

section('HmIP-BBL venetian blind, LEVEL_2 carries the slat position');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Slat', ccutype: 'HmIP-BBL', ccurole: 'BLIND_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '1.0', '4.LEVEL_2': '0.5' },
    PossibleSets: 'pct:slider,0,1,100 up down stop datapoint',
  }) );
  var m = r.accessory.mappings;
  check( 'service is blind', r.accessory.service_name === 'blind', r.accessory.service_name );
  check( 'tilt mapped', !!m.CurrentHorizontalTiltAngle );
  check( 'slats closed (0.0) is -90', m.CurrentHorizontalTiltAngle.reading2homekit('0') === -90,
         m.CurrentHorizontalTiltAngle.reading2homekit('0') );
  check( 'slats half (0.5) is 0', m.CurrentHorizontalTiltAngle.reading2homekit('0.5') === 0,
         m.CurrentHorizontalTiltAngle.reading2homekit('0.5') );
  check( 'slats open (1.0) is 90', m.CurrentHorizontalTiltAngle.reading2homekit('1.0') === 90,
         m.CurrentHorizontalTiltAngle.reading2homekit('1.0') );
  check( 'tilt writes the datapoint', m.TargetHorizontalTiltAngle.cmd === 'datapoint 4.LEVEL_2',
         m.TargetHorizontalTiltAngle.cmd );
  check( '-90 becomes 0', m.TargetHorizontalTiltAngle.homekit2reading(-90) === 0,
         m.TargetHorizontalTiltAngle.homekit2reading(-90) );
  check( '0 becomes 0.5', m.TargetHorizontalTiltAngle.homekit2reading(0) === 0.5,
         m.TargetHorizontalTiltAngle.homekit2reading(0) );
  check( '90 becomes 1', m.TargetHorizontalTiltAngle.homekit2reading(90) === 1,
         m.TargetHorizontalTiltAngle.homekit2reading(90) );
  check( 'position is separate from tilt', m.CurrentPosition.reading === '4.LEVEL', m.CurrentPosition.reading );
}

section('HmIP-BDT dimmer');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Dim', ccutype: 'HmIP-BDT', ccurole: 'DIMMER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.6' },
    PossibleSets: 'on:noArg off:noArg pct:slider,0,1,100 datapoint',
  }) );
  var m = r.accessory.mappings;
  check( 'service is light', r.accessory.service_name === 'light', r.accessory.service_name );
  check( 'On reads 4.LEVEL', m.On.reading === '4.LEVEL', m.On.reading );
  check( '0.6 becomes 60', m.Brightness.reading2homekit('0.6') === 60, m.Brightness.reading2homekit('0.6') );
  check( 'brightness uses set pct', m.Brightness.cmd === 'pct', m.Brightness.cmd );
}

section('HmIP-eTRV-2 radiator thermostat');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Valve', ccutype: 'HmIP-eTRV-2', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
    Readings: { '1.SET_POINT_TEMPERATURE': '21.0', '1.ACTUAL_TEMPERATURE': '19.4',
                '1.LEVEL': '0.25', '1.SET_POINT_MODE': '0', '0.LOW_BAT': '0' },
    PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 auto manu boost on off datapoint',
  }) );
  var m = r.accessory.mappings;
  check( 'service is thermostat', r.accessory.service_name === 'thermostat', r.accessory.service_name );
  check( 'target reads the set point', m.TargetTemperature.reading === '1.SET_POINT_TEMPERATURE',
         m.TargetTemperature.reading );
  check( 'target uses desired-temp', m.TargetTemperature.cmd === 'desired-temp', m.TargetTemperature.cmd );
  check( 'range is 4.5 to 30.5 in 0.5 steps',
         m.TargetTemperature.minValue === 4.5 && m.TargetTemperature.maxValue === 30.5
         && m.TargetTemperature.minStep === 0.5 );
  check( 'current reads the actual temperature', m.CurrentTemperature.reading === '1.ACTUAL_TEMPERATURE' );
  check( 'valve drives the heating state', !!m.CurrentHeatingCoolingState );
  check( 'mode drives the target state', !!m.TargetHeatingCoolingState );
  check( 'valve 0.25 becomes 25%', m[CustomUUIDs.Actuation].reading2homekit('0.25') === 25,
         m[CustomUUIDs.Actuation].reading2homekit('0.25') );
}

section('HmIP-WTH-2 wall thermostat');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Wall', ccutype: 'HmIP-WTH-2', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
    Readings: { '1.SET_POINT_TEMPERATURE': '22.0', '1.ACTUAL_TEMPERATURE': '21.1', '1.HUMIDITY': '48' },
    PossibleSets: 'desired-temp auto manu datapoint',
  }) );
  var m = r.accessory.mappings;
  check( 'humidity mapped', m.CurrentRelativeHumidity && m.CurrentRelativeHumidity.reading === '1.HUMIDITY' );
  check( 'no valve means no actuation', m[CustomUUIDs.Actuation] === undefined );
}

section('sensors');
{
  var swdo = mappingsFor( device({
    Internals: { NAME: 'Win', ccutype: 'HmIP-SWDO', ccurole: 'SHUTTER_CONTACT' },
    Readings: { '1.STATE': '0', '0.LOW_BAT': '0' },
    PossibleSets: 'datapoint config',
  }) );
  check( 'SWDO is a contact sensor', swdo.accessory.service_name === 'contact', swdo.accessory.service_name );
  check( 'SWDO is not switchable', swdo.accessory.mappings.On === undefined );
  check( 'SWDO maps contact state', !!swdo.accessory.mappings.ContactSensorState );
  check( 'SWDO maps door state', !!swdo.accessory.mappings.CurrentDoorState );
  check( 'SWDO maps battery', !!swdo.accessory.mappings.StatusLowBattery );

  var srh = mappingsFor( device({
    Internals: { NAME: 'Handle', ccutype: 'HmIP-SRH', ccurole: 'ROTARY_HANDLE_TRANSCEIVER' },
    Readings: { '1.STATE': '2' },
    PossibleSets: 'datapoint',
  }) );
  check( 'SRH is a contact sensor', srh.accessory.service_name === 'contact', srh.accessory.service_name );

  var smi = mappingsFor( device({
    Internals: { NAME: 'Mot', ccutype: 'HmIP-SMI', ccurole: 'MOTIONDETECTOR_TRANSCEIVER' },
    Readings: { '1.MOTION': '0', '1.ILLUMINATION': '23' },
    PossibleSets: 'datapoint',
  }) );
  check( 'SMI is a motion sensor', smi.accessory.service_name === 'MotionSensor', smi.accessory.service_name );
  check( 'SMI maps motion', smi.accessory.mappings.MotionDetected.reading === '1.MOTION' );
  check( 'SMI exposes brightness as its own service',
         smi.accessory.mappings['LightSensor#CurrentAmbientLightLevel'] !== undefined );

  var spi = mappingsFor( device({
    Internals: { NAME: 'Pres', ccutype: 'HmIP-SPI', ccurole: 'PRESENCEDETECTOR_TRANSCEIVER' },
    Readings: { '1.PRESENCE_DETECTION_STATE': '1' },
    PossibleSets: 'datapoint',
  }) );
  check( 'SPI is an occupancy sensor', spi.accessory.service_name === 'OccupancySensor', spi.accessory.service_name );

  var swsd = mappingsFor( device({
    Internals: { NAME: 'Smoke', ccutype: 'HmIP-SWSD', ccurole: 'SMOKE_DETECTOR' },
    Readings: { '1.SMOKE_DETECTOR_ALARM_STATUS': '0' },
    PossibleSets: 'datapoint',
  }) );
  check( 'SWSD is a smoke sensor', swsd.accessory.service_name === 'SmokeSensor', swsd.accessory.service_name );

  var swd = mappingsFor( device({
    Internals: { NAME: 'Leak', ccutype: 'HmIP-SWD', ccurole: 'WATER_DETECTION_TRANSMITTER' },
    Readings: { '1.WATERLEVEL_DETECTED': '0', '1.MOISTURE_DETECTED': '0' },
    PossibleSets: 'datapoint',
  }) );
  check( 'SWD is a leak sensor', swd.accessory.service_name === 'LeakSensor', swd.accessory.service_name );
}

section('actuators are not guessed from a bare datapoint');
{
  // a STATE or LEVEL datapoint alone is not enough, or sensors become switches
  var odd = mappingsFor( device({
    Internals: { NAME: 'Odd', ccutype: 'HmIP-XYZ', ccurole: 'SOMETHING_ELSE' },
    Readings: { '1.LEVEL': '0.4' },
    PossibleSets: 'datapoint',
  }) );
  check( 'bare LEVEL is not a light', odd.handled === false, odd.accessory.service_name );

  var bare = mappingsFor( device({
    Internals: { NAME: 'Bare', ccutype: 'HmIP-XYZ', ccurole: '' },
    Readings: { '1.STATE': '0' },
    PossibleSets: 'datapoint',
  }) );
  check( 'bare STATE is not a switch', bare.handled === false, bare.accessory.service_name );

  var sw = mappingsFor( device({
    Internals: { NAME: 'RealSw', ccutype: 'HmIP-XYZ', ccurole: '' },
    Readings: { '3.STATE': 'false' },
    PossibleSets: 'on off datapoint',
  }) );
  check( 'STATE with on/off is a switch', sw.handled === true && sw.accessory.service_name === 'switch',
         sw.accessory.service_name );

  var role = mappingsFor( device({
    Internals: { NAME: 'RoleSw', ccutype: 'HmIP-XYZ', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '3.STATE': 'false' },
    PossibleSets: 'datapoint',
  }) );
  check( 'an explicit switch role wins without on/off', role.handled === true );
  check( '  and writes the datapoint', role.accessory.mappings.On.cmdOn === 'datapoint 3.STATE true',
         role.accessory.mappings.On.cmdOn );
}

section('reading lookup is independent of ccureadingformat');
{
  var lc = mappingsFor( device({
    Internals: { NAME: 'Lc', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Readings: { '4.level': '0.2' },
    PossibleSets: 'pct datapoint',
  }) );
  check( 'datapointlc found', lc.accessory.mappings.CurrentPosition.reading === '4.level',
         lc.accessory.mappings.CurrentPosition.reading );

  var addr = mappingsFor( device({
    Internals: { NAME: 'Addr', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '000E1A2B3C4D5E:3.STATE': 'false' },
    PossibleSets: 'on off datapoint',
  }) );
  check( 'address format found', addr.accessory.mappings.On.reading === '000E1A2B3C4D5E:3.STATE',
         addr.accessory.mappings.On.reading );

  var multi = mappingsFor( device({
    Internals: { NAME: 'Multi', TYPE: 'HMCCUDEV', ccutype: 'HmIP-BSM' },
    Attributes: { controldatapoint: '4.STATE' },
    Readings: { '1.STATE': 'false', '4.STATE': 'true', '6.POWER': '12.0' },
    PossibleSets: 'on off datapoint',
  }) );
  check( 'controldatapoint pins the channel', multi.accessory.mappings.On.reading === '4.STATE',
         multi.accessory.mappings.On.reading );

  var d = device({
    Internals: { NAME: 'Contact', ccutype: 'HmIP-SWDO' },
    Readings: { '1.STATE': '0', '1.WINDOW_STATE': '0', '4.LEVEL_2': '0.1' },
    PossibleSets: 'datapoint',
  });
  check( 'LEVEL does not match LEVEL_2', h.load().FHEM_hmccuReading( d, 'LEVEL' ) === undefined,
         h.load().FHEM_hmccuReading( d, 'LEVEL' ) );
  check( 'STATE does not match WINDOW_STATE', h.load().FHEM_hmccuReading( d, 'STATE' ) === '1.STATE',
         h.load().FHEM_hmccuReading( d, 'STATE' ) );
}

section('genericDeviceType overrides the detection');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Forced', ccutype: 'HmIP-BDT', ccurole: 'DIMMER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.5' },
    PossibleSets: 'on off pct datapoint',
  }), 'blind' );
  check( 'forced to blind', r.accessory.service_name === 'blind', r.accessory.service_name );
}

section('unhandled device types fall back to the generic autodetection');
{
  var r = mappingsFor( device({
    Internals: { NAME: 'Weather', ccutype: 'HmIP-SWO-PL', ccurole: 'WEATHER_TRANSMIT' },
    Readings: { '1.WIND_SPEED': '3.4', '1.RAIN_COUNTER': '12' },
    PossibleSets: 'datapoint',
  }) );
  check( 'not handled here', r.handled === false );
  check( 'mappings left untouched', Object.keys(r.accessory.mappings).length === 0, r.accessory.mappings );
}
