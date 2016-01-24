# homebridge-fhem
a fhem platform shim for homebridge

uses longpoll and an internal cache to avoid roundtrips to fhem.
a debug browser is available at port 8082.

add one (or more) FHEM platforms to config.json and set the filter to a fhem devspec that
includes the devices that should be bridged to homekit.

directly (automaticaly) supports:
- switches (devices with set on and set off commands)
- lights (devices with set on and set off commands)
- homematc and FS20 dimmers (devices with set on, set off and set dim or set pct commands)
- HUE, WifiLight, SWAP_0000002200000003 (hue, sat, bri, rgb)
- homematic, max and pid20 thermostats
- homematic, DUOFERN and FS20/IT(?) blinds
- hommatic, MAX and FHTTK contact sensors (door, window)
- HM-SEC-WIN, HM-SEC-KEY
- presence, ROOMMATE
- SONOS (power, volume)
- harmony scenes
- temperature and humidity sensors
- CO20 air quality sensor
- probably some more ...


for devices that are not correctly identified use the genericDeviceType attribute to configure the device type.
supported values are: ignore,switch,outlet,light,blind,thermostat,garage,window,lock
this is probably mostly used for differentiating betewwn switches and lights.


for devices that don't use the autodetected readings and commands or for devices that mix readings from different
devices use the homebridgeMapping attribute. which works as follows:
- the genericDeviceType attribute is used to determine the service type that should be used for this device
- the homebridgeMapping attribute containts a space separated list of characteristic descriptions
- each description consists of the characteristic name followed by a = followed by a komma separated list of parameters
- each parameter can be of the form <command>:<device>:<reading> where parts can be omitted from left to right
  or of the form <name>=<value> 

e.g:
attr <thermostat> genericDeviceType thermostat
attr <thermostat> homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 CurrentTemperature=myTemp:temperature

this would define a thermostat device with a command target to set the desired temperature, a reading target that indicates the desired target temperature, the desired min, max and step values and a current temeprature comming from the temperature reading of the device myTemp.

currently supported values for characteristic names are:
  On
  Brightness
  Hue
  Saturation
  CurrentTemperaure
  TargetTemperature
  CurrentRelativeHumidity
  CurrentAmbientLightLevel
  AirQuality
  CurrentDoorState
  OccupancyDetected
  StatusLowBattery
  FirmwareRevision

currently supported parameters are:
  minValue, maxValue, minStep: for all int and float characteristics -> the allowed range for this value in homekit
  cmdOn, cmdOff: for all bool characteristics -> 
  (min,) max: Hue and Saturation characteristics -> the range the reading has in fhem, only if differenf from minValue and maxValue
  delay: true/false -> the value ist send afer one second inactivity
  cmdLock, cmdUnlock, cmdOpen: commands to lock, unlock and open a door
  nocache: don't cache values for this reading
  threshold: -> ...

  //TODO: invert numeric readings
  
  valueOn, valueOf: the reading values that are mapped to the true/false resp. on/off states in homekit
  values: a ; separated list of reading values that should be mapped to consecutive homekit values

          each value can be a literal value or a regex of the form /regex/
          homekit values can be given as literal values or homekit definde terms

          e.g.: PositionState=motor,values=/^up/:INCREASING;/^down/:DECREASING;/.*/:STOPPED On:state,valueOn=/on|dim/,valueOff=off



instead of the format described above homebridgeMapping can also contain the same data encoded as json
this hast to be used if any of the separators aabove are used in an command or value.

e.g.: { "PositionState" = { "reading" = "motor", "values" = [...] }, "On" = { "reading" = "state", "valueOn" = "/on|dim/", "valueOff" = "off" } }
