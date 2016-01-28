// FHEM Platform Shim for HomeBridge
// current version on https://github.com/justme-1968/homebridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         'platform': "FHEM",
//         'name': "FHEM",
//         'server': "127.0.0.1",
//         'port': 8083,
//         'ssl': true,
//         'auth': {'user': "fhem", 'pass': "fhempassword"},
//         'filter': "room=xyz"
//     }
// ],

var Service, Characteristic;
module.exports = function(homebridge){
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerPlatform("homebridge-fhem", "FHEM", FHEMPlatform);
}


var util = require('util');


// subscriptions to fhem longpoll evens
var FHEM_subscriptions = {};
function
FHEM_subscribe(accessory, informId, characteristic) {
  if( !FHEM_subscriptions[informId] )
    FHEM_subscriptions[informId] = [];

  FHEM_subscriptions[informId].push( { accessory: accessory, characteristic: characteristic } );
}

function
FHEM_isPublished(device) {
  for( var inform_id in FHEM_subscriptions ) {
    for( var subscription of FHEM_subscriptions[inform_id] ) {
      var accessory = subscription.accessory;

      if( accessory.device === device )
        return accessory;
    };
  };

  return null;
}

var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds

// cached readings from longpoll & query
var FHEM_cached = {};
//var FHEM_internal = {};
function
FHEM_update(informId, orig, no_update) {
  if( orig === undefined
      || FHEM_cached[informId] === orig )
    return;

  FHEM_cached[informId] = orig;
  //FHEM_cached[informId] = { orig: orig, timestamp: Date.now() };
  var date = new Date(Date.now()-tzoffset).toISOString().replace(/T/, ' ').replace(/\..+/, '');
  console.log("  " + date + " caching: " + informId + ": " + orig );

  var subscriptions = FHEM_subscriptions[informId];
  if( subscriptions )
    subscriptions.forEach( function(subscription) {
      var mapping = subscription.characteristic.FHEM_mapping;

      var value;
      if( typeof mapping.reading2homekit === 'function' ) {
        value = mapping.reading2homekit(orig);

      } else {
        value = FHEM_reading2homekit(mapping, orig);

      }

      mapping.cached = value;
      mapping.log.info('    caching: ' + mapping.characteristic_name + (mapping.subtype?':'+mapping.subtype:'') +  ': ' + value + ' (' + typeof(value) + '; from ' + orig + ')' );

      if( !no_update && typeof mapping.characteristic === 'object' )
        mapping.characteristic.setValue(value, undefined, 'fromFHEM');
    } );
}

function
FHEM_reading2homekit(mapping, orig)
{
  var value = orig;
  if( value === undefined )
    return undefined;
  var reading = mapping.reading;

  if(reading == 'controlMode') {
    if( value.match(/^auto/))
      value = Characteristic.TargetHeatingCoolingState.AUTO;
    else if( value.match(/^manu/))
      value = Characteristic.TargetHeatingCoolingState.HEAT;
    else
      value = Characteristic.TargetHeatingCoolingState.OFF;

  } else if(reading == 'mode') {
    if( value.match(/^auto/))
      value = Characteristic.TargetHeatingCoolingState.AUTO;
    else
      value = Characteristic.TargetHeatingCoolingState.HEAT;

  } else if( reading == 'volume'
             || reading == 'Volume' ) {
    value = parseInt( value );

  } else if( reading == 'lock' ) {
      if( value.match( /uncertain/ ) )
        value = Characteristic.LockCurrentState.UNKNOWN;
      else if( value.match( /^locked/ ) )
        value = Characteristic.LockCurrentState.SECURED;
      else
        value = Characteristic.LockCurrentState.UNSECURED;

  } else if( reading == 'actuator'
             || reading == 'actuation'
             || reading == 'valveposition' ) {
    value = parseInt( value );

  } else if( reading == 'temperature'
             || reading == 'measured'
             || reading == 'measured-temp'
             || reading == 'desired-temp'
             || reading == 'desired'
             || reading == 'desiredTemperature' ) {
    value = parseFloat( value );

    if( mapping.minValue !== undefined && value < mapping.minValue )
      value = parseFloat(mapping.minValue);
    else if( mapping.maxValue !== undefined && value > mapping.maxValue )
      value = parseFloat(mapping.maxValue);

    if( mapping.minStep ) {
      if( mapping.minValue )
        value -= parseFloat(mapping.minValue);
      value = parseFloat( (Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1) );
      if( mapping.minValue )
        value += parseFloat(mapping.minValue);
    }

  } else if( reading == 'humidity' ) {
    value = parseInt( value );

  } else if( reading == 'battery' ) {
    if(mapping.characteristic_name == 'BatteryLevel' ) {
      value = parseInt(value);

    } else if( value == 'ok' )
      value = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

    else {
      value = parseInt(value);
      if( isNaN(value) )
        value = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      else
        value = value > mapping.threshold ? Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL : Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }

  } else if( reading == 'onoff' ) {
    value = parseInt( value );

  } else if( reading == 'reachable' ) {
    value = parseInt( value );
    //value = parseInt( value ) == true;

  } else if( reading == 'state' ) {
    if( value.match(/^set-/ ) )
      return undefined;

    if( mapping.characteristic_name == 'Brightness' ) {
      if( value == 'off' )
        value = 0;
      else if( match = value.match(/dim(\d+)%?/ ) )
        value = parseInt( match[1] );
      else
        value = 100;

    } else if( this.event_map !== undefined ) {
      var mapped = this.event_map[value];
      if( mapped !== undefined )
        value = mapped;

    } else if( value == 'off' )
      value = 0;
    else if( value == 'opened' )
      value = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    else if( value == 'closed' )
      value = Characteristic.ContactSensorState.CONTACT_DETECTED;
    else if( value == 'present' )
      value = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
    else if( value == 'absent' )
      value = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
    else if( value == 'locked' )
      value = Characteristic.LockCurrentState.SECURED;
    else if( value == 'unlocked' )
      value = Characteristic.LockCurrentState.UNSECURED;
    else if( value == '000000' )
      value = 0;
    else if( value.match( /^[A-D]0$/ ) ) //FIXME: not necessary any more. handled by event_map now.
      value = 0;
    else
      value = 1;

  } else {
    var orig = value;

    var format;
    if( typeof mapping.characteristic === 'object' )
      format = mapping.characteristic.props.format;
    else if( typeof mapping.characteristic === 'function' ) {
      var characteristic = new (Function.prototype.bind.apply(mapping.characteristic, arguments));

      format = characteristic.props.format;

      delete characteristic;
    } else if( mapping.format ) { // only for testing !
      format = mapping.format;

    }

    if( format === undefined ) {
      return value;
    }

    if( value !== undefined && mapping.part !== undefined ) {
      value = value.split(' ')[mapping.part];

      if( value === undefined ) {
        mapping.log.error(mapping.informId + ' value ' + orig + ' has no part ' + mapping.part);
        return value;
      }
    }

    if( typeof mapping.value2homekit_re === 'object' || typeof mapping.value2homekit === 'object' ) {
      var result;
      if( typeof mapping.value2homekit_re === 'object' )
        for( var entry of mapping.value2homekit_re ) {
          if( value.match( entry.re ) ) {
            result = entry.to;
            break;
          }
        }

      if( typeof mapping.value2homekit === 'object' )
        if( mapping.value2homekit[value] )
          result = mapping.value2homekit[value];

      if( result === undefined ) {
        mapping.log.error(mapping.informId + ' value ' + value + ' not handled in values');
        return undefined;
      }

      mapping.log.debug(mapping.informId + ' value ' + value + ' mapped to ' + result);
      value = result;
    }


    if( format == 'float' )
      value = parseFloat( value );

    else if( format == 'bool' ) {
      var orig = value;
      if( mapping.valueOn !== undefined ) {
        var match = mapping.valueOn.match('^/(.*)/$');
        if( !match && value == mapping.valueOn )
          value = 1;
        else if( match && value.toString().match( match[1] ) )
          value = 1;
        else
          value = 0;
      }
      if( mapping.valueOff !== undefined ) {
        var match = mapping.valueOff.match('^/(.*)/$');
        if( !match && value == mapping.valueOff )
          value = 0;
        else if( match && value.toString().match( match[1] ) )
          value = 0;
        else
          value = 1;
      }
      if( mapping.valueOn === undefined  &&  mapping.valueOff === undefined )
        value = parseInt( value );

      if( mapping.threshold ) {
        if( value > mapping.threshold )
          value = 1;
        else
          value = 0;
      }

      if( mapping.invert ) {
        mapping.minValue = 0;
        mapping.maxValue = 1;
      }

    } else if( format && format.match(/int/) )
      value = parseInt( value );

    if( mapping.max && mapping.maxValue ) {
      value = Math.round(value * mapping.maxValue / mapping.max );
      mapping.log.debug(mapping.informId + ' value ' + orig + ' scaled to: ' + value);
    }

    if( mapping.minValue !== undefined && value < mapping.minValue ) {
      mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to minValue: ' + mapping.minValue);
      value = parseFloat(mapping.minValue);
    } else if( mapping.maxValue !== undefined && value > mapping.maxValue ) {
      mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to maxValue: ' + mapping.maxValue);
      value = parseFloat(mapping.maxValue);
    }

    if( mapping.minStep ) {
      if( mapping.minValue )
        value -= parseFloat(mapping.minValue);
      value = parseFloat( (Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1) );
      if( mapping.minValue )
        value += parseFloat(mapping.minValue);
    }

    if( format.match(/int/) )
      value = parseInt( value );
  }

  if( typeof value === 'number' ) {
    if( isNaN(value) ) {
      mapping.log.error(mapping.informId + '  not a number ' + orig);
      return undefined;
    } else if( mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined ) {
      value = mapping.maxValue - value + mapping.minValue;
      mapping.log.debug(mapping.informId + ' value inverted to ' + value);
    } else if( mapping.invert && mapping.maxValue !== undefined ) {
      value = mapping.maxValue - value;
      mapping.log.debug(mapping.informId + ' value inverted to ' + value);
    } else if( mapping.invert ) {
      value = 100 - value;
      mapping.log.debug(mapping.informId + ' value inverted to ' + value);
    }

  }

  return(value);
}


var FHEM_lastEventTime = {};
var FHEM_longpoll_running = {};
//FIXME: add filter
function FHEM_startLongpoll(connection) {
  if( FHEM_longpoll_running[connection.base_url] )
    return;
  FHEM_longpoll_running[connection.base_url] = true;

  if( connection.disconnects === undefined )
    connection.disconnects = 0;

  var filter = '.*';
  var since = 'null';
  if( FHEM_lastEventTime[connection.base_url] )
    since = FHEM_lastEventTime[connection.base_url]/1000;
  var query = '/fhem.pl?XHR=1'+
              '&inform=type=status;addglobal=1;filter='+filter+';since='+since+';fmt=JSON'+
              '&timestamp='+Date.now()

  var url = encodeURI( connection.base_url + query );
  console.log( 'starting longpoll: ' + url );

  var FHEM_longpollOffset = 0;
  var input = '';
  connection.request.get( { url: url } ).on( 'data', function(data) {
//console.log( 'data: '+ data );
                 if( !data )
                   return;

                 input += data;
                 var lastEventTime = Date.now();
                 for(;;) {
                   var nOff = input.indexOf('\n', FHEM_longpollOffset);
                   if(nOff < 0)
                     break;
                   var l = input.substr(FHEM_longpollOffset, nOff-FHEM_longpollOffset);
                   FHEM_longpollOffset = nOff+1;
//console.log( 'Rcvd: '+(l.length>132 ? l.substring(0,132)+'...('+l.length+')':l) );

                   if(!l.length)
                     continue;

                   var d;
                   if( l.substr(0,1) == '[' )
                     d = JSON.parse(l);
                   else
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
//console.log( 'device: '+device );
//console.log( 'reading: '+reading );
                   if( reading === undefined )
                     continue;

                   var value = d[1];
//console.log( 'value: '+value );
                   if( value.match( /^set-/ ) )
                     continue;


                   if( 0 && device == 'global' ) {
                     if( reading == 'DEFINED' ) {
console.log( 'DEFINED: '+value );
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
console.log( 'DELETED: '+value );
                       var accessory = FHEM_isPublished(value);

                       //if( accessory && typeof accessory.updateReachability === 'function' )
                         //accessory.updateReachability( false );

                     } else if( reading == 'ATTR' ) {
console.log( 'ATTR: '+value );
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
console.log( 'DELETEATTR: '+value );
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
                     FHEM_lastEventTime[connection.base_url] = lastEventTime;

                     subscriptions.forEach( function(subscription) {
//console.log( 'Rcvd: '+(l.length>132 ? l.substring(0,132)+'...('+l.length+')':l) );
                       var accessory = subscription.accessory;

                       if( reading == 'state') {
                         if( accessory.mappings.window ) {
                           var level = 50;
                           if( match = value.match(/^(\d+)/ ) )
                             level = parseInt( match[1] );
                           else if( value == 'locked' )
                             level = 0;

                           FHEM_update( accessory.mappings.window.informId, level );
                           return;

                         } else if( accessory.mappings.lock ) {
                           var lock = Characteristic.LockCurrentState.UNSECURED;
                           if( value.match( /^locked/ ) )
                             lock = Characteristic.LockCurrentState.SECURED;

                           if( value.match( /uncertain/ ) )
                             level = Characteristic.LockCurrentState.UNKNOWN;

                           FHEM_update( accessory.mappings.lock.informId, lock );
                           return;

                         }

                       } else if(accessory.mappings.colormode) {
                         //FIXME: add colormode ct
                         if( reading == 'xy') {
                           var xy = value.split(',');
                           var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
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

                 input = input.substr(FHEM_longpollOffset);
                 FHEM_longpollOffset = 0;

                 connection.disconnects = 0;

               } ).on( 'end', function() {
                 FHEM_longpoll_running[connection.base_url] = false;

                 connection.disconnects++;
                 var timeout = 500 * connection.disconnects - 300;
                 if( timeout > 30000 ) timeout = 30000;

                 console.log( 'longpoll ended, reconnect in: ' + timeout + 'msec' );
                 setTimeout( function(){FHEM_startLongpoll(connection)}, timeout  );

               } ).on( 'error', function(err) {
                 FHEM_longpoll_running[connection.base_url] = false;

                 connection.disconnects++;
                 var timeout = 5000 * connection.disconnects;
                 if( timeout > 30000 ) timeout = 30000;

                 console.log( 'longpoll error: ' + err + ', retry in: ' + timeout + 'msec' );
                 setTimeout( function(){FHEM_startLongpoll(connection)}, timeout );

               } );
}

var FHEM_platforms = [];

function
FHEMPlatform(log, config) {
  this.log     = log;
  this.server  = config['server'];
  this.port    = config['port'];
  this.filter  = config['filter'];

  var base_url = 'http://';
  if( config.ssl ) {
    if( typeof config.ssl !== 'boolean' ) {
      this.log.error( 'config: value for ssl has to be boolean.' );
      process.exit(0);
    }
    base_url = 'https://';
  }
  base_url += this.server + ':' + this.port;

  var request = require('request');
  var auth = config['auth'];
  if( auth ) {
    if( auth.sendImmediately === undefined )
      auth.sendImmediately = false;

    request = request.defaults( { auth: auth, rejectUnauthorized: false } );
  }

  this.connection = { base_url: base_url, request: request };

  FHEM_platforms.push(this);

  FHEM_startLongpoll( this.connection );
}

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
FHEM_ct2rgb(ct)
{
  // calculation from http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code
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
FHEM_xyY2rgb(x,y,Y)
{
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
FHEM_rgb2hsv(r,g,b){
  if( r === undefined )
    return;

  if( g === undefined ) {
    var str = r;
    r = parseInt( str.substr(0,2), 16 );
    g = parseInt( str.substr(2,2), 16 );
    b = parseInt( str.substr(4,2), 16 );
  }

  var M = Math.max( r, g, b );
  var m = Math.min( r, g, b );
  var c = M - m;

  var h, s, v;
  if( c == 0 ) {
    h = 0;
  } else if( M == r ) {
    h = ( 60 * ( ( g - b ) / c ) % 360 ) / 360;
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

  v = M/255;

  return  [h,s,v];
}

function
FHEM_execute(log,connection,cmd,callback) {
  var url = encodeURI( connection.base_url + '/fhem?cmd=' + cmd + '&XHR=1');
  log( '  executing: ' + url );

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
  execute: function(cmd,callback) {FHEM_execute(this.log, this.connection, cmd, callback)},

  checkAndSetGenericDeviceType: function() {
    this.log('Checking genericDeviceType...');

    var cmd = '{AttrVal("global","userattr","")}';

    this.execute( cmd,
                  function(result) {
                    //if( result === undefined )
                      //result = "";

                    if( !result.match(/(^| )homebridgeMapping\b/) ) {
                      var cmd = '{ addToAttrList( "homebridgeMapping:textField-long" ) }';
                      this.execute( cmd );
                      console.log.info( 'homebridgeMapping attribute created.' );
                    }

                    if( !result.match(/(^| )genericDeviceType\b/) ) {
                      var cmd = '{addToAttrList( "genericDeviceType:ignore,switch,outlet,light,blind,thermostat,garage,window,lock" ) }';
                      this.execute( cmd,
                                    function(result) {
                                        console.log.warn( 'genericDeviceType attribute was not known. please restart homebridge.' );
                                        process.exit(0);
                                    } );
                    }

                  }.bind(this) );

  },

  accessories: function(callback) {
    this.checkAndSetGenericDeviceType();

    this.log.info("Fetching FHEM switchable devices...");

    var foundAccessories = [];

    // mechanism to ensure callback is only executed once all requests complete
    var asyncCalls = 0;
    function callbackLater() { if (--asyncCalls == 0) callback(foundAccessories); }

    var cmd = 'jsonlist2';
    if( this.filter )
      cmd += " " + this.filter;
    var url = encodeURI( this.connection.base_url + "/fhem?cmd=" + cmd + "&XHR=1");
    this.log.info( 'fetching: ' + url );


    asyncCalls++;

    this.connection.request.get( { url: url, json: true, gzip: true },
                 function(err, response, json) {
                   if( !err && response.statusCode == 200 ) {
//console.log("got json: " + util.inspect(json) );
                     this.log.info( 'got: ' + json['totalResultsReturned'] + ' results' );
                     if( json['totalResultsReturned'] ) {
                       var sArray=FHEM_sortByKey(json['Results'],"Name");
                       sArray.map( function(s) {

                         var accessory;
                         if( FHEM_isPublished(s.Internals.NAME) )
                           this.log.warn( s.Internals.NAME + ' is already published');

                         else if( 0 && s.Attributes.disable == 1 ) {
                           this.log.info( s.Internals.NAME + ' is disabled');

                         } else if( s.Internals.TYPE == 'structure' ) {
                           this.log.info( 'ignoring structure ' + s.Internals.NAME );

                         } else if( s.Attributes.genericDisplayType
                                    || s.Attributes.genericDeviceType ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.PossibleSets.match(/(^| )on\b/)
                                    && s.PossibleSets.match(/(^| )off\b/) ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Attributes.subType == 'thermostat'
                                    || s.Attributes.subType == 'blindActuator'
                                    || s.Attributes.subType == 'threeStateSensor' ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Attributes.model == 'HM-SEC-WIN' ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Attributes.model && s.Attributes.model.match(/^HM-SEC-KEY/) ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Internals.TYPE == 'PRESENCE'
                                    || s.Internals.TYPE == 'ROOMMATE' ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Internals.TYPE == 'SONOSPLAYER' ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Readings.temperature ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Readings.humidity ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Readings.voc ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else if( s.Internals.TYPE == 'harmony' ) {
                           accessory = new FHEMAccessory(this.log, this.connection, s);

                         } else {
                           this.log.info( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')' );

                         }

                         if( accessory && Object.getOwnPropertyNames(accessory).length )
                           foundAccessories.push(accessory);

                       }.bind(this) );
                     }

                     callback(foundAccessories);
                     //callbackLater();

                   } else {
                     this.log.error("There was a problem connecting to FHEM");
                     if( response )
                       this.log.error( "  " + response.statusCode + ": " + response.statusMessage );

                   }

                 }.bind(this) );
  }
}

function
FHEMAccessory(log, connection, s) {
//log( 'sets: ' + s.PossibleSets );
//log("got json: " + util.inspect(s) );
//log("got json: " + util.inspect(s.Internals) );

  if( !(this instanceof FHEMAccessory) )
    return new FHEMAccessory(log, connection, s);

  if( s.Attributes.disable == 1 ) {
    log.info( s.Internals.NAME + ' is disabled');
    //return null;

  } else if( s.Internals.TYPE == 'structure' ) {
    log.info( 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')' );
    return null;

  }

  var genericType = s.Attributes.genericDeviceType;
  if( !genericType )
    genericType = s.Attributes.genericDisplayType;

  if( genericType == 'ignore' ) {
    log.info( 'ignoring ' + s.Internals.NAME );
    return null;
  }

  this.log        = log;
  this.connection = connection;

  this.mappings = {};

  //this.service_name = 'switch';

  var match;
  if( match = s.PossibleSets.match(/(^| )pct\b/) ) {
    this.service_name = 'light';
    this.mappings.Brightness = { reading: 'pct', cmd: 'pct', delay: true };
  } else if( match = s.PossibleSets.match(/(^| )dim\d+%/) ) {
    this.service_name = 'light';
    this.mappings.Brightness = { reading: 'state', cmd: 'dim', delay: true };
  }
  if( match = s.PossibleSets.match(/(^| )hue[^\b\s]*(,(\d+)?)+\b/) ) {
    this.service_name = 'light';
    var max = 360;
    if( match[3] !== undefined )
      max = match[3];
    this.mappings.Hue = { reading: 'hue', cmd: 'hue', min: 0, max: max, maxValue: 360 };
  }
  if( match = s.PossibleSets.match(/(^| )sat[^\b\s]*(,(\d+)?)+\b/) ) {
    this.service_name = 'light';
    var max = 100;
    if( match[3] !== undefined )
      max = match[3];
    this.mappings.Saturation = { reading: 'sat', cmd: 'sat', min: 0, max: max, maxValue: 100 };
  }

  if( s.Readings.colormode )
    this.mappings.colormode = { reading: 'colormode' };
  if( s.Readings.xy )
    this.mappings.xy = { reading: 'xy' };
  //FIXME: add ct/colortemperature

  if( !this.mappings.Hue ) {
    var reading;
    var cmd;
    if( s.PossibleSets.match(/(^| )rgb\b/) ) {
      this.service_name = 'light';
      reading = 'rgb'; cmd = 'rgb';
      if( s.Internals.TYPE == 'SWAP_0000002200000003' )
        reading = '0B-RGBlevel';
    } else if( s.PossibleSets.match(/(^| )RGB\b/) ) {
      this.service_name = 'light';
      reading = 'RGB'; cmd = 'RGB';
    }

    if( reading && cmd ) {
      this.mappings.Hue = { reading: reading, cmd: cmd, min: 0, max: 360 };
      this.mappings.Saturation = { reading: reading, cmd: cmd, min: 0, max: 100 };
      this.mappings.Brightness = { reading: reading, cmd: cmd, min: 0, max: 100, delay: true };

      var homekit2reading = function(mapping, orig) {
        var h = FHEM_cached[mapping.device + '-h'];
        var s = FHEM_cached[mapping.device + '-s'];
        var v = FHEM_cached[mapping.device + '-v'];
        //console.log( ' from cached : [' + h + ',' + s + ',' + v + ']' );

        if( h === undefined ) h = 0.0;
        if( s === undefined ) s = 1.0;
        if( v === undefined ) v = 1.0;
        //console.log( ' old : [' + h + ',' + s + ',' + v + ']' );

        if( mapping.characteristic_name == 'Hue' ) {
          h = orig / mapping.max;
          FHEM_cached[mapping.device + '-h'] = h;

        } else if( mapping.characteristic_name == 'Saturation' ) {
          s = orig / mapping.max;
          FHEM_cached[mapping.device + '-s'] = s;

        } else if( mapping.characteristic_name == 'Brightness' ) {
          v = orig / mapping.max;
          FHEM_cached[mapping.device + '-v'] = v;

        }
        //console.log( ' new : [' + h + ',' + s + ',' + v + ']' );

        var value = FHEM_hsv2rgb( h, s, v );
        if( value === FHEM_cached[mapping.informId] )
          return undefined;

        FHEM_update(mapping.informId, value, true);
        //console.log( ' rgb : [' + value + ']' );

        return value;
      }

      if( this.mappings.Hue ) {
        this.mappings.Hue.reading2homekit = function(mapping, orig) {
          var hsv = FHEM_rgb2hsv(orig);
          var hue = parseInt( hsv[0] * mapping.max );

          FHEM_cached[mapping.device + '-h'] = hsv[0];

          return hue;
        }.bind(null,this.mappings.Hue);
        this.mappings.Hue.homekit2reading = homekit2reading.bind(null,this.mappings.Hue);
      }
      if( this.mappings.Saturation ) {
        this.mappings.Saturation.reading2homekit = function(mapping, orig) {
          var hsv = FHEM_rgb2hsv(orig);
          var sat = parseInt( hsv[1] * mapping.max );

          FHEM_cached[mapping.device + '-s'] = hsv[1];

          return sat;
        }.bind(null,this.mappings.Saturation);
        this.mappings.Saturation.homekit2reading = homekit2reading.bind(null,this.mappings.Saturation);
      }
      if( this.mappings.Brightness ) {
        this.mappings.Brightness.reading2homekit = function(mapping, orig) {
          var hsv = FHEM_rgb2hsv(orig);
          var bri = parseInt( hsv[2] * mapping.max );

          FHEM_cached[mapping.device + '-v'] = hsv[2];

          return bri;
        }.bind(null,this.mappings.Brightness);
        this.mappings.Brightness.homekit2reading = homekit2reading.bind(null,this.mappings.Brightness);
      }
    }
  }

  if( s.Readings['measured-temp'] ) {
    this.service_name = 'thermometer';
    this.mappings.CurrentTemperature = { reading: 'measured-temp', minValue: -30 };
  } else if( s.Readings.temperature ) {
    this.service_name = 'thermometer';
    this.mappings.CurrentTemperature = { reading: 'temperature', minValue: -30 };
  }

  if( s.Readings.volume )
    this.mappings.volume = { reading: 'volume', cmd: 'volume' };
  else if( s.Readings.Volume ) {
    this.mappings.volume = { reading: 'Volume', cmd: 'Volume', nocache: true };
    if( s.Attributes.generateVolumeEvent == 1 )
      delete this.mappings.volume.nocache;
  }

  if( s.Readings.humidity ) {
    if( !this.service_name ) this.service_name = 'HumiditySensor';
    this.mappings.CurrentRelativeHumidity = { reading: 'humidity' };
  }

  if( s.Readings.luminosity ) {
    if( !this.service_name ) this.service_name = 'LightSensor';
    this.mappings.CurrentAmbientLightLevel = { reading: 'luminosity' };
    this.mappings.CurrentAmbientLightLevel.reading2homekit = function(mapping, orig) {value = parseFloat( value ) / 0.265;};
  }

  if( s.Readings.voc ) {
    if( !this.service_name ) this.service_name = 'AirQualitySensor';
    this.mappings.AirQuality = { reading: 'voc' };
    this.mappings.AirQuality.reading2homekit = function(mapping, orig) {
      value = parseInt( value );
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
      }
  }

  if( s.Readings.motor )
    this.mappings.PositionState = { reading: 'motor',
                                    values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED' ] };

  if( s.Readings.direction )
    this.mappings.PositionState = { reading: 'direction',
                                    values: ['/^opening/:INCREASING', '/^closing/:DECREASING', '/.*/:STOPPED' ] };

  if ( s.Readings.doorState )
    this.mappings.CurrentDoorState = { reading: 'doorState',
                                       values: ['/^opening/:OPENING', '/^closing/:CLOSING',
                                                '/^open/:OPEN', '/^closed/:CLOSED', '/.*/:STOPPED' ] };

  if( s.Readings.battery ) {
    var value = parseInt( s.Readings.battery.Value );

    if( isNaN(value) )
      this.mappings.StatusLowBattery = { reading: 'battery' };
    else {
      this.mappings.BatteryLevel = { reading: 'battery' };
      this.mappings.StatusLowBattery = { reading: 'battery', threshold: 20 };
    }
  }

  if( s.Readings['D-firmware'] )
    this.mappings.FirmwareRevision = { reading: 'D-firmware' };
  else if( s.Readings.firmware )
    this.mappings.FirmwareRevision = { reading: 'firmware' };
  //FIXME: add swversion internal for HUEDevices

  if( 0 ) {
  if( s.Readings.reachable )
    this.mappings.reachable = { reading: 'reachable' };
  else if( s.PossibleAttrs.match(/[\^ ]disable\b/) )
    this.mappings.reachable = { reading: 'reachable' };
  }

  else if( genericType == 'garage' )
    this.mappings.garage = { reading: 'state', cmdOpen: 'off', cmdClose: 'on' };

  else if( genericType == 'blind'
           || s.Attributes.subType == 'blindActuator' ) {
    this.service_name = 'blind';
    delete this.mappings.Brightness;
    if( s.PossibleSets.match(/[\^ ]position\b/) ) {
      this.mappings.CurrentPosition = { reading: 'position' };
      this.mappings.TargetPosition = { reading: 'position', cmd: 'position', delay: true };
      if( this.type == 'DUOFERN' ) {
        this.mappings.CurrentPosition.invert = true;
        this.mappings.TargetPosition.invert = true;

        //the following could be used instead of invert
        //var reading2homekit = function(mapping, orig) { return 100 - parseInt( orig ) };
        //var homekit2reading = function(mapping, orig) { return 100 - orig };
        //this.mappings.CurrentPosition.reading2homekit = reading2homekit;
        //this.mappings.TargetPosition.reading2homekit = reading2homekit;
        //this.mappings.TargetPosition.homekit2reading = homekit2reading;
      }
    } else {
      this.mappings.CurrentPosition = { reading: 'pct' };
      this.mappings.TargetPosition = { reading: 'pct', cmd: 'pct', delay: true };
    }

  } else if( genericType == 'window'
             || s.Attributes.model == 'HM-SEC-WIN' ) {
    this.service_name = 'window';
    this.mappings.window = { reading: 'level', cmd: 'level' };

  } else if( genericType == 'lock'
           || ( s.Attributes.model && s.Attributes.model.match(/^HM-SEC-KEY/ ) ) ) {
    this.service_name = 'lock';
    this.mappings.lock = { reading: 'lock', cmdLock: 'lock', cmdUnlock: 'unlock', cmdOpen: 'open' };
    if( s.Internals.TYPE == 'dummy' )
      this.mappings.lock = { reading: 'lock', cmdLock: 'lock locked', cmdUnlock: 'lock unlocked', cmdOpen: 'open' };

  } else if( genericType == 'thermostat'
             || s.Attributes.subType == 'thermostat' )
    s.isThermostat = true;

  else if( s.Internals.TYPE == 'CUL_FHTTK' ) {
    this.service_name = 'ContactSensor';
    this.mappings.ContactSensorState = { reading: 'Window', values: ['/^Closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED' ] };
    this.mappings.CurrentDoorState = { reading: 'Window', values: ['/^Closed/:CLOSED', '/.*/:OPEN' ] };

  } else if( s.Internals.TYPE == 'MAX'
             && s.Internals.type == 'ShutterContact' ) {
    this.service_name = 'ContactSensor';
    this.mappings.ContactSensorState = { reading: 'state', values: ['closed:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED' ]  };
    this.mappings.CurrentDoorState = { reading: 'state', values: ['closed:CLOSED', '/.*/:OPEN' ]  };

  } else if( s.Attributes.subType == 'threeStateSensor' ) {
    this.service_name = 'ContactSensor';
    this.mappings.ContactSensorState = { reading: 'contact', values: ['/^closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED' ] };
    this.mappings.CurrentDoorState = { reading: 'contact', values: ['/^closed/:CLOSED', '/.*/:OPEN' ] };

  } else if( s.Internals.TYPE == 'PRESENCE' )
    this.mappings.OccupancyDetected = { reading: 'state', values: ['present:OCCUPANCY_DETECTED', 'absent:OCCUPANCY_NOT_DETECTED' ] };

  else if( s.Internals.TYPE == 'ROOMMATE' )
    this.mappings.OccupancyDetected = { reading: 'presence', values: ['presence:OCCUPANCY_DETECTED', '/.*/:OCCUPANCY_NOT_DETECTED' ] };

  else if( s.Attributes.model == 'fs20di' )
    this.service_name = 'light';

  if( match = s.PossibleSets.match(/(^| )desired-temp(:[^\d]*([^\$ ]*))?/) ) {
    //HM
    this.mappings.TargetTemperature = { reading: 'desired-temp', cmd: 'desired-temp', delay: true };

    if( s.Readings.controlMode )
      this.mappings.thermostat_mode = { reading: 'controlMode', cmd: 'controlMode' };

    if( s.Readings.actuator )
      this.mappings.actuation = { reading: 'actuator' };

    if( match[3] ) {
      var values = match[3].split(',');
      this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
      this.mappings.TargetTemperature.maxValue = parseFloat(values[values.length-1]);
      this.mappings.TargetTemperature.minStep = values[1] - values[0];
    }

  } else if( match = s.PossibleSets.match(/(^| )desiredTemperature(:[^\d]*([^\$ ]*))?/) ) {
    // MAX
    this.mappings.TargetTemperature = { reading: 'desiredTemperature', cmd: 'desiredTemperature', delay: true };

    if( s.Readings.mode )
      this.mappings.thermostat_mode = { reading: 'mode', cmd: 'desiredTemperature' };

    if( s.Readings.valveposition )
      this.mappings.actuation = { reading: 'valveposition' };

    if( match[3] ) {
      var values = match[3].split(',');
      this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
      this.mappings.TargetTemperature.maxValue = parseFloat(values[values.length-2]);
      this.mappings.TargetTemperature.minStep = values[1] - values[0];
    }

  } else if( match = s.PossibleSets.match(/(^| )desired(:[^\d]*([^\$ ]*))?/) ) {
    //PID20
    this.mappings.TargetTemperature = { reading: 'desired', cmd: 'desired', delay: true };

    if( s.Readings.actuation )
      this.mappings.actuation = { reading: 'actuation' };

    if( s.Readings.measured )
      this.mappings.CurrentTemperature = { reading: 'measured' };

  }

  if( s.Internals.TYPE == 'SONOSPLAYER' ) //FIXME: use sets [Pp]lay/[Pp]ause/[Ss]top
    this.mappings.On = { reading: 'transportState', cmdOn: 'play', cmdOff: 'pause', valueOn: 'PLAYING' };

  else if( s.Internals.TYPE == 'harmony' ) {
    if( s.Internals.id !== undefined ) {
      if( s.Attributes.genericDeviceType )
        this.mappings.On = { reading: 'power', cmdOn: 'on', cmdOff: 'off' };
      else
        return null;

    } else if( !s.Attributes.homebridgeMapping ) {
      this.service_name = 'switch';

      var match;
      if( match = s.PossibleSets.match(/(^| )activity:([^\s]*)/) ) {
        this.mappings.On = [];

        for( var activity of match[2].split(',') ) {
          this.mappings.On.push( {reading: 'activity', subtype:activity, valueOn: activity, cmdOn: 'activity+'+activity, cmdOff: 'off'} );
        }
      }
    }

  } else if( s.PossibleSets.match(/(^| )on\b/)
           && s.PossibleSets.match(/(^| )off\b/) ) {
    this.mappings.On = { reading: 'state', cmdOn: 'on', cmdOff: 'off' };
    if( !s.Readings.state )
      delete this.mappings.On.reading;
    else
      this.service_name = 'switch';
  }

  if( this.service_name === undefined )
    this.service_name = genericType;
  if( this.service_name === undefined ) {
    log.error( s.Internals.NAME + ': no service type detected' );
    return {};
  }
  if( this.service_name === undefined )
    this.service_name = 'switch';

  var event_map = s.Attributes.eventMap;
  if( event_map ) {
    for( var part of event_map.split( ' ' ) ) {
      var map = part.split( ':' );
      if( map[1] == 'on'
          || map[1] == 'off' ) {
        if( !this.event_map )
          this.event_map = {}
        this.event_map[map[0]] = map[1];
      }
    }
  }

  this.fromHomebridgeMapping( s.Attributes.homebridgeMapping );
  log.debug( 'mappings for ' + s.Internals.NAME + ': '+ util.inspect(this.mappings) );

  if( this.service_name !== undefined ) {
    log( s.Internals.NAME + ' is ' + this.service_name );
    if( this.mappings.rgb )
      log( s.Internals.NAME + ' has RGB [' + this.mappings.rgb.reading +']');
    if( this.mappings.Brightness )
      log( s.Internals.NAME + ' is dimable ['+ this.mappings.Brightness.reading +';' + this.mappings.Brightness.cmd +']' );
  } else if( this.mappings.door )
    log( s.Internals.NAME + ' is door' );
  else if( this.mappings.garage )
    log( s.Internals.NAME + ' is garage' );
  else if( this.mappings.lock )
    log( s.Internals.NAME + ' is lock ['+ this.mappings.lock.reading +']' );
  else if( this.mappings.window )
    log( s.Internals.NAME + ' is window' );
  else if( this.mappings.CurrentPosition )
    log( s.Internals.NAME + ' is blind ['+ this.mappings.CurrentPosition.reading +']' );
  else if( this.mappings.TargetTemperature )
    log( s.Internals.NAME + ' is thermostat ['+ this.mappings.TargetTemperature.reading + ';' + this.mappings.TargetTemperature.minValue + '-' + this.mappings.TargetTemperature.maxValue + ':' + this.mappings.TargetTemperature.minStep +']' );
  else if( this.mappings.ContactSensor )
    log( s.Internals.NAME + ' is contact sensor [' + this.mappings.ContactSensor.reading +']' );
  else if( this.mappings.OccupancyDetected )
    log( s.Internals.NAME + ' is occupancy sensor' );
  else if( !this.mappings ) {
    log.error( s.Internals.NAME + ': no service type detected' );
    return {};
  }


  if( this.mappings.On )
    log( s.Internals.NAME + ' has On [' +  this.mappings.On.reading + ';' + this.mappings.On.cmdOn +',' + this.mappings.On.cmdOff + ']' );
  if( this.mappings.Hue )
    log( s.Internals.NAME + ' has Hue [' + this.mappings.Hue.reading + ';0-' + this.mappings.Hue.max +']' );
  if( this.mappings.Saturation )
    log( s.Internals.NAME + ' has Saturation [' + this.mappings.Saturation.reading + ';0-' + this.mappings.Saturation.max +']' );
  if( this.mappings.colormode )
    log( s.Internals.NAME + ' has colormode [' + this.mappings.colormode.reading +']' );
  if( this.mappings.xy )
    log( s.Internals.NAME + ' has xy [' + this.mappings.xy.reading +']' );
  if( this.mappings.thermostat_mode )
    log( s.Internals.NAME + ' has thermostat mode ['+ this.mappings.thermostat_mode.reading + ';' + this.mappings.thermostat_mode.cmd +']' );
  if( this.mappings.CurrentTemperature )
    log( s.Internals.NAME + ' has CurrentTemperature ['+ this.mappings.CurrentTemperature.reading +']' );
  if( this.mappings.CurrentRelativeHumidity )
    log( s.Internals.NAME + ' has CurrentRelativeHumidity ['+ this.mappings.CurrentRelativeHumidity.reading +']' );
  if( this.mappings.CurrentAmbientLightLevel )
    log( s.Internals.NAME + ' has CurrentAmbientLightLevel ['+ this.mappings.CurrentAmbientLightLevel.reading +']' );
  if( this.mappings.AirQuality )
    log( s.Internals.NAME + ' has AirQuality ['+ this.mappings.AirQuality.reading +']' );
  if( this.mappings.PositionState )
    log( s.Internals.NAME + ' has PositionState ['+ this.mappings.PositionState.reading +']' );
  if( this.mappings.CurrentDoorState )
    log( s.Internals.NAME + ' has CurrentDoorState ['+ this.mappings.CurrentDoorState.reading +']');
  if( this.mappings.BatteryLevel )
    log( s.Internals.NAME + ' has BatteryLevel ['+ this.mappings.BatteryLevel.reading +']' );
  if( this.mappings.StatusLowBattery )
    log( s.Internals.NAME + ' has StatusLowBattery ['+ this.mappings.StatusLowBattery.reading +']' );
  if( this.mappings.FirmwareRevision )
    log( s.Internals.NAME + ' has FirmwareRevision ['+ this.mappings.FirmwareRevision.reading +']' );
  if( this.mappings.volume )
    log( s.Internals.NAME + ' has volume ['+ this.mappings.volume.reading + ':' + (this.mappings.volume.nocache ? 'not cached' : 'cached' )  +']' );
  if( this.mappings.reachable )
    log( s.Internals.NAME + ' has reachability ['+ this.mappings.reachable.reading +']' );

//log( util.inspect(s) );

  // device info
  this.name		= s.Internals.NAME;
  this.alias		= s.Attributes.alias ? s.Attributes.alias : s.Internals.NAME;
  this.device		= s.Internals.NAME;
  this.type             = s.Internals.TYPE;
  this.model            = s.Readings.model ? s.Readings.model.Value
                                           : (s.Attributes.model ? s.Attributes.model
                                                                 : ( s.Internals.model ? s.Internals.model : '<unknown>' ) );
  this.PossibleSets     = s.PossibleSets;

  if( this.type == 'CUL_HM' ) {
    this.serial = this.type + '.' + s.Internals.DEF;
    if( s.Attributes.serialNr )
      this.serial = s.Attributes.serialNr;
    else if( s.Readings['D-serialNr'] && s.Readings['D-serialNr'].Value )
      this.serial = s.Readings['D-serialNr'].Value;
  } else if( this.type == 'CUL_WS' )
    this.serial = this.type + '.' + s.Internals.DEF;
  else if( this.type == 'FS20' )
    this.serial = this.type + '.' + s.Internals.DEF;
  else if( this.type == 'IT' )
    this.serial = this.type + '.' + s.Internals.DEF;
  else if( this.type == 'HUEDevice' ) {
    if( s.Internals.uniqueid && s.Internals.uniqueid != 'ff:ff:ff:ff:ff:ff:ff:ff-0b' )
      this.serial = s.Internals.uniqueid;
  } else if( this.type == 'SONOSPLAYER' )
    this.serial = s.Internals.UDN;
  else if( this.type == 'EnOcean' )
    this.serial = this.type + '.' + s.Internals.DEF;
  else if( this.type == 'MAX' )
    this.serial = this.type + '.' + s.Internals.addr;

  this.uuid_base = this.serial;

//log( util.inspect(s.Readings) );

  if( this.mappings.CurrentPosition || this.mappings.door || this.mappings.garage || this.mappings.window || this.mappings.TargetTemperature )
    delete this.mappings.On;

  if( s.isThermostat && (!this.mappings.TargetTemperature
                         || !this.mappings.TargetTemperature.cmd
                         || !s.PossibleSets.match('(^| )'+this.mappings.TargetTemperature.cmd+'\\b') ) ) {
    log.error( s.Internals.NAME + ' is NOT a thermostat. set command for target temperature missing: '
                          + (this.mappings.TargetTemperature && this.mappings.TargetTemperature.cmd?this.mappings.TargetTemperature.cmd:'') );
    s.isThermostat = false;
    delete this.mappings.TargetTemperature;
  }


  for( var characteristic_name in this.mappings ) {
    var mappings = this.mappings[characteristic_name];
    if( !Array.isArray(mappings) )
       mappings = [mappings];

    for( var mapping of mappings ) {
      var device = this.device;
      if( mapping.device === undefined )
        mapping.device = device;
      else
        device = mapping.device;

      mapping.characteristic = this.characteristicOfName(characteristic_name);
      mapping.informId = device +'-'+ mapping.reading;
      mapping.characteristic_name = characteristic_name;
      mapping.log = this.log;

      if( typeof mapping.values === 'object' ) {
        mapping.value2homekit = {};
        mapping.value2homekit_re = [];
        for( var entry of mapping.values ) {
          var match = entry.match('^([^:]*)(:(.*))?$');
          if( !match ) {
            log.error( 'values: format wrong for ' + entry );
            continue;
          }

          var from = match[1];
          var to = match[3] === undefined ? i : match[3];

          if( Characteristic[mapping.characteristic_name] && Characteristic[mapping.characteristic_name][to] !== undefined )
            to = Characteristic[mapping.characteristic_name][to];

          var match;
          if( match = from.match('^/(.*)/$') )
            mapping.value2homekit_re.push( { re: match[1], to: to} );
          else
            mapping.value2homekit[from] = to;
        }
        if(mapping.value2homekit_re.length) this.log.debug( 'value2homekit_re: ' + util.inspect(mapping.value2homekit_re) );
        if(Object.keys(mapping.value2homekit).length) this.log.debug( 'value2homekit: ' + util.inspect(mapping.value2homekit) );
      }

      if( typeof mapping.cmds === 'object' ) {
        mapping.homekit2cmd = {};
        for( var entry of mapping.cmds ) {
          var match = entry.match('^([^:]*)(:(.*))?$');
          if( !match ) {
            log.error( 'cmds: format wrong for ' + entry );
            continue;
          }

          var from = (match[1] === undefined || match[2] === undefined ) ? i : match[1];
          var to = match[2] !== undefined ? match[3] : match[1];

          if( Characteristic[mapping.characteristic_name] && Characteristic[mapping.characteristic_name][from] !== undefined )
            from = Characteristic[mapping.characteristic_name][from];

          mapping.homekit2cmd[from] = to;
        }
        if(Object.keys(mapping.homekit2cmd).length) this.log.debug( 'homekit2cmd: ' + mapping.homekit2cmd );
      }

      var orig;
      if( device != this.device )
        orig = this.query(mapping);
      else if( s.Readings[mapping.reading] && s.Readings[mapping.reading].Value )
        orig = s.Readings[mapping.reading].Value;

      if( orig === undefined && device == this.device ) {
        delete mapping.informId;

      } else if( orig !== undefined ) {
        if( !mapping.nocache ) {
          if( FHEM_cached[mapping.informId] === undefined )
            FHEM_update(mapping.informId, orig);

          var value;
          if( typeof mapping.reading2homekit === 'function' )
            value = mapping.reading2homekit(orig);
          else
            value = FHEM_reading2homekit(mapping, orig);

          mapping.cached = value;
          mapping.log.info("    caching: " + mapping.characteristic_name + (mapping.subtype?':'+mapping.subtype:'') + ": " + value + " (" + typeof(value) + "; from " + orig + ")" );
        }
      }

    }
  }

}

FHEM_dim_values = [ 'dim06%', 'dim12%', 'dim18%', 'dim25%', 'dim31%', 'dim37%', 'dim43%', 'dim50%', 'dim56%', 'dim62%', 'dim68%', 'dim75%', 'dim81%', 'dim87%', 'dim93%' ];

FHEMAccessory.prototype = {
  subscribe: function(mapping, characteristic) {
    if( typeof mapping === 'object' ) {
      mapping.characteristic = characteristic;

      if( characteristic )
        characteristic.FHEM_mapping = mapping;

      FHEM_subscribe(this, mapping.informId, characteristic);

    } else {
      FHEM_subscribe(this, mapping, characteristic);

    }
  },

  fromHomebridgeMapping: function(homebridgeMapping) {
    if( !homebridgeMapping )
      return;

    this.log.info( 'homebridgeMapping: ' + homebridgeMapping );

    if( homebridgeMapping.match( /^{.*}$/ ) ) {
      homebridgeMapping = JSON.parse(homebridgeMapping);

      //FIXME: handle multiple identical characteristics in this.mappings and in homebridgeMapping
      if( 1 )
        this.mappings = homebridgeMapping;
      else
      for( var characteristic in homebridgeMapping )
        for( var attrname in homebridgeMapping[characteristic] ) {
          if( !this.mappings[characteristic] )
            this.mappings[characteristic] = {};
          this.mappings[characteristic][attrname] = homebridgeMapping[characteristic][attrname];
      }

      return;
    }

    var seen = {};
    for( var mapping of homebridgeMapping.split(/ |\n/) ) {
      if( !mapping )
        continue;

      if( mapping == 'clear' ) {
        this.mappings = {};
        continue;
      }

      var parts = mapping.split('=');
      if( parts.length < 2 || !parts[1] ) {
        this.log.error( '  wrong syntax: ' + mapping );
        continue;
      }

      var characteristic = parts[0];
      var params = parts.slice(1).join('=');

      var mapping;
      if( !seen[characteristic] && this.mappings[characteristic] !== undefined )
        mapping = this.mappings[characteristic];
      else {
        mapping = {};
        if( this.mappings[characteristic] )
          this.mappings[characteristic] = [this.mappings[characteristic], mapping];
        else
          this.mappings[characteristic] = mapping;
      }
      seen[characteristic] = true;

      for( var param of params.split(',') ) {
        if( param == 'clear' ) {
          mapping = {};
          continue;
        }

        var p = param.split('=');
        if( p.length == 2 )
          if( p[0] == 'values' )
            mapping[p[0]] = p[1].split(';');
          else if( p[0] == 'cmds' )
            mapping[p[0]] = p[1].split(';');
          else
            mapping[p[0]] = p[1];

        else if( p.length == 1 ) {
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


        } else {
          this.log.error( '  wrong syntax: ' + param );

        }
      }
    }
  },

  delayed: function(c,value,delay) {
    if( !this.delayed_timers )
      this.delayed_timers = {};

    if( typeof delay !== 'numeric' )
      delay = 1000;
    if( delay < 500 )
      delay = 500;

    var timer = this.delayed_timers[c];
    if( timer ) {
      //this.log(this.name + " delayed: removing old command " + c);
      clearTimeout( timer );
    }

    this.log.info(this.name + " delaying command " + c + " with value " + value);
    this.delayed_timers[c] = setTimeout( function(){delete this.delayed_timers[c]; this.command(c,value);}.bind(this), delay );
  },

  command: function(mapping,value) {
    var c = mapping;
    if( typeof mapping === 'object' )
      c = mapping.cmd;
    else
      this.log.info(this.name + " sending command " + c + " with value " + value);

    var command;
    if( c == 'identify' ) {
      if( this.type == 'HUEDevice' )
        command = "set " + this.device + "alert select";
      else
        command = "set " + this.device + " toggle; sleep 1; set "+ this.device + " toggle";

    } else if( c == 'set' ) {
      command = "set " + this.device + " " + value;

    } else if( c == 'volume' ) {
      command = "set " + this.device + " volume " + value;

    } else if( c == 'pct' ) {
      command = "set " + this.device + " pct " + value;

    } else if( c == 'dim' ) {
      //if( value < 3 )
      //  command = "set " + this.device + " off";
      //else
      if( value > 97 )
        command = "set " + this.device + " on";
      else
        command = "set " + this.device + " " + FHEM_dim_values[Math.round(value/6.25)];

    } else if( c == 'hue' ) {
        value = Math.round(value * this.mappings.Hue.max / 360);
        command = "set " + this.device + " hue " + value;

    } else if( c == 'sat' ) {
      value = value / 100 * this.mappings.Saturation.max;
      command = "set " + this.device + " sat " + value;

    } else if( c == 'targetTemperature' ) {
      command = "set " + this.device + " " + this.mappings.TargetTemperature.cmd + " " + value;

    } else if( c == 'targetMode' ) {
      var cmd = this.mappings.thermostat_mode.cmd;
      if( value == Characteristic.TargetHeatingCoolingState.OFF ) {
        value = 'off'
        if( this.mappings.thermostat_mode.cmd == 'controlMode' )
          cmd = 'desired-temp';

      } else if( value == Characteristic.TargetHeatingCoolingState.AUTO ) {
        value = 'auto'

      }else {
        if( this.mappings.thermostat_mode == 'controlMode' )
          value = 'manu';
        else {
          value = FHEM_cached[this.mappings.TargetTemperature.informId];
          cmd = 'desired-temp';
        }

      }
      command = "set " + this.device + " " + cmd + " " + value;

    } else if( c == 'targetPosition' ) {
      if( this.mappings.window ) {
        if( value == 0 )
          value = 'lock';

        command = "set " + this.device + " " + this.mappings.window.cmd + " " + value;

      } else
        this.log.error(this.name + " Unhandled command! cmd=" + c + ", value=" + value);

    } else if( mapping.cmd ) {
      this.log.info(this.name + ': sending ' + mapping.characteristic_name + ' with value ' + value + ' to set ' + mapping.cmd );

      if( typeof mapping.homekit2reading === 'function' ) {
        value = mapping.homekit2reading( value );
        if( value === undefined ) {
          this.log.info( '  converted value is unchanged ' );
          return;

        }

        this.log.info( '  value converted to ' + value );
      } else {
        if( typeof value === 'number' ) {
          if( mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined )
            value = mapping.maxValue - value + mapping.minValue;
          else if( mapping.invert && mapping.maxValue !== undefined )
            value = mapping.maxValue - value;
          else if( mapping.invert )
            value = 100 - value;
          }
      }

      if( mapping.max !== undefined && mapping.maxValue != undefined )
        value = Math.round(value * mapping.max / mapping.maxValue);

      var cmd = mapping.cmd;

      if( mapping.cmdOn !== undefined && value == 1 )
        cmd = mapping.cmdOn

      else if( mapping.cmdOff !== undefined && value == 0 )
        cmd = mapping.cmdOff

      else if( typeof mapping.homekit2cmd === 'object' ) {
        cmd = homekit2cmd[value];
      }

      if( cmd === undefined ) {
        this.log.error(this.name + ' no cmd for ' + c + ', value ' + value);
        return;
      }

      command = 'set ' + this.device + ' ' + cmd + ' ' + value;

    }

    if( command === undefined) {
      this.error(this.name + ' Unhandled command! cmd=' + c + ', value ' + value);
      return;
    }

    this.execute(cmd);
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

    if( reading === undefined ) {
      if( callback !== undefined )
        callback( 1 );
      return;
    }

    this.log.info('query: ' + mapping.characteristic_name + ' for ' + mapping.informId);
    var result = mapping.cached;
    if( result !== undefined ) {
      this.log.info("  cached: " + result);
      if( callback !== undefined )
        callback( undefined, result );
      return result;

    } else {
      this.log.info('not cached; query: ' + mapping.informId);

      var result = FHEM_cached[mapping.informId];
      result = FHEM_reading2homekit(mapping, result);

      if( result !== undefined ) {
        this.log.info("  cached: " + result);
        if( callback !== undefined )
          callback( undefined, result );
        return result;

      } else
        this.log.info("  not cached" );
    }

    var query_reading = reading;
    if( reading == 'level' && this.mappings.window ) {
      query_reading = 'state';

    } else if( reading == 'lock' && this.mappings.lock ) {
      //query_reading = 'state';

    }

    var cmd = '{ReadingsVal("'+device+'","'+query_reading+'","")}';

    this.execute( cmd,
                  function(result) {
                    value = result.replace(/[\r\n]/g, "");
                    this.log.info("  value: " + value);

                    if( value === undefined )
                      return value;

                    if( reading != query_reading ) {
                      if( reading == 'level'
                                 && query_reading == 'state') {

                        if( match = value.match(/^(\d+)/ ) )
                          value = parseInt( match[1] );
                        else if( value == 'locked' )
                          value = 0;
                        else
                          value = 50;

                      } else if( reading == 'lock'
                                 && query_reading == 'state') {

                        if( value.match( /uncertain/ ) )
                          value = Characteristic.LockCurrentState.UNKNOWN;
                        else if( value.match( /^locked/ ) )
                          value = Characteristic.LockCurrentState.SECURED;
                        else
                          value = Characteristic.LockCurrentState.UNSECURED;

                      }

                    }

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

  serviceOfName: function(service_name,subtype) {
    var serviceNameOfGenericDeviceType = {      ignore: null,
                                                switch: 'Switch',
                                                outlet: 'Outlet',
                                                 light: 'Lightbulb',
                                                 blind: 'WindowCovering',
                                           thermometer: 'TemperatureSensor',
                                            thermostat: 'Thermostat',
                                                garage: 'GarageDoorOpener',
                                                window: 'WindowCovering',
                                                  lock: 'LockMechanism'
                                         };

    if( serviceNameOfGenericDeviceType[service_name] !== undefined )
      service_name = serviceNameOfGenericDeviceType[service_name];

    var service = Service[service_name];
    if( typeof service === 'function' ) {
      //var name = this.alias + ' (' + this.name + ')';
      var name = this.alias;
      if( subtype )
        //name = subtype + ' (' + this.name + ')';
        name = subtype + ' (' + this.alias + ')';

      this.service_name = service_name;
      this.log('  ' + service_name + ' service for ' + this.name + (subtype?' (' + subtype + ')':'') );
      return new service(name,subtype);
    }

    if( service === undefined )
      this.log.error(this.name + ': service name '+ service_name + ' unknown')

    return undefined;
  },

  characteristicOfName: function(name) {
    var characteristic = Characteristic[name];
    if( typeof characteristic === 'function' )
      return characteristic;

    return undefined;
  },

  createDeviceService: function(subtype) {
    //var name = this.alias + ' (' + this.name + ')';
    var name = this.alias;
    if( subtype )
      //name = subtype + ' (' + this.name + ')';
      name = subtype + ' (' + this.alias + ')';

    var service = this.serviceOfName(this.service_name,subtype);
    if( typeof service === 'object' )
      return service;

    if( this.mappings.garage ) {
      this.log("  garage door opener service for " + this.name)
      return new Service.GarageDoorOpener(name);
    } else if( this.mappings.lock ) {
      this.log("  lock mechanism service for " + this.name)
      return new Service.LockMechanism(name);
    } else if( this.mappings.window ) {
      this.log("  window service for " + this.name)
      return new Service.Window(name);
    }

    this.log("  switch service for " + this.name + ' (' + subtype + ')' )
    return new Service.Switch(name, subtype);
  },

  identify: function(callback) {
    this.log('['+this.name+'] identify requested!');
    if( match = this.PossibleSets.match(/(^| )toggle\b/) ) {
      this.command( 'identify' );
    }
    callback();
  },

  getServices: function() {
    var services = [];

    this.log("creating services for " + this.name)

    this.log("  information service for " + this.name)
    var informationService = new Service.AccessoryInformation();
    services.push( informationService );

    this.log("    manufacturer, model and serial number characteristics for " + this.name)
    informationService
      .setCharacteristic(Characteristic.Manufacturer, "FHEM:"+this.type)
      .setCharacteristic(Characteristic.Model, "FHEM:"+ (this.model ? this.model : '<unknown>') )
      .setCharacteristic(Characteristic.SerialNumber, this.serial ? this.serial : '<unknown>');


    if( this.mappings.FirmwareRevision ) {
      this.log("    firmware revision characteristic for " + this.name)

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

    if( Characteristic.Reachable )
      if( this.mappings.reachable ) {
        this.log("  bridging service for " + this.name)
        var bridgingService = new Service.BridgingState();
        services.push( bridgingService );

        this.log("    reachability characteristic for " + this.name)
        var characteristic = bridgingService.getCharacteristic(Characteristic.Reachable);

        this.subscribe(this.mappings.reachable,characteristic);
        characteristic.value = FHEM_cached[this.mappings.reachable.informId]==true;

        characteristic
          .on('get', function(callback) {
                       this.query(this.mappings.reachable, callback);
                     }.bind(this) );
    }


    if( this.mappings.xy
        && this.mappings.colormode ) {
      this.subscribe(this.mappings.xy);
      this.subscribe(this.mappings.colormode);


      //FIXME: add colormode ct
      if( FHEM_cached[this.mappings.colormode.informId] == 'xy' ) {
        var mapping = this.mappings.xy;
        var value = FHEM_cached[mapping.informId];
        var xy = value.split(',');
        var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
        var hsv = FHEM_rgb2hsv(rgb);

        FHEM_cached[mapping.device + '-h'] = hsv[0];
        FHEM_cached[mapping.device + '-s'] = hsv[1];
        FHEM_cached[mapping.device + '-v'] = hsv[2];
      }
    }

    var controlService = this.createDeviceService();
    services.push( controlService );

    var seen = {};
    for( var characteristic_name in this.mappings ) {
      var mappings = this.mappings[characteristic_name];
      if( !Array.isArray(mappings) )
         mappings = [mappings];

      for( var mapping of mappings ) {
        if( !mapping.characteristic ) {
          //this.log.error(this.name + ': '+ ' no such characteristic: ' + characteristic_name );
          continue;
        }

        if( seen[characteristic_name] ) {
          if( mapping.subtype === undefined ) {
            this.log.error(this.name + ': '+ characteristic_name + ' characteristic already defined for service ' + this.name + ' and no subtype given');
            continue;
          }

          controlService = this.createDeviceService( mapping.subtype );
          controlService.getCharacteristic(Characteristic.Name).setValue(mapping.subtype);
          services.push( controlService );

        } else if( mapping.subtype ) {
          controlService.subtype = mapping.subtype;
          controlService.getCharacteristic(Characteristic.Name).setValue(mapping.subtype);

        }

        var characteristic = controlService.getCharacteristic(mapping.characteristic)
                             || controlService.addCharacteristic(mapping.characteristic)
        seen[characteristic_name] = true;

        if( !characteristic ) {
          this.log.error(this.name + ': no '+ characteristic_name + ' characteristic available for service ' + this.service_name);
          continue;
        }
        if( mappings.subtype )
          this.log('    ' + characteristic_name + ':' + mappings.subtype + ' characteristic for ' + mapping.device + ':' + mapping.reading);
        else
          this.log('    ' + characteristic_name + ' characteristic for ' + mapping.device + ':' + mapping.reading);

        this.subscribe(mapping, characteristic);

        if( mapping.cached !== undefined ) {
          characteristic.value = mapping.cached;
          this.log.debug('      initial value is: ' + mapping.cached + ' (' + typeof(mapping.cached) + ')' );
        } else {
          this.log.debug('      no initial value. default is: ' + characteristic.value + ' (' + typeof(characteristic.value) + ')' );
        }

        if( mapping.minValue !== undefined ) characteristic.setProps( { minValue: mapping.minValue, } );
        if( mapping.maxValue !== undefined ) characteristic.setProps( { maxValue: mapping.maxValue, } );
        if( mapping.minStep !== undefined ) characteristic.setProps( { minStep: mapping.minStep, } );

        this.log.debug('      props: ' + util.inspect(characteristic.props) );

        characteristic
          .on('set', function(mapping, value, callback, context) {
                       if( context !== 'fromFHEM' ) {
                         if( mapping.delayed )
                           this.delayed(mapping, value, mapping.delayed);
                         else if( mapping.cmd )
                           this.command(mapping, value);
                         else
                           this.command( 'set', value == 0 ? (mapping.cmdOff?mapping.cmdOff:mapping.cmd) : (mapping.cmdOn?mapping.cmdOn:mapping.cmd) );
                       }
                       callback();
                     }.bind(this,mapping) )
          .on('get', function(callback) {
                       this.query(mapping, callback);
                     }.bind(this) );
      }
    }


    if( this.mappings.volume ) {
      this.log("    custom volume characteristic for " + this.name);

      var characteristic = new Characteristic('Volume', '00000027-0000-1000-8000-0026BB765291'); // FIXME!!!
      controlService.addCharacteristic(characteristic);

      if( !this.mappings.volume.nocache ) {
        this.subscribe(this.mappings.volume.informId, characteristic);
        characteristic.value = FHEM_cached[this.mappings.volume.informId];
      } else {
        characteristic.value = 10;
      }

      characteristic.setProps({
        format: Characteristic.Formats.UINT8,
        unit: Characteristic.Units.PERCENTAGE,
        maxValue: 100,
        minValue: 0,
        minStep: 1,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
      });

      characteristic.readable = true;
      characteristic.writable = true;
      characteristic.supportsEventNotification = true;

      characteristic
        .on('set', function(value, callback, context) {
                     if( context !== 'fromFHEM' )
                       this.delayed('volume', value);
                     callback();
                   }.bind(this) )
        .on('get', function(callback) {
                     this.query(this.mappings.volume, callback);
                   }.bind(this) );
    }

    if( this.mappings.window ) {
      this.log("    current position characteristic for " + this.name);

      var characteristic = controlService.getCharacteristic(Characteristic.CurrentPosition);

      this.subscribe(this.name+'-state', characteristic);
      this.subscribe(this.mappings.window.informId, characteristic);
      characteristic.value = FHEM_cached[this.mappings.window.informId];

      characteristic
        .on('get', function(callback) {
                     this.query(this.mappings.window, callback);
                   }.bind(this) );


      this.log("    target position characteristic for " + this.name);

      var characteristic = controlService.getCharacteristic(Characteristic.TargetPosition);

      characteristic.value = FHEM_cached[this.mappings.window.informId];

      characteristic
        .on('set', function(value, callback, context) {
                     if( context !== 'fromFHEM' )
                       this.delayed('targetPosition', value, 1500);
                     callback();
                   }.bind(this) )
        .on('get', function(callback) {
                     this.query(this.mappings.window, callback);
                   }.bind(this) );
    }

    if( this.mappings.lock ) {
      this.log("    lock current state characteristic for " + this.name);

      var characteristic = controlService.getCharacteristic(Characteristic.LockCurrentState);

      //this.subscribe(this.name+'-state', characteristic);
      this.subscribe(this.mappings.lock.informId, characteristic);
      characteristic.value = FHEM_cached[this.mappings.lock.informId];

      characteristic
        .on('get', function(callback) {
                     this.query(this.mappings.lock, callback);
                   }.bind(this) );

      this.log("    lock target state characteristic for " + this.name);

      var characteristic = controlService.getCharacteristic(Characteristic.LockTargetState);

      characteristic.value = FHEM_cached[this.mappings.lock.informId];

      characteristic
        .on('set', function(value, callback, context) {
                     if( context !== 'fromFHEM' )
                       this.command( 'set', value == Characteristic.LockTargetState.UNSECURED ? this.mappings.lock.cmdUnlock : this.mappings.lock.cmdLock );
                     callback();
                   }.bind(this) )
        .on('get', function(callback) {
                     this.query(this.mappings.lock, callback);
                   }.bind(this) );

      if( this.mappings.lock.cmdOpen ) {
        this.log("    target door state characteristic for " + this.name);

        var characteristic = controlService.addCharacteristic(Characteristic.TargetDoorState);

        characteristic.value = Characteristic.TargetDoorState.CLOSED;

        characteristic
          .on('set', function(characteristic,value, callback, context) {
                       if( context !== 'fromFHEM' ) {
                         this.command( 'set', this.mappings.lock.cmdOpen );
                         setTimeout( function(){characteristic.setValue(Characteristic.TargetDoorState.CLOSED, undefined, 'fromFHEM');}, 500  );
                       }
                       if( callback ) callback();
                     }.bind(this,characteristic) )
          .on('get', function(callback) {
                       callback(undefined,Characteristic.TargetDoorState.CLOSED);
                     }.bind(this) );
      }

    }

    if( this.mappings.garage ) {
      this.log("    current door state characteristic for " + this.name);

      var characteristic = controlService.getCharacteristic(Characteristic.CurrentDoorState);

      characteristic.value = Characteristic.CurrentDoorState.STOPPED;

      if (this.mappings.CurrentDoorState) {
        this.subscribe(this.mappings.CurrentDoorState.informId, characteristic);
        characteristic.value = this.mappings.CurrentDoorState?FHEM_cached[this.mappings.CurrentDoorState.informId]:Characteristic.CurrentDoorState.STOPPED;
        characteristic
          .on('get', function(callback) {
                       this.query(this.mappings.CurrentDoorState, callback);
                     }.bind(this) );

      } else {
        characteristic
          .on('get', function(callback) {
                       callback(undefined, Characteristic.CurrentDoorState.STOPPED);
                     }.bind(this) );
      }


      this.log("    target door state characteristic for " + this.name);

      var characteristic = controlService.getCharacteristic(Characteristic.TargetDoorState);

      characteristic.value = 1;

      characteristic
        .on('set', function(value, callback, context) {
                     if( context !== 'fromFHEM' )
                       this.command( 'set', value == 0 ? this.mappings.garage.cmdOpen : this.mappings.garage.cmdClose );
                     callback();
                   }.bind(this) )
        .on('get', function(callback) {
                     this.query(this.mappings.garage, callback);
                   }.bind(this) );
    }

    if( this.mappings.TargetTemperature ) {
      if( this.mappings.thermostat_modex ) {
        this.log("    current mode characteristic for " + this.name);

        var characteristic = controlService.getCharacteristic(Characteristic.CurrentHeatingCoolingState);

        this.subscribe(this.mappings.thermostat_mode.informId, characteristic);
        characteristic.value = FHEM_cached[this.mappings.thermostat_mode.informId];

        characteristic
          .on('get', function(callback) {
                       this.query(this.mappings.thermostat_mode, callback);
                     }.bind(this) );
      }

      if( this.mappings.thermostat_modex ) {
        this.log("    target mode characteristic for " + this.name);

        var characteristic = controlService.getCharacteristic(Characteristic.TargetHeatingCoolingState);

        this.subscribe(this.mappings.thermostat_mode.informId, characteristic);
        characteristic.value = FHEM_cached[this.mappings.thermostat_mode.informId];

        characteristic
          .on('set', function(value, callback, context) {
                       if( context !== 'fromFHEM' )
                         this.command('targetMode', value);
                       callback();
                     }.bind(this) )
          .on('get', function(callback) {
                       this.query(this.mappings.thermostat_mode, callback);
                     }.bind(this) );
      }

      if( this.mappings.actuation ) {
        this.log("    custom actuation characteristic for " + this.name);

        var characteristic = new Characteristic('Actuation', '10000027-0000-1000-8000-0026BB765291'); // FIXME!!!
        controlService.addCharacteristic(characteristic);

        this.subscribe(this.mappings.actuation.informId, characteristic);
        characteristic.value = FHEM_cached[this.mappings.actuation.informId];

        characteristic.setProps({
          format: Characteristic.Formats.UINT8,
          unit: Characteristic.Units.PERCENTAGE,
          maxValue: 100,
          minValue: 0,
          minStep: 1,
          perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });

        characteristic.readable = true;
        characteristic.supportsEventNotification = true;

        characteristic
          .on('get', function(callback) {
                       this.query(this.mappings.actuation, callback);
                     }.bind(this) );
      }
    }

    return services;
  }

};

//module.exports.accessory = FHEMAccessory;
//module.exports.platform = FHEMPlatform;



//http server for debugging
var http = require('http');

const FHEMdebug_PORT=8082;

function FHEMdebug_handleRequest(request, response){
  //console.log( request );

  if( request.url == '/cached' ) {
    response.write( '<a href="/">home</a><br><br>' );
    if( FHEM_lastEventTime )
      for( var key in FHEM_lastEventTime )
        response.write( 'FHEM_lastEventTime ' + key + ': '+ new Date(FHEM_lastEventTime[key]) +'<br>' );
    response.write( '<br>' );

    for( var informId in FHEM_subscriptions ) {
      response.write( informId + ': '+ FHEM_cached[informId] +'<br>' );

      var derived;
console.log( FHEM_subscriptions[informId] );
      for( var subscription of FHEM_subscriptions[informId] ) {
        var characteristic = subscription.characteristic;
        if( !characteristic ) continue;

console.log( characteristic );
        var mapping = characteristic.FHEM_mapping;
        if( !mapping || mapping.cached === undefined ) continue;

        derived = 1;
        response.write( '&nbsp;&nbsp;' + mapping.characteristic_name + ': '+ mapping.cached + ' (' + typeof(mapping.cached)+')<br>' );
      }
      if( derived )
        response.write( '<br>' );
    }
    //response.write( '<br>cached: ' + util.inspect(FHEM_cached).replace(/\n/g, '<br>') );
    response.end( '' );

  } else if( request.url == '/subscriptions' ) {
    response.write( '<a href="/">home</a><br><br>' );
    response.end( 'subscriptions: ' + util.inspect(FHEM_subscriptions, {depth: 5}).replace(/\n/g, '<br>') );

  } else
    response.end( '<a href="/cached">cached</a><br><a href="/subscriptions">subscriptions</a>' );
}

var FHEMdebug_server = http.createServer( FHEMdebug_handleRequest );

FHEMdebug_server.on('error', function (e) {
  console.log('Server error: ' + e);
});

//Lets start our server
FHEMdebug_server.listen(FHEMdebug_PORT, function(){
    console.log('Server listening on: http://<ip>:%s', FHEMdebug_PORT);
});

//var mapping = { format: 'int', reading: 'statex', values: ['on', 'off', '/dim06/']};
//var mapping = { format: 'bool', reading: 'statex', valueOn: 1, valueOff: 0, values: ['on', 'off'] };
//var mapping = { format: 'bool', reading: 'state' };
//console.log( FHEM_reading2homekit( mapping, '0' ) );
//console.log( FHEM_reading2homekit( mapping, '1' ) );
//console.log( FHEM_reading2homekit( mapping, 'on' ) );
//console.log( FHEM_reading2homekit( mapping, 'off' ) );
//console.log( FHEM_reading2homekit( mapping, 'dim06%' ) );
//process.exit(0);
