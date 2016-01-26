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

currently supported parameters are for FHEM -> homekit:
  minValue, maxValue, minStep: for all int and float characteristics -> the allowed range for this value in homekit
  (min,) max: Hue and Saturation characteristics -> the range the reading has in fhem, only if different from minValue and maxValue
  delay: true/false -> the value ist send afer one second inactivity
  nocache: don't cache values for this reading
  threshold: reading is mapped to true if the value is greater than the threshold value and to false otherwise
  invert: invert the reading, taking minValue, maxValue into account
  part: the reading value will be splitted at spaces and the n-th item is used as the value. counting starts at 0
  values: a ; separated list that indicates the mapping of reading values to homekit values.
          each list entry consists of : separated pair of from and to values
          each from value can be a literal value or a regex of the form /regex/
          each to value can be a literal value or a homekit defined term for this characteristic
  valueOn, valueOf: the reading values that are mapped to the true/false resp. on/off states in homekit. shotcut for values

    e.g.: PositionState=motor,values=/^up/:INCREASING;/^down/:DECREASING;/.*/:STOPPED On=state,valueOn=/on|dim/,valueOff=off

  the order of the transformations is as follows: part, values, valueOn/valueOff, threshold, maxValue/minValue/minStep, invert

//TODO: multiple occurances of the same characteristic with different paramters -> e.g. multiple switches for the same or harmony activities


and for homekit -> FHEM:
  cmd: the set command to use: set <device> <cmd> <value>
  cmdOn, cmdOff: for all bool characteristics
  cmdLock, cmdUnlock, cmdOpen: commands to lock, unlock and open a door
  cmds: a ; separated list that indicates the mapping of homekit values to fhem values.
        each list entry consists of : separated pair of from and to values
        each from value can be a literal value or a homekit defined term for this characteristic
        each to value has to be a literal value

  e.g.: TargetHeatingCoolingState=...,cmds=OFF:desired-temp+off;HEAT:controllMode+day;COOL:controllMode+night;AUTO:controllMode+auto

examples:
1 device -> 1 service (thermometer)
n devices -> 1 service (temp + hum, dummy thermostat + temp)
1 device  -> n services (1 service per harmony activity), (temp1, temp2)

attr <temp> genericDeviceType thermometer
attr <temp> homebridgeMapping CurrentTemperature=temperature1,minValue=-30
wenn das reading temperature heisst statt temperature1 muss es nicht angegeben werden.


attr <tempHum> genericDeviceType thermometer
attr <tempHum> homebridgeMapping [CurrentTemperature=temperature1] CurrentRelativeHumidity=<device2>:humidity
wenn das reading temperature heisst statt temperature1 kann CurrentTemperature=temperature1 weg gelassen werden

attr <thermostat> genericDeviceType thermostat
attr <thermostat> homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 CurrentTemperature=myTemp:temperature


attr <dualTemp> genericDeviceType thermometer
attr <dualTemp> homebridgeMapping CurrentTemperature=temperature1,minValue=-30,subtype=innen
                                  CurrentTemperature=temperature2,minValue=-30, subtype=aussen


attr <hub> genericDeviceType switch
attr <hub> homebridgeMapping On=currentActivity,subtype=TV,valueOn=TV,cmdOn=activity+TV,cmdOff=off
                             On=currentActivity,subtype=DVD,valueOn=/DVD/,cmdOn=activity+DVD,cmdOff=off
                             On=currentActivity,subtype=Off,valueOff=PowerOff,cmd=off



instead of the format described above homebridgeMapping can also contain the same data encoded as json
this hast to be used if any of the separators aabove are used in an command or value.

e.g.: { "PositionState" = { "reading" = "motor", "values" = [...] }, "On" = { "reading" = "state", "valueOn" = "/on|dim/", "valueOff" = "off" } }
