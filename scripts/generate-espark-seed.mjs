/**
 * Emit seed.espark.sql and seed.espark.console.sql — the eSpark drive's
 * folder tree, from the Electrical Scope Register Rev2 workbook (sheet
 * "Scope Register", columns Part / Sub / Deliverable).
 *
 * Part is the package (1–17) and Sub the deliverable inside it, so "9.5" in
 * the workbook is folder 9.5 in the drive. Each deliverable is a short
 * general folder, and every point its description lists is a subfolder
 * inside it — "As-Built Survey Drawing of Existing MV Room - dimensions/
 * access openings, existing floor construction, …" becomes 2.1 As-Built
 * Survey of Existing MV Room with 2.1.1 Dimensions & Access Openings, 2.1.2
 * Existing Floor Construction, and so on — so each upload has one obvious
 * place. A deliverable that is a single item stays a single folder. The
 * register's full wording is kept beside each entry as `full`.
 *
 * Every row is inserted with drive = 'espark', so this tree cannot appear in
 * the Power Systems drive whichever database it is loaded into. Requires
 * migrations/003_drives.sql.
 *
 *   node scripts/generate-espark-seed.mjs
 *   npx wrangler d1 execute <DB> --remote --file=./seed.espark.sql
 */

import { writeFileSync } from "node:fs";

/** A deliverable: short folder name, the register's wording, its points. */
const D = (name, full, children) => ({ name, full: full ?? name, children: children ?? [] });
const P = (name, subs) => ({ name, subs });

const CABLE_SUBS = [
  D("Datasheets & Samples", "Data sheet and Samples", ["Datasheets", "Samples"]),
  D("Routing & Installation Layout", "Routing & installation Layout"),
  D("Routing Details"),
  D("Cable Sizing"),
  D("FAT Test", "FAT test"),
  D("Testing ITP & Method of Statement", "Testing ITP and Method of Statement", ["ITP", "Method of Statement"]),
  D("Testing Report"),
];

export const TREE = [
  P("Alternator", [
    D("Rating & Site Derating", "Rating & site derating"),
    D("Neutral Earthing & NER", "Neutral earthing & NER"),
    D("Excitation, AVR & Governor", "Excitation, AVR & governor"),
    D("Fault Contribution", "Fault contribution"),
    D("Generator Protection", "Generator protection"),
    D("Testing"),
  ]),
  P("MV Switchgear (MVSG)", [
    D(
      "As-Built Survey of Existing MV Room",
      "As-Built Survey Drawing of Existing MV Room - dimensions/access openings, existing floor construction, existing cable trench/duct routing, visible earthing conductor routing",
      ["Dimensions & Access Openings", "Existing Floor Construction", "Existing Cable Trench & Duct Routing", "Visible Earthing Conductor Routing"]
    ),
    D(
      "Existing Cable Trench & Duct Bank Survey",
      "Existing Cable Trench/Duct Bank Condition Survey and Compatibility Assessment for new cable sizes and routing",
      ["Condition Survey", "Compatibility Assessment for New Cables"]
    ),
    D("Existing HVAC Assessment", "Existing Ventilation/HVAC Assessment against new switchgear heat load"),
    D(
      "HVAC Modification Design",
      "HVAC and Ventilation Modification design and shop drawings includes, all supportive calculations, drawings, BOQ, and New Equipment Datasheet",
      ["Design & Shop Drawings", "Calculations", "BOQ", "New Equipment Datasheets"]
    ),
    D("Fire Detection & Fighting Assessment", "Fire Detection & fighting system Assessment Report"),
    D(
      "Fire Detection & Fighting Modification Design",
      "Fire Detection & Fighting system Modification Design/shop drawings includes but not limited to all supportive Drawings, BOQs, Datasheets.",
      ["Design & Shop Drawings", "BOQ", "Datasheets"]
    ),
    D("Outdoor Lighting Design", "Outdoor lighting design includes lux calculation and drawings", ["Lux Calculation", "Drawings"]),
  ]),
  P("Aux Transformer", [
    D("Rating & Vector Group", "Rating & vector group"),
    D("Dry vs Oil-Filled", "Dry vs oil-filled"),
    D("Protection"),
    D("Inrush & Through-Fault", "Inrush & through-fault"),
    D("Losses & Noise", "Losses & noise"),
    D("Testing"),
  ]),
  P("MV Cable & Termination", CABLE_SUBS),
  P("LV Cables", CABLE_SUBS),
  P("Earthing", [
    D(
      "Soil Resistivity Test Procedures",
      "Soil Resistivity Test procedures (ITP, MOS, Test Report Template), shall include the proposed test locations and depths across the sites.",
      ["ITP", "Method of Statement", "Test Report Template", "Proposed Test Locations & Depths"]
    ),
    D(
      "Soil Resistivity Test Report",
      "Soil Resistivity Test Report, includes the results and testing equipment calibration certificate",
      ["Test Results", "Equipment Calibration Certificates"]
    ),
    D("Existing Earth System Assessment", "Existing Earth system assessment and Test Report", ["Assessment", "Test Report"]),
    D(
      "Earthing Design Calculation (IEEE 80)",
      "Earthing System Design Calculation following the lastest version of IEEE 80, including the touch, step, mesh voltage, Ground Potential Rise (GPR), grid conductor sizing, fault current withstand, and calculated ground resistance.",
      ["Touch, Step & Mesh Voltage", "Ground Potential Rise (GPR)", "Grid Conductor Sizing", "Fault Current Withstand", "Calculated Ground Resistance"]
    ),
    D(
      "Primary Earthing Grid Layout & Details",
      "Primary Earthing Grid Layout Drawing and details, showing grid conductor routing, buried depth, mesh spacing, earth pit/test pit locations, and Typical Details",
      ["Grid Conductor Routing", "Buried Depth & Mesh Spacing", "Earth Pit & Test Pit Locations", "Typical Details"]
    ),
    D(
      "Secondary Earthing Layout",
      "Secondary earthing layout, showing the risers for each equipment, the size of risers, and Earth Bar locations with Equipment Earthing Connection Details",
      ["Equipment Risers & Sizes", "Earth Bar Locations", "Equipment Earthing Connection Details"]
    ),
    D(
      "Earthing System Modification",
      "Earthing System Modification if required includes all design and shop drawing drawings, calculations, BOQ, new material datasheets.",
      ["Design & Shop Drawings", "Calculations", "BOQ", "New Material Datasheets"]
    ),
    D(
      "Earthing BOQ & Datasheets",
      "Earthing system BOQ and Datasheets, includes cables, rods, pits, and clamps",
      ["BOQ", "Cables", "Rods", "Pits", "Clamps"]
    ),
    D("Earthing Test Procedures", "Earthing System Test Procedures (ITP, MOS, Test Report Template)", ["ITP", "Method of Statement", "Test Report Template"]),
    D("Earthing Test Reports", "Earthing System Test Reports"),
    D("Earthing Maintenance Plan", "Earthing System maintainance plan"),
  ]),
  P("Main Distribution Boards", [
    D("Assembly Standard", "Assembly standard"),
    D("Ratings"),
    D("Feeder Schedule", "Feeder schedule"),
    D("Discrimination & Cascading", "Discrimination & cascading"),
    D("Changeover / ATS"),
    D("Metering & Monitoring", "Metering & monitoring"),
    D("Arc Flash, Access & Ventilation", "Arc flash, access & ventilation"),
  ]),
  P("Control Room", [
    D("Fire Detection & Suppression", "Fire detection & suppression"),
    D("Power Supplies", "Power supplies"),
    D("Operator Interface", "Operator interface"),
    D("Access Control & Security", "Access control & security"),
  ]),
  P("MCC Panels", [
    D(
      "General Arrangement Drawing",
      "MCC Panel General Arrangement Drawing showing dimensions, floor layout, cable entries, busbar details, equip segregation",
      ["Dimensions", "Floor Layout", "Cable Entries", "Busbar Details", "Equipment Segregation"]
    ),
    D(
      "Single Line Diagram",
      "MCC Panel Single Line Diagram (SLD) showing all incoming/outgoing feeders, ratings.",
      ["Incoming & Outgoing Feeders", "Ratings"]
    ),
    D(
      "Schematics & Wiring Diagrams",
      "MCC Panel Schematics & Wiring Diagrams for all starters, control circuits, interlocks, and alarms.",
      ["Starters", "Control Circuits", "Interlocks", "Alarms"]
    ),
    D(
      "Main Component Datasheets",
      "MCC main component datasheets including but not limited to starter, CBs, Contactors, and VFDs, showing the rating and harmonic tables.",
      ["Starters", "Circuit Breakers", "Contactors", "VFDs", "Rating & Harmonic Tables"]
    ),
    D(
      "Protection Settings & Coordination Study",
      "MCC Panel Protection Relay Settings & Coordination Study, including the coordination curves for all overcurrent protection.",
      ["Relay Settings", "Coordination Curves"]
    ),
    D(
      "Bill of Materials",
      "MCC Panel Bill of Materials (Breakers, Contactors, Relays, Pushbuttons, Indicating Lamps, Terminals)",
      ["Breakers", "Contactors", "Relays", "Pushbuttons", "Indicating Lamps", "Terminals"]
    ),
    D("Cable Termination Schedule & Details", "MCC Panel Cable Termination Schedule and Details", ["Termination Schedule", "Termination Details"]),
    D("Certified Type Test Reports", "MCC Certified Type Test Reports"),
    D(
      "Factory Test Procedure",
      "MCC Panel Factory Test Procedure detailing all required visual/mechanical, dielectric, functional, and operation tests",
      ["Visual & Mechanical Tests", "Dielectric Tests", "Functional Tests", "Operation Tests"]
    ),
    D("Factory Test Reports", "MCC Panel Factory Test Reports"),
    D("Operation & Maintenance Manual", "MCC Panel Operation & Maintenance Manual"),
    D("Spare Parts List (2-Year)", "MCC Panel Spare Parts Recommendation List (2-year operation)"),
  ]),
  P("Control Panels & Motors", [
    D("Motor Data", "Motor data"),
    D("Hazardous Area", "Hazardous area"),
    D("Accessories"),
    D("Control Philosophy", "Control philosophy"),
    D("Motor Starting Study", "Motor starting study"),
    D("Commissioning"),
  ]),
  P("Charger & Batteries", [
    D(
      "System Datasheets",
      "System Datasheet including battery, chargers, inverters, DC/AC switchboards, CVT",
      ["Batteries", "Chargers", "Inverters", "DC/AC Switchboards", "CVT"]
    ),
    D("DC/UPS Single Line Diagram", "Single Line Diagram for DC/UPS system"),
    D(
      "Installation & Layout Drawings",
      "Installation and layout drawings: Arrangements outline dimensions, mounting details, cable entry areas and weights for all supplied equipment. The drawings shall provide sufficient and adequate information required for the interfaces including the following: a. Outline dimensions including front view, side views, top view and bottom view. b. Cable entry and location of all interface connections. c. Shipping sections and assembly drawings. d. Total weight and center of gravity of each switchboard panel board, enclosure and shipping section. e. Mounting details. f. Anchorage requirements (number of anchor bolts, type size, location)",
      [
        "Outline Dimensions (Front, Side, Top, Bottom Views)",
        "Cable Entry & Interface Connections",
        "Shipping Sections & Assembly Drawings",
        "Weight & Centre of Gravity",
        "Mounting Details",
        "Anchorage Requirements",
      ]
    ),
    D(
      "Battery Layout Drawings",
      "Battery layout drawings showing details of intercell connections, Battery terminal plate layout including terminal locations and sizes connection of cables.",
      ["Intercell Connections", "Terminal Plate Layout & Cable Connections"]
    ),
    D(
      "Schematic & Connection Drawings",
      "Schematic and Connection Drawings showing terminal designations for external cable connections and other information required to complete design interfaces.",
      ["External Cable Terminal Designations", "Design Interface Information"]
    ),
    D(
      "Battery & Charger Sizing (IEEE 485)",
      "Sizing calculations for the battery and battery charger in accordance with IEEE 485, including discharge curves and correction factors for temperature.",
      ["Battery Sizing", "Charger Sizing", "Discharge Curves", "Temperature Correction Factors"]
    ),
    D(
      "DC Short-Circuit Calculations (IEEE 946)",
      "DC short-circuit calculations for polarity-to-polarity faults at the DC switchboard in accordance with IEEE 946"
    ),
    D("UPS/Charger Short-Circuit Calculations", "UPS/charger short-circuit calculations for faults at the Distribution Panel"),
    D(
      "Breaker Trip Curves & Coordination Study",
      "Circuit breaker trip curves and coordination study for all circuit breakers supplied in DC switchboards, AC/DC panel boards and input/out breakers in chargers, inverters and CVT.",
      ["DC Switchboards", "AC/DC Panel Boards", "Charger, Inverter & CVT Breakers"]
    ),
    D(
      "DC Cable Sizing Calculations",
      "Sizing calculations (ampacity, voltage drop, and short time withstanding current) for all interconnecting cables within DC system",
      ["Ampacity", "Voltage Drop", "Short-Time Withstand Current"]
    ),
    D("DC & UPS Test Procedures", "DC and UPS system test procedures", ["DC System", "UPS System"]),
    D("Certified Production Test Reports", "Certified production test Reports"),
    D("Heat Rejection Loads", "Heat rejection loads in kW and Btu/hr for each piece of equipment supplied"),
    D(
      "Battery Hydrogen & Ventilation Calculation",
      "Battery hydrogen evaluation calculation for worst case operating condition, which produces most hydrogen and battery room minimum ventilation requirements",
      ["Hydrogen Evaluation (Worst Case)", "Battery Room Minimum Ventilation"]
    ),
    D("Nameplate Drawing & List", "Nameplate drawing and equipment nameplate list", ["Nameplate Drawing", "Equipment Nameplate List"]),
    D(
      "Instruction Manuals",
      "Instruction manuals including catalogs for equipment showing theory of operation, erection, installation, troubleshooting guide, factory settings of all adjustable alarm and trip set points and maintenance instructions for all the supplied equipment",
      ["Catalogs", "Theory of Operation", "Erection & Installation", "Troubleshooting Guide", "Factory Settings (Alarm & Trip Set Points)", "Maintenance Instructions"]
    ),
    D(
      "Control Logic & Operation Philosophy",
      "Control logic and system operation philosophy including SCADA interface",
      ["Control Logic", "System Operation Philosophy", "SCADA Interface"]
    ),
  ]),
  P("SCADA System", [
    D(
      "System Architecture",
      "SCADA System Architecture including Control System Architecture, Communication Architecture, Redundancy Philosophy, Time Synchronization Philosophy (NTP/GPS)",
      ["Control System Architecture", "Communication Architecture", "Redundancy Philosophy", "Time Synchronization Philosophy (NTP/GPS)"]
    ),
    D(
      "Software Design",
      "Software Design including Functional Design Specification (FDS), Software Design Specification (SDS)",
      ["Functional Design Specification (FDS)", "Software Design Specification (SDS)"]
    ),
    D(
      "Philosophies",
      "Philosophies: Control, Operator, Alarm, Historian, Event Logging, Reporting, User Management, Cybersecurity",
      ["Control", "Operator", "Alarm", "Historian", "Event Logging", "Reporting", "User Management", "Cybersecurity"]
    ),
    D(
      "Hardware Design",
      "Hardware Design including Hardware Datasheets, Server Datasheets, Workstation Datasheets, Engineering Station Datasheet, Network Switch Datasheets, Firewall Datasheets, Industrial PC Datasheets",
      ["Hardware Datasheets", "Server Datasheets", "Workstation Datasheets", "Engineering Station Datasheet", "Network Switch Datasheets", "Firewall Datasheets", "Industrial PC Datasheets"]
    ),
    D(
      "SCADA Graphics",
      "SCADA Graphics including Screen Navigation, Plant Mimic & Process Mimics, Systems Screens, Electrical SLD Screens, Alarm Screens, Trend Screens, Historical Trend Screens, Maintenance Screens, Diagnostic Screens",
      ["Screen Navigation", "Plant & Process Mimics", "System Screens", "Electrical SLD Screens", "Alarm Screens", "Trend Screens", "Historical Trend Screens", "Maintenance Screens", "Diagnostic Screens"]
    ),
    D(
      "Signal Interface List",
      "Signal Interface List including IO List with Signal Exchange Matrix, Modbus Register List with Mapping",
      ["IO List & Signal Exchange Matrix", "Modbus Register List & Mapping"]
    ),
  ]),
  P("Lightning", [
    D("Risk Assessment Report (IEC 62305)", "Lightning Risk Assessment Report per IEC 62305, determining required Lightning Protection Level (LPL I-IV)"),
    D("Design Report", "Lightning Protection Design report includes the Basis and Philosophy as per IEC 62305", ["Design Basis", "Design Philosophy"]),
    D("Layout, Sections & Details", "Lightning protection system layout, sections, and details drawing", ["Layout", "Sections", "Details"]),
    D(
      "Component BOQ & Datasheets",
      "Lightning Protection Component BOQ and Datasheets, includes but not limited to air rods, down conductors, test joints, bonding clamps, surge counters",
      ["BOQ", "Air Rods", "Down Conductors", "Test Joints", "Bonding Clamps", "Surge Counters"]
    ),
    D("SPD Coordination Study", "Surge Protection Device (SPD) Coordination Study per IEC 62305"),
    D("SPD Datasheets & Location Schedule", "SPD Datasheets & Location Schedule", ["SPD Datasheets", "Location Schedule"]),
    D("Maintenance Plan", "Lightning Protection System maintainance plan"),
  ]),
  P("LV Equipment", [
    D("Sub-Boards & Isolators", "Sub-boards & isolators"),
    D("UPS"),
    D("Metering & Energy Monitoring", "Metering & energy monitoring"),
  ]),
  P("ELV Equipment", [
    D("System List", "System list"),
    D("Cause & Effect Matrix", "Cause & effect matrix"),
    D("Power & Backup", "Power & backup"),
    D("Cabling"),
    D("Integration Boundaries", "Integration boundaries"),
  ]),
  P("General", [
    D("Single Line Diagram", "Single line diagram"),
    D("Load List"),
    D("Studies"),
    D("Standards & Specification Register", "Standards & specification register"),
    D("Interface / Responsibility Matrix", "Interface / responsibility matrix"),
    D("Vendor Document Review", "Vendor document review"),
    D("ITP & Hold Points", "ITP & hold points"),
    D("Energisation & Commissioning Sequence", "Energisation & commissioning sequence"),
    D("O&M, Spares & Training", "O&M, spares & training"),
  ]),
  P("E-House", [
    D(
      "General Arrangement Drawings",
      "E-House General Arrangement Drawings (Plan, Elevation, Sections), includes but not limited to the MCC room, Battery room, SCADA/Control room layout, equipment placement, access doors, escape/maintenance clearances",
      ["Plans", "Elevations", "Sections", "MCC Room", "Battery Room", "SCADA / Control Room", "Equipment Placement", "Access Doors", "Escape & Maintenance Clearances"]
    ),
    D(
      "Painting & Corrosion Protection Spec",
      "Painting & Corrosion Protection Specification (external cladding, internal surfaces)",
      ["External Cladding", "Internal Surfaces"]
    ),
    D(
      "HVAC Design Basis",
      "HVAC Design Basis, including the cooling load calculation per room (MCC heat dissipation, SCADA/UPS rack heat load), redundancy philosophy (N+1)",
      ["Cooling Load Calculation per Room", "MCC Heat Dissipation", "SCADA/UPS Rack Heat Load", "Redundancy Philosophy (N+1)"]
    ),
    D("HVAC Equipment Datasheets"),
    D("Normal & Emergency Lighting", "Normal & Emergency Lighting Layout with Lux Calculation", ["Lighting Layout", "Lux Calculation"]),
    D("Battery Room Ventilation Design"),
    D(
      "Battery Room Ventilation Datasheets & Coating Spec",
      "Battery Room Ventilation Fan & Ductwork Datasheet and Floor/Wall Chemically-Resistant Coating Specification",
      ["Fan & Ductwork Datasheets", "Floor/Wall Chemically-Resistant Coating Spec"]
    ),
  ]),
];

const DRIVE = "espark";
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// One fixed stamp so the file is reproducible; the drive shows it as the
// folder's modified date until something changes inside it.
const TS = Date.parse("2026-09-03T12:00:00Z");

// Ids carry the outline number, prefixed for this revision of the register.
const rows = [];
TREE.forEach((part, i) => {
  const n = String(i + 1);
  rows.push({ id: `r2-${n}`, parent: null, name: part.name, code: n, pos: i });
  part.subs.forEach((sub, j) => {
    const sn = `${n}.${j + 1}`;
    rows.push({ id: `r2-${n}-${j + 1}`, parent: `r2-${n}`, name: sub.name, code: sn, pos: j });
    sub.children.forEach((child, k) => {
      rows.push({ id: `r2-${n}-${j + 1}-${k + 1}`, parent: `r2-${n}-${j + 1}`, name: child, code: `${sn}.${k + 1}`, pos: k });
    });
  });
});

// One INSERT per part, many rows each: far fewer characters than a statement
// per row, which matters because the D1 console truncates a paste at about
// 20,000 characters and rejects the remainder as one broken statement.
const COLS = "(id, parent_id, drive, name, code, icon, position, created_at, modified_at)";
const row = (r) =>
  `(${[q(r.id), r.parent === null ? "NULL" : q(r.parent), q(DRIVE), q(r.name), q(r.code), "'folder'", r.pos, TS, TS].join(", ")})`;
const statements = [];
for (let i = 0; i < TREE.length; i++) {
  const prefix = `r2-${i + 1}`;
  const partRows = rows.filter((r) => r.id === prefix || r.id.startsWith(prefix + "-"));
  statements.push(`INSERT OR IGNORE INTO folders ${COLS} VALUES\n${partRows.map(row).join(",\n")};`);
}

// Rows earlier seed files created — ids "esp-*" (Rev1) and "r2-*" (this one) —
// go first, wherever they are. The app never mints such ids itself, so this
// touches nothing a person created. It matters because migration 003 marks
// every pre-existing row as the main drive, seeded rows included, and an
// INSERT OR IGNORE would then leave those stale copies in place.
const clearSeeded = [
  "DELETE FROM file_versions WHERE file_id IN (SELECT id FROM files WHERE folder_id LIKE 'esp-%' OR folder_id LIKE 'r2-%');",
  "DELETE FROM files WHERE folder_id LIKE 'esp-%' OR folder_id LIKE 'r2-%';",
  "DELETE FROM folders WHERE id LIKE 'esp-%' OR id LIKE 'r2-%';",
];

const header = [
  "-- eSpark Drive — folder tree, from the Electrical Scope Register Rev2.",
  "-- Generated by scripts/generate-espark-seed.mjs. Needs migrations/003_drives.sql.",
  "--   npx wrangler d1 execute <DB> --remote --file=./seed.espark.sql",
  "-- Removes rows from earlier seed files (ids esp-* and r2-*) from whichever drive",
  "-- they sit in, then inserts this tree with drive = 'espark'. Safe to run twice.",
  "-- Never touches a folder the app created.",
  "",
];

writeFileSync("seed.espark.sql", [...header, ...clearSeeded, "", ...statements, ""].join("\n"));
// The D1 dashboard console can flatten a paste onto one line, where a leading
// "--" comments out everything after it; this copy carries no comments.
writeFileSync("seed.espark.console.sql", [...clearSeeded, ...statements].join("\n") + "\n");

const parts = TREE.length;
const subs = TREE.reduce((s, p) => s + p.subs.length, 0);
console.log(
  `seed.espark.sql written — ${parts} parts, ${subs} deliverables, ${rows.length - parts - subs} point folders, ${rows.length} folders, ${statements.length} statements`
);
