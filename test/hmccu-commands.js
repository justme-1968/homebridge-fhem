// the exact 'set ...' string sent to fhem when homekit changes a value
var h = require('./helpers');
var device = h.device, accessoryFor = h.accessoryFor;
var section = h.section, check = h.check, command = h.command;

section('switch with set on/off');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Plug', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '3.STATE': 'false' }, PossibleSets: 'on:noArg off:noArg datapoint',
  }) );
  command( a, 'On', 1, 'set Plug on' );
  command( a, 'On', 0, 'set Plug off' );
}

section('switch without set on/off');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Plug2', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '3.STATE': 'false' }, PossibleSets: 'datapoint config',
  }) );
  command( a, 'On', 1, 'set Plug2 datapoint 3.STATE true' );
  command( a, 'On', 0, 'set Plug2 datapoint 3.STATE false' );
}

section('blind with set pct');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Roll', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.35' }, PossibleSets: 'pct:slider,0,1,100 up down stop datapoint',
  }) );
  command( a, 'TargetPosition', 50, 'set Roll pct 50' );
  command( a, 'TargetPosition', 0, 'set Roll pct 0' );
  command( a, 'TargetPosition', 100, 'set Roll pct 100' );
}

section('blind without set pct, LEVEL is a 0.0-1.0 datapoint');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Roll3', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.5' }, PossibleSets: 'datapoint config',
  }) );
  command( a, 'TargetPosition', 50, 'set Roll3 datapoint 4.LEVEL 0.5' );
  command( a, 'TargetPosition', 33, 'set Roll3 datapoint 4.LEVEL 0.33' );
  command( a, 'TargetPosition', 100, 'set Roll3 datapoint 4.LEVEL 1' );
}

section('venetian blind slats');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Slat', ccutype: 'HmIP-BBL', ccurole: 'BLIND_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '1.0', '4.LEVEL_2': '0.5' },
    PossibleSets: 'pct:slider,0,1,100 up down stop datapoint',
  }) );
  command( a, 'TargetPosition', 60, 'set Slat pct 60' );
  command( a, 'TargetHorizontalTiltAngle', -90, 'set Slat datapoint 4.LEVEL_2 0' );
  command( a, 'TargetHorizontalTiltAngle', 0, 'set Slat datapoint 4.LEVEL_2 0.5' );
  command( a, 'TargetHorizontalTiltAngle', 90, 'set Slat datapoint 4.LEVEL_2 1' );
}

section('dimmer');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Dim', ccutype: 'HmIP-BDT', ccurole: 'DIMMER_VIRTUAL_RECEIVER' },
    Readings: { '4.LEVEL': '0.6' }, PossibleSets: 'on off pct:slider,0,1,100 datapoint',
  }) );
  command( a, 'Brightness', 60, 'set Dim pct 60' );
  command( a, 'On', 1, 'set Dim on' );
  command( a, 'On', 0, 'set Dim off' );
}

section('thermostat');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Valve', ccutype: 'HmIP-eTRV-2', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
    Readings: { '1.SET_POINT_TEMPERATURE': '21.0', '1.ACTUAL_TEMPERATURE': '19.4',
                '1.LEVEL': '0.25', '1.SET_POINT_MODE': '0' },
    PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 auto manu boost on off datapoint',
  }) );
  command( a, 'TargetTemperature', 22, 'set Valve desired-temp 22' );
  command( a, 'TargetTemperature', 4.5, 'set Valve desired-temp 4.5' );
  command( a, 'TargetHeatingCoolingState', 3, 'set Valve auto' );
  command( a, 'TargetHeatingCoolingState', 1, 'set Valve manu' );
  command( a, 'TargetHeatingCoolingState', 0, 'set Valve off' );
}

section('thermostat without set desired-temp');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'Valve2', ccutype: 'HmIP-eTRV', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
    Readings: { '1.SET_POINT_TEMPERATURE': '18.0', '1.ACTUAL_TEMPERATURE': '17.0' },
    PossibleSets: 'datapoint config values',
  }) );
  command( a, 'TargetTemperature', 22, 'set Valve2 datapoint 1.SET_POINT_TEMPERATURE 22' );
}

section('CUL_HM devices still produce the same commands');
{
  var sw = accessoryFor( device({
    Internals: { NAME: 'HmSw', TYPE: 'CUL_HM', DEF: 'ABCDEF' },
    Attributes: { model: 'HM-LC-SW1-PL2', subType: 'switch' },
    Readings: { state: 'off' }, PossibleSets: 'on off toggle',
  }) );
  command( sw, 'On', 1, 'set HmSw on' );
  command( sw, 'On', 0, 'set HmSw off' );

  var th = accessoryFor( device({
    Internals: { NAME: 'HmTh', TYPE: 'CUL_HM', DEF: 'ABCDE1' },
    Attributes: { model: 'HM-CC-RT-DN', subType: 'thermostat' },
    Readings: { 'desired-temp': '20.0', 'measured-temp': '19.0' },
    PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 on off',
  }) );
  command( th, 'TargetTemperature', 21.5, 'set HmTh desired-temp 21.5' );

  var bl = accessoryFor( device({
    Internals: { NAME: 'HmBlind', TYPE: 'CUL_HM', DEF: 'ABCDE2' },
    Attributes: { model: 'HM-LC-Bl1-FM', subType: 'blindActuator' },
    Readings: { state: '40', pct: '40' }, PossibleSets: 'on off pct:slider,0,1,100 up down stop',
  }) );
  command( bl, 'TargetPosition', 70, 'set HmBlind pct 70' );
}

section('readOnly characteristics send nothing');
{
  var a = accessoryFor( device({
    Internals: { NAME: 'RO', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
    Readings: { '3.STATE': 'false' }, PossibleSets: 'on off datapoint',
  }) );
  a.mappings.On.readOnly = true;
  a.sent.length = 0;
  a.command( a.mappings.On, 1 );
  check( 'no command sent for a readOnly characteristic', a.sent.length === 0, a.sent );
}
