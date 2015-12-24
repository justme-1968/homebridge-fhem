# homebridge-fhem
a fhem platform shim for homebridge

uses longpoll and an internal cache to avoid roundtrips to fhem.
a debug browser is available at port 8082.

supports:
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

