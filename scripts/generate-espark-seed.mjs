/**
 * Emit seed.espark.sql and seed.espark.console.sql — the eSpark drive's
 * folder tree, from the Electrical Scope Register Rev2 workbook (sheet
 * "Scope Register", columns Part / Sub / Deliverable).
 *
 * The numbering is the register's: Part is the package (1–17) and Sub the
 * deliverable inside it, so "9.5" in the workbook is folder 9.5 in the
 * drive. The drive numbers folders from their position, and positions here
 * follow the register exactly.
 *
 * Folder names are short titles for the deliverables, since a folder named
 * with a two-line sentence is unusable in a sidebar. The register's full
 * wording is kept beside each entry as `full` so nothing is lost. Where one
 * deliverable bundles several distinct documents — "ITP, MOS, Test Report
 * Template", or a datasheet line that names five kinds of equipment — it gets
 * a third level, one folder per document, so each upload has an obvious home.
 *
 *   node scripts/generate-espark-seed.mjs
 *   npx wrangler d1 execute <ESPARK_DB> --remote --file=./seed.espark.sql
 */

import { writeFileSync } from "node:fs";

/** A deliverable: short folder name, the register's wording, optional sub-folders. */
const D = (name, full, children) => ({ name, full: full ?? name, children: children ?? [] });
const P = (name, subs) => ({ name, subs });

const TEST_PROCEDURES = ["ITP", "Method of Statement", "Test Report Template"];
const CABLE_SUBS = [
  D("Datasheets & Samples", "Data sheet and Samples"),
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
      "As-Built Survey Drawing of Existing MV Room - dimensions/access openings, existing floor construction, existing cable trench/duct routing, visible earthing conductor routing"
    ),
    D(
      "Existing Cable Trench & Duct Bank Survey",
      "Existing Cable Trench/Duct Bank Condition Survey and Compatibility Assessment for new cable sizes and routing"
    ),
    D("Existing HVAC Assessment", "Existing Ventilation/HVAC Assessment against new switchgear heat load"),
    D(
      "HVAC Modification Design",
      "HVAC and Ventilation Modification design and shop drawings includes, all supportive calculations, drawings, BOQ, and New Equipment Datasheet",
      ["Calculations", "Design & Shop Drawings", "BOQ", "Equipment Datasheets"]
    ),
    D("Fire Detection & Fighting Assessment", "Fire Detection & fighting system Assessment Report"),
    D(
      "Fire Detection & Fighting Modification Design",
      "Fire Detection & Fighting system Modification Design/shop drawings includes but not limited to all supportive Drawings, BOQs, Datasheets.",
      ["Design & Shop Drawings", "BOQ", "Datasheets"]
    ),
    D("Outdoor Lighting Design", "Outdoor lighting design includes lux calculation and drawings", [
      "Lux Calculation",
      "Drawings",
    ]),
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
      TEST_PROCEDURES
    ),
    D(
      "Soil Resistivity Test Report",
      "Soil Resistivity Test Report, includes the results and testing equipment calibration certificate",
      ["Test Results", "Equipment Calibration Certificates"]
    ),
    D("Existing Earth System Assessment & Test Report", "Existing Earth system assessment and Test Report"),
    D(
      "Earthing Design Calculation (IEEE 80)",
      "Earthing System Design Calculation following the lastest version of IEEE 80, including the touch, step, mesh voltage, Ground Potential Rise (GPR), grid conductor sizing, fault current withstand, and calculated ground resistance."
    ),
    D(
      "Primary Earthing Grid Layout & Details",
      "Primary Earthing Grid Layout Drawing and details, showing grid conductor routing, buried depth, mesh spacing, earth pit/test pit locations, and Typical Details"
    ),
    D(
      "Secondary Earthing Layout & Connections",
      "Secondary earthing layout, showing the risers for each equipment, the size of risers, and Earth Bar locations with Equipment Earthing Connection Details"
    ),
    D(
      "Earthing System Modification",
      "Earthing System Modification if required includes all design and shop drawing drawings, calculations, BOQ, new material datasheets.",
      ["Design & Shop Drawings", "Calculations", "BOQ", "Material Datasheets"]
    ),
    D("Earthing BOQ & Datasheets", "Earthing system BOQ and Datasheets, includes cables, rods, pits, and clamps"),
    D("Earthing Test Procedures", "Earthing System Test Procedures (ITP, MOS, Test Report Template)", TEST_PROCEDURES),
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
      "MCC Panel General Arrangement Drawing showing dimensions, floor layout, cable entries, busbar details, equip segregation"
    ),
    D("Single Line Diagram", "MCC Panel Single Line Diagram (SLD) showing all incoming/outgoing feeders, ratings."),
    D(
      "Schematics & Wiring Diagrams",
      "MCC Panel Schematics & Wiring Diagrams for all starters, control circuits, interlocks, and alarms."
    ),
    D(
      "Main Component Datasheets",
      "MCC main component datasheets including but not limited to starter, CBs, Contactors, and VFDs, showing the rating and harmonic tables.",
      ["Starters", "Circuit Breakers", "Contactors", "VFDs"]
    ),
    D(
      "Protection Settings & Coordination Study",
      "MCC Panel Protection Relay Settings & Coordination Study, including the coordination curves for all overcurrent protection."
    ),
    D(
      "Bill of Materials",
      "MCC Panel Bill of Materials (Breakers, Contactors, Relays, Pushbuttons, Indicating Lamps, Terminals)"
    ),
    D("Cable Termination Schedule & Details", "MCC Panel Cable Termination Schedule and Details"),
    D("Certified Type Test Reports", "MCC Certified Type Test Reports"),
    D(
      "Factory Test Procedure",
      "MCC Panel Factory Test Procedure detailing all required visual/mechanical, dielectric, functional, and operation tests"
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
        "Outline Dimensions",
        "Cable Entry & Interface Connections",
        "Shipping Sections & Assembly",
        "Weight & Centre of Gravity",
        "Mounting Details",
        "Anchorage Requirements",
      ]
    ),
    D(
      "Battery Layout Drawings",
      "Battery layout drawings showing details of intercell connections, Battery terminal plate layout including terminal locations and sizes connection of cables."
    ),
    D(
      "Schematic & Connection Drawings",
      "Schematic and Connection Drawings showing terminal designations for external cable connections and other information required to complete design interfaces."
    ),
    D(
      "Battery & Charger Sizing (IEEE 485)",
      "Sizing calculations for the battery and battery charger in accordance with IEEE 485, including discharge curves and correction factors for temperature."
    ),
    D(
      "DC Short-Circuit Calculations (IEEE 946)",
      "DC short-circuit calculations for polarity-to-polarity faults at the DC switchboard in accordance with IEEE 946"
    ),
    D("UPS/Charger Short-Circuit Calculations", "UPS/charger short-circuit calculations for faults at the Distribution Panel"),
    D(
      "Breaker Trip Curves & Coordination Study",
      "Circuit breaker trip curves and coordination study for all circuit breakers supplied in DC switchboards, AC/DC panel boards and input/out breakers in chargers, inverters and CVT."
    ),
    D(
      "DC Cable Sizing Calculations",
      "Sizing calculations (ampacity, voltage drop, and short time withstanding current) for all interconnecting cables within DC system"
    ),
    D("DC & UPS Test Procedures", "DC and UPS system test procedures"),
    D("Certified Production Test Reports", "Certified production test Reports"),
    D("Heat Rejection Loads", "Heat rejection loads in kW and Btu/hr for each piece of equipment supplied"),
    D(
      "Battery Hydrogen & Ventilation Calculation",
      "Battery hydrogen evaluation calculation for worst case operating condition, which produces most hydrogen and battery room minimum ventilation requirements"
    ),
    D("Nameplate Drawing & List", "Nameplate drawing and equipment nameplate list"),
    D(
      "Instruction Manuals",
      "Instruction manuals including catalogs for equipment showing theory of operation, erection, installation, troubleshooting guide, factory settings of all adjustable alarm and trip set points and maintenance instructions for all the supplied equipment"
    ),
    D("Control Logic & Operation Philosophy", "Control logic and system operation philosophy including SCADA interface"),
  ]),
  P("SCADA System", [
    D(
      "System Architecture",
      "SCADA System Architecture including Control System Architecture, Communication Architecture, Redundancy Philosophy, Time Synchronization Philosophy (NTP/GPS)",
      ["Control System Architecture", "Communication Architecture", "Redundancy Philosophy", "Time Synchronization (NTP/GPS)"]
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
      ["Hardware Datasheets", "Servers", "Workstations", "Engineering Station", "Network Switches", "Firewalls", "Industrial PCs"]
    ),
    D(
      "SCADA Graphics",
      "SCADA Graphics including Screen Navigation, Plant Mimic & Process Mimics, Systems Screens, Electrical SLD Screens, Alarm Screens, Trend Screens, Historical Trend Screens, Maintenance Screens, Diagnostic Screens",
      [
        "Screen Navigation",
        "Plant & Process Mimics",
        "System Screens",
        "Electrical SLD Screens",
        "Alarm Screens",
        "Trend Screens",
        "Historical Trend Screens",
        "Maintenance Screens",
        "Diagnostic Screens",
      ]
    ),
    D(
      "Signal Interface List",
      "Signal Interface List including IO List with Signal Exchange Matrix, Modbus Register List with Mapping",
      ["IO List & Signal Exchange Matrix", "Modbus Register Map"]
    ),
  ]),
  P("Lightning", [
    D(
      "Risk Assessment Report (IEC 62305)",
      "Lightning Risk Assessment Report per IEC 62305, determining required Lightning Protection Level (LPL I-IV)"
    ),
    D("Design Report & Philosophy", "Lightning Protection Design report includes the Basis and Philosophy as per IEC 62305"),
    D("Layout, Sections & Details", "Lightning protection system layout, sections, and details drawing"),
    D(
      "Component BOQ & Datasheets",
      "Lightning Protection Component BOQ and Datasheets, includes but not limited to air rods, down conductors, test joints, bonding clamps, surge counters"
    ),
    D("SPD Coordination Study", "Surge Protection Device (SPD) Coordination Study per IEC 62305"),
    D("SPD Datasheets & Location Schedule"),
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
      ["Plans", "Elevations", "Sections"]
    ),
    D(
      "Painting & Corrosion Protection Spec",
      "Painting & Corrosion Protection Specification (external cladding, internal surfaces)"
    ),
    D(
      "HVAC Design Basis & Cooling Load",
      "HVAC Design Basis, including the cooling load calculation per room (MCC heat dissipation, SCADA/UPS rack heat load), redundancy philosophy (N+1)"
    ),
    D("HVAC Equipment Datasheets"),
    D("Normal & Emergency Lighting & Lux Calc", "Normal & Emergency Lighting Layout with Lux Calculation", [
      "Lighting Layout",
      "Lux Calculation",
    ]),
    D("Battery Room Ventilation Design"),
    D(
      "Battery Room Ventilation Datasheets & Coating Spec",
      "Battery Room Ventilation Fan & Ductwork Datasheet and Floor/Wall Chemically-Resistant Coating Specification",
      ["Fan & Ductwork Datasheets", "Chemically-Resistant Coating Specification"]
    ),
  ]),
];

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// One fixed stamp so the file is reproducible; the drive shows it as the
// folder's modified date until something changes inside it.
const TS = Date.parse("2026-09-03T12:00:00Z");

// Ids carry the outline number, prefixed "r2-" for this revision of the
// register, so a later revision can replace these rows by prefix.
const rows = [];
TREE.forEach((part, i) => {
  const n = String(i + 1);
  rows.push({ id: `r2-${n}`, parent: null, name: part.name, code: n, pos: i });
  part.subs.forEach((sub, j) => {
    const sn = `${n}.${j + 1}`;
    rows.push({ id: `r2-${n}-${j + 1}`, parent: `r2-${n}`, name: sub.name, code: sn, pos: j });
    sub.children.forEach((child, k) => {
      const cn = `${sn}.${k + 1}`;
      rows.push({ id: `r2-${n}-${j + 1}-${k + 1}`, parent: `r2-${n}-${j + 1}`, name: child, code: cn, pos: k });
    });
  });
});

const inserts = rows.map(
  (r) =>
    `INSERT OR IGNORE INTO folders (id, parent_id, name, code, icon, position, created_at, modified_at) VALUES (` +
    [q(r.id), r.parent === null ? "NULL" : q(r.parent), q(r.name), q(r.code), "'folder'", r.pos, TS, TS].join(", ") +
    ");"
);

// The first revision's rows used the "esp-" prefix. Take them out, and any
// file rows recorded under them, so the two trees never sit side by side.
const removeRev1 = [
  "DELETE FROM file_versions WHERE file_id IN (SELECT id FROM files WHERE folder_id LIKE 'esp-%');",
  "DELETE FROM files WHERE folder_id LIKE 'esp-%';",
  "DELETE FROM folders WHERE id LIKE 'esp-%';",
];

const header = [
  "-- eSpark Drive — folder tree, from the Electrical Scope Register Rev2.",
  "-- Generated by scripts/generate-espark-seed.mjs. Load after schema.sql:",
  "--   npx wrangler d1 execute <ESPARK_DB> --remote --file=./seed.espark.sql",
  "--",
  "-- Removes the Rev1 tree (ids esp-*) first, then inserts this one (ids r2-*)",
  "-- with INSERT OR IGNORE, so it is safe to run twice. Files uploaded into the",
  "-- Rev1 folders lose their rows here; their objects stay in R2 and the storage",
  "-- counter is rebuilt by POST /api/admin/recalc.",
  "",
];

writeFileSync("seed.espark.sql", [...header, ...removeRev1, "", ...inserts, ""].join("\n"));
// The D1 dashboard console can flatten a paste onto one line, where a leading
// "--" comments out everything after it; this copy carries no comments.
writeFileSync("seed.espark.console.sql", [...removeRev1, ...inserts].join("\n") + "\n");

const parts = TREE.length;
const subs = TREE.reduce((s, p) => s + p.subs.length, 0);
console.log(
  `seed.espark.sql written — ${parts} parts, ${subs} deliverables, ${rows.length - parts - subs} document folders, ${rows.length} folders`
);
