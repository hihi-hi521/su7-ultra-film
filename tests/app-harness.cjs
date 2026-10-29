const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Clock {
  now = 1000;
  nextId = 1;
  tasks = new Map();

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + Number(delay), callback });
    return id;
  }

  clearTimeout(id) { this.tasks.delete(id); }

  async advance(milliseconds) {
    const end = this.now + milliseconds;
    for (let i = 0; i < 10000; i++) {
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) {
        this.now = end;
        for (let turn = 0; turn < 8; turn++) await Promise.resolve();
        return;
      }
      this.now = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    throw new Error("The app scheduled more than 10,000 timers in one clock advance");
  }
}

class Events {
  listeners = new Map();

  addEventListener(type, callback, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ callback, once: options.once });
    this.listeners.set(type, list);
  }

  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item.callback !== callback));
  }

  dispatch(type, properties = {}) {
    const event = {
      type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties
    };
    for (const item of [...(this.listeners.get(type) || [])]) {
      if (item.once) this.removeEventListener(type, item.callback);
      item.callback(event);
    }
    return event;
  }
}

class Element extends Events {
  constructor(tag = "div", id = "") {
    super();
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.complete = true;
    this.naturalWidth = 1280;
    this.textContent = "";
    this.classSet = new Set();
    const styles = new Map();
    this.style = {
      setProperty(name, value) { styles.set(name, String(value)); },
      removeProperty(name) { styles.delete(name); },
      getPropertyValue(name) { return styles.get(name) || ""; }
    };
    this.classList = {
      add: (...names) => names.forEach((name) => this.classSet.add(name)),
      remove: (...names) => names.forEach((name) => this.classSet.delete(name)),
      contains: (name) => this.classSet.has(name),
      toggle: (name, force = !this.classSet.has(name)) => {
        if (force) this.classSet.add(name);
        else this.classSet.delete(name);
        return force;
      }
    };
  }

  set className(value) { this.classSet = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classSet].join(" "); }
  set src(value) {
    this._src = String(value);
    this.attributes.set("src", this._src);
  }
  get src() { return this._src || ""; }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(value);
    if (name === "src") this.src = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src") this._src = "";
  }
  matches(selector) {
    if (selector === "[data-jump]") return this.dataset.jump !== undefined;
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector;
  }
  closest(selectors) {
    const parts = selectors.split(",").map((selector) => selector.trim());
    for (let node = this; node; node = node.parentElement) {
      if (parts.some((selector) => node.matches(selector))) return node;
    }
    return null;
  }
  querySelectorAll(selectors) {
    const parts = selectors.split(",").map((selector) => selector.trim());
    const result = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (parts.some((selector) => {
          const pieces = selector.split(/\s+/);
          return child.matches(pieces.at(-1)) && (pieces.length === 1 || child.parentElement?.closest(pieces[0]));
        })) result.push(child);
        walk(child);
      });
    };
    walk(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: 0, right: 1200, top: 0, bottom: 800 }; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
  decode() { return Promise.resolve(); }
  focus() {}
}

class Media extends Element {
  constructor(tag, id, clock, blocked, rejectPlay = false) {
    super(tag, id);
    this.clock = clock;
    this.blocked = blocked;
    this.rejectPlay = rejectPlay;
    this.src = "";
    this.currentSrc = "";
    this.currentTime = 0;
    this.duration = 3;
    this.readyState = 0;
    this.paused = true;
    this.muted = false;
    this.volume = 1;
    this.playbackRate = 1;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.loadCalls = 0;
    this.loadSources = [];
    this.pendingPlays = [];
    this.deferPlay = false;
    this.error = null;
  }
  load() {
    this.loadCalls++;
    this.loadSources.push(this.src);
    this.currentSrc = this.src;
    this.readyState = 0;
    this.error = null;
    if (this.blocked) return;
    const source = this.src;
    this.clock.setTimeout(() => {
      if (this.src !== source) return;
      this.readyState = 4;
      this.dispatch("loadedmetadata");
      this.dispatch("loadeddata");
      this.dispatch("canplay");
      this.dispatch("canplaythrough");
    }, 0);
  }
  play() {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(new Error("play was rejected"));
    if (this.blocked || this.deferPlay) {
      if (this.deferPlay) this.paused = false;
      return new Promise((resolve, reject) => this.pendingPlays.push({ resolve, reject }));
    }
    this.paused = false;
    this.dispatch("playing");
    return Promise.resolve();
  }
  pause() { this.pauseCalls++; this.paused = true; }
  fail() {
    this.error = { code: 2, message: "network failure" };
    this.dispatch("error");
  }
  finishPendingPlay(error) {
    const pending = this.pendingPlays.splice(0);
    if (error) {
      this.paused = true;
      pending.forEach((item) => item.reject(error));
    } else {
      this.paused = false;
      this.dispatch("playing");
      pending.forEach((item) => item.resolve());
    }
  }
}

function createApp({ blockedVideo = true, blockedAudio = false, rejectAudio = false, deferredVideoPlay = false, reducedMotion = false } = {}) {
  const clock = new Clock();
  const document = new Events();
  const window = new Events();
  const elements = new Map();
  const body = new Element("body");
  body.className = "is-hero";
  document.body = body;
  document.documentElement = new Element("html");
  document.hidden = false;
  document.fullscreenEnabled = false;
  const ids = [
    "experience", "poster", "blackout", "home", "sound", "chapters-button", "fullscreen",
    "hero-title", "caption-kicker", "caption-title", "caption-description", "rail-buttons",
    "chapter-number", "chapter-name", "chapter-en", "next-label", "next-name", "watch-film",
    "next-action-label", "next", "counter", "timeline", "loading-status", "loading-label",
    "loading-percent", "notice", "notice-text", "retry", "chapters-dialog", "chapters-title",
    "chapter-grid", "close-chapters", "film-dialog", "close-film"
  ];
  const buttons = new Set(["home", "sound", "chapters-button", "fullscreen", "watch-film", "next", "retry", "close-chapters", "close-film"]);
  ids.forEach((id) => {
    const element = new Element(buttons.has(id) ? "button" : id.endsWith("-dialog") ? "dialog" : "div", id);
    elements.set(id, element);
    body.append(element);
  });
  for (const [id, tag] of [["film", "video"], ["film-buffer", "video"], ["full-film", "video"], ["bgm", "audio"]]) {
    const element = new Media(tag, id, clock, tag === "video" && id !== "full-film" ? blockedVideo : tag === "audio" && blockedAudio, tag === "audio" && rejectAudio);
    element.deferPlay = tag === "video" && id !== "full-film" && deferredVideoPlay;
    elements.set(id, element);
    body.append(element);
  }
  const nav = new Element("nav");
  nav.className = "top-nav";
  for (const index of [1, 3, 4, 6]) {
    const button = new Element("button");
    button.dataset.jump = index;
    nav.append(button);
  }
  body.append(nav);
  const media = [elements.get("film"), elements.get("film-buffer"), elements.get("full-film"), elements.get("bgm")];
  document.getElementById = (id) => elements.get(id) || null;
  document.querySelectorAll = (selectors) => body.querySelectorAll(selectors);
  document.createElement = (tag) => {
    if (["video", "audio"].includes(tag)) {
      const item = new Media(tag, "", clock, tag === "video" && blockedVideo);
      media.push(item);
      return item;
    }
    return new Element(tag);
  };
  document.createElementNS = (_namespace, tag) => new Element(tag);
  window.matchMedia = () => ({ matches: reducedMotion });
  const requests = [];
  const context = vm.createContext({
    window, document, console, innerHeight: 800, location: { protocol: "http:" },
    performance: { now: () => clock.now },
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    requestAnimationFrame: (callback) => clock.setTimeout(() => callback(clock.now), 16),
    cancelAnimationFrame: clock.clearTimeout.bind(clock),
    fetch: (...args) => { requests.push(args); return new Promise(() => {}); },
    Image: class extends Element { constructor() { super("img"); } },
    AbortController, URL, Blob
  });
  context.globalThis = window;
  window.performance = context.performance;
  window.setTimeout = context.setTimeout;
  window.clearTimeout = context.clearTimeout;
  window.requestAnimationFrame = context.requestAnimationFrame;
  window.cancelAnimationFrame = context.cancelAnimationFrame;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../story.js"), "utf8"), context, { filename: "story.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), context, { filename: "app.js" });
  return {
    clock, document, window, body, media, requests, elements, story: window.SU7_STORY,
    $(id) { return elements.get(id); },
    click(id) {
      const target = elements.get(id);
      if (!target || target.disabled) return false;
      target.dispatch("click");
      document.dispatch("click", { target });
      return true;
    },
    jump(index) {
      const target = body.querySelectorAll("[data-jump]").find((item) => Number(item.dataset.jump) === index);
      if (!target || target.disabled) return false;
      document.dispatch("click", { target });
      return true;
    },
    wheel(delta = 100) {
      window.dispatch("wheel", { deltaX: 0, deltaY: delta, deltaMode: 0 });
    },
    visibility(hidden) {
      document.hidden = hidden;
      document.dispatch("visibilitychange");
    },
    key(key, extra = {}) {
      window.dispatch("keydown", { key, target: body, repeat: false, ...extra });
    }
  };
}

module.exports = { createApp };
