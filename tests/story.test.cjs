const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STATIONS, SETTINGS, createWheelGate } = require("../story.js");

test("there are exactly ten forward gestures after the prologue", () => {
  assert.equal(STATIONS.length - 1, 10);
  assert.equal(new Set(STATIONS.map((station) => station.id)).size, 11);
  assert.ok(STATIONS[0].hold > 0);
  assert.ok(STATIONS.at(-1).hold < 57);
  STATIONS.slice(1).forEach((station, i) => {
    assert.ok(station.hold > STATIONS[i].hold);
    assert.ok(station.name && station.en && station.title && station.description);
  });
});

test("trackpad inertia emits only one intent until a complete quiet gap", () => {
  const gate = createWheelGate();
  assert.equal(gate.push(30, 0), 1);
  for (let t = 20; t <= 2000; t += 20) assert.equal(gate.push(25, t), 0);
  assert.equal(gate.push(30, 2000 + SETTINGS.wheelIdle + 1), 1);
});

test("ten distinct gestures produce exactly ten forward intents", () => {
  const gate = createWheelGate();
  const results = [];
  for (let i = 0; i < 10; i++) {
    const time = i * 900;
    results.push(gate.push(70, time));
    results.push(gate.push(30, time + 20));
    results.push(gate.push(10, time + 100));
  }
  assert.equal(results.filter((value) => value === 1).length, 10);
});

test("tiny wheel deltas accumulate and direction changes reset accumulation", () => {
  const gate = createWheelGate(350, 18);
  assert.equal(gate.push(8, 0), 0);
  assert.equal(gate.push(8, 10), 0);
  assert.equal(gate.push(-8, 20), 0);
  assert.equal(gate.push(-10, 30), -1);
});

test("settling locks trailing momentum", () => {
  const gate = createWheelGate();
  gate.lock(3000);
  assert.equal(gate.push(100, 3100), 0);
  assert.equal(gate.push(-100, 3500), -1);
});

test("invalid wheel input does not consume a gesture", () => {
  const gate = createWheelGate();
  assert.equal(gate.push(NaN, 0), 0);
  assert.equal(gate.push(100, NaN), 0);
  assert.equal(gate.push(0, 0), 0);
  assert.equal(gate.push(100, 1), 1);
});
