/**
 * Emit seed.espark.sql and seed.espark.console.sql — the eSpark drive's
 * folder tree, exactly as the Electrical Scope Register Rev2 workbook has it
 * (sheet "Scope Register", columns Part / Sub / Deliverable).
 *
 * Part is the package (1–17), Sub the deliverable inside it, and every name
 * is the register's own wording. The drive numbers folders from their
 * position, so "9.5" in the workbook is folder 9.5 in the drive.
 *
 * Every row is inserted with drive = 'espark'. The main drive's queries never
 * read that drive, so this tree cannot appear in the Power Systems drive
 * whichever database it is loaded into. Requires migrations/003_drives.sql.
 *
 *   node scripts/generate-espark-seed.mjs
 *   npx wrangler d1 execute <DB> --remote --file=./seed.espark.sql
 */

import { writeFileSync } from "node:fs";

const P = (name, subs) => ({ name, subs });

export const TREE = [
  P("Alternator", [
    "Rating & site derating",
    "Neutral earthing & NER",
    "Excitation, AVR & governor",
    "Fault contribution",
    "Generator protection",
    "Testing",
  ]),
  P("MV Switchgear (MVSG)", [
    "As-Built Survey Drawing of Existing MV Room - dimensions/access openings, existing floor construction, existing cable trench/duct routing, visible earthing conductor routing",
    "Existing Cable Trench/Duct Bank Condition Survey and Compatibility Assessment for new cable sizes and routing",
    "Existing Ventilation/HVAC Assessment against new switchgear heat load",
    "HVAC and Ventilation Modification design and shop drawings includes, all supportive calculations, drawings, BOQ, and New Equipment Datasheet",
    "Fire Detection & fighting system Assessment Report",
    "Fire Detection & Fighting system Modification Design/shop drawings includes but not limited to all supportive Drawings, BOQs, Datasheets.",
    "Outdoor lighting design includes lux calculation and drawings",
  ]),
  P("Aux Transformer", [
    "Rating & vector group",
    "Dry vs oil-filled",
    "Protection",
    "Inrush & through-fault",
    "Losses & noise",
    "Testing",
  ]),
  P("MV Cable & Termination", [
    "Data sheet and Samples",
    "Routing & installation Layout",
    "Routing Details",
    "Cable Sizing",
    "FAT test",
    "Testing ITP and Method of Statement",
    "Testing Report",
  ]),
  P("LV Cables", [
    "Data sheet and Samples",
    "Routing & installation Layout",
    "Routing Details",
    "Cable Sizing",
    "FAT test",
    "Testing ITP and Method of Statement",
    "Testing Report",
  ]),
  P("Earthing", [
    "Soil Resistivity Test procedures (ITP, MOS, Test Report Template), shall include the proposed test locations and depths across the sites.",
    "Soil Resistivity Test Report, includes the results and testing equipment calibration certificate",
    "Existing Earth system assessment and Test Report",
    "Earthing System Design Calculation following the lastest version of IEEE 80, including the touch, step, mesh voltage, Ground Potential Rise (GPR), grid conductor sizing, fault current withstand, and calculated ground resistance.",
    "Primary Earthing Grid Layout Drawing and details, showing grid conductor routing, buried depth, mesh spacing, earth pit/test pit locations, and Typical Details",
    "Secondary earthing layout, showing the risers for each equipment, the size of risers, and Earth Bar locations with Equipment Earthing Connection Details",
    "Earthing System Modification if required includes all design and shop drawing drawings, calculations, BOQ, new material datasheets.",
    "Earthing system BOQ and Datasheets, includes cables, rods, pits, and clamps",
    "Earthing System Test Procedures (ITP, MOS, Test Report Template)",
    "Earthing System Test Reports",
    "Earthing System maintainance plan",
  ]),
  P("Main Distribution Boards", [
    "Assembly standard",
    "Ratings",
    "Feeder schedule",
    "Discrimination & cascading",
    "Changeover / ATS",
    "Metering & monitoring",
    "Arc flash, access & ventilation",
  ]),
  P("Control Room", [
    "Fire detection & suppression",
    "Power supplies",
    "Operator interface",
    "Access control & security",
  ]),
  P("MCC Panels", [
    "MCC Panel General Arrangement Drawing showing dimensions, floor layout, cable entries, busbar details, equip segregation",
    "MCC Panel Single Line Diagram (SLD) showing all incoming/outgoing feeders, ratings.",
    "MCC Panel Schematics & Wiring Diagrams for all starters, control circuits, interlocks, and alarms.",
    "MCC main component datasheets including but not limited to starter, CBs, Contactors, and VFDs, showing the rating and harmonic tables.",
    "MCC Panel Protection Relay Settings & Coordination Study, including the coordination curves for all overcurrent protection.",
    "MCC Panel Bill of Materials (Breakers, Contactors, Relays, Pushbuttons, Indicating Lamps, Terminals)",
    "MCC Panel Cable Termination Schedule and Details",
    "MCC Certified Type Test Reports",
    "MCC Panel Factory Test Procedure detailing all required visual/mechanical, dielectric, functional, and operation tests",
    "MCC Panel Factory Test Reports",
    "MCC Panel Operation & Maintenance Manual",
    "MCC Panel Spare Parts Recommendation List (2-year operation)",
  ]),
  P("Control Panels & Motors", [
    "Motor data",
    "Hazardous area",
    "Accessories",
    "Control philosophy",
    "Motor starting study",
    "Commissioning",
  ]),
  P("Charger & Batteries", [
    "System Datasheet including battery, chargers, inverters, DC/AC switchboards, CVT",
    "Single Line Diagram for DC/UPS system",
    "Installation and layout drawings: Arrangements outline dimensions, mounting details, cable entry areas and weights for all supplied equipment. The drawings shall provide sufficient and adequate information required for the interfaces including the following: a. Outline dimensions including front view, side views, top view and bottom view. b. Cable entry and location of all interface connections. c. Shipping sections and assembly drawings. d. Total weight and center of gravity of each switchboard panel board, enclosure and shipping section. e. Mounting details. f. Anchorage requirements (number of anchor bolts, type size, location)",
    "Battery layout drawings showing details of intercell connections, Battery terminal plate layout including terminal locations and sizes connection of cables.",
    "Schematic and Connection Drawings showing terminal designations for external cable connections and other information required to complete design interfaces.",
    "Sizing calculations for the battery and battery charger in accordance with IEEE 485, including discharge curves and correction factors for temperature.",
    "DC short-circuit calculations for polarity-to-polarity faults at the DC switchboard in accordance with IEEE 946",
    "UPS/charger short-circuit calculations for faults at the Distribution Panel",
    "Circuit breaker trip curves and coordination study for all circuit breakers supplied in DC switchboards, AC/DC panel boards and input/out breakers in chargers, inverters and CVT.",
    "Sizing calculations (ampacity, voltage drop, and short time withstanding current) for all interconnecting cables within DC system",
    "DC and UPS system test procedures",
    "Certified production test Reports",
    "Heat rejection loads in kW and Btu/hr for each piece of equipment supplied",
    "Battery hydrogen evaluation calculation for worst case operating condition, which produces most hydrogen and battery room minimum ventilation requirements",
    "Nameplate drawing and equipment nameplate list",
    "Instruction manuals including catalogs for equipment showing theory of operation, erection, installation, troubleshooting guide, factory settings of all adjustable alarm and trip set points and maintenance instructions for all the supplied equipment",
    "Control logic and system operation philosophy including SCADA interface",
  ]),
  P("SCADA System", [
    "SCADA System Architecture including Control System Architecture, Communication Architecture, Redundancy Philosophy, Time Synchronization Philosophy (NTP/GPS)",
    "Software Design including Functional Design Specification (FDS), Software Design Specification (SDS)",
    "Philosophies: Control, Operator, Alarm, Historian, Event Logging, Reporting, User Management, Cybersecurity",
    "Hardware Design including Hardware Datasheets, Server Datasheets, Workstation Datasheets, Engineering Station Datasheet, Network Switch Datasheets, Firewall Datasheets, Industrial PC Datasheets",
    "SCADA Graphics including Screen Navigation, Plant Mimic & Process Mimics, Systems Screens, Electrical SLD Screens, Alarm Screens, Trend Screens, Historical Trend Screens, Maintenance Screens, Diagnostic Screens",
    "Signal Interface List including IO List with Signal Exchange Matrix, Modbus Register List with Mapping",
  ]),
  P("Lightning", [
    "Lightning Risk Assessment Report per IEC 62305, determining required Lightning Protection Level (LPL I-IV)",
    "Lightning Protection Design report includes the Basis and Philosophy as per IEC 62305",
    "Lightning protection system layout, sections, and details drawing",
    "Lightning Protection Component BOQ and Datasheets, includes but not limited to air rods, down conductors, test joints, bonding clamps, surge counters",
    "Surge Protection Device (SPD) Coordination Study per IEC 62305",
    "SPD Datasheets & Location Schedule",
    "Lightning Protection System maintainance plan",
  ]),
  P("LV Equipment", [
    "Sub-boards & isolators",
    "UPS",
    "Metering & energy monitoring",
  ]),
  P("ELV Equipment", [
    "System list",
    "Cause & effect matrix",
    "Power & backup",
    "Cabling",
    "Integration boundaries",
  ]),
  P("General", [
    "Single line diagram",
    "Load List",
    "Studies",
    "Standards & specification register",
    "Interface / responsibility matrix",
    "Vendor document review",
    "ITP & hold points",
    "Energisation & commissioning sequence",
    "O&M, spares & training",
  ]),
  P("E-House", [
    "E-House General Arrangement Drawings (Plan, Elevation, Sections), includes but not limited to the MCC room, Battery room, SCADA/Control room layout, equipment placement, access doors, escape/maintenance clearances",
    "Painting & Corrosion Protection Specification (external cladding, internal surfaces)",
    "HVAC Design Basis, including the cooling load calculation per room (MCC heat dissipation, SCADA/UPS rack heat load), redundancy philosophy (N+1)",
    "HVAC Equipment Datasheets",
    "Normal & Emergency Lighting Layout with Lux Calculation",
    "Battery Room Ventilation Design",
    "Battery Room Ventilation Fan & Ductwork Datasheet and Floor/Wall Chemically-Resistant Coating Specification",
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
    rows.push({ id: `r2-${n}-${j + 1}`, parent: `r2-${n}`, name: sub, code: `${n}.${j + 1}`, pos: j });
  });
});

const statements = rows.map(
  (r) =>
    `INSERT OR IGNORE INTO folders (id, parent_id, drive, name, code, icon, position, created_at, modified_at) VALUES (` +
    [q(r.id), r.parent === null ? "NULL" : q(r.parent), q(DRIVE), q(r.name), q(r.code), "'folder'", r.pos, TS, TS].join(", ") +
    ");"
);

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
  "-- eSpark Drive — folder tree, exactly as the Electrical Scope Register Rev2.",
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
console.log(
  `seed.espark.sql written — ${parts} parts, ${rows.length - parts} deliverables, ${rows.length} folders, all drive = '${DRIVE}'`
);
