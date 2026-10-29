(function () {
  "use strict";
  const { STATIONS, SETTINGS, createWheelGate } = window.SU7_STORY;
  const $ = (id) => document.getElementById(id);
  const fullFilm = $("full-film");
  const bgm = $("bgm");
  const slots = [$("film"), $("film-buffer")].map((video) => ({
    video, index: -1, failed: false, starting: false, started: false, playToken: 0
  }));
  const stills = new Map();
  const body = document.body;
  const gate = createWheelGate();
  const lastStation = STATIONS.length - 1;
  let current = 0;
  let target = 0;
  let playing = false;
  let soundOn = false;
  let generation = 0;
  let stillGeneration = 0;
  let musicGeneration = 0;
  let playAttempt = 0;
  let activeSlot = null;
  let frameVideo = null;
  let frameRequest = 0;
  let frameTimer = 0;
  let mediaTimer = 0;
  let endTimer = 0;
  let touch = null;
  let disposed = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function icons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function icon(button, name) {
    button.replaceChildren();
    const item = document.createElement("i");
    item.setAttribute("data-lucide", name);
    button.append(item);
    if (button === $("next")) {
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ring.setAttribute("viewBox", "0 0 64 64");
      ring.classList.add("progress-ring");
      ring.setAttribute("aria-hidden", "true");
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      for (const [key, value] of Object.entries({ cx: 32, cy: 32, r: 30 })) circle.setAttribute(key, value);
      ring.append(circle);
      button.append(ring);
    }
    icons();
  }

  function setState(state) {
    body.dataset.state = state;
    // Media is optional for navigation, including while a clip is buffering.
    $("experience").setAttribute("aria-busy", "false");
    $("next").disabled = false;
    $("chapters-button").disabled = false;
    $("home").disabled = false;
    document.querySelectorAll("[data-jump], .rail-button, .chapter-card").forEach((button) => {
      button.disabled = false;
    });
  }

  function showNotice(text, retry = false) {
    $("notice-text").textContent = text;
    $("notice").hidden = false;
    $("retry").hidden = !retry;
  }

  function hideNotice() { $("notice").hidden = true; }

  function buildNavigation() {
    STATIONS.slice(1).forEach((station, position) => {
      const index = position + 1;
      const number = String(index).padStart(2, "0");
      const rail = document.createElement("button");
      rail.className = "rail-button";
      rail.dataset.jump = index;
      rail.dataset.name = station.name;
      rail.setAttribute("aria-label", `${number} ${station.name}`);
      const label = document.createElement("span");
      label.textContent = number;
      rail.append(label);
      $("rail-buttons").append(rail);

      const segment = document.createElement("div");
      segment.className = "timeline-segment";
      $("timeline").append(segment);

      const card = document.createElement("button");
      card.className = "chapter-card";
      card.dataset.jump = index;
      card.setAttribute("aria-label", `${number} ${station.name}`);
      const thumb = document.createElement("div");
      thumb.className = "chapter-thumb";
      const image = document.createElement("img");
      image.src = `assets/chapter-${number}.jpg`;
      image.alt = "";
      image.loading = "lazy";
      thumb.append(image);
      const title = document.createElement("div");
      title.className = "chapter-card-title";
      const counter = document.createElement("span");
      counter.className = "chapter-card-number";
      counter.textContent = number;
      const name = document.createElement("span");
      name.textContent = station.name;
      title.append(counter, name);
      const subtitle = document.createElement("p");
      subtitle.className = "chapter-card-en";
      subtitle.textContent = station.en;
      card.append(thumb, title, subtitle);
      $("chapter-grid").append(card);
    });
  }

  function renderStation() {
    const station = STATIONS[current];
    const number = String(current).padStart(2, "0");
    body.dataset.station = current;
    body.classList.toggle("is-hero", current === 0);
    body.classList.toggle("is-ended", current === lastStation);
    showStill(current);
    $("chapter-number").textContent = number;
    $("chapter-name").textContent = station.name;
    $("chapter-en").textContent = station.en;
    $("caption-kicker").textContent = `${number} / ${station.en}`;
    $("caption-title").textContent = station.title || "";
    $("caption-description").textContent = station.description || "";
    $("counter").textContent = `${number} / 10`;
    const next = STATIONS[current + 1];
    $("next-label").textContent = next ? "UP NEXT" : "ONCE MORE";
    $("next-name").textContent = next ? `${String(current + 1).padStart(2, "0")} / ${next.name}` : "00 / 序幕";
    $("next-action-label").textContent = current === 0 ? "启程" : next ? "继续" : "重温";
    $("next").setAttribute("aria-label", next ? `下一章：${next.name}` : "重新开始");
    $("next").title = next ? `下一章：${next.name}` : "重新开始";
    icon($("next"), next ? "arrow-down" : "rotate-ccw");
    $("next").style.setProperty("--progress", "0");
    document.querySelectorAll(".rail-button, .chapter-card").forEach((button) => {
      const index = Number(button.dataset.jump);
      button.classList.toggle("active", index === current);
      button.classList.toggle("complete", index < current);
      if (index === current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    document.querySelectorAll(".top-nav button").forEach((button) => {
      const index = Number(button.dataset.jump);
      const end = index === 1 ? 2 : index === 3 ? 3 : index === 4 ? 5 : 10;
      button.classList.toggle("active", current >= index && current <= end);
    });
    renderProgress();
  }

  function renderProgress() {
    const duration = STATIONS[target].duration;
    const fraction = playing && activeSlot && duration
      ? Math.max(0, Math.min(1, activeSlot.video.currentTime / duration)) : 0;
    document.querySelectorAll(".timeline-segment").forEach((segment, i) => {
      segment.style.setProperty("--fill", i < current ? "1" : i === current ? String(fraction) : "0");
    });
    $("next").style.setProperty("--progress", String(fraction));
  }

  function clearFrame() {
    if (frameVideo && frameVideo.cancelVideoFrameCallback && frameRequest) frameVideo.cancelVideoFrameCallback(frameRequest);
    clearTimeout(frameTimer);
    frameRequest = 0;
    frameVideo = null;
  }

  function clearPlaybackTimers() {
    clearFrame();
    clearTimeout(mediaTimer);
    clearTimeout(endTimer);
  }

  function suspended() {
    return document.hidden || $("film-dialog").open;
  }

  function prepareStill(index) {
    if (!stills.has(index)) {
      const image = new Image();
      image.decoding = "async";
      image.src = STATIONS[index].still || SETTINGS.poster;
      stills.set(index, image);
    }
    return stills.get(index);
  }

  function showStill(index) {
    const token = ++stillGeneration;
    const image = prepareStill(index);
    const show = () => {
      if (disposed || token !== stillGeneration || index !== current) return;
      $("poster").src = image.src;
      $("poster").dataset.station = String(index);
    };
    if (image.complete && image.naturalWidth) show();
    else image.addEventListener("load", show, { once: true });
  }

  function prepareClip(index) {
    if (index < 1 || index > lastStation) return null;
    const cached = slots.find((slot) => slot.index === index);
    if (cached && !cached.failed) return cached;
    const slot = cached || slots.find((item) => item !== activeSlot && item.index < 0)
      || slots.find((item) => item !== activeSlot && item.index !== current)
      || slots.find((item) => item !== activeSlot);
    if (!slot) return null;
    slot.index = index;
    slot.failed = false;
    slot.started = false;
    slot.starting = false;
    slot.video.muted = true;
    slot.video.preload = "auto";
    slot.video.src = STATIONS[index].clip;
    slot.video.load();
    return slot;
  }

  function warmNext() {
    if (current === lastStation || disposed) return;
    prepareStill(current + 1);
    if (!reducedMotion.matches && !suspended()) prepareClip(current + 1);
  }

  function settle(index, preload = true) {
    ++generation;
    clearPlaybackTimers();
    slots.forEach((slot) => {
      slot.video.pause();
      slot.video.classList.remove("is-active");
      slot.starting = false;
      slot.playToken = ++playAttempt;
    });
    activeSlot = null;
    playing = false;
    body.classList.remove("is-playing", "is-transitioning");
    current = index;
    target = index;
    gate.lock(performance.now());
    renderStation();
    setState("idle");
    if (preload) warmNext();
  }

  function ownsPlayback(slot, token) {
    return !disposed && playing && activeSlot === slot && token === generation && slot.index === target;
  }

  function ownsSource(slot) {
    return Boolean(STATIONS[slot.index] && STATIONS[slot.index].clip)
      && (!slot.video.currentSrc || slot.video.currentSrc.endsWith(STATIONS[slot.index].clip));
  }

  function waitForMedia(slot, token) {
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(() => {
      if (ownsPlayback(slot, token) && !suspended()) settle(target);
    }, SETTINGS.mediaWait);
  }

  function scheduleFrame(slot, token) {
    if (!ownsPlayback(slot, token) || suspended()) return;
    const video = slot.video;
    const tick = (_now, metadata) => {
      if (!ownsPlayback(slot, token) || suspended()) return;
      const time = metadata ? metadata.mediaTime : video.currentTime;
      if (time >= STATIONS[target].duration - 1 / 24) {
        settle(target);
        return;
      }
      renderProgress();
      scheduleFrame(slot, token);
    };
    frameVideo = video;
    if (video.requestVideoFrameCallback) frameRequest = video.requestVideoFrameCallback(tick);
    else frameTimer = setTimeout(() => tick(performance.now()), 16);
  }

  function revealClip(slot, token) {
    if (!ownsPlayback(slot, token) || !ownsSource(slot) || suspended()) return;
    clearPlaybackTimers();
    slot.started = true;
    slot.video.classList.add("is-active");
    setState("playing");
    scheduleFrame(slot, token);
    // Also finish if the browser stops delivering frame/ended events.
    const remaining = Math.max(0, STATIONS[target].duration - slot.video.currentTime);
    endTimer = setTimeout(() => {
      if (ownsPlayback(slot, token) && !suspended()) settle(target);
    }, remaining * 1000 + SETTINGS.playbackSlack);
  }

  function playClip(slot, token) {
    if (!ownsPlayback(slot, token) || suspended() || slot.starting) return;
    if (slot.failed) { settle(target); return; }
    if (slot.video.readyState < 2) return;
    if (slot.started && !slot.video.paused) return;
    slot.starting = true;
    const attempt = ++playAttempt;
    slot.playToken = attempt;
    slot.video.muted = true;
    if (!slot.started) slot.video.currentTime = 0;
    try {
      Promise.resolve(slot.video.play()).then(() => {
        if (slot.playToken !== attempt) {
          if (activeSlot !== slot || suspended() || disposed) slot.video.pause();
          return;
        }
        slot.starting = false;
        if (!ownsPlayback(slot, token)) {
          if (activeSlot !== slot || !playing || disposed) slot.video.pause();
          return;
        }
        if (suspended()) { slot.video.pause(); return; }
        revealClip(slot, token);
      }).catch(() => {
        if (slot.playToken !== attempt) return;
        slot.starting = false;
        if (ownsPlayback(slot, token) && !suspended()) settle(target);
      });
    } catch {
      slot.starting = false;
      if (ownsPlayback(slot, token)) settle(target);
    }
  }

  function moveTo(index) {
    if (disposed || index < 0 || index > lastStation) return;
    if (playing) settle(target, false);
    if (index === current) return;
    hideNotice();
    if (index !== current + 1 || reducedMotion.matches) {
      settle(index);
      return;
    }
    const token = ++generation;
    target = index;
    playing = true;
    prepareStill(index);
    body.classList.remove("is-hero");
    body.classList.add("is-playing");
    setState("buffering");
    activeSlot = prepareClip(index);
    if (!activeSlot) { settle(index); return; }
    activeSlot.started = false;
    waitForMedia(activeSlot, token);
    playClip(activeSlot, token);
  }

  function intent(direction) {
    if ($("chapters-dialog").open || $("film-dialog").open) return;
    const base = playing ? target : current;
    if (direction > 0 && base === lastStation) return;
    moveTo(base + direction);
  }

  function restart() {
    moveTo(0);
  }

  function renderSound() {
    $("sound").setAttribute("aria-pressed", String(soundOn));
    const label = soundOn ? "关闭背景音乐" : "开启背景音乐";
    $("sound").setAttribute("aria-label", label);
    $("sound").dataset.tooltip = label;
    icon($("sound"), soundOn ? "volume-2" : "volume-x");
  }

  function musicAllowed() {
    return soundOn && !disposed && !suspended();
  }

  async function syncMusic() {
    const token = ++musicGeneration;
    if (!musicAllowed()) { bgm.pause(); return; }
    if (!bgm.src) {
      bgm.src = SETTINGS.music;
      bgm.loop = true;
      bgm.volume = SETTINGS.volume;
      bgm.load();
    } else if (bgm.error) bgm.load();
    if (!bgm.paused) return;
    try {
      await bgm.play();
      if (!musicAllowed()) bgm.pause();
    } catch {
      if (token !== musicGeneration || !musicAllowed()) return;
      soundOn = false;
      renderSound();
      showNotice("背景音乐暂未能播放，可点击声音图标重试。");
    }
  }

  function setSound(enabled) {
    soundOn = enabled;
    fullFilm.muted = !enabled;
    renderSound();
    syncMusic();
  }

  function pausePreview() {
    clearPlaybackTimers();
    if (activeSlot) {
      activeSlot.playToken = ++playAttempt;
      activeSlot.starting = false;
      activeSlot.video.pause();
    }
  }

  function resumePlayback() {
    if (suspended() || disposed) return;
    if (playing && activeSlot) {
      waitForMedia(activeSlot, generation);
      playClip(activeSlot, generation);
    } else warmNext();
  }

  body.style.setProperty("--media-transition", `${SETTINGS.transitionDuration}ms`);
  buildNavigation();
  icons();
  renderStation();
  setState("idle");

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump]");
    if (!button || button.disabled) return;
    const index = Number(button.dataset.jump);
    if ($("chapters-dialog").open) $("chapters-dialog").close();
    moveTo(index);
  });
  $("next").addEventListener("click", () => {
    if ((playing ? target : current) === lastStation) restart();
    else intent(1);
  });
  $("home").addEventListener("click", restart);
  $("sound").addEventListener("click", () => setSound(!soundOn));
  $("chapters-button").addEventListener("click", () => {
    $("chapters-dialog").showModal();
  });
  $("close-chapters").addEventListener("click", () => $("chapters-dialog").close());
  $("watch-film").addEventListener("click", () => {
    pausePreview();
    bgm.pause();
    if (!fullFilm.src) fullFilm.src = SETTINGS.video;
    fullFilm.muted = !soundOn;
    $("film-dialog").showModal();
    fullFilm.play().catch(() => {});
  });
  $("close-film").addEventListener("click", () => $("film-dialog").close());
  $("film-dialog").addEventListener("close", () => {
    fullFilm.pause();
    resumePlayback();
    syncMusic();
  });
  [$("chapters-dialog"), $("film-dialog")].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  if (!document.fullscreenEnabled) $("fullscreen").hidden = true;
  $("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { showNotice("当前浏览器暂不支持全屏。"); }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    $("fullscreen").setAttribute("aria-label", active ? "退出全屏" : "全屏");
    $("fullscreen").dataset.tooltip = active ? "退出全屏" : "全屏";
    icon($("fullscreen"), active ? "minimize" : "maximize");
  });
  window.addEventListener("wheel", (event) => {
    if ($("chapters-dialog").open || $("film-dialog").open || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const direction = gate.push(event.deltaY * factor, performance.now());
    if (direction) intent(direction);
  }, { passive: false });
  window.addEventListener("keydown", (event) => {
    if ($("chapters-dialog").open || $("film-dialog").open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest("button, a, input, select, textarea") && ["Enter", " "].includes(event.key)) return;
    if (["ArrowDown", "PageDown", " ", "Enter", "ArrowUp", "PageUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === "Home") restart();
      else if (event.key === "End") moveTo(lastStation);
      else intent(["ArrowUp", "PageUp"].includes(event.key) ? -1 : 1);
    }
  });
  window.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || event.target.closest("button, dialog")) { touch = null; return; }
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  window.addEventListener("touchend", (event) => {
    if (!touch || !event.changedTouches.length) return;
    const dx = touch.x - event.changedTouches[0].clientX;
    const dy = touch.y - event.changedTouches[0].clientY;
    touch = null;
    if (Math.abs(dy) >= SETTINGS.touchThreshold && Math.abs(dy) > Math.abs(dx)) intent(Math.sign(dy));
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pausePreview();
      bgm.pause();
      fullFilm.pause();
    } else {
      resumePlayback();
      syncMusic();
    }
  });
  slots.forEach((slot) => {
    const { video } = slot;
    ["loadeddata", "canplay"].forEach((event) => {
      video.addEventListener(event, () => {
        if (activeSlot === slot && ownsSource(slot)) playClip(slot, generation);
      });
    });
    video.addEventListener("waiting", () => {
      if (ownsPlayback(slot, generation) && ownsSource(slot) && !suspended()) waitForMedia(slot, generation);
    });
    video.addEventListener("playing", () => revealClip(slot, generation));
    video.addEventListener("ended", () => {
      if (ownsPlayback(slot, generation) && ownsSource(slot)) settle(target);
    });
    video.addEventListener("error", () => {
      if (!ownsSource(slot)) return;
      slot.failed = true;
      if (ownsPlayback(slot, generation)) settle(target);
    });
  });
  window.addEventListener("pagehide", (event) => {
    pausePreview();
    bgm.pause();
    fullFilm.pause();
    if (!event.persisted) disposed = true;
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    resumePlayback();
    syncMusic();
  });
  warmNext();
})();
