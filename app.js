(function () {
  "use strict";
  const { STATIONS, SETTINGS, createWheelGate } = window.SU7_STORY;
  const $ = (id) => document.getElementById(id);
  const video = $("film");
  const fullFilm = $("full-film");
  const body = document.body;
  const gate = createWheelGate();
  const lastStation = STATIONS.length - 1;
  let current = 0;
  let target = 0;
  let playing = false;
  let ready = false;
  let soundOn = false;
  let generation = 0;
  let frameRequest = 0;
  let timer = 0;
  let blobURL = null;
  let loadController = null;
  let suspendForDialog = false;
  let suspendForVisibility = false;
  let resumeOffered = false;
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
    $("experience").setAttribute("aria-busy", String(state === "loading"));
    $("next").disabled = !ready || playing;
    $("chapters-button").disabled = playing;
    $("home").disabled = playing;
    document.querySelectorAll("[data-jump], .rail-button, .chapter-card").forEach((button) => {
      button.disabled = !ready || playing;
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
    const from = STATIONS[current].hold;
    const end = STATIONS[target].hold;
    const fraction = playing && target > current ? Math.max(0, Math.min(1, (video.currentTime - from) / (end - from))) : 0;
    document.querySelectorAll(".timeline-segment").forEach((segment, i) => {
      segment.style.setProperty("--fill", i < current ? "1" : i === current ? String(fraction) : "0");
    });
    $("next").style.setProperty("--progress", String(fraction));
  }

  function clearFrame() {
    if (video.cancelVideoFrameCallback && frameRequest) video.cancelVideoFrameCallback(frameRequest);
    clearTimeout(timer);
    frameRequest = 0;
  }

  function settle(index) {
    clearFrame();
    video.pause();
    playing = false;
    suspendForVisibility = false;
    resumeOffered = false;
    body.classList.remove("is-playing", "is-transitioning");
    current = index;
    target = index;
    video.volume = SETTINGS.volume;
    gate.lock(performance.now());
    renderStation();
    setState("idle");
  }

  function seek(time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.015 && video.readyState >= 2) return resolve();
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener("seeked", done);
        video.removeEventListener("error", failed);
      };
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("seek failed")); };
      const timeout = setTimeout(failed, 6000);
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("error", failed, { once: true });
      video.currentTime = time;
    });
  }

  function scheduleFrame(token) {
    if (!playing || token !== generation || suspendForDialog || suspendForVisibility) return;
    const tick = (_now, metadata) => {
      if (!playing || token !== generation || suspendForDialog || suspendForVisibility) return;
      const time = metadata ? metadata.mediaTime : video.currentTime;
      const remaining = STATIONS[target].hold - time;
      if (remaining <= 1 / 30) {
        const destination = target;
        video.pause();
        video.currentTime = STATIONS[destination].hold;
        settle(destination);
        return;
      }
      video.volume = soundOn ? SETTINGS.volume * Math.min(1, remaining / 0.17) : SETTINGS.volume;
      renderProgress();
      scheduleFrame(token);
    };
    if (video.requestVideoFrameCallback) frameRequest = video.requestVideoFrameCallback(tick);
    else timer = setTimeout(() => tick(performance.now()), 16);
  }

  async function moveTo(index) {
    if (!ready || playing || index < 0 || index > lastStation || index === current) return;
    hideNotice();
    const previous = current;
    const token = ++generation;
    target = index;
    playing = true;
    body.classList.add("is-playing");
    setState("playing");
    try {
      // Non-adjacent and reverse navigation use a covered seek, never a visible rewind.
      if (index !== current + 1 || reducedMotion.matches) {
        body.classList.add("is-transitioning");
        await new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : SETTINGS.transitionDuration));
        if (token !== generation) return;
        await seek(STATIONS[index].hold);
        if (token !== generation) return;
        settle(index);
        return;
      }
      if (current === 0) {
        body.classList.add("is-transitioning");
        await new Promise((resolve) => setTimeout(resolve, SETTINGS.transitionDuration));
      }
      await seek(STATIONS[current].hold);
      if (token !== generation) return;
      body.classList.remove("is-hero", "is-transitioning");
      video.muted = !soundOn;
      video.volume = SETTINGS.volume;
      if (suspendForDialog || suspendForVisibility) return;
      await video.play();
      if (token !== generation) return;
      scheduleFrame(token);
    } catch (error) {
      if (token !== generation) return;
      settle(previous);
      showNotice("播放未能开始，请点击右下角箭头重试。");
    }
  }

  function intent(direction) {
    if (!ready || playing || $("chapters-dialog").open || $("film-dialog").open) return;
    if (direction > 0 && current === lastStation) return;
    moveTo(current + direction);
  }

  async function restart() {
    if (!ready || playing) return;
    if (current === 0) return;
    await moveTo(0);
  }

  function setSound(enabled) {
    soundOn = enabled;
    video.muted = !enabled;
    fullFilm.muted = !enabled;
    $("sound").setAttribute("aria-pressed", String(enabled));
    const label = enabled ? "关闭声音" : "开启声音";
    $("sound").setAttribute("aria-label", label);
    $("sound").dataset.tooltip = label;
    icon($("sound"), enabled ? "volume-2" : "volume-x");
  }

  async function resumePlayback() {
    if (!playing || !ready) return;
    resumeOffered = false;
    hideNotice();
    try {
      await video.play();
      scheduleFrame(generation);
    } catch {
      resumeOffered = true;
      showNotice("点击右下角箭头继续播放。");
      $("next").disabled = false;
    }
  }

  function pauseForOverlay() {
    suspendForDialog = playing;
    if (playing) {
      video.pause();
      clearFrame();
    }
  }

  function closeOverlay() {
    if (!suspendForDialog) return;
    suspendForDialog = false;
    if (!document.hidden) resumePlayback();
  }

  async function loadVideo() {
    if (loadController) loadController.abort();
    loadController = new AbortController();
    ready = false;
    body.classList.add("is-loading");
    $("loading-status").hidden = false;
    setState("loading");
    hideNotice();
    $("loading-label").textContent = "准备影像";
    $("loading-percent").textContent = "0%";
    try {
      let src = SETTINGS.video;
      if (location.protocol !== "file:") {
        const response = await fetch(SETTINGS.video, { signal: loadController.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const total = Number(response.headers.get("content-length"));
        const chunks = [];
        let received = 0;
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            $("loading-percent").textContent = total ? `${Math.min(99, Math.floor(received / total * 100))}%` : `${(received / 1024 / 1024).toFixed(1)} MB`;
          }
          if (blobURL) URL.revokeObjectURL(blobURL);
          blobURL = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
        } else {
          blobURL = URL.createObjectURL(await response.blob());
        }
        src = blobURL;
      }
      if (disposed) return;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error("load timeout")); }, 30000);
        const cleanup = () => {
          clearTimeout(timeout);
          video.removeEventListener("loadeddata", loaded);
          video.removeEventListener("error", failed);
        };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("media error")); };
        video.addEventListener("loadeddata", loaded, { once: true });
        video.addEventListener("error", failed, { once: true });
        video.src = src;
        video.load();
      });
      await seek(STATIONS[0].hold);
      ready = true;
      body.classList.remove("is-loading");
      $("loading-percent").textContent = "100%";
      $("loading-status").hidden = true;
      settle(0);
    } catch (error) {
      if (error.name === "AbortError" || disposed) return;
      body.classList.remove("is-loading");
      setState("error");
      showNotice("影像加载失败，请检查本地视频文件后重试。", true);
    }
  }

  buildNavigation();
  icons();
  renderStation();
  setState("loading");

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump]");
    if (!button || button.disabled) return;
    const index = Number(button.dataset.jump);
    if ($("chapters-dialog").open) $("chapters-dialog").close();
    moveTo(index);
  });
  $("next").addEventListener("click", () => {
    if (resumeOffered) resumePlayback();
    else if (current === lastStation) restart();
    else intent(1);
  });
  $("home").addEventListener("click", restart);
  $("sound").addEventListener("click", () => setSound(!soundOn));
  $("retry").addEventListener("click", loadVideo);
  $("chapters-button").addEventListener("click", () => {
    if (playing) return;
    $("chapters-dialog").showModal();
  });
  $("close-chapters").addEventListener("click", () => $("chapters-dialog").close());
  $("watch-film").addEventListener("click", () => {
    pauseForOverlay();
    if (!fullFilm.src) fullFilm.src = blobURL || SETTINGS.video;
    fullFilm.muted = !soundOn;
    $("film-dialog").showModal();
    fullFilm.play().catch(() => {});
  });
  $("close-film").addEventListener("click", () => $("film-dialog").close());
  $("film-dialog").addEventListener("close", () => {
    fullFilm.pause();
    closeOverlay();
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
      if (playing && !suspendForDialog) {
        suspendForVisibility = true;
        video.pause();
        clearFrame();
      }
      fullFilm.pause();
    } else if (suspendForVisibility && !suspendForDialog) {
      suspendForVisibility = false;
      resumePlayback();
    }
  });
  video.addEventListener("waiting", () => {
    if (playing) showNotice("影像缓冲中…");
  });
  video.addEventListener("playing", hideNotice);
  video.addEventListener("ended", () => {
    if (playing) settle(target);
  });
  video.addEventListener("error", () => {
    if (!ready || disposed) return;
    ++generation;
    clearFrame();
    playing = false;
    ready = false;
    body.classList.remove("is-playing", "is-transitioning");
    setState("error");
    showNotice("影像读取中断，请重新加载。", true);
  });
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    disposed = true;
    if (loadController) loadController.abort();
    clearFrame();
    video.pause();
    fullFilm.pause();
    if (blobURL) URL.revokeObjectURL(blobURL);
  });
  loadVideo();
})();
