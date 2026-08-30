/**
 * The folder tree exactly as the design canvas defines it
 * ("Yahya Khaled - Drive.dc.html", Component constructor), including the
 * modified dates its `stamp` pass assigns in pre-order.
 */

const F = (name, code, icon, children) => ({
  name,
  code,
  icon: icon || "folder",
  children: children || [],
});

export const TREE = [
  F("Master Degree", "MSC-00", "cap", [
    F("Power System Protection", "PRT-01", "shield", [
      F("Relay Coordination", "PRT-11"),
      F("Distance Protection", "PRT-12"),
      F("Differential Protection", "PRT-13"),
      F("Protection Lab Work", "PRT-14"),
    ]),
    F("Power System Communication", "COM-02", "tower", [
      F("IEC 61850 & GOOSE", "COM-21"),
      F("SCADA Systems", "COM-22"),
      F("Teleprotection", "COM-23"),
      F("Substation Networking", "COM-24"),
    ]),
    F("Power System Analysis", "ANL-03", "activity", [
      F("Load Flow Studies", "ANL-31"),
      F("Short Circuit Studies", "ANL-32"),
      F("Transient Stability", "ANL-33"),
    ]),
    F("Courses & Lectures", "CRS-04", "book", [
      F("Semester 1", "CRS-41"),
      F("Semester 2", "CRS-42"),
      F("Semester 3", "CRS-43"),
    ]),
    F("Thesis & Research", "THS-05", "flask", [
      F("Literature Review", "THS-51"),
      F("Simulation Models", "THS-52"),
      F("Drafts", "THS-53"),
      F("Published Papers", "THS-54"),
    ]),
    F("Standards & References", "STD-06", "bookmark", [
      F("IEC Standards", "STD-61"),
      F("IEEE Standards", "STD-62"),
      F("Textbooks", "STD-63"),
    ]),
  ]),
];

/** The canvas's date cycle, applied pre-order the same way `stamp` does. */
const DATES = [
  "Aug 12, 2026",
  "Jul 30, 2026",
  "Aug 24, 2026",
  "Jun 18, 2026",
  "Aug 28, 2026",
  "May 9, 2026",
];

export function stamped() {
  let i = 0;
  const walk = (nodes, parentId, out) => {
    nodes.forEach((n, idx) => {
      const id = `${n.code.toLowerCase()}-${idx}`;
      const modified = DATES[i++ % DATES.length];
      out.push({
        id,
        parent_id: parentId,
        name: n.name,
        code: n.code,
        icon: n.icon,
        position: idx,
        modified,
      });
      walk(n.children, id, out);
    });
    return out;
  };
  return walk(TREE, null, []);
}
