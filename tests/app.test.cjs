const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./app-harness.cjs");

const clips = (app) => app.media.filter((item) => item.tagName === "VIDEO" && item.id !== "full-film");
const station = (app) => Number(app.body.dataset.station);

async function settleSlowMedia(app) {
  await app.clock.advance(900);
  assert.equal(app.body.dataset.state, "idle");
  assert.equal(app.$("next").disabled, false);
}

async function finishClip(app) {
  await app.clock.advance(20);
  const active = clips(app).find((item) => !item.paused);
  assert.ok(active, "the ready chapter clip should play");
  active.currentTime = active.duration;
  active.dispatch("ended");
  await app.clock.advance(250);
}

test("startup is interactive before any video data arrives", async () => {
  const app = createApp();
  assert.equal(app.body.dataset.state, "idle");
  assert.equal(station(app), 0);
  assert.equal(app.$("next").disabled, false);
  assert.equal(app.$("chapters-button").disabled, false);
  assert.equal(app.$("home").disabled, false);
  assert.equal(app.$("experience").getAttribute("aria-busy"), "false");
  assert.equal(app.requests.length, 0, "no fetch-to-Blob full-video gate");
  assert.equal(app.$("full-film").src, "");
  assert.equal(app.$("bgm").playCalls, 0);
  assert.equal(app.$("bgm").src, "", "background audio is not downloaded before consent");
  assert.equal(clips(app).filter((item) => item.src).length, 1, "only the next short clip is prepared");
  assert.equal(app.click("chapters-button"), true);
  assert.equal(app.$("chapters-dialog").open, true);
  app.click("close-chapters");
  assert.equal(app.$("chapters-dialog").open, false);
});

test("a never-loading clip falls forward instead of blocking the first interaction", async () => {
  const app = createApp();
  app.click("next");
  await settleSlowMedia(app);
  assert.equal(station(app), 1);
  assert.equal(app.$("chapter-name").textContent, app.story.STATIONS[1].name);
  assert.equal(app.$("next").disabled, false);
  assert.ok(clips(app).every((item) => item.paused));
});

test("ten independent gestures still reach ten chapters on a network with no video", async () => {
  const app = createApp();
  for (let index = 1; index <= 10; index++) {
    app.wheel();
    await settleSlowMedia(app);
    assert.equal(station(app), index);
    await app.clock.advance(app.story.SETTINGS.wheelIdle + 1);
  }
  app.wheel();
  await settleSlowMedia(app);
  assert.equal(station(app), 10, "extra downward gestures do not wrap unexpectedly");
});

test("jump and reverse navigation use stills without waiting for media", async () => {
  const app = createApp();
  assert.equal(app.jump(8), true);
  await app.clock.advance(350);
  assert.equal(station(app), 8);
  assert.equal(app.body.dataset.state, "idle");
  app.key("ArrowUp");
  await app.clock.advance(350);
  assert.equal(station(app), 7);
  app.key("Home");
  await app.clock.advance(350);
  assert.equal(station(app), 0);
});

test("media errors do not disable navigation or return to a global loading gate", async () => {
  const app = createApp();
  app.click("next");
  clips(app).forEach((item) => item.fail());
  await settleSlowMedia(app);
  assert.equal(station(app), 1);
  assert.equal(app.jump(9), true);
  await app.clock.advance(350);
  assert.equal(station(app), 9);
  assert.equal(app.$("next").disabled, false);
});

test("returning home retries a failed cached chapter instead of preserving its failure", async () => {
  const app = createApp();
  app.click("next");
  const first = clips(app).find((item) => /clip-01\.mp4$/.test(item.src));
  first.fail();
  await app.clock.advance(0);
  assert.equal(station(app), 1);
  const loads = first.loadCalls;
  first.blocked = false;
  app.click("home");
  await app.clock.advance(0);
  assert.equal(station(app), 0);
  assert.equal(first.loadCalls, loads + 1, "failed cached clip must receive a new load()");
  assert.equal(first.error, null);
  app.click("next");
  await finishClip(app);
  assert.equal(station(app), 1);
});

test("late events from a timed-out clip cannot override the selected chapter", async () => {
  const app = createApp();
  app.click("next");
  const stale = clips(app).find((item) => item.src);
  await settleSlowMedia(app);
  app.jump(7);
  await app.clock.advance(350);
  assert.equal(station(app), 7);
  stale.readyState = 4;
  stale.dispatch("loadeddata");
  stale.dispatch("canplay");
  stale.dispatch("playing");
  stale.dispatch("ended");
  await app.clock.advance(1000);
  assert.equal(station(app), 7);
  assert.equal(app.body.dataset.state, "idle");
});

test("navigation can cancel a buffering transition before its timeout", async () => {
  const app = createApp();
  app.click("next");
  const stale = clips(app).find((item) => item.src);
  assert.equal(app.$("next").disabled, false);
  assert.equal(app.$("home").disabled, false);
  assert.equal(app.jump(8), true);
  await app.clock.advance(350);
  assert.equal(station(app), 8);
  stale.dispatch("canplay");
  stale.dispatch("ended");
  await app.clock.advance(1000);
  assert.equal(station(app), 8);
  assert.equal(app.body.dataset.state, "idle");
});

test("background music is continuous across a chapter play and hold", async () => {
  const app = createApp({ blockedVideo: false });
  await app.clock.advance(0);
  app.click("sound");
  await app.clock.advance(0);
  const bgm = app.$("bgm");
  assert.equal(bgm.paused, false);
  assert.equal(app.$("sound").getAttribute("aria-pressed"), "true");
  bgm.currentTime = 12.5;
  const pauseCalls = bgm.pauseCalls;
  app.click("next");
  await finishClip(app);
  assert.equal(station(app), 1);
  assert.equal(bgm.paused, false);
  assert.equal(bgm.currentTime, 12.5, "station timing must not seek the soundtrack");
  assert.equal(bgm.pauseCalls, pauseCalls, "settling a station must not pause background music");
  assert.ok(clips(app).every((item) => item.muted), "interactive clips never duplicate the original audio");
  app.jump(6);
  await app.clock.advance(350);
  assert.equal(station(app), 6);
  assert.equal(bgm.paused, false);
  assert.equal(bgm.currentTime, 12.5);
});

test("music pauses for the original film and resumes at its existing position", async () => {
  const app = createApp({ blockedVideo: false });
  app.click("sound");
  await app.clock.advance(0);
  const bgm = app.$("bgm");
  bgm.currentTime = 18;
  app.click("watch-film");
  await app.clock.advance(0);
  assert.equal(bgm.paused, true);
  assert.equal(app.$("film-dialog").open, true);
  assert.ok(app.$("full-film").src, "the full film is only assigned on demand");
  app.click("close-film");
  await app.clock.advance(0);
  assert.equal(app.$("full-film").paused, true);
  assert.equal(bgm.paused, false);
  assert.equal(bgm.currentTime, 18);
});

test("visibility changes resume opted-in music but do not enable muted music", async () => {
  const app = createApp();
  app.visibility(true);
  app.visibility(false);
  await app.clock.advance(0);
  assert.equal(app.$("bgm").playCalls, 0);
  app.click("sound");
  await app.clock.advance(0);
  assert.equal(app.$("bgm").paused, false);
  app.visibility(true);
  assert.equal(app.$("bgm").paused, true);
  app.visibility(false);
  await app.clock.advance(0);
  assert.equal(app.$("bgm").paused, false);
  app.click("sound");
  assert.equal(app.$("bgm").paused, true);
  app.visibility(true);
  app.visibility(false);
  await app.clock.advance(0);
  assert.equal(app.$("bgm").paused, true);
});

test("a pending music start cannot turn music back on after the user disables it", async () => {
  const app = createApp({ blockedAudio: true });
  app.click("sound");
  const bgm = app.$("bgm");
  assert.equal(bgm.pendingPlays.length, 1);
  app.click("sound");
  bgm.finishPendingPlay();
  await app.clock.advance(0);
  assert.equal(bgm.paused, true);
  assert.equal(app.$("sound").getAttribute("aria-pressed"), "false");
});

test("pausing a pending video start does not prevent motion from resuming", async () => {
  const app = createApp({ blockedVideo: false, deferredVideoPlay: true });
  await app.clock.advance(0);
  app.click("next");
  const active = clips(app).find((item) => item.pendingPlays.length);
  assert.ok(active);
  app.visibility(true);
  active.finishPendingPlay(new Error("AbortError: play interrupted by pause"));
  await app.clock.advance(0);
  active.deferPlay = false;
  app.visibility(false);
  await app.clock.advance(20);
  assert.equal(active.playCalls, 2, "resuming must retry a play call interrupted by pause");
  assert.equal(active.paused, false);
  assert.equal(app.body.dataset.state, "playing");
});

test("a stale play promise cannot pause the same video slot after it has been reused", async () => {
  const app = createApp({ blockedVideo: false, deferredVideoPlay: true });
  await app.clock.advance(0);
  app.click("next");
  const reused = clips(app).find((item) => item.pendingPlays.length);
  const oldPlay = reused.pendingPlays.shift();
  app.click("next");
  await app.clock.advance(0);
  app.click("next");
  await app.clock.advance(0);
  assert.match(reused.src, /clip-03\.mp4$/);
  assert.equal(reused.pendingPlays.length, 1);
  const pauses = reused.pauseCalls;
  oldPlay.resolve();
  await app.clock.advance(0);
  assert.equal(reused.pauseCalls, pauses, "old promise must not pause the new owner");
  reused.finishPendingPlay();
  await app.clock.advance(20);
  assert.equal(reused.paused, false);
  assert.equal(app.body.dataset.state, "playing");
  reused.currentTime = reused.duration;
  reused.dispatch("ended");
  await app.clock.advance(0);
  assert.equal(station(app), 3);
});

test("leaving the page silences media even when a pending start resolves late", async () => {
  const app = createApp({ blockedVideo: false, deferredVideoPlay: true, blockedAudio: true });
  await app.clock.advance(0);
  app.click("sound");
  app.click("next");
  const active = clips(app).find((item) => item.pendingPlays.length);
  app.window.dispatch("pagehide", { persisted: false });
  active.finishPendingPlay();
  app.$("bgm").finishPendingPlay();
  await app.clock.advance(1000);
  assert.equal(active.paused, true);
  assert.equal(app.$("bgm").paused, true);
  assert.equal(app.$("full-film").paused, true);
});

test("rejected audio playback never blocks the visual experience", async () => {
  const app = createApp({ rejectAudio: true });
  app.click("sound");
  await app.clock.advance(0);
  app.click("next");
  await settleSlowMedia(app);
  assert.equal(station(app), 1);
  assert.equal(app.$("next").disabled, false);
  assert.equal(app.jump(10), true);
  await app.clock.advance(350);
  assert.equal(station(app), 10);
});

test("enabling music again reloads an audio source that failed on a weak network", async () => {
  const app = createApp({ rejectAudio: true });
  app.click("sound");
  const bgm = app.$("bgm");
  bgm.fail();
  await app.clock.advance(0);
  assert.equal(app.$("sound").getAttribute("aria-pressed"), "false");
  const loads = bgm.loadCalls;
  bgm.rejectPlay = false;
  app.click("sound");
  await app.clock.advance(0);
  assert.equal(bgm.loadCalls, loads + 1, "a failed audio source must receive a new load()");
  assert.equal(bgm.error, null);
  assert.equal(bgm.paused, false);
  assert.equal(app.$("sound").getAttribute("aria-pressed"), "true");
});

test("reduced-motion navigation is immediate even when media is unavailable", async () => {
  const app = createApp({ reducedMotion: true });
  app.click("next");
  await app.clock.advance(0);
  assert.equal(station(app), 1);
  assert.equal(app.body.dataset.state, "idle");
  assert.equal(clips(app).filter((item) => !item.paused).length, 0);
});
