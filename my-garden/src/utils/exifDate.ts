// src/utils/exifDate.ts
// Reads a JPEG's EXIF "date taken" so an uploaded photo can be timestamped
// by when it was actually shot, not when it happened to be uploaded — a
// photo taken last week and only added to the plant's timeline today
// should still sort by last week. Only JPEGs carry EXIF; anything else
// (PNG, HEIC re-encoded to JPEG by resizeImage before this ever runs on
// it, etc.) returns null and the caller falls back to "now", same as
// before this existed.
//
// Deliberately hand-rolled instead of a library: this needs only two EXIF
// tags out of the entire spec, and reads them straight from the first few
// KB of the file — no need to pull in a general-purpose EXIF parser for
// that.

/** DateTimeOriginal (0x9003, in the Exif sub-IFD) if present, else DateTime
 *  (0x0132, in IFD0) — both use EXIF's "YYYY:MM:DD HH:MM:SS" format, always
 *  local time with no timezone recorded. Returns null for anything that
 *  isn't a JPEG, has no EXIF block, or has neither tag. */
export async function readExifDate(file: Blob): Promise<Date | null> {
  try {
    // EXIF lives in the first APP1 segment, always near the start of the
    // file — 128KB is generously more than any real camera's EXIF block.
    const head = await file.slice(0, 131072).arrayBuffer();
    const view = new DataView(head);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if (marker === 0xffe1) {
        const segmentLength = view.getUint16(offset + 2);
        const segmentStart = offset + 4;
        if (
          segmentStart + 6 <= view.byteLength &&
          view.getUint32(segmentStart) === 0x45786966 && // "Exif"
          view.getUint16(segmentStart + 4) === 0x0000
        ) {
          return parseTiff(view, segmentStart + 6);
        }
        offset = segmentStart + segmentLength - 2;
      } else if (marker === 0xffd8 || (marker & 0xff00) !== 0xff00) {
        offset += 1; // resync — not a valid marker here
      } else if (marker === 0xffda) {
        return null; // start of scan (actual image data) — EXIF always comes before this
      } else {
        offset += 2 + view.getUint16(offset + 2);
      }
    }
    return null;
  } catch {
    return null; // a malformed/truncated file shouldn't block the upload
  }
}

function parseTiff(view: DataView, tiffStart: number): Date | null {
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949; // "II"
  if (!little && byteOrder !== 0x4d4d) return null; // "MM" is the only other valid value

  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = readIfd(view, tiffStart, tiffStart + ifd0Offset, little);

  // DateTimeOriginal (in the Exif sub-IFD) is when the shutter actually
  // fired — preferred over IFD0's plain DateTime, which many cameras/editors
  // instead stamp with whenever the file was last saved/modified.
  if (ifd0.exifIfdOffset != null) {
    const exifIfd = readIfd(view, tiffStart, tiffStart + ifd0.exifIfdOffset, little);
    if (exifIfd.dateTimeOriginal) return exifIfd.dateTimeOriginal;
  }
  if (ifd0.dateTime) return ifd0.dateTime;
  return null;
}

const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TYPE_ASCII = 2;

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
): { dateTime?: Date; dateTimeOriginal?: Date; exifIfdOffset?: number } {
  const result: { dateTime?: Date; dateTimeOriginal?: Date; exifIfdOffset?: number } = {};
  if (ifdOffset + 2 > view.byteLength) return result;

  const entryCount = view.getUint16(ifdOffset, little);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const count = view.getUint32(entryOffset + 4, little);

    if (tag === TAG_EXIF_IFD_POINTER) {
      result.exifIfdOffset = view.getUint32(entryOffset + 8, little);
      continue;
    }
    if ((tag === TAG_DATE_TIME || tag === TAG_DATE_TIME_ORIGINAL) && type === TYPE_ASCII) {
      // A 20-byte ASCII value (19 chars + null) never fits inline in the
      // 4-byte value slot, so it's always stored at an offset from tiffStart.
      const valueOffset = tiffStart + view.getUint32(entryOffset + 8, little);
      const str = readAscii(view, valueOffset, count);
      const parsed = parseExifDateString(str);
      if (parsed) {
        if (tag === TAG_DATE_TIME_ORIGINAL) result.dateTimeOriginal = parsed;
        else result.dateTime = parsed;
      }
    }
  }
  return result;
}

function readAscii(view: DataView, start: number, length: number): string {
  let str = '';
  for (let i = 0; i < length && start + i < view.byteLength; i++) {
    const code = view.getUint8(start + i);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str;
}

function parseExifDateString(str: string): Date | null {
  const match = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  if (y === 0) return null; // some cameras write all-zero placeholders
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}
