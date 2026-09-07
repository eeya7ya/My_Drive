import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PrintNote from "@/components/PrintNote";
import { canOpenDrive } from "@/lib/auth";
import { getDrive } from "@/lib/drives";
import { driveOfFile, resolveDownload } from "@/lib/store";
import { kindFor } from "@/lib/preview";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Query = Promise<{ version?: string }>;

/**
 * A note on its own page, laid out for paper.
 *
 * Its own route rather than a dialog inside the drive, because printing takes
 * the whole page: the drive's chrome, its fixed sidebar and its scroll
 * containers all have to be absent rather than hidden, and a separate address
 * is also something a person can bookmark, reload, or send to a printer twice.
 *
 * The route lives at the site root instead of under a drive so that "print"
 * cannot shadow a folder in one; it is a reserved drive slug for the same
 * reason.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const { id } = await params;
  const { version } = await searchParams;

  // The same gate the file's own routes apply. A private drive's note must not
  // become readable by asking for it in a different shape.
  const driveKey = await driveOfFile(id);
  if (!driveKey) notFound();
  const brand = await getDrive(driveKey);
  if (!brand || !(await canOpenDrive(brand))) notFound();

  const target = await resolveDownload(id, version ?? null);
  if (!target) notFound();

  // Only what the app can lay out as a document. Anything else has a viewer of
  // its own, and printing raw bytes would produce nonsense.
  const kind = kindFor(target.name);
  if (kind !== "markdown" && kind !== "text") notFound();

  return (
    <PrintNote
      fileId={id}
      fileName={target.name}
      driveKey={brand.key}
      driveName={brand.name}
      versionId={version ?? null}
    />
  );
}
