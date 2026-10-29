(function (root) {
  "use strict";

  // Holds are source-video timestamps, checked against extracted frames.
  const STATIONS = [
    { id: "prologue", hold: 0.1, name: "序幕", en: "THE ULTRA EXPERIENCE" },
    { id: "awakening", hold: 7.6, duration: 2.416667, name: "觉醒", en: "THE AWAKENING", title: "LIGHT INTO\nEXISTENCE.", description: "锋芒，始于此刻。" },
    { id: "presence", hold: 10.3, duration: 1.416667, name: "锋芒", en: "A BOLDER PRESENCE", title: "BORN TO\nSTAND OUT.", description: "目光所及，不止惊艳。" },
    { id: "aero", hold: 16.8, duration: 2.416667, name: "气动", en: "SCULPTED BY AIR", title: "FORM FOLLOWS\nPERFORMANCE.", description: "每一道线条，都有它的使命。" },
    { id: "cockpit", hold: 21.2, duration: 1.833008, name: "座舱", en: "AT THE CENTER OF IT ALL", title: "FOCUS.\nFEEL. DRIVE.", description: "落座，进入你的主场。" },
    { id: "launch", hold: 24.1, duration: 1.416667, name: "出发", en: "THE MOMENT BEFORE", title: "ALL SET.\nLET GO.", description: "把期待，交给下一个弯道。" },
    { id: "circuit", hold: 32.4, duration: 2.791667, name: "赛道", en: "BUILT FOR THE CIRCUIT", title: "CHASE\nTHE APEX.", description: "在每一次入弯，找到答案。" },
    { id: "velocity", hold: 39.7, duration: 2.625, name: "疾驰", en: "BEYOND THE STRAIGHT", title: "NEVER\nSETTLE.", description: "向前，是唯一的方向。" },
    { id: "freedom", hold: 46.7, duration: 2.625, name: "漂移", en: "THE ART OF LETTING GO", title: "BREAK\nFREE.", description: "让热爱，自由驰骋。" },
    { id: "afterglow", hold: 51.4, duration: 2, name: "定格", en: "AFTER THE ADRENALINE", title: "LEAVE YOUR\nSIGNATURE.", description: "尘埃落定，锋芒依旧。" },
    { id: "ultra", hold: 55.3, duration: 1.833333, name: "落幕", en: "THIS IS ULTRA", title: "生而极致。", description: "XIAOMI SU7 ULTRA" }
  ];
  STATIONS.slice(1).forEach((station, position) => {
    const number = String(position + 1).padStart(2, "0");
    station.clip = `assets/clip-${number}.mp4`;
    station.still = `assets/still-${number}.jpg`;
  });

  const SETTINGS = {
    video: "assets/su7-ultra.mp4",
    poster: "assets/poster.jpg",
    music: "assets/ambient.m4a",
    wheelIdle: 350, // More milliseconds require a longer quiet gap between gestures.
    wheelThreshold: 18,
    touchThreshold: 40,
    transitionDuration: 160,
    mediaWait: 650, // Longer waits favor animation over the immediate still-image fallback.
    playbackSlack: 400, // Watchdog allowance beyond the encoded clip duration, in milliseconds.
    volume: 0.55
  };

  function createWheelGate(idle = SETTINGS.wheelIdle, threshold = SETTINGS.wheelThreshold) {
    let lastAt = -Infinity;
    let locked = false;
    let accumulated = 0;
    return {
      push(delta, now) {
        if (!Number.isFinite(delta) || !Number.isFinite(now) || delta === 0) return 0;
        if (now - lastAt > idle) {
          locked = false;
          accumulated = 0;
        }
        lastAt = now;
        if (locked) return 0;
        if (Math.sign(accumulated) !== Math.sign(delta)) accumulated = 0;
        accumulated += delta;
        if (Math.abs(accumulated) < threshold) return 0;
        locked = true;
        return Math.sign(accumulated);
      },
      lock(now) {
        lastAt = now;
        locked = true;
        accumulated = 0;
      }
    };
  }

  const api = { STATIONS, SETTINGS, createWheelGate };
  root.SU7_STORY = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
