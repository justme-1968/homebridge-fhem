// index.js is a homebridge platform plugin and does not export its internals. it is loaded
// into a vm context instead, so the detection and mapping functions can be driven directly
// with the device structures fhem's jsonlist2 produces.
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function characteristic(format, constants) {
  var fn = function() { this.props = { format: format }; };
  for( var key in (constants || {}) )
    fn[key] = constants[key];
  return fn;
}

function characteristics() {
  return {
    On:                          characteristic('bool'),
    Brightness:                  characteristic('int'),
    CurrentPosition:             characteristic('uint8'),
    TargetPosition:              characteristic('uint8'),
    PositionState:               characteristic('uint8', { DECREASING: 0, INCREASING: 1, STOPPED: 2 }),
    CurrentHorizontalTiltAngle:  characteristic('int'),
    TargetHorizontalTiltAngle:   characteristic('int'),
    CurrentTemperature:          characteristic('float'),
    TargetTemperature:           characteristic('float'),
    CurrentRelativeHumidity:     characteristic('float'),
    CurrentHeatingCoolingState:  characteristic('uint8', { OFF: 0, HEAT: 1, COOL: 2 }),
    TargetHeatingCoolingState:   characteristic('uint8', { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 }),
    StatusLowBattery:            characteristic('uint8', { BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 }),
    BatteryLevel:                characteristic('uint8'),
    ContactSensorState:          characteristic('uint8', { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 }),
    CurrentDoorState:            characteristic('uint8', { OPEN: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, STOPPED: 4 }),
    MotionDetected:              characteristic('bool'),
    OccupancyDetected:           characteristic('uint8', { OCCUPANCY_NOT_DETECTED: 0, OCCUPANCY_DETECTED: 1 }),
    SmokeDetected:               characteristic('uint8', { SMOKE_NOT_DETECTED: 0, SMOKE_DETECTED: 1 }),
    LeakDetected:                characteristic('uint8', { LEAK_NOT_DETECTED: 0, LEAK_DETECTED: 1 }),
    CurrentAmbientLightLevel:    characteristic('float'),
    Name:                        characteristic('string'),
  };
}

var context;
function load() {
  if( context )
    return context;

  var src = fs.readFileSync( path.join(__dirname, '..', 'index.js'), 'utf8' );

  context = {
    console: console,
    require: function(m) { return m === './lib/version' ? '0.0.0-test' : require(m) },
    module: { exports: {} }, exports: {}, global: {},
    process: process, Buffer: Buffer,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
  };
  vm.createContext( context );
  vm.runInContext( src, context );

  context.Characteristic = characteristics();
  context.Accessory = { Categories: {} };

  return context;
}

// collects everything the accessory logs so tests can assert that nothing errored
var logged = [];
var log = Object.assign( function(m) { logged.push( String(m) ) }, {
  info:  function(m) { logged.push( 'INFO ' + m ) },
  warn:  function(m) { logged.push( 'WARN ' + m ) },
  error: function(m) { logged.push( 'ERROR ' + m ) },
  debug: function() {},
});

function errors() {
  return logged.filter( function(l) { return l.indexOf('ERROR') === 0 } );
}

function readings(values) {
  var r = {};
  for( var name in values )
    r[name] = { Value: String(values[name]), Time: '2026-08-16 12:00:00' };
  return r;
}

// a device as fhem would report it
function device(o) {
  var internals = { NAME: 'test', TYPE: 'HMCCUCHN', DEF: 'CCU 000ABC:4' };
  for( var key in (o.Internals || {}) )
    internals[key] = o.Internals[key];

  return {
    Internals: internals,
    Attributes: o.Attributes || {},
    Readings: readings( o.Readings || {} ),
    PossibleSets: o.PossibleSets || '',
    PossibleAttrs: o.PossibleAttrs || '',
  };
}

// run FHEM_hmccuMappings on its own, without the rest of the constructor
function mappingsFor(d, genericType) {
  logged.length = 0;
  var accessory = { log: log, mappings: {}, service_name: genericType };
  var handled = load().FHEM_hmccuMappings( accessory, d, genericType );
  return { handled: handled, accessory: accessory };
}

// run the whole FHEMAccessory constructor
function accessoryFor(d) {
  logged.length = 0;
  var accessory = new (load().FHEMAccessory)( { log: log, connection: {}, jsFunctions: {} }, d );
  accessory.sent = [];
  accessory.execute = function(cmd) { accessory.sent.push(cmd) };
  return accessory;
}

var checks = 0;
var failures = 0;

function section(title) {
  console.log( '\n' + title );
}

function check(name, condition, actual) {
  checks++;
  if( condition ) {
    console.log( '  ok   ' + name );
  } else {
    failures++;
    console.log( '  FAIL ' + name + (actual !== undefined ? '  -> ' + JSON.stringify(actual) : '') );
  }
}

// asserts the fhem command produced for a characteristic
function command(accessory, characteristic_type, value, expected) {
  accessory.sent.length = 0;
  accessory.command( accessory.mappings[characteristic_type], value );
  var got = accessory.sent[0];
  check( characteristic_type + '(' + value + ') -> ' + expected, got === expected, got );
}

function summary() {
  console.log( '\n' + checks + ' checks, ' + (failures ? failures + ' FAILED' : 'all passed') );
  return failures;
}

module.exports = { load, device, mappingsFor, accessoryFor, errors, section, check, command, summary };
