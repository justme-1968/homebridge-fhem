# homebridge-fhem
a fhem platform plugin for homebridge

uses longpoll and an internal cache to avoid roundtrips to fhem.
a debug browser is available at port 8082.

add one (or more) FHEM platforms to config.json and set the filter(s) to a fhem devspec that
includes the devices that should be bridged to homekit.

##directly (automaticaly) supports:
- switches (devices with set on and set off commands)
- lights (devices with set on and set off commands)
- homematc, FS20 and ZWave dimmers (devices with set on, set off and set dim or set pct commands)
- HUE, WifiLight, MilightDevice, SWAP_0000002200000003 (hue, sat, bri, rgb)
- homematic, max and pid20 thermostats
- homematic, DUOFERN, SOMFY and FS20/IT(?) blinds
- hommatic, MAX and FHTTK contact sensors (door, window)
- HM-SEC-WIN, HM-SEC-KEY
- HM-Sen-LI-O
- presence, ROOMMATE, GUEST
- SONOS (power, volume)
- harmony scenes
- temperature and humidity sensors
- CO20 and netatmo air quality sensor
- RESIDENTS module
- probably some more ...


##simple config
for devices that are not correctly identified use the genericDeviceType attribute to configure the device type.
supported values are: ignore,switch,outlet,light,blind,thermostat,garage,window,lock
this is probably mostly used for differentiating between switches and lights.

##enhanced config
for devices that don't use the autodetected readings and commands or for devices that mix readings from different
devices use the homebridgeMapping attribute. it is parsed from left to right and works as follows:
- the genericDeviceType attribute is used to determine the service type that should be used for this device
  in addition to the symbolic names above all homekit Service names are recognized
- the homebridgeMapping attribute containts a space separated list of characteristic descriptions
- each description consists of the characteristic name followed by a = followed by a komma separated list of parameters
- each parameter can be of the form <command>:<device>:<reading> where parts can be omitted from left to right
  or of the form <name>=<value> or the special clear to clear the mappings for the current characteristic
- the following special values for a description are recognized: clear -> clears all mappings for this device

e.g:
```
attr <thermostat> genericDeviceType thermostat
attr <thermostat> homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 CurrentTemperature=myTemp:temperature
```

this would define a thermostat device with a command target to set the desired temperature, a reading target that indicates the desired target temperature, the desired min, max and step values and a current temeprature comming from the temperature reading of the device myTemp.


###currently supported values for characteristic names are:
- On
- Brightness
- Hue
- Saturation
- CurrentTemperaure
- TargetTemperature
- CurrentRelativeHumidity
- CurrentAmbientLightLevel
- AirQuality
- CurrentDoorState
- OccupancyDetected
- StatusLowBattery
- SecuritySystemCurrentState
- SecuritySystemTargetState
- FirmwareRevision
- and all other homebridge Characteristic names

###currently supported parameters for FHEM -> homekit direction are:
- minValue, maxValue, minStep: for all int and float characteristics -> the allowed range for this value in homekit
- max: Hue and Saturation characteristics -> the range the reading has in fhem, only if different from minValue and maxValue
- nocache: don't cache values for this reading
- subtype: unique value necessary if multiple characteristics of the same type are in an accessory.
- factor: multiply reading with this value
- threshold: reading is mapped to true if the value is greater than the threshold value and to false otherwise
- invert: invert the reading, taking minValue, maxValue into account
- part: the reading value will be splitted at spaces and the n-th item is used as the value. counting starts at 0
- values: a ; separated list that indicates the mapping of reading values to homekit values.
          each list entry consists of a : separated pair of from and to values
          each from value can be a literal value or a regex of the form /regex/
          each to value can be a literal value or a homekit defined term for this characteristic
          if to is exaktly # then it is set to the current value. usefull for regex ranges
- valueOn, valueOff: the reading values that are mapped to the true/false resp. on/off states in homekit. shotcut for values
                     if only one is given all values not matching this one are automaticaly mapped to the other
- default: value to use if no reading is found or if none of values/valueOn/valueOff matches
- timeout: timeout in ms after which the homebridge value is reset to the default value -> used to simulate push buttons

e.g.:
```
PositionState=motor,values=/^up/:INCREASING;/^down/:DECREASING;/.*/:STOPPED On=state,valueOn=/on|dim/,valueOff=off
```

the order of the transformations is as follows: eventMap, part, threshold, values, valueOn/valueOff, factor, max, maxValue/minValue/minStep, invert

instead of using the transformation chain reading2homekit can be set to the name of a js function that is imported from a file
named by the jsFunctions config option. relative paths are relative to the same path the config file is located in.
the function it will be called with mapping and reading value as parameters and has to return the value to be used with homekit.

for custom characterisitcs the additional parameters name, format and unit have to be set. e.g.:
```
00000027-0000-1000-8000-0026BB765291=Volume::Volume,name=Volume,format=UINT8,unit=PERCENTAGE,minValue=0,maxValue=0,minStep=1
```


###for the homekit -> FHEM direction:
- delay: true/<number> -> the value ist send afer one second/<number>ms of inactivity
- factor: divide homekit value by this factor
- maxValue: for all int and float characteristics -> the allowed range for this value in homekit
- max: the max value the reading has in fhem, only if different from maxValue
- cmd: the set command to use: set <device> <cmd> <value>
- cmdOn, cmdOff: for all bool characteristics
- cmds: a ; separated list that indicates the mapping of homekit values to fhem values.
        each list entry consists of a : separated pair of from and to values
        each from value can be a literal value or a homekit defined term for this characteristic or a regex of the form /regex/
        each to value has to be a literal value

spaces in commands have to be replaced by +

e.g.:
```
TargetHeatingCoolingState=...,cmds=OFF:desired-temp+off;HEAT:controlMode+day;COOL:controlMode+night;AUTO:controlMode+auto
```

the order of the transformations is as follows: invert, factor, max/maxValue
precedence for mapping of homekit value to commands is in increasing order: cmd, cmdOn/cmdOff, cmds

instead of using the transformation chain homekit2reading can be set to the name of a js function that is imported from a file
named by the jsFunctions config option. relative paths are relative to the same path the config file is located in.
the function it will be called with mapping and the homekit value as parameters and has to return the value to be used with the fhem set command.

a dummy with a setList of exactly two entries will be mapped to a On characteristic where the first entry will be mapped to on and the second to off.


examples:
- 1 device -> 1 service (thermometer)
```
  attr <temp> genericDeviceType thermometer
  attr <temp> homebridgeMapping CurrentTemperature=temperature1,minValue=-30
```
  wenn das reading temperature heisst statt temperature1 muss es nicht angegeben werden.

- 1 device -> 1 service, 2 characteristics (thermostat)
```
  attr <thermostat> genericDeviceType thermostat
  attr <thermostat> homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5
                                      CurrentTemperature=myTemp:temperature
```

- n devices -> 1 service (temp + hum, dummy thermostat + temp)
```
  attr <tempHum> genericDeviceType thermometer
  attr <tempHum> homebridgeMapping [CurrentTemperature=temperature1] CurrentRelativeHumidity=<device2>:humidity
```
  wenn das reading temperature heisst statt temperature1 kann CurrentTemperature=temperature1 entfallen

- 1 device -> 2 services mit identischen characteristics (thermometer)
```
  attr <dualTemp> genericDeviceType thermometer
  attr <dualTemp> homebridgeMapping CurrentTemperature=temperature1,minValue=-30,subtype=innen
                                    CurrentTemperature=temperature2,minValue=-30,subtype=aussen
```

- 1 device  -> n services (1 service per harmony activity)
```
  attr <hub> genericDeviceType switch
  attr <hub> homebridgeMapping clear
                               On=activity,subtype=TV,valueOn=TV,cmdOn=activity+TV,cmdOff=off
                               On=activity,subtype=DVD,valueOn=/DVD/,cmdOn=activity+DVD,cmdOff=off
                               On=activity,subtype=Off,valueOn=PowerOff,valueOff=PowerOff,cmd=off
```


instead of the format described above homebridgeMapping can also contain the same data encoded as json
this hast to be used if any of the separators above are used in an command or value. at the moment the
json version replaces all build in defaults for a device. e.g.:
```
{ "PositionState": { "reading": "motor", "values": [...] }, "On": { "reading": "state", "valueOn": "/on|dim/", "valueOff": "off" } }
```
