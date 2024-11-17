// FHEM Platform Plugin for HomeBridge
// current version on https://github.com/justme-1968/homebridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "FHEM",
//         "name": "FHEM",
//         "ssl": true,
//         "auth": {"user": "fhem", "pass": "fhempassword"},
//         "server": "127.0.0.1",
//         "port": 8083,
//         "webname": fhem,
//         "jsFunctions": "myFunctions",
//         "filter": "room=xyz"
//     }
// ],
'use strict';

var version = require('./lib/version');
//var FHEM = require('./lib/fhem').FHEM;

function getLine(offset) {
var stack = new Error().stack.split('\n'),
      line = stack[(offset || 1) + 1].split(':');
return parseInt(line[line.length - 2], 10);
}
global.__defineGetter__('__LINE__', function () {
return getLine(2);
});


var User;
var Accessory, Service, Characteristic, Units, Formats, Perms, UUIDGen, FakeGatoHistoryService;
module.exports = function(homebridge){
  console.log('homebridge API version: ' + homebridge.version);
  console.info( 'this is homebridge-fhem '+ version );

//console.log( homebridge );
//process.exit(0);
  User = homebridge.user;

  //Accessory = homebridge.platformAccessory;
  Accessory = homebridge.hap.Accessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  try {
    FakeGatoHistoryService = require('fakegato-history')(homebridge);
  } catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
      throw e;
    }

    console.log( 'error: fakegato-history not installed' );
  }

  homebridge.registerPlatform('homebridge-fhem', 'FHEM', FHEMPlatform);
}


var util = require('util');
var events = require('events');

// subscriptions to fhem longpoll events
var FHEM_subscriptions = {};
function
FHEM_subscribe(accessory, informId, characteristic, mapping) {
  if( !FHEM_subscriptions[informId] )
    FHEM_subscriptions[informId] = [];

  FHEM_subscriptions[informId].push( { accessory: accessory, characteristic: characteristic, mapping: mapping } );
}
function
FHEM_unsubscribe(accessory, informId, characteristic) {
  var subscriptions = FHEM_subscriptions[informId];
  if( subscriptions ) {
    for( var i = 0; i < subscriptions.length; ++i  ) {
      var subscription = subscriptions[i];
      if( subscription.accessory !== accessory )
        continue;

      if( subscription.characteristic !== characteristic )
        continue;

      delete subscriptions[i];
    }

    FHEM_subscriptions[informId] = subscriptions.filter( function(n){ return n !== undefined } );
    if( !FHEM_subscriptions[informId].length )
      delete FHEM_subscriptions[informId] ;
  }
}

function
FHEM_isPublished(device) {
  for( var inform_id in FHEM_subscriptions ) {
    for( var subscription of FHEM_subscriptions[inform_id] ) {
      var accessory = subscription.accessory;

      if( accessory.device === device )
        return accessory;
    }
  }

  return null;
}

var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds

// cached readings from longpoll & query
var FHEM_cached = {};
function
FHEM_update(informId, orig, no_update) {
  if( orig === undefined
      || FHEM_cached[informId] === orig )
     return;

  FHEM_cached[informId] = orig;
  //FHEM_cached[informId] = { orig: orig, timestamp: Date.now() };
  var date = new Date(Date.now()-tzoffset).toISOString().replace(/T/, ' ').replace(/\..+/, '');
  console.log('  ' + date + ' caching: ' + informId + ': ' + orig );

  var subscriptions = FHEM_subscriptions[informId];
  if( subscriptions )
    subscriptions.forEach( function(subscription) {
      var mapping = subscription.mapping;
      if( typeof mapping !== 'object' )
        return;

      mapping.last_update = parseInt( Date.now()/1000 );

      var value = FHEM_reading2homekit(mapping, orig);
      if( value === undefined )
        return;

      var accessory = subscription.accessory;
      if( accessory && accessory.historyService ) {
        var historyService = accessory.historyService;

        var extra_persist = {};
        if( historyService.isHistoryLoaded() ) {
          extra_persist = historyService.getExtraPersistedData();
        }
        historyService.extra_persist = extra_persist;

        if( mapping.name === 'Custom TimesOpened' )
          historyService.extra_persist.TimesOpened = value;

        else if( mapping.name === 'Custom LastActivation' )
          historyService.extra_persist.LastActivation = value;

        else {
          var entry = { time: mapping.last_update };
          if( mapping.characteristic_type === 'ContactSensorState' ) {
            entry.status = value;
            if( value === Characteristic.ContactSensorState.CONTACT_NOT_DETECTED ) {
              FHEM_update( mapping.device + '-EVE-TimesOpened', ++historyService.extra_persist.TimesOpened );
            }
            //var time = mapping.last_update - historyService.getInitialTime();
            //accessory.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'].characteristic.setValue(time, undefined, 'fromFHEM');

          } else if( mapping.characteristic_type === 'MotionDetected' )
            entry.status = value?1:0;

          else if( mapping.characteristic_type === 'CurrentTemperature'
                   || mapping.characteristic_type === 'TargetTemperature'
                   || mapping.characteristic_type === CustomUUIDs.Actuation ) {
            var current;
            if( accessory.mappings.CurrentTemperature )
              current = accessory.mappings.CurrentTemperature.cached;

            if( accessory.mappings.TargetTemperature ) {
              var target = accessory.mappings.TargetTemperature.cached;
              if( target !== undefined )
                entry.setTemp = target;
              if( current !== undefined )
                entry.currentTemp = current;
            } else
              if( current !== undefined )
                entry.temp = current;

            if( accessory.mappings[CustomUUIDs.Actuation] ) {
              var valve = accessory.mappings[CustomUUIDs.Actuation].cached;
              if( valve !== undefined )
                entry.valvePosition = valve;
            }

          } else if( mapping.characteristic_type === 'CurrentRelativeHumidity' )
            entry.humidity = value;

          else if( mapping.characteristic_type === 'AirQuality' )
            entry.ppm = value;

          else if( mapping.characteristic_type === CustomUUIDs.AirPressure )
            entry.pressure = value;

          else if( mapping.characteristic_type === CustomUUIDs.Power )
            entry.power = value;

          else
            entry = undefined;

          if( entry !== undefined ) {
            mapping.log.info( '      adding history entry '+ util.inspect(entry) );
            historyService.addEntry(entry);
          }
        }

      }

      if( !no_update && mapping.characteristic )
        mapping.characteristic.setValue(value, undefined, 'fromFHEM');
    } );
}

function
FHEM_reading2homekit(mapping, orig)
{
  var value = undefined;
  if( typeof mapping.reading2homekit === 'function' ) {

    try {
      value = mapping.reading2homekit(orig);
    } catch(err) {
      mapping.log.error( mapping.informId + ' reading2homekit: ' + err );
      return undefined;
    }

    if( typeof value === 'number' && isNaN(value) ) {
      mapping.log.error(mapping.informId + ' not a number: ' + orig);
      return undefined;
    }

  } else {
    value = FHEM_reading2homekit_(mapping, orig);

  }

  if( value === undefined ) {
    if( mapping.default !== undefined ) {
      orig = 'mapping.default';
      value = mapping.default;
    } else
      return undefined;

  }

  if( 0 && typeof value === 'string' ) { //FIXME: activate this ?
    if( Characteristic[mapping.characteristic_type] && Characteristic[mapping.characteristic_type][value] !== undefined ) {
      if( mapping.homekit2name === undefined ) mapping.homekit2name = {};
      mapping.homekit2name[Characteristic[mapping.characteristic_type][value]] = value;
      value = Characteristic[mapping.characteristic_type][value];
    }
  }

   var defined = undefined;
   if( mapping.homekit2name !== undefined ) {
     defined = mapping.homekit2name[value];
     if( defined === undefined )
       defined = '???';
   }

   mapping.log.info('    caching: ' + (mapping.name?mapping.name:mapping.characteristic_type) +': '
                                    + value + ' (' + 'as '+typeof(value) + (defined?'; means '+defined:'') + '; from \''+orig + '\')');
   mapping.cached = value;

  return value;
}

function
FHEM_reading2homekit_(mapping, orig)
{
  var value = orig;
  if( value === undefined )
    return undefined;
  var reading = mapping.reading;
  if( reading === undefined )
    return orig;

  if( reading == 'temperature'
      || reading == 'measured'
      || reading == 'measured-temp'
      || reading == 'desired-temp'
      || reading == 'desired'
      || reading == 'desiredTemperature' ) {
    if( typeof value === 'string' && value.toLowerCase() == 'on' )
      value = 31.0;
    else if( typeof value === 'string' && value.toLowerCase() == 'off' )
      value = 4.0;
    else
      value = parseFloat( value );

    if( mapping.minValue !== undefined && value < mapping.minValue )
      value = mapping.minValue;
    else if( mapping.maxValue !== undefined && value > mapping.maxValue )
      value = mapping.maxValue;

    if( mapping.minStep ) {
      if( mapping.minValue )
        value -= mapping.minValue;
      value = parseFloat( (Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1) );
      if( mapping.minValue )
        value += mapping.minValue;
    }

  } else if( reading == 'humidity' ) {
    value = parseInt( value );

  } else if( reading == 'onoff' ) {
    value = parseInt( value );

  } else if( reading == 'reachable' ) {
    value = parseInt( value ) == true;

  } else if( reading === 'state' && ( mapping.On
                                      && typeof mapping.values !== 'object'
                                      && mapping.reading2homekit === undefined
                                      && mapping.valueOn === undefined && mapping.valueOff === undefined ) ) {
    if( value.match(/^set-/ ) )
      return undefined;
    if( value.match(/^set_/ ) )
      return undefined;

    if( mapping.event_map !== undefined ) {
      var mapped = mapping.event_map[value];
      if( mapped !== undefined )
        value = mapped;
    }

    if( value.toLowerCase() == 'off' )
      value = 0;
    else if( value == '000000' )
      value = 0;
    else if( value.match( /^[A-D]0$/ ) )
      value = 0;
    else
      value = 1;

  } else {
    if( value.match(/^set-/ ) )
      return undefined;
    else if( value.match(/^set_/ ) )
      return undefined;

    var orig = value;

    var format = undefined;
    if( typeof mapping.characteristic === 'object' )
      format = mapping.characteristic.props.format;
    else if( typeof mapping.characteristic === 'function' ) {
      var characteristic = new (Function.prototype.bind.apply(mapping.characteristic, arguments));

      format = characteristic.props.format;

      //delete characteristic;
    } else if( mapping.format ) { // only for testing !
      format = mapping.format;

    }

    if( mapping.event_map !== undefined ) {
      var mapped = mapping.event_map[value];
      if( mapped !== undefined ) {
        mapping.log.debug(mapping.informId + ' eventMap: value ' + value + ' mapped to: ' + mapped);
        value = mapped;
      }
    }

    if( value !== undefined && mapping.part !== undefined ) {
      var mapped = value.split(' ')[mapping.part];

      if( mapped === undefined ) {
        mapping.log.error(mapping.informId + ' value ' + value + ' has no part ' + mapping.part);
        return value;
      }
      mapping.log.debug(mapping.informId + ' parts: using part ' + mapping.part + ' of: ' + value + ' results in: ' + mapped);
      value = mapped;
    }

    if( mapping.threshold ) {
    //if( !format.match( /bool/i ) && mapping.threshold ) {
      var mapped;
      if( parseFloat(value) > mapping.threshold )
        mapped = 1;
      else
        mapped = 0;
      mapping.log.debug(mapping.informId + ' threshold: value ' + value + ' mapped to ' + mapped);
      value = mapped;
    }

    if( typeof mapping.value2homekit_re === 'object' || typeof mapping.value2homekit === 'object' ) {
      var mapped = undefined;
      if( typeof mapping.value2homekit_re === 'object' )
        for( var entry of mapping.value2homekit_re ) {
          if( value && value.match( entry.re ) ) {
            mapped = entry.to;
            break;
          }
        }

      if( mapped === '#' )
        mapped = value;

      if( typeof mapping.value2homekit === 'object' )
        if( mapping.value2homekit[value] !== undefined )
          mapped = mapping.value2homekit[value];

      if( mapped === undefined )
        mapped = mapping.default;

      if( mapped === undefined ) {
        mapping.log.error(mapping.informId + ' value ' + value + ' not handled in values');
        return undefined;
      }

      mapping.log.debug(mapping.informId + ' values: value ' + value + ' mapped to ' + mapped);
      value = mapped;
    }

    if( format === undefined )
      return value;

//mapping.log.error( format );
    if( !format ) {
      mapping.log.error(mapping.informId + ' empty format' );
    } else if( format.match( /bool/i ) ) {
      var mapped = undefined;;
      if( mapping.valueOn !== undefined ) {
        var match = mapping.valueOn.match('^/(.*)/$');
        if( !match && value == mapping.valueOn )
          mapped = 1;
        else if( match && value.toString().match( match[1] ) )
          mapped = 1;
        else
          mapped = 0;
      }
      if( mapping.valueOff !== undefined ) {
        var match = mapping.valueOff.match('^/(.*)/$');
        if( !match && value == mapping.valueOff )
          mapped = 0;
        else if( match && value.toString().match( match[1] ) )
          mapped = 0;
        else if( mapped === undefined )
          mapped = 1;
      }
      if( mapping.valueOn === undefined  &&  mapping.valueOff === undefined ) {
        if( typeof value === 'string' && value.toLowerCase() == 'on' )
          mapped = 1;
        else if( typeof value === 'string' && value.toLowerCase() == 'off' )
          mapped = 0;
        else
          mapped = parseInt(value)?1:0;
      }
      if( mapped !== undefined ) {
        mapping.log.debug(mapping.informId + ' valueOn/valueOff: value ' + value + ' mapped to ' + mapped);
        value = mapped;
      }

      if( mapping.factor ) {
        mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

      if( mapping.invert ) {
        mapping.minValue = 0;
        mapping.maxValue = 1;
      }

    } else if( format.match( /float/i ) ) {
      var mapped = parseFloat( value );

      if( typeof mapped !== 'number' ) {
        mapping.log.error(mapping.informId + ' is not a number: ' + value);
        return undefined;
      }
      value = mapped;

      if( mapping.factor ) {
        mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

    } else if( format.match(/int/i) ) {
      var mapped = parseFloat( value );

      if( typeof mapped !== 'number' ) {
        mapping.log.error(mapping.informId + ' not a number: ' + value);
        return undefined;
      }
      value = mapped;

      if( mapping.factor ) {
        mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

      value = parseInt( value + 0.5 );
    } else if( format.match( /string/i ) ) {
    }


    if( mapping.max && mapping.maxValue ) {
      value = Math.round(value * mapping.maxValue / mapping.max );
      mapping.log.debug(mapping.informId + ' value ' + orig + ' scaled to: ' + value);
    }

    if( mapping.minValue !== undefined && value < mapping.minValue ) {
      mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to minValue: ' + mapping.minValue);
      value = mapping.minValue;
    } else if( mapping.maxValue !== undefined && value > mapping.maxValue ) {
      mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to maxValue: ' + mapping.maxValue);
      value = mapping.maxValue;
    }

    if( mapping.minStep ) {
      if( mapping.minValue )
        value -= mapping.minValue;
      value = parseFloat( (Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1) );
      if( mapping.minValue )
        value += mapping.minValue;
    }

    if( format && format.match(/int/i) )
      value = parseInt( value );
    else if( format && format.match(/float/i) )
      value = parseFloat( value );

    if( typeof value === 'number' ) {
      var mapped = value;
      if( isNaN(value) ) {
        mapping.log.error(mapping.informId + ' not a number: ' + orig);
        return undefined;
      } else if( mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined ) {
        mapped = mapping.maxValue - value + mapping.minValue;
      } else if( mapping.invert && mapping.maxValue !== undefined ) {
        mapped = mapping.maxValue - value;
      } else if( mapping.invert ) {
        mapped = 100 - value;
      }

      if( value !== mapped )
        mapping.log.debug(mapping.informId + ' value: ' + value + ' inverted to ' + mapped);
      value = mapped;
    }

    if( format && format.match( /bool/i ) )
      value = parseInt(value)?true:false;
  }

  return(value);
}


var FHEM_longpoll = {};
var FHEM_csrfToken = {};
//FIXME: add filter
function FHEM_startLongpoll(connection) {
  if( !FHEM_longpoll[connection.base_url] ) {
    FHEM_longpoll[connection.base_url] = {};
    FHEM_longpoll[connection.base_url].connects = 0;
    FHEM_longpoll[connection.base_url].disconnects = 0;
    FHEM_longpoll[connection.base_url].received_total = 0;
  }

  if( FHEM_longpoll[connection.base_url].connected )
    return;
  FHEM_longpoll[connection.base_url].connects++;
  FHEM_longpoll[connection.base_url].received = 0;
  FHEM_longpoll[connection.base_url].connected = true;


  var filter = '.*';
  var since = 'null';
  if( FHEM_longpoll[connection.base_url].last_event_time )
    since = FHEM_longpoll[connection.base_url].last_event_time/1000;
  var query = '?XHR=1'
              + '&inform=type=status;addglobal=1;filter='+filter+';since='+since+';fmt=JSON'
              + '&timestamp='+Date.now();

  var url = encodeURI( connection.base_url + query );
  console.log( 'starting longpoll: ' + url );

  var FHEM_longpollOffset = 0;
  var input = '';
  connection.request.get( { url: url } ).on( 'data', function(data) {
//console.log( 'data: ' + data );
               if( !data )
                 return;

               var length = data.length;
               FHEM_longpoll[connection.base_url].received += length;
               FHEM_longpoll[connection.base_url].received_total += length;

               input += data;

               try {
                 var lastEventTime = Date.now();
                 for(;;) {
                   var nOff = input.indexOf('\n', FHEM_longpollOffset);
                   if(nOff < 0)
                     break;
                   var l = input.substr(FHEM_longpollOffset, nOff-FHEM_longpollOffset);
                   FHEM_longpollOffset = nOff+1;
//console.log( 'Rcvd: ' + (l.length>132 ? l.substring(0,132)+'...('+l.length+')':l) );

                   if(!l.length)
                     continue;

                   var d;
                   if( l.substr(0,1) == '[' ) {
                     try {
                       d = JSON.parse(l);
                     } catch(err) {
                       console.log( '  longpoll JSON.parse: ' + err );
                       continue;
                     }
                   } else
                     d = l.split('<<', 3);
//console.log(d);

                   if(d.length != 3)
                     continue;
                   if(d[0].match(/-ts$/))
                     continue;
                   if(d[0].match(/^#FHEMWEB:/))
                     continue;

                   var match = d[0].match(/([^-]*)-(.*)/);
                   if( !match )
                     continue;
                   var device = match[1];
                   var reading = match[2];
//console.log( 'device: ' + device );
//console.log( 'reading: ' + reading );
                   if( reading === undefined )
                     continue;

                   var value = d[1];
//console.log( 'value: ' + value );
                   if( value.match( /^set-/ ) )
                     continue;


                   if( 0 && device == 'global' ) {
                     if( reading == 'DEFINED' ) {
console.log( 'DEFINED: ' + value );
console.log( connection.base_url );
                       FHEM_platforms.forEach( function(platform) {
platform.log( platform.connection.base_url );
                         if( connection.base_url == platform.connection.base_url ) {
platform.log( platform.filter );
                           platform.accessories( function(accessories) {
                                                   accessories.forEach( function(accessory) {
                                                     if( platform.addBridgedAccessory )
                                                       platform.addBridgedAccessory(accessory);

                                                   } );
                                                } );
                         }
                       } );

                     } else if( reading == 'DELETED' ) {
console.log( 'DELETED: ' + value );
                       var accessory = FHEM_isPublished(value);

                       //if( accessory && typeof accessory.updateReachability === 'function' )
                         //accessory.updateReachability( false );

                     } else if( reading == 'ATTR' ) {
console.log( 'ATTR: ' + value );
                       var values = value.split( ' ' );
                       var accessory = FHEM_isPublished(values[0]);

                       if( accessory && values[1] == 'disable' )
                         FHEM_update(values[0] + '-reachable', !values[2] );
                       else if( values[1] == 'genericDeviceType' || values[1] =='homebridgeMapping' ) {
console.log( connection.base_url );
                         FHEM_platforms.forEach( function(platform) {
platform.log( platform.connection.base_url );
                           if( connection.base_url == platform.connection.base_url ) {
platform.log( platform.filter );
                             platform.accessories( function(accessories) {
                                                     accessories.forEach( function(accessory) {
                                                       if( platform.addBridgedAccessory )
                                                         platform.addBridgedAccessory(accessory);

                                                     } );
                                                  } );
                           }
                         } );
                       }

                     } else if( reading == 'DELETEATTR' ) {
console.log( 'DELETEATTR: ' + value );
                       var values = value.split( ' ' );
                       var accessory = FHEM_isPublished(values[0]);

                       if( accessory && values[1] == 'disable' )
                         FHEM_update(values[0] + '-reachable', !values[2] );

                     }

                     continue;
                   }

                   var subscriptions = FHEM_subscriptions[d[0]];
                   if( subscriptions ) {
                     FHEM_update( d[0], value );
                     FHEM_longpoll[connection.base_url].last_event_time = lastEventTime;

                     subscriptions.forEach( function(subscription) {
                       var accessory = subscription.accessory;

                       if(accessory.mappings.colormode) {
                         if( reading == 'xy') {
                           var xy = value.split(',');
                           var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
                           var hsv = FHEM_rgb2hsv(rgb);

                           FHEM_update( device+'-h', hsv[0] );
                           FHEM_update( device+'-s', hsv[1] );
                           FHEM_update( device+'-v', hsv[2] );

                           FHEM_update( device+'-'+reading, value, false );

                           return;

                         } else if( reading == 'ct') {
                           var rgb = FHEM_ct2rgb(value);
                           var hsv = FHEM_rgb2hsv(rgb);

                           FHEM_update( device+'-h', hsv[0] );
                           FHEM_update( device+'-s', hsv[1] );
                           FHEM_update( device+'-v', hsv[2] );

                           FHEM_update( device+'-'+reading, value, false );

                           return;
                         }

                       }
                     } );

                   }
                 }

             } catch(err) {
               connection.log.error( '  error in longpoll connection: ' + err );

             }

             input = input.substr(FHEM_longpollOffset);
             FHEM_longpollOffset = 0;

	     if( FHEM_csrfToken[connection.base_url] )
               FHEM_longpoll[connection.base_url].disconnects = 0;

           } ).on( 'response', function(response) {
             if( response.headers && response.headers['x-fhem-csrftoken'] )
               FHEM_csrfToken[connection.base_url] = response.headers['x-fhem-csrftoken'];
             else
               FHEM_csrfToken[connection.base_url] = '';

             connection.fhem.checkAndSetGenericDeviceType();

           } ).on( 'end', function() {
             FHEM_longpoll[connection.base_url].connected = false;

             FHEM_longpoll[connection.base_url].disconnects++;
             var timeout = 500 * FHEM_longpoll[connection.base_url].disconnects - 300;
             if( timeout > 30000 ) timeout = 30000;

             connection.log.error( 'longpoll ended, reconnect in: ' + timeout + 'msec' );
             setTimeout( function(){FHEM_startLongpoll(connection)}, timeout  );

           } ).on( 'error', function(err) {
             FHEM_longpoll[connection.base_url].connected = false;

             FHEM_longpoll[connection.base_url].disconnects++;
             var timeout = 3000 * FHEM_longpoll[connection.base_url].disconnects;
             if( timeout > 30000 ) timeout = 30000;

             if( !connection.neverTimeout && timeout > 10000 && !FHEM_csrfToken[connection.base_url] ) {
               connection.log.error( 'longpoll error: ' + err + ', retrys exhausted' );
	       connection.dead = true;
	       return;
             }

             connection.log.error( 'longpoll error: ' + err + ', retry in: ' + timeout + 'msec' );
             setTimeout( function(){FHEM_startLongpoll(connection)}, timeout );

           } );
}

var FHEM_platforms = [];

function
FHEMPlatform(log, config, api) {
  events.EventEmitter.call(this);

  Units = api.hap.Units;
  Formats = api.hap.Formats;
  Perms = api.hap.Perms;

  this.log         = log;
  this.config      = config;

  if( api ) {
    this.api         = api;

    //this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));

    this.api.on('shutdown', this.shutdown.bind(this));
  }

  //this.server      = config['server'] || '127.0.0.1';
  this.server      = config['server'];
  this.port        = config['port'] || 8083;
  this.filter      = config['filter'];
  this.jsFunctions = config['jsFunctions'];

  this.scope        = config['scope'];

  if( this.server === undefined ) {
    log.error( 'incomplete configuration ' );
    return;
  }

  if( this.jsFunctions !== undefined ) {
    try {
      var path = this.jsFunctions;
      if( path.substr(0,1) != '/' )
        path = User.storagePath()+'/'+this.jsFunctions;
      this.jsFunctions = require(path);
    } catch(err) {
      log.error( '  jsFunctions: ' + err );
      delete this.jsFunctions;
    }
  }

  var base_url = 'http://';
  if( config.ssl ) {
    if( typeof config.ssl !== 'boolean' ) {
      this.log.error( 'config: value for ssl has to be boolean.' );
      process.exit(0);
    }
    base_url = 'https://';
  }
  base_url += this.server + ':' + this.port;

  if( config.webname ) {
    base_url += '/'+config.webname;
  } else {
    base_url += '/fhem';
  }

  var request = require('postman-request');
  var auth = config['auth'];
  if( auth ) {
    if( auth.sendImmediately === undefined )
      auth.sendImmediately = false;

    request = request.defaults( { auth: auth, rejectUnauthorized: false } );
  }

  this.connection = { base_url: base_url, request: request, log: log, fhem: this, neverTimeout: config['neverTimeout'] };

  FHEM_platforms.push(this);

  FHEM_startLongpoll( this.connection );
}
util.inherits(FHEMPlatform, events.EventEmitter);

function
FHEM_sortByKey(array, key) {
  return array.sort( function(a, b) {
    var x = a[key]; var y = b[key];
    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

function
FHEM_rgb2hex(r,g,b) {
  if( g === undefined )
    return Number(0x1000000 + r[0]*0x10000 + r[1]*0x100 + r[2]).toString(16).substring(1);

  return Number(0x1000000 + r*0x10000 + g*0x100 + b).toString(16).substring(1);
}

function
FHEM_hsv2rgb(h,s,v) {
  var r = 0.0;
  var g = 0.0;
  var b = 0.0;

  if( s == 0 ) {
    r = v;
    g = v;
    b = v;

  } else {
    var i = Math.floor( h * 6.0 );
    var f = ( h * 6.0 ) - i;
    var p = v * ( 1.0 - s );
    var q = v * ( 1.0 - s * f );
    var t = v * ( 1.0 - s * ( 1.0 - f ) );
    i = i % 6;

    if( i == 0 ) {
      r = v;
      g = t;
      b = p;
    } else if( i == 1 ) {
      r = q;
      g = v;
      b = p;
    } else if( i == 2 ) {
      r = p;
      g = v;
      b = t;
    } else if( i == 3 ) {
      r = p;
      g = q;
      b = v;
    } else if( i == 4 ) {
      r = t;
      g = p;
      b = v;
    } else if( i == 5 ) {
      r = v;
      g = p;
      b = q;
    }
  }

  return FHEM_rgb2hex( Math.round(r*255),Math.round(g*255),Math.round(b*255) );
}
function
FHEM_ct2rgb(ct) {
  // calculation from http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code

  // kelvin -> mired
  if( ct > 1000 )
    ct = 1000000/ct;

  // adjusted by 1000K
  var temp = (1000000/ct)/100 + 10;

  var r = 0;
  var g = 0;
  var b = 0;

  r = 255;
  if( temp > 66 )
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
  if( r < 0 )
    r = 0;
  if( r > 255 )
    r = 255;

  if( temp <= 66 )
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  else
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
  if( g < 0 )
    g = 0;
  if( g > 255 );
    g = 255;

  b = 255;
  if( temp <= 19 )
    b = 0;
  if( temp < 66 )
    b = 138.5177312231 * log(temp-10) - 305.0447927307;
  if( b < 0 )
    b = 0;
  if( b > 255 )
    b = 255;

  return FHEM_rgb2hex( Math.round(r),Math.round(g),Math.round(b) );
}

function
FHEM_xyY2rgb(x,y,Y) {
  // calculation from http://www.brucelindbloom.com/index.html

  var r = 0;
  var g = 0;
  var b = 0;

  if( y > 0 ) {
    var X = x * Y / y;
    var Z = (1 - x - y)*Y / y;

    if( X > 1
        || Y > 1
        || Z > 1 ) {
      var f = Math.max(X,Y,Z);
      X /= f;
      Y /= f;
      Z /= f;
    }

    r =  0.7982 * X + 0.3389 * Y - 0.1371 * Z;
    g = -0.5918 * X + 1.5512 * Y + 0.0406 * Z;
    b =  0.0008 * X + 0.0239 * Y + 0.9753 * Z;

    if( r > 1
        || g > 1
        || b > 1 ) {
      var f = Math.max(r,g,b);
      r /= f;
      g /= f;
      b /= f;
    }

  }

  return FHEM_rgb2hex( Math.round(r*255),Math.round(g*255),Math.round(b*255) );
}


function
FHEM_rgb2hsv(r,g,b) {
  if( r === undefined )
    return;

  if( g === undefined ) {
    var str = r;
    r = parseInt( str.substr(0,2), 16 );
    g = parseInt( str.substr(2,2), 16 );
    b = parseInt( str.substr(4,2), 16 );

    r /= 255;
    g /= 255;
    b /= 255;
  }

  var M = Math.max( r, g, b );
  var m = Math.min( r, g, b );
  var c = M - m;

  var h, s, v;
  if( c == 0 ) {
    h = 0;
  } else if( M == r ) {
    h = ( ( 360 + 60 * ( ( g - b ) / c ) ) % 360 ) / 360;
  } else if( M == g ) {
    h = ( 60 * ( ( b - r ) / c ) + 120 ) / 360;
  } else if( M == b ) {
    h = ( 60 * ( ( r - g ) / c ) + 240 ) / 360;
  }

  if( M == 0 ) {
    s = 0;
  } else {
    s = c / M;
  }

  v = M;

  return  [h,s,v];
}

function
FHEM_execute(log,connection,cmd,callback) {
  if( FHEM_csrfToken[connection.base_url] )
    cmd += '&fwcsrf='+FHEM_csrfToken[connection.base_url];
  cmd += '&XHR=1';
  var url = encodeURI( connection.base_url + '?cmd=' + cmd );
  log.info( '  executing: ' + url );

  connection.request
              .get( { url: url, gzip: true },
               function(err, response, result) {
                      if( !err && response.statusCode == 200 ) {
                        result = result.replace(/[\r\n]/g, '');
                        if( callback )
                          callback( result );

                      } else {
                        log('There was a problem connecting to FHEM ('+ url +').');
                        if( response )
                          log( '  ' + response.statusCode + ': ' + response.statusMessage );

                      }

                    } )
              .on( 'error', function(err) { log('There was a problem connecting to FHEM ('+ url +'):'+ err); } );
}

FHEMPlatform.prototype = {
  didFinishLaunching: function() { this.log.error('didFinishLaunching')
  },

  shutdown: function() { //this.log.error('shutdown')
    for( var informId in FHEM_subscriptions ) {
      for( var subscription of FHEM_subscriptions[informId] ) {
        var accessory = subscription.accessory;
        if( accessory.shutdown ) continue;

        if( accessory.historyService )
          accessory.historyService.save();

        accessory.shutdown = true;
      }
    }
  },

  execute: function(cmd,callback) {FHEM_execute(this.log, this.connection, cmd, callback)},

  checkAndSetGenericDeviceType: function() {
    this.log('Checking devices and attributes...');

    var cmd = '{AttrVal("global","userattr","")}';
    this.execute( cmd,
                  function(result) {
                    //if( result === undefined )
                      //result = '';

                    if( !result.match(/(^| )homebridgeMapping\b/) ) {
                      var cmd = '{ addToAttrList( "homebridgeMapping:textField-long" ) }';
                      this.execute( cmd );
                      this.log.info( 'homebridgeMapping attribute created.' );
                    }

                    if( !result.match(/(^| )genericDeviceType\b/) ) {
                      var cmd = '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock" ) }';
                      this.execute( cmd,
                                    function(result) {
                                        this.log.warn( 'genericDeviceType attribute was not known. please restart.' );
					if( FHEM_csrfToken[this.connection.base_url] )
                                          process.exit(0);
                                    }.bind(this) );
                    }

                  }.bind(this) );

    if( !this.siri_device );
      this.execute( 'jsonlist2 TYPE=siri',
                    function(result) {
                      try {
                        var d = JSON.parse( result );
                        if( d.totalResultsReturned === 1 ) {
                          this.siri_device = d.Results[0].Name;
                          this.log.info( 'siri device is ' + this.siri_device );
                          this.execute( '{$defs{'+ this.siri_device +'}->{"homebridge-fhem version"} = "'+ version +'"}' );
                        } else
                          this.log.warn( 'no siri device found. please define it.' );

                      } catch(err) {
                        this.log.error( 'failed to parse ' + result );
                      }
                    }.bind(this) );
  },

  accessories: function(callback) {
    var foundAccessories = [];

    //this.checkAndSetGenericDeviceType();
    if( !this.connection ) {
      callback(foundAccessories);
      return;
    }

    // mechanism to ensure callback is only executed once all requests complete
    var asyncCalls = 0;
    function callbackLater() { if (--asyncCalls == 0) callback(foundAccessories); }

    if( FHEM_csrfToken[this.connection.base_url] === undefined ) {
      if( this.connection.dead ) {
        callback(foundAccessories);
	return;
      }

      var timeout = 500;
      if( FHEM_longpoll[this.connection.base_url].disconnects )
        timeout = FHEM_longpoll[this.connection.base_url].disconnects * 1000;
      this.log.debug('FHEM csrfToken missing, retry in: ' + timeout + 'msec');
      setTimeout( function(){this.connection.fhem.accessories(callback)}.bind(this), timeout  );
      return;
    }

    this.log.info('Fetching FHEM devices...');

    var cmd = 'jsonlist2';
    if( this.filter )
      cmd += '%20' + encodeURIComponent(this.filter);
    if( FHEM_csrfToken[this.connection.base_url] )
      cmd += '&fwcsrf='+FHEM_csrfToken[this.connection.base_url];
    var url = this.connection.base_url + '?cmd=' + cmd + '&XHR=1';
    this.log.info( 'fetching: ' + url );

    asyncCalls++;

    this.connection.request.get( { url: url, json: true, gzip: true },
                 function(err, response, json) {
                   if( !err && response.statusCode == 200 && json ) {
//console.log("got json: " + util.inspect(json) );
                     this.log.info( 'got: ' + json['totalResultsReturned'] + ' results' );
                     if( json['totalResultsReturned'] ) {
                       var sArray=FHEM_sortByKey(json['Results'],'Name');
                       sArray.map( function(s) {

                         //FIXME: change to factory pattern
                         var accessory = new FHEMAccessory(this, s);
                         if( accessory && accessory.service_name ) {
                           accessory.fhem = this.connection.fhem;

                           if( !accessory.isInScope('siri') ) {
                             this.log.info( 'ignoring '+ accessory.name +' for siri' );
                             return;
                           }

                           foundAccessories.push(accessory);
                         } else {
                           this.log.info( 'no accessory created for ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')' );
                           return undefined;
                         }

                       }.bind(this) );
                     }

                     callback(foundAccessories);
                     //callbackLater();

                   } else {
                     this.log.error('There was a problem connecting to FHEM');
                     if( response )
                       this.log.error( '  ' + response.statusCode + ': ' + response.statusMessage );

                   }

                 }.bind(this) );
  }
}

var CustomUUIDs = {
                  //  F H E M       h o  m e  b r i d g e
            xVolume: '4648454d-0101-686F-6D65-627269646765',
        //Actuation: '4648454d-0201-686F-6D65-627269646765',
   //ColorTemperature: '4648454d-0301-686F-6D65-627269646765',

                 // see: https://github.com/ebaauw/homebridge-hue/wiki/Characteristics
                 CT: 'E887EF67-509A-552D-A138-3DA215050F46',
   //ColorTemperature: 'A18E5901-CFA1-4D37-A10F-0071CEEEEEBD',

             Volume: '00001001-0000-1000-8000-135D67EC4377', // used in YamahaAVRPlatform, recognized by EVE

                  // see: https://gist.github.com/gomfunkel/b1a046d729757120907c
            Voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
            Current: 'E863F126-079E-48FF-8F27-9C2605A29F52',
              Power: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
             Energy: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
        AirPressure: 'E863F10F-079E-48FF-8F27-9C2605A29F52',
          Actuation: 'E863F12E-079E-48FF-8F27-9C2605A29F52',
};

function
FHEMAccessory(platform, s) {
  this.log         = platform.log;
  this.connection  = platform.connection;
  this.jsFunctions = platform.jsFunctions;

  if( FHEM_isPublished(s.Internals.NAME) ) {
    this.log.warn( s.Internals.NAME + ' is already published');
    return;
  }

  if( !s.Readings ) {
    this.log.error( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without readings' );
    return;
  }
  if( !s.Attributes ) {
    this.log.error( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without attributes' );
    return;
  }


  if( s.Attributes.disable == 1 ) {
    this.log.info( s.Internals.NAME + ' is disabled');
    //return;
  }

  var genericType = s.Attributes.genericDeviceType;
  if( !genericType === undefined )
    genericType = s.Attributes.genericDisplayType;

  if( genericType === 'ignore' ) {
    this.log.info( 'ignoring ' + s.Internals.NAME );
    return;
  }

  this.service_name = genericType;

  if( s.Internals.TYPE === 'structure' && genericType === undefined ) {
    this.log.info( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType' );
    return;
  }
  if( s.Internals.TYPE === 'SVG' && genericType === undefined ) {
    this.log.info( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType' );
    return;
  }
  if( s.Internals.TYPE === 'THRESHOLD' && genericType === undefined ) {
    this.log.info( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType' );
    return;
  }

  this.mappings = {};

  //this.service_name = 'switch';

  var match;
  if( match = s.PossibleSets.match(/(^| )dim:slider,0,1,99/) ) {
    // ZWave dimmer
    if( !this.service_name ) this.service_name = 'light';
    this.mappings.On = { reading: 'state', valueOff: '/^(dim )?0$/', cmdOn: 'on', cmdOff: 'off' };
    this.mappings.Brightness = { reading: 'state', cmd: 'dim', delay: true };

    this.mappings.Brightness.reading2homekit = function(mapping, orig) {
      var match;
      if( match = orig.match(/dim (\d+)/ ) )
        return parseInt( match[1] );

      return 0;
    }.bind(null, this.mappings.Brightness);

  } else if( match = s.PossibleSets.match(/(^| )bri(:[^\b\s]*(,(\d+))+)?\b/) ) {
    // Hue
    if( !this.service_name ) this.service_name = 'light';
    this.log.debug( 'detected HUEDevice' );
    var max = 100;
    if( match[4] !== undefined )
      max = match[4];
    this.mappings.On = { reading: 'onoff', valueOff: '0', cmdOn: 'on', cmdOff: 'off' };
    //FIXME: max & maxValue are not set. they would work in both directions. but we use pct for the set cmd. not bri!
    this.mappings.Brightness = { reading: 'bri', cmd: 'pct', delay: true };

    this.mappings.Brightness.reading2homekit = function(mapping, orig) {
      return Math.round(orig  / 2.54);
    }.bind(null, this.mappings.Brightness);


  } else if( match = s.PossibleSets.match(/(^| )pct\b/) ) {
    // HM dimmer
    if( !this.service_name ) this.service_name = 'light';
    this.mappings.On = { reading: 'pct', valueOff: '0', cmdOn: 'on', cmdOff: 'off' };
    this.mappings.Brightness = { reading: 'pct', cmd: 'pct', delay: true };

  } else if( match = s.PossibleSets.match(/(^| )dim\d+%/) ) {
    // FS20 dimmer
    if( !this.service_name ) this.service_name = 'light';
    this.mappings.On = { reading: 'state', valueOff: 'off', cmdOn: 'on', cmdOff: 'off' };
    this.mappings.Brightness = { reading: 'state', cmd: ' ', delay: true };

    this.mappings.Brightness.reading2homekit = function(mapping, orig) {
      var match;
      if( orig.toLowerCase() == 'off' )
        return 0;
      else if( match = orig.match(/dim(\d+)%?/ ) )
        return parseInt( match[1] );

      return 100;
    }.bind(null, this.mappings.Brightness);

    this.mappings.Brightness.homekit2reading = function(mapping, orig) {
      var dim_values = [ 'dim06%', 'dim12%', 'dim18%', 'dim25%', 'dim31%', 'dim37%', 'dim43%', 'dim50%',
                         'dim56%', 'dim62%', 'dim68%', 'dim75%', 'dim81%', 'dim87%', 'dim93%', 'dim100%' ];
      //if( value < 3 )
      //  value = 'off';
      //else
      if( orig > 97 )
        return 'dim100%';

      return dim_values[Math.round(orig/6.25)];
    }.bind(null, this.mappings.Brightness);

  }

  if( match = s.PossibleSets.match(/(^| )hue(:[^\b\s]*(,(\d+))+)?\b/) ) {
    if( !this.service_name ) this.service_name = 'light';
    var max = 359;
    if( match[4] !== undefined )
      max = match[4];
    this.mappings.Hue = { reading: 'hue', cmd: 'hue', max: max, maxValue: 359 };
  }

  if( match = s.PossibleSets.match(/(^| )sat(:[^\b\s]*(,(\d+))+)?\b/) ) {
    if( !this.service_name ) this.service_name = 'light';
    var max = 100;
    if( match[4] !== undefined )
      max = match[4];
    this.mappings.Saturation = { reading: 'sat', cmd: 'sat', max: max, maxValue: 100 };
  }

  /*if( match = s.PossibleSets.match(/(^| )ct(:[^\d]*([^\$ ]*))?/) ) {
    if( !this.service_name ) this.service_name = 'light';
    var minValue = 2000;
    var maxValue = 6500;
    if( match[3] ) {
      var values = match[3].split(',');
      minValue = parseInt(1000000/values[2]);
      maxValue = parseInt(1000000/values[0]);
    }
    this.mappings[ColorTemperature] = { reading: 'ct', cmd: 'ct', delay: true,
                                        name: 'Color Temperature', format: 'INT', unit: 'K',
                                        minValue: maxValue,  maxValue: minValue, minStep: 10 };
    var reading2homekit = function(mapping, orig) { return parseInt(1000000 / parseInt(orig)) };
    var homekit2reading = function(mapping, orig) { return parseInt(1000000 / orig) };
    this.mappings[ColorTemperature].reading2homekit = reading2homekit.bind(null, this.mappings.color);
    this.mappings[ColorTemperature].reading2homekit = reading2homekit.bind(null, this.mappings.color);

  } else if( match = s.PossibleSets.match(/(^| )color(:[^\d]*([^\$ ]*))?/) ) {
    if( !this.service_name ) this.service_name = 'light';
    var minValue = 2000;
    var maxValue = 6500;
    if( match[3] ) {
      var values = match[3].split(',');
      minValue = parseInt(values[0]);
      maxValue = parseInt(values[2]);
    }
    this.mappings[ColorTemperature] = { reading: 'color', cmd: 'color', delay: true,
                                        name: 'Color Temperature', format: 'INT', unit: 'K',
                                        minValue: minValue,  maxValue: maxValue, minStep: 10 };
  }*/


  if( s.Internals.TYPE == 'MilightDevice' && s.PossibleSets.match(/(^| )dim\b/) )  {
    // MilightDevice
    if( !this.service_name ) this.service_name = 'light';
    this.log.debug( 'detected MilightDevice' );
    this.mappings.Brightness = { reading: 'brightness', cmd: 'dim', max: 100, maxValue: 100, delay: true };
    if( s.PossibleSets.match(/(^| )hue\b/) && s.PossibleSets.match(/(^| )saturation\b/) )  {
      this.mappings.Hue = { reading: 'hue', cmd: 'hue', max: 359, maxValue: 359 };
      this.mappings.Saturation = { reading: 'saturation', cmd: 'saturation', max: 100, maxValue: 100 };
    }

  } else if( s.Internals.TYPE == 'WifiLight' && s.PossibleSets.match(/(^| )HSV\b/)
             && s.Readings.hue !== undefined && s.Readings.saturation !== undefined && s.Readings.brightness !== undefined ) {
    // WifiLight
    if( !this.service_name ) this.service_name = 'light';
    this.log.debug( 'detected WifiLight' );
    this.mappings.Hue = { reading: 'hue', cmd: 'HSV', max: 359, maxValue: 359 };
    this.mappings.Saturation = { reading: 'saturation', cmd: 'HSV', max: 100, maxValue: 100 };
    this.mappings.Brightness = { reading: 'brightness', cmd: 'HSV', max: 100, maxValue: 100, delay: true };

    var homekit2reading = function(mapping, orig) {
      var h = FHEM_cached[mapping.device + '-hue'];
      var s = FHEM_cached[mapping.device + '-saturation'];
      var v = FHEM_cached[mapping.device + '-brightness'];
      //mapping.log( ' from cached : [' + h + ',' + s + ',' + v + ']' );

      if( h === undefined ) h = 0;
      if( s === undefined ) s = 100;
      if( v === undefined ) v = 100;
      //mapping.log( ' old : [' + h + ',' + s + ',' + v + ']' );

      if( mapping.characteristic_type == 'Hue' ) {
        h = orig;

        //if( FHEM_cached[mapping.device + '-hue'] === orig ) return undefined;
        FHEM_cached[mapping.device + '-hue'] = orig;

      } else if( mapping.characteristic_type == 'Saturation' ) {
        s = orig;

        //if( FHEM_cached[mapping.device + '-saturation'] === orig ) return undefined;
        FHEM_cached[mapping.device + '-saturation'] = orig;

      } else if( mapping.characteristic_type == 'Brightness' ) {
        v = orig;

        //if( FHEM_cached[mapping.device + '-brightness'] === orig ) return undefined;
        FHEM_cached[mapping.device + '-brightness'] = orig;

      }
      //mapping.log( ' new : [' + h + ',' + s + ',' + v + ']' );

      return h + ',' + s + ',' + v;
    }

    this.mappings.Hue.homekit2reading = homekit2reading.bind(null, this.mappings.Hue);
    this.mappings.Saturation.homekit2reading = homekit2reading.bind(null, this.mappings.Saturation);
    this.mappings.Brightness.homekit2reading = homekit2reading.bind(null, this.mappings.Brightness);

  }

  if( !this.mappings.Hue || s.Internals.TYPE == 'SWAP_0000002200000003' ) {
    // rgb/RGB
    var reading = undefined;
    var cmd = undefined;
    if( s.PossibleSets.match(/(^| )rgb\b/) ) {
      if( !this.service_name ) this.service_name = 'light';
      reading = 'rgb'; cmd = 'rgb';
      if( s.Internals.TYPE == 'SWAP_0000002200000003' )
        reading = '0B-RGBlevel';
    } else if( s.PossibleSets.match(/(^| )RGB\b/) ) {
      if( !this.service_name ) this.service_name = 'light';
      reading = 'RGB'; cmd = 'RGB';
    }

    if( reading && cmd ) {
      this.mappings.Hue = { reading: reading, cmd: cmd, max: 359, maxValue: 359 };
      this.mappings.Saturation = { reading: reading, cmd: cmd, max: 100, maxValue: 100 };
      this.mappings.Brightness = { reading: reading, cmd: cmd, max: 100, maxValue: 100,  delay: true };

      var homekit2reading = function(mapping, orig) {
        var h = FHEM_cached[mapping.device + '-h'];
        var s = FHEM_cached[mapping.device + '-s'];
        var v = FHEM_cached[mapping.device + '-v'];
        //mapping.log( ' from cached : [' + h + ',' + s + ',' + v + ']' );

        if( h === undefined ) h = 0.0;
        if( s === undefined ) s = 1.0;
        if( v === undefined ) v = 1.0;
        //mapping.log( ' old : [' + h + ',' + s + ',' + v + ']' );

        if( mapping.characteristic_type === 'Hue' ) {
          h = orig / 360.0;
          FHEM_cached[mapping.device + '-h'] = h;

        } else if( mapping.characteristic_type === 'Saturation' ) {
          s = orig / 100.0;
          FHEM_cached[mapping.device + '-s'] = s;

        } else if( mapping.characteristic_type === 'Brightness' ) {
          v = orig / 100.0;
          FHEM_cached[mapping.device + '-v'] = v;

        }
        //mapping.log( ' new : [' + h + ',' + s + ',' + v + ']' );

        var value = FHEM_hsv2rgb( h, s, v );
        if( value === FHEM_cached[mapping.informId] )
          return undefined;

        FHEM_update(mapping.informId, value, true);
        //mapping.log( ' rgb : [' + value + ']' );

        return value;
      }

      if( this.mappings.Hue ) {
        this.mappings.Hue.reading2homekit = function(mapping, orig) {
          var hsv = FHEM_rgb2hsv(orig);
          var hue = parseInt( hsv[0] * mapping.maxValue );

          FHEM_cached[mapping.device + '-h'] = hsv[0];

          return hue;
        }.bind(null, this.mappings.Hue);
        this.mappings.Hue.homekit2reading = homekit2reading.bind(null, this.mappings.Hue);
      }
      if( this.mappings.Saturation ) {
        this.mappings.Saturation.reading2homekit = function(mapping, orig) {
          var hsv = FHEM_rgb2hsv(orig);
          var sat = parseInt( hsv[1] * mapping.maxValue );

          FHEM_cached[mapping.device + '-s'] = hsv[1];

          return sat;
        }.bind(null, this.mappings.Saturation);
        this.mappings.Saturation.homekit2reading = homekit2reading.bind(null, this.mappings.Saturation);
      }
      if( this.mappings.Brightness ) {
        this.mappings.Brightness.reading2homekit = function(mapping, orig) {
          var hsv = FHEM_rgb2hsv(orig);
          var bri = parseInt( hsv[2] * mapping.maxValue );

          FHEM_cached[mapping.device + '-v'] = hsv[2];

          return bri;
        }.bind(null, this.mappings.Brightness);
        this.mappings.Brightness.homekit2reading = homekit2reading.bind(null, this.mappings.Brightness);
      }
    }
  }

  if( s.Readings.colormode )
    this.mappings.colormode = { reading: 'colormode' };
  if( s.Readings.xy )
    this.mappings.xy = { reading: 'xy' };
  //if( s.Readings.ct && !this.mappings[ColorTemperature] )
  //  this.mappings.ct = { reading: 'ct', cmd: 'ct' };

  if( s.Readings.volume ) {
    this.mappings[CustomUUIDs.Volume] = { reading: 'volume', cmd: 'volume', delay: true,
                                          name: 'Volume', format: 'UINT8', unit: 'PERCENTAGE',
                                          minValue: 0, maxValue: 100, minStep: 1  };

  } else if( s.Readings.Volume ) {
    this.mappings[CustomUUIDs.Volume] = { reading: 'Volume', cmd: 'Volume', delay: true, nocache: true,
                                          name: 'Volume', format: 'UINT8', unit: 'PERCENTAGE',
                                          minValue: 0, maxValue: 100, minStep: 1  };
    if( s.Attributes.generateVolumeEvent == 1 )
      delete this.mappings[CustomUUIDs.Volume].nocache;

  }

  if( s.Readings.voltage )
    this.mappings[CustomUUIDs.Voltage] = { name: 'Voltage', reading: 'voltage', format: 'FLOAT', factor: 1 };

  if( s.Readings.current ) {
    this.mappings[CustomUUIDs.Current] = { name: 'Current', reading: 'current', format: 'FLOAT', factor: 1 };
    if( s.Attributes.model && (s.Attributes.model.toUpperCase() === 'HM-ES-PMSW1-PL' || s.Attributes.model.toUpperCase() === 'HM-ES-PMSW1-PL-DN-R1') )
      this.mappings[CustomUUIDs.Current].factor = 0.001;
  }

  if( s.Readings.power )
    this.mappings[CustomUUIDs.Power] = { name: 'Power', reading: 'power', format: 'FLOAT', factor: 1 };

  if( s.Readings.energy ) {
    this.mappings[CustomUUIDs.Energy] = { name: 'Energy', reading: 'energy', format: 'FLOAT', factor: 1 };
    if( s.Attributes.model && (s.Attributes.model.toUpperCase() === 'HM-ES-PMSW1-PL' || s.Attributes.model.toUpperCase() === 'HM-ES-PMSW1-PL-DN-R1') )
      this.mappings[CustomUUIDs.Energy].factor = 0.001;
    else if( s.Readings.energy.Value.match( / Wh/ ) )
      this.mappings[CustomUUIDs.Energy].factor = 0.001;
  }

  if( s.Attributes.model && s.Attributes.model.toUpperCase() == 'HM-SEN-LI-O' ) {
    this.service_name = 'LightSensor';
    this.mappings.CurrentAmbientLightLevel = { reading: 'brightness', minValue: 0 };
  } else if( s.Readings.luminance ) {
    if( !this.service_name ) this.service_name = 'LightSensor';
    this.mappings.CurrentAmbientLightLevel = { reading: 'luminance', minValue: 0 };
  } else if( s.Readings.illuminance ) {
    if( !this.service_name ) this.service_name = 'LightSensor';
    this.mappings.CurrentAmbientLightLevel = { reading: 'illuminance', minValue: 0 };
  } else if( s.Readings.luminosity ) {
    if( !this.service_name ) this.service_name = 'LightSensor';
    this.mappings.CurrentAmbientLightLevel = { reading: 'luminosity', minValue: 0, factor: 1/0.265 };
  }

  if( s.Readings.voc ) {
    if( !this.service_name ) this.service_name = 'AirQualitySensor';
    this.mappings.AirQuality = { reading: 'voc' };
  } else if( s.Readings.co2 ) {
    if( !this.service_name ) this.service_name = 'AirQualitySensor';
    this.mappings.AirQuality = { reading: 'co2' };
    this.mappings.CarbonDioxideLevel = { reading: 'co2' };
  }

  if( this.mappings.AirQuality )
    this.mappings.AirQuality.reading2homekit = function(mapping, orig) {
      orig = parseInt( orig );
      if( orig > 1500 )
        return Characteristic.AirQuality.POOR;
      else if( orig > 1000 )
        return Characteristic.AirQuality.INFERIOR;
      else if( orig > 800 )
        return Characteristic.AirQuality.FAIR;
      else if( orig > 600 )
        return Characteristic.AirQuality.GOOD;
      else if( orig > 0 )
        return Characteristic.AirQuality.EXCELLENT;
      else
        return Characteristic.AirQuality.UNKNOWN;
      }.bind(null, this.mappings.AirQuality);

  if( s.Readings.motor )
    this.mappings.PositionState = { reading: 'motor',
                                    values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED'] };

  if( s.Readings.moving )
    this.mappings.PositionState = { reading: 'moving',
                                    values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED'] };

  if( s.Readings.direction )
    this.mappings.PositionState = { reading: 'direction',
                                    values: ['/^opening/:INCREASING', '/^closing/:DECREASING', '/.*/:STOPPED'] };

  if ( s.Readings.doorState )
    this.mappings.CurrentDoorState = { reading: 'doorState',
                                       values: ['/^opening/:OPENING', '/^closing/:CLOSING',
                                                '/^open/:OPEN', '/^closed/:CLOSED', '/.*/:STOPPED'] };

  if( s.Readings.battery ) {
    var value = parseInt( s.Readings.battery.Value );

    if( isNaN(value) )
      this.mappings.StatusLowBattery = { reading: 'battery', values: ['ok:BATTERY_LEVEL_NORMAL', '/.*/:BATTERY_LEVEL_LOW'] };
      //this.mappings['Battery#StatusLowBattery'] = { reading: 'battery', values: ['ok:BATTERY_LEVEL_NORMAL', '/.*/:BATTERY_LEVEL_LOW'] };
    else {
      this.mappings.BatteryLevel = { reading: 'battery' };
      this.mappings.StatusLowBattery = { reading: 'battery', threshold: 20, values: ['0:BATTERY_LEVEL_LOW', '1:BATTERY_LEVEL_NORMAL']  };
      //this.mappings['Battery#BatteryLevel'] = { reading: 'battery' };
      //this.mappings['Battery#StatusLowBattery'] = { reading: 'battery', threshold: 20, values: ['0:BATTERY_LEVEL_LOW', '1:BATTERY_LEVEL_NORMAL']  };
    }
  }

  if( s.Readings['D-firmware'] )
    this.mappings.FirmwareRevision = { reading: 'D-firmware', _isInformation: true };
  else if( s.Readings.firmware )
    this.mappings.FirmwareRevision = { reading: 'firmware', _isInformation: true };
  //FIXME: add swversion internal for HUEDevices

  if( s.Readings.reachable )
    this.mappings.Reachable = { reading: 'reachable' };

  if( genericType == 'garage' ) {
    this.service_name = 'garage';
    if( s.PossibleAttrs.match(/(^| )setList\b/) && !s.Attributes.setList  ) s.Attributes.setList = 'on off';
    if( s.Attributes.setList ) {
      var parts = s.Attributes.setList.split( ' ' );
      if( parts.length == 2 ) {
        this.mappings.CurrentDoorState = { reading: 'state', values: [parts[0]+':OPEN', parts[1]+':CLOSED'] };
        this.mappings.TargetDoorState = { reading: 'state', values: [parts[0]+':OPEN', parts[1]+':CLOSED'],
                                                            cmds: ['OPEN:'+parts[0], 'CLOSED:'+parts[1]] };
      }
    }

  } else if( genericType == 'blind'
	     || s.Internals.type == 'blind'
             || s.Attributes.subType == 'blind'
             || s.Attributes.subType == 'blindActuator' ) {
    if( !this.service_name ) this.service_name = 'blind';
    delete this.mappings.Brightness;
    if( s.PossibleSets.match(/(^| )position\b/) ) {
      this.mappings.CurrentPosition = { reading: 'position' };
      this.mappings.TargetPosition = { reading: 'position', cmd: 'position', delay: true };
      if( s.Internals.TYPE == 'DUOFERN' ) {
        this.mappings.CurrentPosition.invert = true;
        this.mappings.TargetPosition.invert = true;

        //the following could be used instead of invert
        //var reading2homekit = function(mapping, orig) { return 100 - parseInt( orig ) };
        //var homekit2reading = function(mapping, orig) { return 100 - orig };
        //this.mappings.CurrentPosition.reading2homekit = reading2homekit.bind(null, this.mappings.CurrentPosition);
        //this.mappings.TargetPosition.reading2homekit = reading2homekit.bind(null, this.mappings.TargetPosition);
        //this.mappings.TargetPosition.homekit2reading = homekit2reading.bind(null, this.mappings.TargetPosition);
      } else if( s.Internals.TYPE == 'SOMFY' ) {
        if( !s.Attributes.positionInverse || s.Attributes.positionInverse != '1' ) {
          this.mappings.CurrentPosition.invert = true;
          this.mappings.TargetPosition.invert = true;
        }
        this.mappings.TargetPosition.cmd = 'pos';
      }
    } else {
      this.mappings.CurrentPosition = { reading: 'pct' };
      this.mappings.TargetPosition = { reading: 'pct', cmd: 'pct', delay: true };
      if( s.Attributes.param && s.Attributes.param.match(/levelInverse/i) ) {
        this.mappings.CurrentPosition.invert = true;
        this.mappings.TargetPosition.invert = true;
      }
    }

  } else if( s.Attributes.model == 'HM-SEC-WIN' ) {
    if( !this.service_name ) this.service_name = 'window';
    this.mappings.CurrentPosition = { reading: 'state' };
    this.mappings.TargetPosition = { reading: 'state', cmd: ' ', delay: true };

    var reading2homekit = function(mapping, orig) {
                            var match;
                            if( match = orig.match(/^(\d+)/ ) )
                              return parseInt( match[1] );
                            else if( orig == 'locked' )
                              return 0;

                            return 50;
                          };
    this.mappings.CurrentPosition.reading2homekit = reading2homekit.bind(null, this.mappings.CurrentPosition);
    this.mappings.TargetPosition.reading2homekit = reading2homekit.bind(null, this.mappings.TargetPosition);

    this.mappings.TargetPosition.homekit2reading = function(mapping, orig) {
                                                     if( orig == 0 ) return 'lock';
                                                     return orig;
                                                   }.bind(null, this.mappings.TargetPosition);

  } else if( s.Attributes.model && s.Attributes.model.match(/^HM-SEC-KEY/ ) ) {
    if( !this.service_name ) this.service_name = 'lock';
    this.mappings.TargetDoorState = { reading:'', default:'CLOSED', timeout:500, cmds: ['OPEN:open'] };
    this.mappings.LockCurrentState = { reading: 'lock',
                                       values: ['/uncertain/:UNKNOWN', '/^locked/:SECURED', '/.*/:UNSECURED'] };
    this.mappings.LockTargetState = { reading: 'lock',
                                      values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
                                      cmds: ['SECURED:lock', 'UNSECURED:unlock'], };

  } else if( genericType == 'lock' ) {
    this.mappings.TargetDoorState = { reading:'', default:'CLOSED', timeout:500, cmds: ['OPEN:open'] };
    this.mappings.LockCurrentState = { reading: 'state',
                                       values: ['/uncertain/:UNKNOWN', '/^locked/:SECURED', '/.*/:UNSECURED'] };
    this.mappings.LockTargetState = { reading: 'state',
                                      values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
                                      cmds: ['SECURED:lock+locked', 'UNSECURED:lock+unlocked'] };

  } else if( genericType == 'thermostat'
             || s.Attributes.subType == 'thermostat' ) {
    if( !this.service_name ) this.service_name = 'thermostat';

  } else if( s.Internals.TYPE == 'CUL_FHTTK' ) {
    if( !this.service_name ) this.service_name = 'ContactSensor';
    this.mappings.ContactSensorState = { reading: 'Window', values: ['/^Closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED'] };
    this.mappings.CurrentDoorState = { reading: 'Window', values: ['/^Closed/:CLOSED', '/.*/:OPEN'] };

  } else if( s.Internals.TYPE == 'MAX'
             && s.Internals.type == 'ShutterContact' ) {
    this.service_name = 'ContactSensor';
    this.mappings.ContactSensorState = { reading: 'state', values: ['closed:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED']  };
    this.mappings.CurrentDoorState = { reading: 'state', values: ['closed:CLOSED', '/.*/:OPEN']  };

  } else if( s.Attributes.subType == 'threeStateSensor' ) {
    if( !this.service_name ) this.service_name = 'ContactSensor';
    this.mappings.ContactSensorState = { reading: 'contact', values: ['/^closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED'] };
    this.mappings.CurrentDoorState = { reading: 'contact', values: ['/^closed/:CLOSED', '/.*/:OPEN'] };

  } else if( s.Internals.TYPE == 'PRESENCE' ) {
    if( !this.service_name ) this.service_name = 'OccupancySensor';
    this.mappings.OccupancyDetected = { reading: 'state', values: ['present:OCCUPANCY_DETECTED', 'absent:OCCUPANCY_NOT_DETECTED'] };

  } else if( s.Internals.TYPE == 'ROOMMATE' || s.Internals.TYPE == 'GUEST' ) {
    if( !this.service_name ) this.service_name = 'OccupancySensor';
    this.mappings.OccupancyDetected = { reading: 'presence', values: ['present:OCCUPANCY_DETECTED', '/.*/:OCCUPANCY_NOT_DETECTED'] };

  } else if( s.Internals.TYPE == 'RESIDENTS' ) {
    if( !this.service_name ) this.service_name = 'security';
    this.mappings.SecuritySystemCurrentState = { reading: 'state', values: ['/^home/:DISARMED', '/^gotosleep/:NIGHT_ARM', '/^absent/:STAY_ARM', '/^gone/:AWAY_ARM'] }
    this.mappings.SecuritySystemTargetState = { reading: 'state', values: ['/^home/:DISARMED', '/^gotosleep/:NIGHT_ARM', '/^absent/:STAY_ARM', '/^gone/:AWAY_ARM'], cmds: ['STAY_ARM:home', 'AWAY_ARM:absent', 'NIGHT_ARM:gotosleep', 'DISARM:home'], delay: true }

  } else if( s.Attributes.model == 'fs20di' )
    if( !this.service_name ) this.service_name = 'light';

  if( match = s.PossibleSets.match(/(^| )desired-temp(:[^\d]*([^\$ ]*))?/) ) {
    //HM & Comet DECT
    if( !this.service_name ) this.service_name = 'thermostat';
    this.mappings.TargetTemperature = { reading: 'desired-temp', cmd: 'desired-temp', delay: true };
    if( s.Readings['desired-temp'] === undefined ) //Comet DECT
      this.mappings.TargetTemperature.reading = 'temperature';

    if( s.Readings.actuator )
      this.mappings[CustomUUIDs.Actuation] = { reading: 'actuator',
                                               name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                                               maxValue: 100, minValue: 0, minStep: 1  };
    else if( s.Readings.ValvePosition )
      this.mappings[CustomUUIDs.Actuation] = { reading: 'ValvePosition',
                                               name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                                               maxValue: 100, minValue: 0, minStep: 1  };

    if( match[3] ) {
      var values = match[3].split(',');
      if( match[2].match(/slider/ ) ) {
        this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
        this.mappings.TargetTemperature.maxValue = parseFloat(values[2]);
        this.mappings.TargetTemperature.minStep = values[1];
      } else {
        this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
        this.mappings.TargetTemperature.maxValue = parseFloat(values[values.length-1]);
        this.mappings.TargetTemperature.minStep = values[1] - values[0];
      }
    }

    if( match = s.PossibleSets.match(/(^| )mode($| )/) ) {
      this.mappings.TargetHeatingCoolingState = { reading: 'mode',
                                                  values: ['/^auto/:AUTO', '/^holiday_short/:OFF', '/.*/:HEAT'],
                                                  cmds: ['OFF:mode holiday_short', 'HEAT:mode manual', 'COOL:mode manual', 'AUTO:mode auto'], };
    }

  } else if( match = s.PossibleSets.match(/(^| )desiredTemperature(:[^\d]*([^\$ ]*))?/) ) {
    // MAX
    if( !this.service_name ) this.service_name = 'thermostat';
    this.mappings.TargetTemperature = { reading: 'desiredTemperature', cmd: 'desiredTemperature', delay: true };

    if( s.Readings.valveposition )
      this.mappings[CustomUUIDs.Actuation] = { reading: 'valveposition',
                                               name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                                               maxValue: 100, minValue: 0, minStep: 1  };

    if( match[3] ) {
      var values = match[3].split(',');
      this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
      this.mappings.TargetTemperature.maxValue = parseFloat(values[values.length-2]);
      this.mappings.TargetTemperature.minStep = values[1] - values[0];
    }

  } else if( match = s.PossibleSets.match(/(^| )desired(:[^\d]*([^\$ ]*))?/) ) {
    //PID20
    if( !this.service_name ) this.service_name = 'thermostat';
    this.mappings.TargetTemperature = { reading: 'desired', cmd: 'desired', delay: true };

    if( s.Readings.actuation )
      this.mappings[CustomUUIDs.Actuation] = { reading: 'actuation',
                                               name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                                               maxValue: 100, minValue: 0, minStep: 1  };

    if( s.Readings.measured )
      this.mappings.CurrentTemperature = { reading: 'measured' };

  }

  if( s.Internals.TYPE == 'SONOSPLAYER' ) { //FIXME: use sets [Pp]lay/[Pp]ause/[Ss]top
    if( !this.service_name ) this.service_name = 'switch';
    this.mappings.On = { reading: 'transportState', valueOn: 'PLAYING', cmdOn: 'play', cmdOff: 'pause' };

  } else if( s.Internals.TYPE == 'harmony' ) {
    if( s.Internals.id !== undefined ) {
      if( s.Attributes.genericDeviceType )
        this.mappings.On = { reading: 'power', cmdOn: 'on', cmdOff: 'off' };
      else
        return;

    } else if( !s.Attributes.homebridgeMapping ) {
      if( !this.service_name ) this.service_name = 'switch';

      var match;
      if( match = s.PossibleSets.match(/(^| )activity:([^\s]*)/) ) {
        this.mappings.On = [];

        for( var activity of match[2].split(',') ) {
          this.mappings.On.push( {reading: 'activity', subtype: activity, valueOn: activity, cmdOn: 'activity+'+activity, cmdOff: 'off'} );
        }
      }
    }

  } else if( !this.mappings.On
             && s.PossibleSets.match(/(^| )on\b/)
             && s.PossibleSets.match(/(^| )off\b/) ) {
    if( !this.service_name ) this.service_name = 'switch';
    this.mappings.On = { reading: 'state', valueOff: '/off|A0|000000/', cmdOn: 'on', cmdOff: 'off' };
    if( !s.Readings.state ) delete this.mappings.On.reading;

  } else if( (!this.service_name || this.service_name === 'switch') && s.Attributes.setList ) {
    var parts = s.Attributes.setList.split( ' ' );
    if( parts.length == 2 ) {
      if( !this.service_name ) this.service_name = 'switch';
      this.mappings.On = { reading: 'state', valueOn: parts[0], cmdOn: parts[0], cmdOff: parts[1] };
      if( !s.Readings.state ) delete this.mappings.On.reading;
    }

  }

  if( s.Readings['measured-temp'] ) {
    if( !this.service_name ) this.service_name = 'thermometer';
    this.mappings.CurrentTemperature = { reading: 'measured-temp', minValue: -30 };
  } else if( s.Readings.temperature ) {
    if( !this.service_name ) this.service_name = 'thermometer';
    this.mappings.CurrentTemperature = { reading: 'temperature', minValue: -30 };
  }

  if( s.Readings.humidity ) {
    if( !this.service_name ) this.service_name = 'HumiditySensor';
    this.mappings.CurrentRelativeHumidity = { reading: 'humidity' };
  }

  if( s.Readings.pressure )
    this.mappings[CustomUUIDs.AirPressure] = { name: 'AirPressure', reading: 'pressure', format: 'UINT16', factor: 1 };


  if( this.service_name === 'thermostat' )
    this.mappings.CurrentHeatingCoolingState = { default: 'HEAT' };


  if( this.service_name === undefined ) {
    this.log.error( s.Internals.NAME + ': no service type detected' );
    return;
  } else if( this.service_name === undefined )
    this.service_name = 'switch';

  this.fromHomebridgeMapping( s.Attributes.homebridgeMapping );
  this.log.debug( 'mappings for ' + s.Internals.NAME + ': '+ util.inspect(this.mappings) );

  if( this.service_name !== undefined ) {
    this.log( s.Internals.NAME + ' is ' + this.service_name );
  } else if( this.mappings.CurrentPosition )
    this.log( s.Internals.NAME + ' is blind ['+ this.mappings.CurrentPosition.reading +']' );
  else if( this.mappings.TargetTemperature )
    this.log( s.Internals.NAME + ' is thermostat ['+ this.mappings.TargetTemperature.reading
                                                   + ';' + this.mappings.TargetTemperature.minValue + '-' + this.mappings.TargetTemperature.maxValue
                                                   + ':' + this.mappings.TargetTemperature.minStep +']' );
  else if( this.mappings.ContactSensor )
    this.log( s.Internals.NAME + ' is contact sensor [' + this.mappings.ContactSensor.reading +']' );
  else if( this.mappings.OccupancyDetected )
    log( s.Internals.NAME + ' is occupancy sensor' );
  else if( !this.mappings ) {
    this.log.error( s.Internals.NAME + ': no service type detected' );
    return;
  }

  if( this.mappings.CurrentPosition || this.mappings.TargetTemperature
      || this.service_name === 'lock' || this.service_name === 'garage' || this.service_name === 'window' )
    delete this.mappings.On;

  if( this.service_name === 'thermostat'
      && (!this.mappings.TargetTemperature
          || !this.mappings.TargetTemperature.cmd || !s.PossibleSets.match('(^| )'+this.mappings.TargetTemperature.cmd+'\\b') ) ) {
    this.log.error( s.Internals.NAME + ' is NOT a thermostat. set command for target temperature missing: '
                          + (this.mappings.TargetTemperature && this.mappings.TargetTemperature.cmd?this.mappings.TargetTemperature.cmd:'') );
    delete this.mappings.TargetTemperature;
  }



  this.log( s.Internals.NAME + ' has' );
  for( var characteristic_type in this.mappings ) {
    var mappings = this.mappings[characteristic_type];
    if( !Array.isArray(mappings) )
       mappings = [mappings];

    for( var mapping of mappings ) {
      if( characteristic_type == 'On' )
        this.log( '  ' + characteristic_type + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ';' + mapping.cmdOn +',' + mapping.cmdOff + ']' );
      else if( characteristic_type == 'Hue' || characteristic_type == 'Saturation' )
        this.log( '  ' + characteristic_type + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ';' + mapping.cmd + ';0-' + mapping.max +']' );
      else if( characteristic_type == 'history' )
        this.log( '  ' + characteristic_type + ' [' + (mapping.type ? mapping.type:'thermo') +';'+ (mapping.size ? mapping.size:1024) + ']' );
      else if( mapping.name ) {
        if( characteristic_type == CustomUUIDs.Volume )
          this.log( '  Custom ' + mapping.name + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading +  ';' + (mapping.nocache ? 'not cached' : 'cached' )  +']' );
        else
          this.log( '  Custom ' + mapping.name + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ']' );
      } else
        this.log( '  ' + characteristic_type + ' [' + (mapping.device ? mapping.device +'.':'') + mapping.reading + ']' );
    }
  }

//log( util.inspect(s) );

  // device info
  this.name		= s.Internals.NAME;
  this.fuuid            = s.Internals.FUUID;
  this.alias		= s.Attributes.alias ? s.Attributes.alias : s.Internals.NAME;
  this.siriName         = s.Attributes.siriName ? s.Attributes.siriName : this.alias;
  this.device		= s.Internals.NAME;
  this.type             = s.Internals.TYPE;
  this.model            = s.Readings.model ? s.Readings.model.Value
                                           : (s.Attributes.model ? s.Attributes.model
                                                                 : ( s.Internals.model ? s.Internals.model : '<unknown>' ) );
  this.PossibleSets     = s.PossibleSets;
  this.room		= s.Attributes.room;

  if( this.type == 'CUL_HM' ) {
    this.serial = this.type + '.' + s.Internals.DEF;
    if( s.Attributes.serialNr )
      this.serial = s.Attributes.serialNr;
    else if( s.Readings['D-serialNr'] && s.Readings['D-serialNr'].Value )
      this.serial = s.Readings['D-serialNr'].Value;
  } else if( this.type == 'CUL_WS' || this.type == 'Siro' || this.type == 'FS20' || this.type == 'IT' || this.type == 'EnOcean')
    this.serial = this.type + '.' + s.Internals.DEF;
  else if( this.type == 'HUEDevice' ) {
    if( s.Internals.uniqueid && s.Internals.uniqueid != 'ff:ff:ff:ff:ff:ff:ff:ff-0b' )
      this.serial = s.Internals.uniqueid;
  } else if( this.type == 'SONOSPLAYER' )
    this.serial = s.Internals.UDN;
  else if( this.type == 'WOL' )
    this.serial = this.type + '.' + s.Internals.MAC;
  else if( this.type == 'MAX' ) {
    this.model = s.Internals.type;
    this.serial = this.type + '.' + s.Internals.addr;
  } else if( this.type == 'DUOFERN' ) {
    this.model = s.Internals.SUBTYPE;
    this.serial = this.type + '.' + s.Internals.DEF;
  } else if( this.type == 'ZWave' ) {
    if( s.Readings.model && s.Readings.model.Value )
      this.model = s.Readings.model.Value;
    this.serial = this.type + '.' + s.Internals.DEF.replace(/ /, '-');
  } else if( this.type == 'HMCCUDEV' || this.type == 'HMCCUCHN' ) {
    this.model = s.Internals.ccutype;
    this.serial = s.Internals.DEF;
  }

  if( !this.serial )
    this.serial = this.fuuid;


  if( this.mappings.SerialNumber !== undefined ) {
    if( this.mappings.SerialNumber.serial != undefined )
      this.serial = this.mappings.SerialNumber.serial;
    else if( this.mappings.SerialNumber.value != undefined )
      this.serial = this.mappings.SerialNumber.value;
  }


  this.uuid_base = this.serial;


  // prepare mapping internals
  for( var characteristic_type in this.mappings ) {
    var mappings = this.mappings[characteristic_type];
    if( !Array.isArray(mappings) )
       mappings = [mappings];

    for( var mapping of mappings ) {
      var device = this.device;
      if( mapping.device === undefined )
        mapping.device = device;
      else
        device = mapping.device;

      if( mapping.reading === undefined && mapping.default === undefined )
        mapping.reading = 'state';

      mapping.characteristic = this.characteristicOfName(characteristic_type);
      mapping.informId = device +'-'+ mapping.reading;
      mapping.characteristic_type = characteristic_type;
      mapping.log = this.log;

      var parts = characteristic_type.split('#');
      if( parts[1] ) characteristic_type = parts[1];

      //FIXME: better integrate eventMap
      if( s.Attributes.eventMap ) {
        for( var part of s.Attributes.eventMap.split( ' ' ) ) {
          var map = part.split( ':' );
          if( map[1] && ( map[1].toLowerCase() == 'on'
                          || map[1].toLowerCase() == 'off' ) ) {
            if( !mapping.event_map )
              mapping.event_map = {}
            mapping.event_map[map[0]] = map[1];
          }
        }
        if(mapping.event_map && Object.keys(mapping.event_map).length) this.log.debug( 'event_map: ' + mapping.event_map );
      }

      if( mapping.default !== undefined ) {
        if( Characteristic[characteristic_type] && Characteristic[characteristic_type][mapping.default] !== undefined ) {
          if( mapping.homekit2name === undefined ) mapping.homekit2name = {};
          mapping.homekit2name[Characteristic[characteristic_type][mapping.default]] = mapping.default;
          mapping.default = Characteristic[characteristic_type][mapping.default];
        }
        if( typeof mapping.default === 'string' )
          mapping.default = mapping.default.replace( /\+/g, ' ' );
        this.log.debug( 'default: ' + mapping.default );
      }

      if( typeof mapping.values === 'object' ) {
        mapping.value2homekit = {};
        mapping.value2homekit_re = [];
        if( mapping.homekit2name === undefined ) mapping.homekit2name = {};
        for( var entry of mapping.values ) {
          var match = entry.match('^([^:]*)(:(.*))?$');
          if( !match ) {
            this.log.error( 'values: format wrong for ' + entry );
            continue;
          }

          var from = match[1];
          var to = match[3] === undefined ? entry : match[3];
          to = to.replace( /\+/g, ' ' );

          if( Characteristic[characteristic_type] && Characteristic[characteristic_type][to] !== undefined ) {
            mapping.homekit2name[Characteristic[characteristic_type][to]] = to;
            to = Characteristic[characteristic_type][to];
          } else if( Characteristic[characteristic_type] ) {
            for( var defined in Characteristic[characteristic_type] ) {
              if( to == Characteristic[characteristic_type][defined] )
                mapping.homekit2name[to] = defined;
            }
          }

          var match;
          if( match = from.match('^/(.*)/$') )
            mapping.value2homekit_re.push( { re: match[1], to: to} );
          else {
            from = from.replace( /\+/g, ' ' );
            mapping.value2homekit[from] = to;
          }
        }
        if(mapping.value2homekit_re
           && mapping.value2homekit_re.length) this.log.debug( 'value2homekit_re: ' + util.inspect(mapping.value2homekit_re) );
        if(mapping.value2homekit
           && Object.keys(mapping.value2homekit).length) this.log.debug( 'value2homekit: ' + util.inspect(mapping.value2homekit) );
        if(mapping.homekit2name ) {
           if(Object.keys(mapping.homekit2name).length)
             this.log.debug( 'homekit2name: ' + util.inspect(mapping.homekit2name) );
           else
             delete mapping.homekit2name;
        }
      }

      if( typeof mapping.valid === 'object' ) {
        this.log.debug( 'valid: ' + util.inspect(mapping.valid) );
        var valid = [];
        for( var value of mapping.valid ) {
          var mapped = undefined;
          if( Characteristic[characteristic_type] && Characteristic[characteristic_type][value] !== undefined ) {
            mapped = Characteristic[characteristic_type][value];
          } else if( Characteristic[characteristic_type] ) {
            for( var defined in Characteristic[characteristic_type] ) {
              if( value == Characteristic[characteristic_type][defined] ) {
                mapped = defined;
                break;
              }
            }
          }

          if( mapped !== undefined ) {
            this.log.debug( '  '+ value +' -> '+ mapped );
            value = mapped;
          } else
            value = parseInt( value );

          valid.push( value );
        }
        mapping.valid = valid.sort();

        this.log.debug( 'valid: ' + util.inspect(mapping.valid) );
      }

      if( typeof mapping.cmds === 'object' ) {
        mapping.homekit2cmd = {};
        mapping.homekit2cmd_re = [];
        for( var entry of mapping.cmds ) {
          var match = entry.match('^([^:]*)(:(.*))?$');
          if( !match ) {
            this.log.error( 'cmds: format wrong for ' + entry );
            continue;
          }

          var from = match[1];
          var to = match[2] !== undefined ? match[3] : match[1];
          to = to.replace( /\+/g, ' ' );

          if( match = from.match('^/(.*)/$') ) {
            mapping.homekit2cmd_re.push( { re: match[1], to: to} );
          } else {
            if( Characteristic[characteristic_type] && Characteristic[characteristic_type][from] !== undefined )
              from = Characteristic[characteristic_type][from];
            else
              from = from.replace( /\+/g, ' ' );

            mapping.homekit2cmd[from] = to;
          }
        }
        if(mapping.homekit2cmd_re
           && mapping.homekit2cmd_re.length) this.log.debug( 'homekit2cmd_re: ' + util.inspect(mapping.homekit2cmd_re) );
        if(mapping.homekit2cmd
           && Object.keys(mapping.homekit2cmd).length) this.log.debug( 'homekit2cmd: ' + util.inspect(mapping.homekit2cmd) );
      }

      if( mapping.reading2homekit !== undefined && typeof mapping.reading2homekit !== 'function' ) {
        if( mapping.reading2homekit.match( /^{.*}$/ ) ) {
          try {
            mapping.reading2homekit = new Function( 'mapping', 'orig', mapping.reading2homekit ).bind(null,mapping);
          } catch(err) {
            this.log.error( '  reading2homekit: ' + err );
            //delete mapping.reading2homekit;
          }
        } else if( typeof this.jsFunctions === 'object' ) {
          if( typeof this.jsFunctions[mapping.reading2homekit] === 'function' )
            mapping.reading2homekit = this.jsFunctions[mapping.reading2homekit].bind(null,mapping);
          else
            this.log.error( '  reading2homekit: no function named ' + mapping.reading2homekit + ' in ' + util.inspect(this.jsFunctions) );
        }

        if( mapping.reading2homekit !== undefined && typeof mapping.reading2homekit !== 'function' ) {
          this.log.error( '  reading2homekit disabled.' );
          delete mapping.reading2homekit;
        }
      }

      if( mapping.homekit2reading !== undefined && typeof mapping.homekit2reading !== 'function' ) {
        if( mapping.homekit2reading.match( /^{.*}$/ ) ) {
          try {
            mapping.homekit2reading = new Function( 'mapping', 'orig', mapping.homekit2reading ).bind(null,mapping);
          } catch(err) {
            this.log.error( '  homekit2reading: ' + err );
            //delete mapping.homekit2reading;
          }
        } else if( typeof this.jsFunctions === 'object' ) {
          if( typeof this.jsFunctions[mapping.homekit2reading] === 'function' )
            mapping.homekit2reading = this.jsFunctions[mapping.homekit2reading].bind(null,mapping);
          else
            this.log.error( '  homekit2reading: no function named ' + mapping.homekit2reading + ' in ' + util.inspect(this.jsFunctions) );
        }

        if( mapping.homekit2reading !== undefined && typeof mapping.homekit2reading !== 'function' ) {
          this.log.error( '  homekit2reading disabled.' );
          delete mapping.reading2homekit;
        }
      }

      var orig = undefined;
      if( device != this.device )
        orig = this.query(mapping);
      else if( s.Readings[mapping.reading] && s.Readings[mapping.reading].Value )
        orig = s.Readings[mapping.reading].Value;

      if( orig === undefined && device == this.device && mappings.default !== undefined ) {
        delete mapping.informId;

      } else {
        if( !mapping.nocache && mapping.reading && FHEM_cached[mapping.informId] === undefined )
          FHEM_update(mapping.informId, orig);

        if( mapping.characteristic || mapping.name )
          FHEM_reading2homekit(mapping, orig);
      }

      if( s.Readings[mapping.reading] && s.Readings[mapping.reading].Time ) {
        var date = new Date(s.Readings[mapping.reading].Time);
        mapping.last_update = parseInt( date.getTime() / 1000 );
      }

    }
  }
}

FHEMAccessory.prototype = {
  subscribe: function(mapping, characteristic) {
    if( typeof mapping === 'object' ) {
      mapping.characteristic = characteristic;

      if( characteristic )
        characteristic.FHEM_mapping = mapping;

      FHEM_subscribe(this, mapping.informId, characteristic, mapping);

    } else {
      FHEM_subscribe(this, mapping, characteristic);

    }
  },
  unsubscribe: function(mapping, characteristic) {
    if( mapping === undefined ) {
      for( var characteristic_type in this.mappings ) {
        var mapping = this.mappings[characteristic_type];
        FHEM_unsubscribe(this, mapping.informId, characteristic);
      }

    } else if( typeof mapping === 'object' ) {
      mapping.characteristic = characteristic;

      if( characteristic )
        characteristic.FHEM_mapping = mapping;

      FHEM_unsubscribe(this, mapping.informId, characteristic);

    } else {
      FHEM_unsubscribe(this, mapping, characteristic);

    }
  },

  fromHomebridgeMapping: function(homebridgeMapping) {
    if( !homebridgeMapping )
      return;

    this.log.info( 'homebridgeMapping: ' + homebridgeMapping );

    if( homebridgeMapping.match( /^{.*}$/ ) ) {
      try {
        homebridgeMapping = JSON.parse(homebridgeMapping);
      } catch(err) {
        this.log.error( '  fromHomebridgeMapping JSON.parse: ' + err );
        return;
      }

      //FIXME: handle multiple identical characteristics in this.mappings and in homebridgeMapping ?
      if( 1 )
        this.mappings = homebridgeMapping;
      else
      for( var characteristic in homebridgeMapping ) {
        if( !this.mappings[characteristic] )
          this.mappings[characteristic] = {};
        for( var attrname in homebridgeMapping[characteristic] )
          this.mappings[characteristic][attrname] = homebridgeMapping[characteristic][attrname];
      }

      return;
    }

    var seen = {};
    var service = undefined;
    for( var mapping of homebridgeMapping.split(/ |\n/) ) {
      if( !mapping )
        continue;
      if( mapping.match( /^#/ ) )
        continue;

      if( mapping == 'clear' ) {
        this.mappings = {};
        continue;
      }

      var match = mapping.match(/(^.*?)(:|=)(.*)/);
      if( !match || match.length < 4 || !match[3] ) {
        this.log.error( '  wrong syntax: ' + mapping );
        continue;
      }

      var characteristic = match[1];
      var params = match[3];


      var parts = characteristic.split('#');
      if( parts[1] )
        service = parts[0];
      else if( service !== undefined )
        characteristic = service +'#'+ characteristic;


      var mapping;
      if( !seen[characteristic] && this.mappings[characteristic] !== undefined )
        mapping = this.mappings[characteristic];
      else {
        mapping = {};
        if( this.mappings[characteristic] ) {
          if( this.mappings[characteristic].length == undefined )
            this.mappings[characteristic] = [this.mappings[characteristic]];
          this.mappings[characteristic].push( mapping );
        } else
          this.mappings[characteristic] = mapping;
      }
      seen[characteristic] = true;

      for( var param of params.split(',') ) {
        if( param === 'clear' ) {
          mapping = {};
          delete this.mappings[characteristic];
          continue;
        } else if( characteristic === 'AccessoryCategory' ) {
          delete this.mappings[characteristic];
          if( !Accessory.Categories || Accessory.Categories[param] === undefined ) {
            this.log.error( 'unknown category: ' + param );

	  } else {
	    this.category = Accessory.Categories[param];
            this.log.info( 'using category: '+ this.category +' ('+ param +')' );
	  }
          continue;
        //} else if( characteristic === 'SerialNumber' ) {
        //  delete this.mappings[characteristic];
        //  this.mappings[characteristic] = param;
        //  continue;
        } else if( !this.mappings[characteristic] )
          this.mappings[characteristic] = mapping

        var p = param.split('=');
        if( p.length == 2 ) {
          if( p[0] == 'values' )
            mapping[p[0]] = p[1].split(';');
          else if( p[0] == 'valid' )
            mapping[p[0]] = p[1].split(';');
          else if( p[0] == 'cmds' )
            mapping[p[0]] = p[1].split(';');
          else if( p[0] == 'delay' ) {
            mapping[p[0]] = parseInt(p[1]);
            if( isNaN(mapping[p[0]]) ) mapping[p[0]] = true;
          } else if( p[0] === 'minValue' || p[0] === 'maxValue' || p[0] === 'minStep'
                     || p[0] === 'min' || p[0] === 'max'
                     || p[0] === 'default'  ) {
            mapping[p[0]] = parseFloat(p[1]);
            if( isNaN(mapping[p[0]]) )
              mapping[p[0]] = p[1];
          } else
            mapping[p[0]] = p[1].replace( /\+/g, ' ' );

        } else if( p.length == 1 ) {
          var m = this.mappings[param];
          if( m === undefined ) m = this.mappings[service+'#'+param];
          if( m !== undefined ) {
            try {
              mapping = Object.assign({}, m);
            } catch(err) {
              console.log(m);
              for( var x in m ) {
                mapping[x] = m[x]
              }
            }
            this.mappings[characteristic] = mapping;

          } else if( p === 'invert' ) {
            mapping[p] = 1;

          } else {
            var p = param.split(':');

            var reading = p[p.length-1];
            var device = p.length > 1 ? p[p.length-2] : undefined;
            var cmd = p.length > 2 ? p[p.length-3] : undefined;

            if( reading )
              mapping.reading = reading;

            if( device )
              mapping.device = device;

            if( cmd )
              mapping.cmd = cmd;
          }

        } else {
          this.log.error( '  wrong syntax: ' + param );

        }
      }
    }
  },

  delayed: function(mapping,value,delay) {
    if( !this.delayed_timers )
      this.delayed_timers = {};

    if( typeof delay !== 'number' )
      delay = 1000;
    if( delay < 500 )
      delay = 500;

    var timer = this.delayed_timers[mapping.informId];
    if( timer ) {
      //this.log(this.name + ' delayed: removing old command ' + mapping.characteristic_type);
      clearTimeout( timer );
    }

    this.log.info(this.name + ' delaying command ' + mapping.characteristic_type + ' with value ' + value);
    this.delayed_timers[mapping.informId] = setTimeout( function(){
        delete this.delayed_timers[mapping.informId];
        this.command(mapping,value);
      }.bind(this), delay );
  },

  command: function(mapping,value) {
    if( mapping.readOnly ) {
      this.log.info(this.name + ' NOT sending command ' + c + ' with value ' + value + 'for readOnly characteristic');
      return;
    }

    var c = mapping;
    if( typeof mapping === 'object' )
      c = mapping.cmd;
    else
      this.log.info(this.name + ' sending command ' + c + ' with value ' + value);

    var command = undefined;
    if( c == 'identify' ) {
      if( this.type == 'HUEDevice' )
        command = 'set ' + this.device + 'alert select';
      else
        command = 'set ' + this.device + ' toggle; sleep 1; set '+ this.device + ' toggle';

    } else if( c == 'xhue' ) {
        value = Math.round(value * this.mappings.Hue.max / this.mappings.Hue.maxValue);
        command = 'set ' + this.mappings.Hue.device + ' hue ' + value;

    } else if( c == 'xsat' ) {
      value = value / 100 * this.mappings.Saturation.max;
      command = 'set ' + this.mappings.Saturation.device + ' sat ' + value;

    } else {
      if( mapping.characteristic_type == 'On' && value ) {
        if( this.delayed_timers && this.delayed_timers.length ) {
          mapping.log.info(this.name + ': skipping set cmd for ' + mapping.characteristic_type + ' with value ' + value );
          return;
        }
      }

      mapping.log.info(this.name + ': executing set cmd for ' + mapping.characteristic_type + ' with value ' + value );

      if( typeof mapping.homekit2reading === 'function' ) {
          try {
            value = mapping.homekit2reading(value);
          } catch(err) {
            mapping.log.error( mapping.informId + ' homekit2reading: ' + err );
            return;
          }
        if( value === undefined ) {
          mapping.log.info( '  converted value is unchanged ' );
          return;

        }

        mapping.log.info( '  value converted to ' + value );

      } else {
        if( typeof value === 'number' ) {
          var mapped = value;
          if( mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined ) {
            mapped = mapping.maxValue - value + mapping.minValue;
          } else if( mapping.invert && mapping.maxValue !== undefined ) {
            mapped = mapping.maxValue - value;
          } else if( mapping.invert ) {
            mapped = 100 - value;
          }

          if( value !== mapped ) {
            mapping.log.debug( '  value: ' + value + ' inverted to ' + mapped);
            value = mapped;
          }

          if( mapping.factor ) {
            mapped /= mapping.factor;
            mapping.log.debug( '  value: ' + value + ' mapped to ' + mapped);
            value = mapped;
          }


          if( mapping.max !== undefined && mapping.maxValue != undefined )
            value = Math.round(value * mapping.max / mapping.maxValue);
        }

      }

      var cmd = mapping.cmd + ' ' + value;

      if( mapping.cmdOn !== undefined && value == 1 )
        cmd = mapping.cmdOn

      else if( mapping.cmdOff !== undefined && value == 0 )
        cmd = mapping.cmdOff

      else if( typeof mapping.homekit2cmd === 'object' && mapping.homekit2cmd[value] !== undefined )
        cmd = mapping.homekit2cmd[value];

      else if( typeof mapping.homekit2cmd_re === 'object' ) {
        for( var entry of mapping.homekit2cmd_re ) {
          if( value.toString().match( entry.re ) ) {
            cmd = entry.to;
            break;
          }
        }
      }

      if( cmd === undefined ) {
        mapping.log.error(this.name + ' no cmd for ' + c + ', value ' + value);
        return;
      }

      command = 'set ' + mapping.device + ' ' + cmd;

    }

    if( command === undefined) {
      this.log.error(this.name + ' Unhandled command! cmd=' + c + ', value ' + value);
      return;
    }

    if( mapping.cmdSuffix !== undefined )
      command += ' ' + mapping.cmdSuffix;
    else if( mapping.commandSuffix !== undefined )
      command += ' ' + mapping.commandSuffix;

    this.execute(command);
  },

  execute: function(cmd,callback) {FHEM_execute(this.log, this.connection, cmd, callback)},

  query: function(mapping, callback) {
    var device = this.device;
    var reading;

    if( typeof mapping === 'object' ) {
      if( mapping.device )
        device = mapping.device;
      if( mapping.reading )
        reading = mapping.reading;

    } else
      reading = mapping;

    if( reading === undefined && mapping.default === undefined ) {
      if( callback !== undefined )
        callback( 1 );
      return;
    }

    this.log.info('query: ' + (mapping.name?mapping.name:mapping.characteristic_type) + ' for ' + mapping.informId);
    var value = mapping.cached;
    if( typeof mapping === 'object' && value !== undefined && (!('nocache' in mapping)) ) {
      var defined = undefined;
      if( mapping.homekit2name !== undefined ) {
        defined = mapping.homekit2name[value];
        if( defined === undefined )
          defined = '???';
      }

      mapping.log.info('  cached: ' + value + ' (as '+typeof(value) + (defined?'; means '+defined:'') + ')');

      if( callback !== undefined )
        callback( undefined, value );
      return value;

    } else {
      /*this.log.info('not cached; query: ' + mapping.informId);

      var value = FHEM_cached[mapping.informId];
      value = FHEM_reading2homekit(mapping, value);

      if( value !== undefined ) {
        this.log.info('  cached: ' + value);
        if( callback !== undefined )
          callback( undefined, value );
        return value;

      } else*/
        this.log.info('  not cached' );
    }

    var cmd = '{ReadingsVal("'+device+'","'+reading+'","")}';

    this.execute( cmd,
                  function(result) {
                    var value = result.replace(/[\r\n]/g, '');
                    this.log.info('  value: ' + value);

                    if( value === undefined )
                      return value;

                    FHEM_update( mapping.informId, value, true );

                    if( callback !== undefined ) {
                      if( value === undefined )
                        callback(1);
                      else {
                        value = FHEM_reading2homekit(mapping, value);
                        callback(undefined, value);
                      }
                    }

                    return value ;

                }.bind(this) );
  },

  isInRoom: function(room) {
    if( !room ) return false;
    if( !this.room ) return false;
    if( this.room.toLowerCase() === room ) return true;
    if( this.room.toLowerCase().match( '(^|,)('+room+')(,|\$)' ) ) return true;
    return false;
  },

  isOfType: function(type) {
    if( !type ) return false;
    if( this.service_name === type ) return true;
    return false;
  },

  isInScope: function(scope) {
    if( this.fhem === undefined ) return true;
    if( this.fhem.scope === undefined ) return true;

    if( typeof this.fhem.scope === 'object' ) {
      if( this.fhem.scope.grep(scope) != -1 ) return true;
    } else if( this.fhem.scope !== undefined ) {
      if( this.fhem.scope.match( '(^|,)('+scope+')(,|\$)' ) ) return true;
    }

    return false;
  },


  // for homebridge
  serviceOfName: function(service_name,subtype) {
    var serviceNameOfGenericDeviceType = {      ignore: null,
                                              security: 'SecuritySystem',
                                                switch: 'Switch',
                                                outlet: 'Outlet',
                                                 light: 'Lightbulb',
                                                 blind: 'WindowCovering',
                                               contact: 'ContactSensor',
                                           thermometer: 'TemperatureSensor',
                                            thermostat: 'Thermostat',
                                                garage: 'GarageDoorOpener',
                                                window: 'Window',
                                                  lock: 'LockMechanism'
                                         };

    if( serviceNameOfGenericDeviceType[service_name] !== undefined )
      service_name = serviceNameOfGenericDeviceType[service_name];

    var service = Service[service_name];
    if( typeof service === 'function' ) {
      var name = this.siriName;
      if( subtype )
        name = subtype + ' (' + this.siriName + ')';

      this.log('  ' + service_name + ' service for ' + this.name + (subtype?' (' + subtype + ')':'') );
      var service = new service(name,subtype?subtype:'');
      service.service_name = service_name;
      return service;
    }

    if( service === undefined )
      this.log.error(this.name + ': service name '+ service_name + ' unknown')

    return undefined;
  },

  characteristicOfName: function(name) {
    var parts = name.split('#');
    if( parts[1] ) name = parts[1];

    var characteristic = Characteristic[name];
    if( typeof characteristic === 'function' )
      return characteristic;

    return undefined;
  },

  createDeviceService: function(service_name,subtype) {
    var name = this.siriName;
    if( subtype )
      name = subtype + ' (' + this.siriName + ')';

    var service = this.serviceOfName(service_name,subtype);
    if( typeof service === 'object' )
      return service;

    this.log('  switch service (default) for ' + this.name + ' (' + subtype + ')' )
    return new Service.Switch(name, subtype);
  },

  identify: function(callback) {
    this.log('['+this.name+'] identify requested!');
    var match;
    if( match = this.PossibleSets.match(/(^| )toggle\b/) ) {
      this.command( 'identify' );
    }
    callback();
  },

  getServices: function() {
    var services = [];

    this.log('creating services for ' + this.name)

    this.log('  information service for ' + this.name)
    var informationService = new Service.AccessoryInformation();
    services.push( informationService );

    this.log('    manufacturer, model and serial number characteristics for ' + this.name)
    informationService
      .setCharacteristic(Characteristic.Manufacturer, this.mappings.Manufacturer
                                                      ?this.mappings.Manufacturer:('FHEM:' + this.type) )
      .setCharacteristic(Characteristic.Model, this.mappings.Model
                                               ?this.mappings.Model:('FHEM:' + (this.model ? this.model : '<unknown>')) )
      .setCharacteristic(Characteristic.SerialNumber, this.mappings.SerialNumber
                                                      ?this.mappings.SerialNumber:(this.serial ? this.serial : '<unknown>') );


    if( this.mappings.FirmwareRevision ) {
      this.log('    firmware revision characteristic for ' + this.name)

      var characteristic = informationService.getCharacteristic(Characteristic.FirmwareRevision)
                           || informationService.addCharacteristic(Characteristic.FirmwareRevision);

      this.subscribe(this.mappings.FirmwareRevision, characteristic);

      characteristic.value = FHEM_cached[this.mappings.FirmwareRevision.informId];

      characteristic
        .on('get', function(callback) {
                     if( this.mappings.FirmwareRevision )
                       this.query(this.mappings.FirmwareRevision, callback);
                   }.bind(this) );
    }

    var characteristic = informationService.getCharacteristic(Characteristic.Name);
    if( characteristic ) {
      this.log('    name (siriName) characteristic for ' + this.name)
      characteristic
        .on('set', function(mapping, value, callback, context) {
                     if( context !== 'fromFHEM' ) {
                       //this.log('set name: ' + value);
                       //this.siriName = value;
                       //this.execute( 'attr '+ this.device +' siriName '+ this.siriName );
                       //this.log.info( 'siriName attribute updated.' );
                     }
                     callback();
                   }.bind(this, mapping) )
        .on('get', function(callback) {
                     callback( null, this.siriName );
                   }.bind(this) );
    }

    if( Characteristic.Reachable ) {
      if( this.mappings.Reachable ) {
	this.log.info( '  ' + this.device + ' has reachability ['+ this.mappings.Reachable.reading +']' );
        this.subscribe(this.mappings.Reachable);
      }
    }


    if( this.mappings.colormode
        && (this.mappings.xy || this.mappings.ct) ) {
      this.subscribe(this.mappings.xy);
      this.subscribe(this.mappings.colormode);

      if( this.mappings.xy && FHEM_cached[this.mappings.colormode.informId] == 'xy' ) {
        var mapping = this.mappings.xy;
        var value = FHEM_cached[mapping.informId];
        var xy = value.split(',');
        var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
        var hsv = FHEM_rgb2hsv(rgb);

        FHEM_cached[mapping.device + '-h'] = hsv[0];
        FHEM_cached[mapping.device + '-s'] = hsv[1];
        FHEM_cached[mapping.device + '-v'] = hsv[2];

      } else if( this.mappings.ct && FHEM_cached[this.mappings.colormode.informId] == 'ct' ) {
        var mapping = this.mappings.ct;
        var value = FHEM_cached[mapping.informId];
        var rgb = FHEM_ct2rgb(value);
        var hsv = FHEM_rgb2hsv(rgb);

        FHEM_cached[mapping.device + '-h'] = hsv[0];
        FHEM_cached[mapping.device + '-s'] = hsv[1];
        FHEM_cached[mapping.device + '-v'] = hsv[2];
      }

    }


    //this.displayName = this.name;
    this.displayName = this.fuuid;

    var controlService = this.createDeviceService(this.service_name);
    services.push( controlService );

    var service_name = controlService.service_name;
    var service_name_default = controlService.service_name;

    var seen = {};
    var services_hash = {};
    //services_hash[service_name +'#undefined'] = controlService;
    for( var characteristic_type in this.mappings ) {
      var mappings = this.mappings[characteristic_type];
      if( !Array.isArray(mappings) )
         mappings = [mappings];

      if( characteristic_type === 'Reachable' )
        continue;

      if( service_name === 'ContactSensor' && characteristic_type === 'CurrentDoorState'
          && this.mappings.history && this.mappings.ContactSensorState ) {
        this.log.error( this.name + ': skipping CurrentDoorState characteristic as ContactSensor is also given and history is enabled' );
        continue;
      }

      for( var mapping of mappings ) {
        if( mapping._isInformation )
          continue;

        if( Object.keys(services_hash).length == 0 ) {
          controlService.subtype = mapping.subtype;
          services_hash[service_name +'#'+ mapping.subtype] = controlService;
        }

        if( characteristic_type === 'history' ) {
          if( !FakeGatoHistoryService ) {
            this.log.error( this.name + ': fakegato-history not installed' );
            continue;
          }
          if( this.historyService ) {
            this.log.error( this.name + ': FakeGatoHistory already created for'+ service_name );
            continue;
          }

          var type = mapping.type;
          if( !type )
            switch(service_name) {
              case 'AirQualitySensor':
                type = 'room';
                break;
              case 'TemperatureSensor':
                type = 'weather';
                break;
              case 'Thermostat':
                type = 'thermo';
                break;
              case 'ContactSensor':
                type = 'door';
                break;
              case 'MotionSensor':
                type = 'motion';
                break;
              default:
                this.log.error(this.name + ': history: no type known for '+ service_name);
                continue;
            }

          this.log('  ' + 'FakeGatoHistory service with type '+ type +' for ' + service_name);
          this.historyService = new FakeGatoHistoryService( type, this,
                                                            { size: mapping.size?mapping.size: 1024,
                                                              storage:'fs' } );
          services.push( this.historyService );

          if( service_name === 'ContactSensor' ) {
            this.historyService.extra_persist = { TimesOpened: 0, LastActivation: 0, OpenDuration: 0, ClosedDuration: 0, reset: 0 };
            this.historyService.setExtraPersistedData( this.historyService.extra_persist );
          }
          else if( service_name === 'MotionSensor' ) {
            this.historyService.extra_persist = { LastActivation: 0, reset: 0 };
            this.historyService.setExtraPersistedData( this.historyService.extra_persist );
          }

          if( this.historyService.extra_persist ) {
            //this.historyService.on( 'historyLoaded', function() {this.log.error(this.name +': loaded')}.bind(this) );
            this.historyService.checkIfLoaded = function(mapping) {
              if( this.historyService.isHistoryLoaded() ) {
                var extra_persist = this.historyService.getExtraPersistedData();
                if( extra_persist !== undefined ) {
                  this.historyService.extra_persist = extra_persist;
                  this.log(this.name+ ': FakeGatoHistory extra persisted data loaded');
                  if( this.historyService.extra_persist.TimesOpened !== undefined )
                    FHEM_update( mapping.device + '-EVE-TimesOpened', this.historyService.extra_persist.TimesOpened );
                } else
                  this.log(this.name+ ': FakeGatoHistory extra persisted data is empty');
              } else {
                setTimeout(function(mapping) {
                  this.historyService.checkIfLoaded.bind(this)(mapping);
                }.bind(this, mapping), 10);
              }
            }

            this.historyService.checkIfLoaded.bind(this)(mapping);
          }

          if( service_name === 'ContactSensor' ) {
            this.log('    ' + 'FakeGatoHistory reset');
            var characteristic = new Characteristic( 'Reset', 'E863F112-079E-48FF-8F27-9C2605A29F52' );
            this.historyService.addCharacteristic( characteristic );
            characteristic.setProps( { format: Formats['UINT32'] } );
            characteristic.setProps( { perms: [Perms.READ, Perms.WRITE] } );
            //characteristic.setProps( { perms: [Perms.READ, Perms.WRITE, Perms.NOTIFY] } );
            this.log.debug('      props: ' + util.inspect(characteristic.props) );
            characteristic
              .on('set', function(mapping, value, callback, context) {
                           if( context !== 'fromFHEM' ) {
                             this.log('set reset: ' + value);
                             this.historyService.extra_persist.reset = value;
                             FHEM_update( mapping.device + '-EVE-TimesOpened', 0 );
                           }
                           callback();
                         }.bind(this, mapping) )
              .on('get', function(mapping, callback) {
                           var value = this.historyService.extra_persist.reset;
                           if( value === undefined) value = 0;
                           this.log('get reset: ' + value);
                           callback( null, value );
                         }.bind(this, mapping) );
            }

          continue;
        }


        var parts = characteristic_type.split('#');
        if( parts[1] ) {
          service_name = parts[0];
          characteristic_type = parts[1];
          //mapping.characteristic_type = parts[1]

          //handle <service>(<subtype>)#<characteristic>
          var match = service_name.match(/(.+)\((.+)\)$/);
          if( match && match[2] !== undefined ) {
            service_name = match[1];
            mapping.subtype = match[2];
            if( !mapping.name ) mapping.name = service_name +'('+ mapping.subtype +')#'+ characteristic_type;
          }
        } else if( mapping.subtype ) {
          if( !mapping.name ) mapping.name = characteristic_type +'('+ mapping.subtype +')';
        }

        if( seen[service_name +'#'+ characteristic_type] ) {
          if( mapping.subtype === undefined ) {
            this.log.error(this.name + ': '+ characteristic_type + ' characteristic already defined for service ' + this.name + ' and no subtype given');
            continue;
          }
        }

        if( services_hash[service_name +'#'+ mapping.subtype] )
          controlService = services_hash[service_name +'#'+ mapping.subtype];
        else {
          controlService = this.createDeviceService(service_name,mapping.subtype);
          services.push( controlService );
          services_hash[service_name +'#'+ mapping.subtype] = controlService;
        }

        if( mapping.subtype !== undefined ) {
          controlService.subtype = mapping.subtype;
          if( service_name !== 'InputSource' )
            controlService.getCharacteristic(Characteristic.Name).setValue(mapping.subtype);
        }

        if( characteristic_type === 'linkedTo' ) {
          let service = services_hash[mapping.reading +'#undefined'];
          if( !service )
            this.log.error(this.name + ': no '+ mapping.reading +' service to link to' );
          else if( mapping.reading === service_name )
            this.log.error(this.name + ': can\'t link '+ mapping.reading +' service to itself' );
          else {
            service.addLinkedService(controlService);
            this.log('    linked to '+ service.service_name );
          }

          continue;
        }

        if( !mapping.characteristic && mapping.name === undefined ) {
          //this.log.error(this.name + ': '+ ' no such characteristic: ' + characteristic_type );
          continue;
        }


        var characteristic = undefined;
        if( !mapping.characteristic ) {
          if( !mapping.name ) mapping.name = characteristic_type;
          if( CustomUUIDs[characteristic_type] ) characteristic_type = CustomUUIDs[characteristic_type];
          if( !characteristic_type.match( /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i ) ) {
            this.log.error(this.name + ': '+ (mapping.name?mapping.name:mapping.characteristic_type) + ' invalid uuid format: '+ characteristic_type );
            continue;
          }
          if( mapping.name !== undefined ) {
            characteristic = new Characteristic( mapping.name, characteristic_type );
            controlService.addCharacteristic( characteristic );
            mapping.name = 'Custom ' + mapping.name;
          }

        } else
          characteristic = controlService.getCharacteristic(mapping.characteristic)
                           || controlService.addCharacteristic(mapping.characteristic)

        if( characteristic == undefined ) {
          this.log.error(this.name + ': no '+ (mapping.name?mapping.name:mapping.characteristic_type) + ' characteristic available for service ' + service_name);
          continue;
        }
        seen[service_name +'#'+ characteristic_type] = true;

        this.log('    ' + (mapping.name?mapping.name:mapping.characteristic_type)
                        + ' characteristic for ' + mapping.device + ':' + mapping.reading);

        this.subscribe(mapping, characteristic);

        if( mapping.cached !== undefined ) {
          var value = mapping.cached;

          var defined = undefined;
          if( mapping.homekit2name !== undefined ) {
            defined = mapping.homekit2name[value];
            if( defined === undefined )
              defined = '???';
          }

          characteristic.value = value;
          this.log.debug('      initial value is: ' + characteristic.value
                                                    + ' (' + typeof(characteristic.value) + (defined?'; means '+defined:'') + ')' );

        } else if( mapping.default !== undefined ) {
          characteristic.value = mapping.default;
          this.log.debug('      no initial value; default is: ' + characteristic.value + ' (' + typeof(characteristic.value) + ')' );

        } else {
          this.log.debug('      no default' );
        }

        if( mapping.format !== undefined ) characteristic.setProps( { format: Formats[mapping.format] } );
        if( mapping.unit !== undefined ) {
          if( Units[mapping.unit] )
            characteristic.setProps( { unit: Units[mapping.unit] } );
          else
            characteristic.setProps( { unit: mapping.unit } );
        }
        //if( mapping.unit !== undefined ) characteristic.setProps( { unit: Units[mapping.unit] } );
        if( mapping.minValue !== undefined ) characteristic.setProps( { minValue: mapping.minValue } );
        if( mapping.maxValue !== undefined ) characteristic.setProps( { maxValue: mapping.maxValue } );
        if( mapping.minStep !== undefined ) characteristic.setProps( { minStep: mapping.minStep } );
        if( mapping.valid !== undefined ) characteristic.setProps( { validValues: mapping.valid } );

        if( characteristic_type.match( /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i )
            || !characteristic.props || !characteristic.props.perms || !characteristic.props.perms.length ) {
          if( mapping.cmd === undefined )
            characteristic.setProps( { perms: [Perms.READ, Perms.NOTIFY] } );
          else {
            characteristic.setProps( { perms: [Perms.READ, Perms.WRITE, Perms.NOTIFY] } );
          }
        }


        this.log.debug('      props: ' + util.inspect(characteristic.props) );

        characteristic
          .on('set', function(mapping, value, callback, context) {
                       if( context !== 'fromFHEM' ) {
                         if( mapping.delay )
                           this.delayed(mapping, value, mapping.delay);
                         else if( mapping.cmd )
                           this.command(mapping, value);
                         else
                           this.command(mapping, value);

                         if( mapping.timeout && mapping.default !== undefined )
                           setTimeout( function(){mapping.characteristic.setValue(mapping.default, undefined, 'fromFHEM');}, mapping.timeout  );
                       }
                       callback();
                     }.bind(this, mapping) )
          .on('get', function(mapping, callback) {
                       if( this.mappings.Reachable && !this.mappings.Reachable.cached  )
                         callback( 'unreachable' );
                       else
                         this.query(mapping, callback);
                     }.bind(this, mapping) );

      }
    }

    if( this.historyService != undefined ) {
      if( this.mappings.ContactSensorState ) {
        this.log('    ' + 'Custom TimesOpened characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'TimesOpened', 'E863F129-079E-48FF-8F27-9C2605A29F52' );
        this.mappings['E863F129-079E-48FF-8F27-9C2605A29F52'] = { name: 'Custom TimesOpened', characteristic: characteristic, informId: mapping.device+'-EVE-TimesOpened', log: mapping.log };
        this.subscribe(this.mappings['E863F129-079E-48FF-8F27-9C2605A29F52'], characteristic);
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.READ, Perms.NOTIFY] } );
        characteristic
          .on('get', function(mapping, callback) {
                       if( !this.historyService ) {
                         this.log.error(this.name + ': Custom TimesOpened characteristic requires FakeGatoHistory');
                         callback( 'no historyService' );
                         return;
                       }

                       var value = this.historyService.extra_persist.TimesOpened;
                       this.log('query Custom TimesOpened for '+ mapping.device + ':' + mapping.reading +': '+ value);
                       callback( null, value );
                     }.bind(this, mapping) );
      }

      if( (this.mappings.ContactSensorState || this.mappings.MotionDetected)
          && !seen[service_name +'#E863F11A-079E-48FF-8F27-9C2605A29F52']) {
        seen[service_name +'#E863F11A-079E-48FF-8F27-9C2605A29F52'] = true;
        this.log('    ' + 'Custom LastActivation characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'LastActivation', 'E863F11A-079E-48FF-8F27-9C2605A29F52' );
        this.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'] = { name: 'Custom LastActivation', characteristic: characteristic, informId: mapping.device+'-EVE-LastActivation', log: mapping.log };
        //this.subscribe(this.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'], characteristic);
        this.mappings['E863F11A-079E-48FF-8F27-9C2605A29F52'] = { characteristic: characteristic };
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.READ] } );
        //characteristic.setProps( { perms: [Perms.READ, Perms.NOTIFY] } );
        this.log.debug('      props: ' + util.inspect(characteristic.props) );
        characteristic
          .on('get', function(mapping, callback) {
                       if( this.historyService === undefined ) {
                         this.log.error(this.name + ': Custom LastActivation characteristic requires FakeGatoHistory');
                         callback( "error" );
                         return;
                       }
                       if( mapping.last_update === undefined ) {
                         this.log.error(this.name + ': Custom LastActivation characteristic: last update unknown ');
                         callback( "error" );
                         return;
                       }

                       var time = this.historyService.getInitialTime();
                       if( time === undefined ) {
                         var entry = { time: mapping.last_update, status: mapping.cached  };
                         mapping.log.info( '      adding history entry '+ util.inspect(entry) );
                         this.historyService.addEntry( entry );
                       }

                       time = mapping.last_update - this.historyService.getInitialTime();

                       this.log('query Custom LastActivation for '+ mapping.device + ':' + mapping.reading +': '+ time);
                       callback( null, time );
                     }.bind(this, mapping) );
        }

      if( this.mappings.ContactSensorState ) {
        this.log('    ' + 'Custom OpenDuration characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'OpenDuration', 'E863F118-079E-48FF-8F27-9C2605A29F52' );
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.READ, Perms.WRITE, Perms.NOTIFY] } );
        characteristic
          .on('get', function(mapping, callback) {
                       var value = 0;
                       this.log('query Custom OpenDuration for '+ mapping.device + ':' + mapping.reading +': '+ value);
                       callback( null, value );
                     }.bind(this, mapping) );

        this.log('    ' + 'Custom ClosedDuration characteristic '+ mapping.device + ':' + mapping.reading);
        characteristic = new Characteristic( 'ClosedDuration', 'E863F119-079E-48FF-8F27-9C2605A29F52' );
        controlService.addCharacteristic( characteristic );
        characteristic.setProps( { format: Formats['UINT32'] } );
        characteristic.setProps( { perms: [Perms.READ, Perms.WRITE, Perms.NOTIFY] } );
        characteristic
          .on('get', function(mapping, callback) {
                       var value = 0;
                       this.log('query Custom ClosedDuration for '+ mapping.device + ':' + mapping.reading +': '+ value);
                       callback( null, value );
                     }.bind(this, mapping) );

      }
    }

    return services;
  }

};


//http server for debugging
var http = require('http');

var FHEMdebug_PORT=8282;

function FHEMdebug_handleRequest(request, response){
  //console.log( request );

  if( request.url == '/cached' ) {
    response.write( '<a href="/">home</a><br><br>' );
    for( var key in FHEM_longpoll ) {
      response.write( key + '<br>' );
      response.write( '&nbsp;&nbsp;connected: ' + FHEM_longpoll[key].connected );
      response.write( '; connects: ' + FHEM_longpoll[key].connects +'<br>' );
      response.write( '&nbsp;&nbsp;received: '+ FHEM_longpoll[key].received );
      response.write( '; received total: ' + FHEM_longpoll[key].received_total +'<br>' );
      if( FHEM_longpoll[key].last_event_time )
        response.write( '&nbsp;&nbsp;last event: ' + new Date(FHEM_longpoll[key].last_event_time) +'<br>' );
     }
    response.write( '<br>' );

    for( var informId in FHEM_subscriptions ) {
      response.write( informId + ': '+ FHEM_cached[informId] +'<br>' );

      var derived = false;
      for( var subscription of FHEM_subscriptions[informId] ) {
        var characteristic = subscription.characteristic;
        if( !characteristic ) continue;

        var mapping = characteristic.FHEM_mapping;
        if( !mapping || mapping.cached === undefined ) continue;

        derived = true;

        var value = mapping.cached;

        var defined = undefined;
        if( mapping.homekit2name !== undefined ) {
          defined = mapping.homekit2name[value];
          if( defined === undefined )
            defined = '???';
        }
        response.write( '&nbsp;&nbsp;' + mapping.characteristic_type + ': '+ value + ' (' + typeof(value)+ (defined?'; means '+defined:'') +')<br>' );
      }
      //if( derived )
        response.write( '<br>' );
    }
    //response.write( '<br>cached: ' + util.inspect(FHEM_cached).replace(/\n/g, '<br>') );
    response.end( '' );

  } else if( request.url == '/subscriptions' ) {
    response.write( '<a href="/">home</a><br><br>' );
    response.end( '<pre>subscriptions: ' + util.inspect(FHEM_subscriptions, {depth: 5}) + '</pre>');

  } else
    response.end( '<a href="/cached">cached</a><br><a href="/subscriptions">subscriptions</a>' );
}

var FHEMdebug_server = http.createServer( FHEMdebug_handleRequest );

FHEMdebug_server.on('error', function (e) {
  console.log('Server error: ' + e);

  if( FHEMdebug_PORT == 8282 ) {
    FHEMdebug_PORT = 8283;
    FHEMdebug_server.close();
    FHEMdebug_server.listen(FHEMdebug_PORT);
  }
});

//Lets start our server
FHEMdebug_server.listen(FHEMdebug_PORT, function(){
    console.log('Server listening on: http://<ip>:%s', FHEMdebug_PORT);
});
