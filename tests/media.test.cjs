const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { STATIONS, SETTINGS } = require("../story.js");
const root = path.resolve(__dirname, "..");

function topLevelBoxes(buffer) {
  const boxes = [];
  for (let offset = 0; offset + 8 <= buffer.length;) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (size === 1) size = Number(buffer.readBigUInt64BE(offset + 8));
    if (size === 0) size = buffer.length - offset;
    assert.ok(size >= 8 && offset + size <= buffer.length, `valid MP4 box ${type}`);
    boxes.push({ type, offset });
    offset += size;
  }
  return boxes;
}

test("all ten chapters have short independently loadable clips and still fallbacks", () => {
  STATIONS.slice(1).forEach((station) => {
    assert.match(station.clip, /^assets\/clip-\d{2}\.mp4$/);
    assert.match(station.still, /^assets\/still-\d{2}\.jpg$/);
    assert.ok(station.duration > 0 && station.duration <= 3, `${station.id} has a short wall duration`);
    assert.ok(fs.statSync(path.join(root, station.clip)).isFile());
    assert.ok(fs.statSync(path.join(root, station.still)).isFile());
  });
  assert.ok(SETTINGS.mediaWait > 0 && SETTINGS.mediaWait <= 650, "slow media must not trap navigation");
});

test("interactive media stays within the lightweight loading budget", () => {
  const sizes = STATIONS.slice(1).map((station) => fs.statSync(path.join(root, station.clip)).size);
  assert.ok(sizes[0] <= 200_000, "first motion should stay below 200 KB");
  assert.ok(sizes.every((size) => size <= 500_000), "each chapter should stay below 500 KB");
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 3_000_000, "all interactive clips should stay below 3 MB");
});

test("every chapter places MP4 metadata before video bytes for progressive playback", () => {
  STATIONS.slice(1).forEach((station) => {
    const boxes = topLevelBoxes(fs.readFileSync(path.join(root, station.clip)));
    const metadata = boxes.find((box) => box.type === "moov");
    const media = boxes.find((box) => box.type === "mdat");
    assert.ok(metadata && media, `${station.id} has MP4 metadata and media`);
    assert.ok(metadata.offset < media.offset, `${station.id} supports fast-start playback`);
  });
});
