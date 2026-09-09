import { describe, it, expect } from 'vitest';
import { readExifDate } from './exifDate';

/** Builds a minimal-but-valid JPEG containing one APP1/EXIF segment with a
 *  DateTimeOriginal tag in the Exif sub-IFD (matching where real cameras
 *  put it) and, optionally, a plain DateTime tag directly in IFD0. */
function buildJpegWithExif(options: {
  dateTimeOriginal?: string;
  dateTime?: string;
  little?: boolean;
}): Blob {
  const little = options.little ?? true;
  const bytes: number[] = [];
  const push16 = (v: number) => {
    if (little) bytes.push(v & 0xff, (v >> 8) & 0xff);
    else bytes.push((v >> 8) & 0xff, v & 0xff);
  };
  const push32 = (v: number) => {
    if (little) bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else bytes.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };
  const pushAscii = (s: string) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
    bytes.push(0);
  };

  // --- Build the TIFF/EXIF block first (everything after "Exif\0\0") ---
  const tiff: number[] = [];
  const t16 = (arr: number[], v: number) => {
    if (little) arr.push(v & 0xff, (v >> 8) & 0xff);
    else arr.push((v >> 8) & 0xff, v & 0xff);
  };
  const t32 = (arr: number[], v: number) => {
    if (little) arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else arr.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };

  // TIFF header: byte order, magic 0x002A, offset to IFD0 (=8, right after header)
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  t16(tiff, 0x002a);
  t32(tiff, 8);

  // IFD0: either a DateTime entry, or just a pointer to the Exif sub-IFD.
  const ifd0Entries: number[][] = [];
  const extraData: { relOffsetPlaceholderIndex: number; bytes: number[] }[] = [];

  // We'll lay out: [IFD0 header+entries+next-ifd-ptr][ExifSubIFD][string data...]
  // Compute sizes as we go using placeholder offsets, then patch.
  const ifd0EntryCount = options.dateTime ? 2 : 1; // DateTime? + ExifIFD pointer
  const ifd0Start = 8;
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const exifIfdStart = ifd0Start + ifd0Size;
  const exifIfdEntryCount = 1; // DateTimeOriginal
  const exifIfdSize = 2 + exifIfdEntryCount * 12 + 4;
  const stringDataStart = exifIfdStart + exifIfdSize;

  let cursor = stringDataStart;
  let dateTimeOffset = -1;
  let dateTimeOriginalOffset = -1;
  const stringBytes: number[] = [];

  if (options.dateTime) {
    dateTimeOffset = cursor;
    const s = options.dateTime;
    for (const ch of s) stringBytes.push(ch.charCodeAt(0));
    stringBytes.push(0);
    cursor += s.length + 1;
  }
  if (options.dateTimeOriginal) {
    dateTimeOriginalOffset = cursor;
    const s = options.dateTimeOriginal;
    for (const ch of s) stringBytes.push(ch.charCodeAt(0));
    stringBytes.push(0);
    cursor += s.length + 1;
  }

  // --- Write IFD0 ---
  t16(tiff, ifd0EntryCount);
  if (options.dateTime) {
    t16(tiff, 0x0132); // DateTime
    t16(tiff, 2); // ASCII
    t32(tiff, options.dateTime.length + 1);
    t32(tiff, dateTimeOffset);
  }
  t16(tiff, 0x8769); // ExifIFD pointer
  t16(tiff, 4); // LONG
  t32(tiff, 1);
  t32(tiff, exifIfdStart);
  t32(tiff, 0); // next IFD offset (none)

  // --- Write Exif sub-IFD ---
  t16(tiff, exifIfdEntryCount);
  t16(tiff, 0x9003); // DateTimeOriginal
  t16(tiff, 2); // ASCII
  t32(tiff, (options.dateTimeOriginal?.length ?? 0) + 1);
  t32(tiff, dateTimeOriginalOffset);
  t32(tiff, 0); // next IFD offset

  // --- String data ---
  tiff.push(...stringBytes);

  void ifd0Entries;
  void extraData;
  void pushAscii;

  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + tiff
  const app1Length = app1Payload.length + 2; // includes the length field itself

  bytes.push(0xff, 0xd8); // SOI
  bytes.push(0xff, 0xe1); // APP1
  push16(app1Length);
  bytes.push(...app1Payload);
  bytes.push(0xff, 0xda); // SOS (start of scan) — parser should stop here
  bytes.push(0x00, 0x00); // dummy scan data

  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

describe('readExifDate', () => {
  it('reads DateTimeOriginal from the Exif sub-IFD (little-endian)', async () => {
    const jpeg = buildJpegWithExif({ dateTimeOriginal: '2024:03:15 09:30:00', little: true });
    const date = await readExifDate(jpeg);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2024);
    expect(date!.getMonth()).toBe(2); // March = index 2
    expect(date!.getDate()).toBe(15);
    expect(date!.getHours()).toBe(9);
    expect(date!.getMinutes()).toBe(30);
  });

  it('reads DateTimeOriginal from big-endian ("MM") EXIF too', async () => {
    const jpeg = buildJpegWithExif({ dateTimeOriginal: '2023:07:04 18:00:00', little: false });
    const date = await readExifDate(jpeg);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2023);
    expect(date!.getMonth()).toBe(6); // July
    expect(date!.getDate()).toBe(4);
  });

  it('falls back to the plain DateTime tag in IFD0 when DateTimeOriginal is absent', async () => {
    const jpeg = buildJpegWithExif({ dateTime: '2022:01:01 00:00:00' });
    const date = await readExifDate(jpeg);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2022);
  });

  it('prefers DateTimeOriginal over DateTime when both are present', async () => {
    const jpeg = buildJpegWithExif({
      dateTime: '2020:01:01 00:00:00',
      dateTimeOriginal: '2025:12:25 12:00:00',
    });
    const date = await readExifDate(jpeg);
    expect(date!.getFullYear()).toBe(2025);
    expect(date!.getMonth()).toBe(11);
  });

  it('returns null for a non-JPEG file', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    expect(await readExifDate(png)).toBeNull();
  });

  it('returns null for a JPEG with no EXIF block at all', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x00]);
    const jpeg = new Blob([bytes], { type: 'image/jpeg' });
    expect(await readExifDate(jpeg)).toBeNull();
  });
});
