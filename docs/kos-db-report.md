# kOS database report: kOS 1.6.0.1

| | |
| --- | ---: |
| Structures | 115 |
| Suffixes | 1051 |
| Suffixes without documentation | 59 |
| Functions | 112 |
| Variables | 108 |
| Documented structures | 103 |

## C# classes sharing a kOS name with an unrelated class (ignored) (1)

- HarddiskDirectory (src/kOS.Safe/Persistence/HarddiskDirectory.cs) is named VolumeFile, like VolumeFile

## Suffixes registered twice (last kept) (5)

- List:COPY, src/kOS.Safe/Encapsulation/ListValue.cs:186
- Queue:COPY, src/kOS.Safe/Encapsulation/QueueValue.cs:106
- ScienceExperimentModule:TOGGLE, src/kOS/AddOns/OrbitalScience/DMScienceExperimentFields.cs:21
- Stack:COPY, src/kOS.Safe/Encapsulation/StackValue.cs:112
- UniqueSet:COPY, src/kOS.Safe/Encapsulation/UniqueSetValue.cs:111

## Suffixes with computed names (structure marked dynamic) (4)

- Addons:?, src/kOS/Suffixed/AddonList.cs:23
- Skin:?, src/kOS/Suffixed/Widget/WidgetSkin.cs:47
- Skin:?, src/kOS/Suffixed/Widget/WidgetSkin.cs:52
- TerminalInput:?, src/kOS.Safe/Encapsulation/TerminalInput.cs:49

## Documented structures not in kOS (3)

- IRAddon (addons/IR.rst)
- IRControlGroup (addons/IR.rst)
- IRServo (addons/IR.rst)

## Suffixes with computed names, added from the documentation (33)

- Skin:box
- Skin:button
- Skin:flatLayout
- Skin:horizontalScrollbar
- Skin:horizontalScrollbarLeftButton
- Skin:horizontalScrollbarRightButton
- Skin:horizontalScrollbarThumb
- Skin:horizontalSlider
- Skin:horizontalSliderThumb
- Skin:label
- Skin:labelTipOverlay
- Skin:popupMenu
- Skin:popupWindow
- Skin:popupmenuItem
- Skin:scrollView
- Skin:textField
- Skin:toggle
- Skin:verticalScrollbar
- Skin:verticalScrollbarLeftButton
- Skin:verticalScrollbarRightButton
- Skin:verticalScrollbarThumb
- Skin:verticalSlider
- Skin:verticalSliderThumb
- Skin:window
- TerminalInput:deleteRight
- TerminalInput:downCursorOne
- TerminalInput:endCursor
- TerminalInput:homeCursor
- TerminalInput:leftCursorOne
- TerminalInput:pageDownCursor
- TerminalInput:pageUpCursor
- TerminalInput:rightCursorOne
- TerminalInput:upCursorOne

## Types made precise (C# says Structure) (7)

- Connection:destination: Vessel | kOSProcessor
- DockingPort:partner: DockingPort | String
- Message:sender: Vessel | Boolean
- Part:decoupler: Decoupler | String
- Part:parent: Part
- Stage:nextDecoupler: Decoupler
- Volume:open: VolumeItem | Boolean

## Element types added (82)

- AggregateResource:parts: List<Part>
- Body:orbitingChildren: List<Body>
- Box:widgets: List<Widget>
- Element:decouplers: List<Decoupler>
- Element:dockingPorts: List<DockingPort>
- Element:parts: List<Part>
- Element:resources: List<AggregateResource>
- Engine:modes: List<String>
- Enumerable:iterator: Iterator<T>
- Enumerable:reverseIterator: Iterator<T>
- FileContent:binary: List<Scalar>
- FileContent:iterator: Iterator<String>
- KACAddon:alarms: List<KACAlarm>
- KUniverse:craftList: List<CraftTemplate>
- KUniverse:quickSaveList: List<String>
- Lexicon:keys: List<Structure>
- Lexicon:values: List<Structure>
- List:copy: List<Structure>
- List:subList: List<Structure>
- Orbitable:patches: List<Orbit>
- Part:allTaggedParts: List<Part>
- Part:children: List<Part>
- Part:modules: List<String>
- Part:modulesNamed: List<PartModule>
- Part:partsDubbed: List<Part>
- Part:partsDubbedPattern: List<Part>
- Part:partsNamed: List<Part>
- Part:partsNamedPattern: List<Part>
- Part:partsTagged: List<Part>
- Part:partsTaggedPattern: List<Part>
- Part:partsTitled: List<Part>
- Part:partsTitledPattern: List<Part>
- Part:resources: List<Resource>
- PartModule:allActionNames: List<String>
- PartModule:allActions: List<String>
- PartModule:allEventNames: List<String>
- PartModule:allEvents: List<String>
- PartModule:allFieldNames: List<String>
- PartModule:allFields: List<String>
- PartModule:allHiddenFieldNames: List<String>
- PartModule:allHiddenFields: List<String>
- Path:segments: List<String>
- Queue:copy: Queue<T>
- RCS:thrustVectors: List<Vector>
- RTAddon:groundStations: List<String>
- RTAddonAntennaModule:allFieldNames: List<String>
- RTAddonAntennaModule:allFields: List<String>
- ScienceContainerModule:data: List<ScienceData>
- ScienceExperimentModule:data: List<ScienceData>
- Stack:copy: Stack<T>
- Stage:resources: List<ActiveResource>
- String:iterator: Iterator<String>
- String:split: List<String>
- Structure:suffixNames: List<String>
- TRAddon:descentAngles: List<Scalar>
- TRAddon:descentGrades: List<Boolean>
- TRAddon:descentModes: List<Boolean>
- TimeWarp:physicsRateList: List<Scalar>
- TimeWarp:railsRateList: List<Scalar>
- TimeWarp:rateList: List<Scalar>
- UniqueSet:copy: UniqueSet<T>
- Vessel:allTaggedParts: List<Part>
- Vessel:crew: List<CrewMember>
- Vessel:decouplers: List<Decoupler>
- Vessel:dockingPorts: List<DockingPort>
- Vessel:elements: List<Element>
- Vessel:engines: List<Engine>
- Vessel:modulesInGroup: List<PartModule>
- Vessel:modulesNamed: List<PartModule>
- Vessel:parts: List<Part>
- Vessel:partsDubbed: List<Part>
- Vessel:partsDubbedPattern: List<Part>
- Vessel:partsInGroup: List<Part>
- Vessel:partsNamed: List<Part>
- Vessel:partsNamedPattern: List<Part>
- Vessel:partsTagged: List<Part>
- Vessel:partsTaggedPattern: List<Part>
- Vessel:partsTitled: List<Part>
- Vessel:partsTitledPattern: List<Part>
- Vessel:rcs: List<RCS>
- Vessel:resources: List<AggregateResource>
- VolumeDirectory:iterator: Iterator<VolumeItem>

## Documented suffixes not in the C# (9)

- Atmosphere:SCALE (structures/celestial_bodies/atmosphere.rst)
- Bounds:RELORIGIN (structures/vessels/bounds.rst)
- CraftTemplate:FILEPATH (structures/vessels/crafttemplate.rst)
- DockingPort:REENGAGEDDISTANCE (structures/vessels/dockingport.rst)
- Iterator:RESET (structures/collections/iterator.rst)
- Orbit:PATCHES (structures/orbits/orbit.rst)
- RCS:THRUST (structures/vessels/rcs.rst)
- TimeSpan:CALENDAR (structures/misc/time.rst)
- TimeSpan:CLOCK (structures/misc/time.rst)

## Types that differ from the C# (C# kept) (17)

- Box:onRadioChange: UserDelegate, also Delegate
- Button:onClick: UserDelegate, also Delegate
- Button:onToggle: UserDelegate, also Delegate
- Lexicon:remove: Boolean, also None
- PopupMenu:onChange: UserDelegate, also Delegate
- Skin:has: Boolean, also Style
- Slider:onChange: UserDelegate, also Delegate
- String:findAt: Scalar, also String
- String:findLastAt: Scalar, also String
- TextField:onChange: UserDelegate, also Delegate
- TextField:onConfirm: UserDelegate, also Delegate
- UniqueSet:remove: Boolean, also None
- VecDraw:colorUpdater: UserDelegate, also Delegate
- VecDraw:startUpdater: UserDelegate, also Delegate
- VecDraw:vecUpdater: UserDelegate, also Delegate
- Vessel:angularMomentum: Vector, also Direction
- Widget:visible: Boolean, also Scalar

## Suffixes without documentation (59)

- Addons:agx
- Addons:available
- Addons:hasAddon
- Addons:kac
- Addons:rt
- Addons:tr
- Box:addTipDisplay
- Config:blizzy
- Config:fontName
- Control:bound
- Control:customAxis
- Control:customAxisCount
- Control:neutralizeCustomAxes
- Control:pilotCustomAxis
- Control:pilotCustomAxisCount
- Control:setCustomAxis
- CrewMember:experienceValue
- CrewMember:kerbalType
- CrewMember:status
- DockingPort:aquireForce
- DockingPort:aquireRange
- DockingPort:aquireTorque
- DockingPort:dockWatchers
- DockingPort:reEngageDistance
- DockingPort:target
- DockingPort:undockWatchers
- Element:decouplers
- Engine:maxPossibleThrust
- Engine:maxPossibleThrustAt
- KACAlarm:margin
- KACAlarm:time
- KUniverse:switchVesselWatchers
- Label:textUpdater
- Orbit:rStateVector
- Orbit:vStateVector
- Part:com
- Part:fuelCrossFeed
- ScienceExperimentModule:lightsOff
- ScienceExperimentModule:lightsOn
- ScienceExperimentModule:toggle
- SteeringManager:actuation
- SteeringManager:adjustTorque
- SteeringManager:angularAcceleration
- SteeringManager:angularVelocity
- SteeringManager:averageDuration
- SteeringManager:controlTorque
- SteeringManager:enableTorqueAdjust
- SteeringManager:measuredTorque
- SteeringManager:moi
- SteeringManager:rawTorque
- SteeringManager:targetTorque
- String:format
- Terminal:resizeWatchers
- Vessel:decouplers
- Vessel:positionError
- Vessel:soiChangeWatchers
- Vessel:surfaceSpeed
- VolumeDirectory:iterator
- Waypoint:dump

## Documented access that differs from the C# (C# kept) (33)

- Bounds:extents: getset, documented "Get-only"
- Bounds:size: getset, documented "Get-only"
- GUI:tooltip: get, documented "Get/Set"
- Sensor:active: getset, documented "Get only"
- Style:active: get, documented "Get/Set"
- Style:active_on: get, documented "Get/Set"
- Style:border: get, documented "Get/Set"
- Style:focused: get, documented "Get/Set"
- Style:focused_on: get, documented "Get/Set"
- Style:hover: get, documented "Get/Set"
- Style:hover_on: get, documented "Get/Set"
- Style:margin: get, documented "Get/Set"
- Style:normal: get, documented "Get/Set"
- Style:on: get, documented "Get/Set"
- Style:overFlow: get, documented "Get/Set"
- Style:padding: get, documented "Get/Set"
- Terminal:charWidth: getset, documented "Get"
- TimeSpan:day: getset, documented "Get only"
- TimeSpan:days: getset, documented "Get only"
- TimeSpan:hour: getset, documented "Get only"
- TimeSpan:hours: getset, documented "Get only"
- TimeSpan:minute: getset, documented "Get only"
- TimeSpan:minutes: getset, documented "Get only"
- TimeSpan:second: getset, documented "Get only"
- TimeSpan:seconds: getset, documented "Get only"
- TimeSpan:year: getset, documented "Get only"
- TimeSpan:years: getset, documented "Get only"
- TimeStamp:day: getset, documented "Get only"
- TimeStamp:hour: getset, documented "Get only"
- TimeStamp:minute: getset, documented "Get only"
- TimeStamp:second: getset, documented "Get only"
- TimeStamp:year: getset, documented "Get only"
- kOSProcessor:tag: getset, documented "Get only"

## Documented parameter counts that differ (names not applied) (2)

- KUniverse:getCraft: 2 parameters, 3 documented
- Part:symmetryPartner: 1 parameters, 2 documented

## Functions without documentation (15)

- anglediff() (src/kOS.Safe/Function/Trigonometry.cs)
- buildlist() (src/kOS/Function/BuildList.cs)
- constant() (src/kOS.Safe/Function/Suffixed.cs)
- debugdump() (src/kOS.Safe/Function/Misc.cs)
- debugfreezegame() (src/kOS.Safe/Function/Misc.cs)
- edit() (src/kOS/Function/Persistence.cs)
- logfile() (src/kOS.Safe/Function/Misc.cs)
- makebuiltindelegate() (src/kOS.Safe/Function/Misc.cs)
- printat() (src/kOS.Safe/Function/Misc.cs)
- printlist() (src/kOS/Function/PrintList.cs)
- run() (src/kOS.Safe/Function/Misc.cs)
- selectautopilotmode() (src/kOS.Safe/Function/Misc.cs)
- switch() (src/kOS.Safe/Function/Persistence.cs)
- toggleflybywire() (src/kOS.Safe/Function/Misc.cs)
- transferall() (src/kOS/Function/Suffixed.cs)

## Functions returning a value in C# but None here (check) (2)

- copypath() (src/kOS.Safe/Function/Persistence.cs)
- movepath() (src/kOS.Safe/Function/Persistence.cs)

## Bound variables with invalid names (ignored) (1)

- VOLUME:NAME (src/kOS/Binding/TerminalSettings.cs)

## Bound variables without documentation (30)

- ACTIVESHIP (src/kOS/Binding/FlightStats.cs:33)
- AG10 (src/kOS/Binding/ActionGroups.cs:39)
- AG2 (src/kOS/Binding/ActionGroups.cs:31)
- AG3 (src/kOS/Binding/ActionGroups.cs:32)
- AG4 (src/kOS/Binding/ActionGroups.cs:33)
- AG5 (src/kOS/Binding/ActionGroups.cs:34)
- AG6 (src/kOS/Binding/ActionGroups.cs:35)
- AG7 (src/kOS/Binding/ActionGroups.cs:36)
- AG8 (src/kOS/Binding/ActionGroups.cs:37)
- AG9 (src/kOS/Binding/ActionGroups.cs:38)
- ANGULARVELOCITY (src/kOS/Binding/FlightStats.cs:23)
- BLACK (src/kOS/Binding/ColorBinding.cs:17)
- BLUE (src/kOS/Binding/ColorBinding.cs:20)
- CONSTANT (src/kOS/Binding/BindingsUniverse.cs:40)
- CYAN (src/kOS/Binding/ColorBinding.cs:23)
- GRAY (src/kOS/Binding/ColorBinding.cs:24)
- GREEN (src/kOS/Binding/ColorBinding.cs:19)
- GREY (src/kOS/Binding/ColorBinding.cs:24)
- MAGENTA (src/kOS/Binding/ColorBinding.cs:22)
- OBT (src/kOS/Binding/FlightStats.cs:27)
- ORBIT (src/kOS/Binding/FlightStats.cs:27)
- PURPLE (src/kOS/Binding/ColorBinding.cs:22)
- RED (src/kOS/Binding/ColorBinding.cs:18)
- SENSOR (VesselTarget.ShortCuttableShipSuffixes)
- SESSIONTIME (src/kOS/Binding/TerminalSettings.cs:13)
- STATUS (src/kOS/Binding/FlightStats.cs:34)
- STEERINGMANAGER (src/kOS/Binding/FlightStats.cs:39)
- VERSION (src/kOS/Binding/BindingsUniverse.cs:41)
- WHITE (src/kOS/Binding/ColorBinding.cs:16)
- YELLOW (src/kOS/Binding/ColorBinding.cs:21)

## Entries added by the overrides (check the names) (18)

- suffix of Stage: ablator
- suffix of Stage: electricCharge
- suffix of Stage: intakeAir
- suffix of Stage: liquidFuel
- suffix of Stage: monoPropellant
- suffix of Stage: ore
- suffix of Stage: oxidizer
- suffix of Stage: solidFuel
- suffix of Stage: xenonGas
- suffix of Vessel: ablator
- suffix of Vessel: electricCharge
- suffix of Vessel: intakeAir
- suffix of Vessel: liquidFuel
- suffix of Vessel: monoPropellant
- suffix of Vessel: ore
- suffix of Vessel: oxidizer
- suffix of Vessel: solidFuel
- suffix of Vessel: xenonGas
