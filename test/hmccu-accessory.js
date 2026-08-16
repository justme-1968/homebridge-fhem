// the mappings that survive the whole FHEMAccessory constructor, plus the CUL_HM devices
// the constructor already handled before HMCCU support was added
var h = require('./helpers');
var device = h.device, accessoryFor = h.accessoryFor, errors = h.errors;
var section = h.section, check = h.check;

section('HmIP-PS switch through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Plug', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '3.STATE': 'false', '0.LOW_BAT': '0' },
    PossibleSets: 'on:noArg off:noArg toggle:noArg datapoint',
  }) );
  check( 'service is switch', a.service_name === 'switch', a.service_name );
  check( 'On survives', !!a.mappings.On );
  check( 'informId is Plug-3.STATE', a.mappings.On.informId === 'Plug-3.STATE', a.mappings.On.informId );
  check( 'model taken from ccutype', a.model === 'HmIP-PS', a.model );
  check( 'nothing logged as error', errors().length === 0, errors() );
}

section('HmIP-BROLL blind through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Roll', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.35', '4.ACTIVITY_STATE': '3' },
    PossibleSets: 'on:noArg off:noArg pct:slider,0,1,100 up down stop datapoint',
  }) );
  check( 'service is blind', a.service_name === 'blind', a.service_name );
  check( 'current position survives', !!a.mappings.CurrentPosition );
  check( 'target position survives', !!a.mappings.TargetPosition );
  check( 'no stray On mapping', a.mappings.On === undefined );
  check( 'no stray brightness mapping', a.mappings.Brightness === undefined );
  check( 'position cached as 35', a.mappings.CurrentPosition.cached === 35, a.mappings.CurrentPosition.cached );
  check( 'nothing logged as error', errors().length === 0, errors() );
}

section('HmIP-BDT dimmer through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Dim', ccutype: 'HmIP-BDT', ccurole: 'DIMMER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.6' },
    PossibleSets: 'on:noArg off:noArg pct:slider,0,1,100 datapoint',
  }) );
  check( 'service is light', a.service_name === 'light', a.service_name );
  check( 'brightness cached as 60', a.mappings.Brightness.cached === 60, a.mappings.Brightness.cached );
  check( 'On reads LEVEL, not state', a.mappings.On.reading === '4.LEVEL', a.mappings.On.reading );
  check( 'nothing logged as error', errors().length === 0, errors() );
}

section('HmIP-eTRV-2 thermostat through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Valve', ccutype: 'HmIP-eTRV-2', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
    Readings: { '1.SET_POINT_TEMPERATURE': '21.0', '1.ACTUAL_TEMPERATURE': '19.4',
                '1.LEVEL': '0.25', '1.SET_POINT_MODE': '0' },
    PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 auto manu boost on off datapoint',
  }) );
  check( 'service is thermostat', a.service_name === 'thermostat', a.service_name );
  check( 'target temperature survives', !!a.mappings.TargetTemperature );
  check( 'target cached as 21', a.mappings.TargetTemperature.cached === 21, a.mappings.TargetTemperature.cached );
  check( 'current cached as 19.4', a.mappings.CurrentTemperature.cached === 19.4, a.mappings.CurrentTemperature.cached );
  check( 'heating state not replaced by the static default',
         a.mappings.CurrentHeatingCoolingState.reading === '1.LEVEL', a.mappings.CurrentHeatingCoolingState );
  check( 'open valve means heating', a.mappings.CurrentHeatingCoolingState.cached === 1,
         a.mappings.CurrentHeatingCoolingState.cached );
  check( 'nothing logged as error', errors().length === 0, errors() );
}

section('a thermostat whose set command carries arguments is still a thermostat');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Valve2', ccutype: 'HmIP-eTRV', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
    Readings: { '1.SET_POINT_TEMPERATURE': '18.0', '1.ACTUAL_TEMPERATURE': '17.0' },
    PossibleSets: 'datapoint config values',
  }) );
  check( 'service is thermostat', a.service_name === 'thermostat', a.service_name );
  check( 'target temperature not discarded', !!a.mappings.TargetTemperature, a.mappings.TargetTemperature );
  check( 'cmd is datapoint 1.SET_POINT_TEMPERATURE',
         a.mappings.TargetTemperature && a.mappings.TargetTemperature.cmd === 'datapoint 1.SET_POINT_TEMPERATURE',
         a.mappings.TargetTemperature && a.mappings.TargetTemperature.cmd );
  check( 'nothing logged as error', errors().length === 0, errors() );
}

section('HmIP-SWDO window contact through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Win', ccutype: 'HmIP-SWDO', ccurole: 'SHUTTER_CONTACT' },
    Readings: { '1.STATE': '0', '0.LOW_BAT': '0' },
    PossibleSets: 'datapoint config',
  }) );
  check( 'service is contact', a.service_name === 'contact', a.service_name );
  check( 'closed contact is CONTACT_DETECTED', a.mappings.ContactSensorState.cached === 0,
         a.mappings.ContactSensorState.cached );
  check( 'not exposed as a switch', a.mappings.On === undefined );
  check( 'nothing logged as error', errors().length === 0, errors() );

  var open = accessoryFor( device({
    Internals: { NAME: 'Win2', ccutype: 'HmIP-SWDO', ccurole: 'SHUTTER_CONTACT' },
    Readings: { '1.STATE': '1' },
    PossibleSets: 'datapoint',
  }) );
  check( 'open contact is CONTACT_NOT_DETECTED', open.mappings.ContactSensorState.cached === 1,
         open.mappings.ContactSensorState.cached );
}

section('HmIP-SMI motion detector through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Mot', ccutype: 'HmIP-SMI', ccurole: 'MOTIONDETECTOR_TRANSCEIVER' },
    Readings: { '1.MOTION': '1', '1.ILLUMINATION': '23' },
    PossibleSets: 'datapoint',
  }) );
  check( 'service is MotionSensor', a.service_name === 'MotionSensor', a.service_name );
  check( 'motion cached as true', a.mappings.MotionDetected.cached === true, a.mappings.MotionDetected.cached );
  check( 'brightness cached as 23', a.mappings['LightSensor#CurrentAmbientLightLevel'].cached === 23,
         a.mappings['LightSensor#CurrentAmbientLightLevel'].cached );
  check( 'nothing logged as error', errors().length === 0, errors() );
}

section('HmIP-SWSD smoke detector through the constructor');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Smoke', ccutype: 'HmIP-SWSD', ccurole: 'SMOKE_DETECTOR' },
    Readings: { '1.SMOKE_DETECTOR_ALARM_STATUS': '0' },
    PossibleSets: 'datapoint',
  }) );
  check( 'service is SmokeSensor', a.service_name === 'SmokeSensor', a.service_name );
  check( 'idle is SMOKE_NOT_DETECTED', a.mappings.SmokeDetected.cached === 0, a.mappings.SmokeDetected.cached );

  var alarm = accessoryFor( device({
    Internals: { NAME: 'Smoke2', ccutype: 'HmIP-SWSD', ccurole: 'SMOKE_DETECTOR' },
    Readings: { '1.SMOKE_DETECTOR_ALARM_STATUS': '1' },
    PossibleSets: 'datapoint',
  }) );
  check( 'primary alarm is SMOKE_DETECTED', alarm.mappings.SmokeDetected.cached === 1,
         alarm.mappings.SmokeDetected.cached );
}

section('CUL_HM devices are unaffected');
{
  var sw = accessoryFor( device({
    Internals: { NAME: 'HmSwitch', TYPE: 'CUL_HM', DEF: 'ABCDEF' },
    Attributes: { model: 'HM-LC-SW1-PL2', subType: 'switch' },
    Readings: { state: 'off' },
    PossibleSets: 'on off toggle statusRequest',
  }) );
  check( 'switch still detected', sw.service_name === 'switch', sw.service_name );
  check( 'On still reads state', sw.mappings.On.reading === 'state', sw.mappings.On.reading );
  check( 'nothing logged as error', errors().length === 0, errors() );

  var th = accessoryFor( device({
    Internals: { NAME: 'HmTherm', TYPE: 'CUL_HM', DEF: 'ABCDE1' },
    Attributes: { model: 'HM-CC-RT-DN', subType: 'thermostat' },
    Readings: { 'desired-temp': '20.0', 'measured-temp': '19.0', actuator: '15' },
    PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 on off statusRequest',
  }) );
  check( 'thermostat still detected', th.service_name === 'thermostat', th.service_name );
  check( 'target still reads desired-temp', th.mappings.TargetTemperature.reading === 'desired-temp',
         th.mappings.TargetTemperature.reading );
  check( 'heating state still defaults to HEAT', th.mappings.CurrentHeatingCoolingState.default === 1,
         th.mappings.CurrentHeatingCoolingState );
  check( 'nothing logged as error', errors().length === 0, errors() );

  // a blindActuator used to end up as a Lightbulb because the 'set pct' branch claimed the
  // service name first
  var bl = accessoryFor( device({
    Internals: { NAME: 'HmBlind', TYPE: 'CUL_HM', DEF: 'ABCDE2' },
    Attributes: { model: 'HM-LC-Bl1-FM', subType: 'blindActuator' },
    Readings: { state: '40', pct: '40' },
    PossibleSets: 'on off pct:slider,0,1,100 up down stop',
  }) );
  check( 'blindActuator is a blind, not a light', bl.service_name === 'blind', bl.service_name );
  check( 'current position reads pct', bl.mappings.CurrentPosition.reading === 'pct',
         bl.mappings.CurrentPosition.reading );
  check( 'target position reads pct', bl.mappings.TargetPosition.reading === 'pct',
         bl.mappings.TargetPosition.reading );
  check( 'brightness removed', bl.mappings.Brightness === undefined );
  check( 'nothing logged as error', errors().length === 0, errors() );

  // but an explicit genericDeviceType still wins
  var forced = accessoryFor( device({
    Internals: { NAME: 'HmBlind2', TYPE: 'CUL_HM', DEF: 'ABCDE3' },
    Attributes: { model: 'HM-LC-Bl1-FM', subType: 'blindActuator', genericDeviceType: 'light' },
    Readings: { state: '40', pct: '40' },
    PossibleSets: 'on off pct:slider,0,1,100 up down stop',
  }) );
  check( 'genericDeviceType light still wins', forced.service_name === 'light', forced.service_name );
}

section('homebridgeMapping still overrides everything');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Override', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Attributes: { homebridgeMapping: 'On=1.STATE,cmdOn=datapoint+1.STATE+true,cmdOff=datapoint+1.STATE+false' },
    Readings: { '3.STATE': 'false', '1.STATE': 'true' },
    PossibleSets: 'on off datapoint',
  }) );
  check( 'reading overridden', a.mappings.On.reading === '1.STATE', a.mappings.On.reading );
  check( 'cmdOn overridden', a.mappings.On.cmdOn === 'datapoint 1.STATE true', a.mappings.On.cmdOn );
}

section('genericDisplayType is used when genericDeviceType is absent');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Disp', TYPE: 'dummy', DEF: '' },
    Attributes: { genericDisplayType: 'switch' },
    Readings: { state: 'off' },
    PossibleSets: 'on off',
  }) );
  check( 'service taken from genericDisplayType', a.service_name === 'switch', a.service_name );
}
