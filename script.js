/* ============================================================
   LOVE — Vol. 2 · Our Little Scrapbook
   script.js — вся логика сайта
   ============================================================ */

"use strict";

/* ============================================================
   0. УТИЛИТЫ
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Форматирование даты ГГГГ-ММ-ДД → «15 января 2025» */
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
};

/** Плавающее сердечко в точке экрана */
function spawnHeart(x, y) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const h = document.createElement("span");
  h.className = "float-heart";
  h.textContent = "♡";
  h.style.left = `${x}px`;
  h.style.top = `${y}px`;
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 1500);
}

/** Тост-уведомление */
let toastTimer = null;
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-show"), 3000);
}

/* ============================================================
   1. СЧЁТЧИК ДНЕЙ (Asia/Barnaul)
   ============================================================ */
const Counter = {
  days: 0,
  _today() {
    // Календарная дата (Y, M, D) в часовом поясе из CONFIG
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CONFIG.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (t) => +parts.find((p) => p.type === t).value;
    return { y: get("year"), m: get("month"), d: get("day") };
  },
  calc() {
    const now = this._today();
    const [sy, sm, sd] = CONFIG.startDate.split("-").map(Number);
    // Разница календарных дат через UTC-представление — без влияния поясов
    const ms = Date.UTC(now.y, now.m - 1, now.d) - Date.UTC(sy, sm - 1, sd);
    this.days = Math.max(0, Math.round(ms / 86400000));
    return this.days;
  },
  init() {
    this.calc();
    $("#daysTogether").textContent = this.days.toLocaleString("ru-RU");
    $("#timeNow").textContent = `${CONFIG.city}, ${CONFIG.country}`;
    // Проверка каждую минуту: при смене суток в Барнауле число обновится
    setInterval(() => {
      const prev = this.days;
      this.calc();
      if (this.days !== prev) {
        $("#daysTogether").textContent = this.days.toLocaleString("ru-RU");
      }
    }, 60000);
  },
};

/* ============================================================
   2. IndexedDB — хранилище пользовательских фото
   ============================================================ */
const DB = {
  name: "love-vol2-photos",
  store: "photos",
  db: null,

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.store, { keyPath: "id" });
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  },

  _tx(mode) {
    return this.db.transaction(this.store, mode).objectStore(this.store);
  },

  add(photo) {
    return new Promise((resolve, reject) => {
      const r = this._tx("readwrite").add(photo);
      r.onsuccess = () => resolve(photo);
      r.onerror = () => reject(r.error);
    });
  },

  getAll() {
    return new Promise((resolve, reject) => {
      const r = this._tx("readonly").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  remove(id) {
    return new Promise((resolve, reject) => {
      const r = this._tx("readwrite").delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },
};

/* ============================================================
   3. ГАЛЕРЕЯ
   ============================================================ */
const Gallery = {
  basePhotos: [],  // из photos.json
  userPhotos: [],  // из IndexedDB
  all: [],         // общий список для лайтбокса

  async init() {
    // photos.json (работает только через http:// — Live Server)
    try {
      const res = await fetch("photos.json");
      if (!res.ok) throw new Error(res.status);
      this.basePhotos = await res.json();
    } catch (e) {
      console.warn("photos.json не загружен (нужен Live Server):", e);
    }
    // Пользовательские фото
    try {
      await DB.open();
      this.userPhotos = await DB.getAll();
    } catch (e) {
      console.warn("IndexedDB недоступна:", e);
    }
    this.render();
  },

  render() {
    const grid = $("#scrapbook");
    grid.innerHTML = "";
    this.all = [];

    const items = [...this.basePhotos, ...this.userPhotos];
    $("#emptyState").hidden = items.length > 0;
    if (!items.length) return;

    const notes = CONFIG.notes || [];
    let noteIdx = 0;

    // Паттерн заполнения рядов сетки (12 колонок):
    // wide(7)+tall(5) | polaroid(4)+tilt(4)+NOTE(4) | plain(4)+polaroid(4)+NOTE(4)
    // Каждый ряд заполняется ровно — без пустот и смещения к левому краю.
    const pattern = ["wide", "tall", "polaroid", "tilt", "NOTE", "plain", "polaroid", "NOTE"];
    let pIdx = 0;

    items.forEach((item) => {
      // Пропускаем заметочные слоты, пока не встретим фото-слот
      while (pattern[pIdx % pattern.length] === "NOTE") {
        this._makeNote(grid, notes[noteIdx % notes.length], noteIdx);
        noteIdx++;
        pIdx++;
      }
      const type = pattern[pIdx % pattern.length];
      pIdx++;
      this._makePhoto(grid, item, type);
    });

    // Если остался зазор в 4 колонки — закрываем его финальной заметкой
    const spans = { wide: 7, tall: 5, polaroid: 4, tilt: 4, plain: 4, note: 4 };
    let used = 0;
    for (let k = 0; k < pIdx; k++) {
      const t = pattern[k % pattern.length];
      used += t === "NOTE" ? spans.note : spans[t];
    }
    if (used % 12 === 8 && notes.length) {
      this._makeNote(grid, notes[noteIdx % notes.length], noteIdx);
    }
  },

  _objUrl(item) {
    if (item.blob) {
      if (!item._url) item._url = URL.createObjectURL(item.blob);
      return item._url;
    }
    return item.src;
  },

  _makePhoto(grid, item, forcedType) {
    const idx = this.all.length;
    this.all.push(item);

    const fig = document.createElement("figure");
    const types = ["wide", "polaroid", "tilt", "tall", "plain"];
    fig.className = `card card--${forcedType || types[idx % types.length]}`;
    fig.setAttribute("role", "button");
    fig.tabIndex = 0;
    fig.setAttribute("aria-label", item.caption || "Открыть фото");

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = item.caption || "Совместное фото";
    img.src = this._objUrl(item);

    fig.appendChild(img);

    if (item.caption) {
      const cap = document.createElement("figcaption");
      cap.className = "card__caption";
      cap.textContent = item.caption;
      fig.appendChild(cap);
    }
    if (item.date) {
      const date = document.createElement("div");
      date.className = "card__date";
      date.textContent = fmtDate(item.date);
      fig.appendChild(date);
    }

    // Удаление — только для фото из IndexedDB
    if (item.id) {
      const del = document.createElement("button");
      del.className = "card__del";
      del.textContent = "✕";
      del.title = "Удалить фото";
      del.setAttribute("aria-label", "Удалить фото");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Удалить это воспоминание?")) this.removeUserPhoto(item.id);
      });
      fig.appendChild(del);
    }

    const open = () => {
      Lightbox.open(idx);
      spawnHeart(e_center(fig).x, e_center(fig).y);
    };
    fig.addEventListener("click", open);
    fig.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    grid.appendChild(fig);
  },

  _makeNote(grid, text, i) {
    const div = document.createElement("div");
    const colors = ["", "card--note--blue", "card--note--green"];
    div.className = `card card--note ${colors[i % colors.length]}`;
    const p = document.createElement("p");
    p.textContent = text;
    div.appendChild(p);
    grid.appendChild(div);
  },

  async removeUserPhoto(id) {
    try {
      await DB.remove(id);
      this.userPhotos = this.userPhotos.filter((p) => p.id !== id);
      this.render();
      showToast("Воспоминание удалено");
    } catch (e) {
      console.error(e);
      showToast("Не удалось удалить 😔");
    }
  },
};

// Центр элемента для сердечка
function e_center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/* ============================================================
   4. LIGHTBOX
   ============================================================ */
const Lightbox = {
  el: null,
  idx: 0,
  isOpen: false,

  init() {
    this.el = $("#lightbox");
    $("#lbPrev").addEventListener("click", () => this.prev());
    $("#lbNext").addEventListener("click", () => this.next());
    $$("[data-close]", this.el).forEach((el) => el.addEventListener("click", () => this.close()));

    document.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowLeft") this.prev();
      if (e.key === "ArrowRight") this.next();
    });

    // Свайпы
    let x0 = null;
    this.el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    this.el.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) dx < 0 ? this.next() : this.prev();
      x0 = null;
    }, { passive: true });
  },

  open(i) {
    this.idx = i;
    this.isOpen = true;
    this.el.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => this.el.classList.add("is-open"));
    this.show(i);
  },

  show(i) {
    const item = Gallery.all[i];
    if (!item) return;
    this.idx = i;
    const img = $("#lbImg");
    img.src = item.blob ? URL.createObjectURL(item.blob) : item.src;
    img.alt = item.caption || "";
    $("#lbCaption").textContent = item.caption || "";
    $("#lbDate").textContent = item.date ? fmtDate(item.date) : "";
  },

  prev() { this.show((this.idx - 1 + Gallery.all.length) % Gallery.all.length); },
  next() { this.show((this.idx + 1) % Gallery.all.length); },

  close() {
    this.isOpen = false;
    this.el.classList.remove("is-open");
    document.body.style.overflow = "";
    setTimeout(() => { this.el.hidden = true; }, 300);
  },
};

/* ============================================================
   5. ДОБАВЛЕНИЕ ФОТОГРАФИЙ
   ============================================================ */
const Uploader = {
  files: [],

  init() {
    const modal = $("#modal");
    const dz = $("#dropzone");
    const fi = $("#fileInput");
    const cap = $("#captionInput");
    const date = $("#dateInput");
    const saveBtn = $("#saveBtn");
    const clearBtn = $("#clearBtn");
    const status = $("#modalStatus");
    this.files = [];

    const openModal = () => {
      modal.hidden = false;
      requestAnimationFrame(() => modal.classList.add("is-open"));
      document.body.style.overflow = "hidden";
      status.textContent = "";
    };

    const closeModal = () => {
      modal.classList.remove("is-open");
      document.body.style.overflow = "";
      setTimeout(() => { modal.hidden = true; }, 350);
      this.clearSelection();
    };

    // Открытие: кнопка в галерее и пункт навигации
    $("#addBtn").addEventListener("click", openModal);
    $("#navAddBtn").addEventListener("click", (e) => {
      e.preventDefault();
      $("#memories").scrollIntoView({ behavior: "smooth" });
      openModal();
    });

    // Закрытие
    $$("[data-close]", modal).forEach((el) => el.addEventListener("click", closeModal));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    // Dropzone
    dz.addEventListener("click", () => fi.click());
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fi.click();
    });
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("is-over");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-over"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-over");
      this.addFiles(e.dataTransfer.files);
    });
    fi.addEventListener("change", () => this.addFiles(fi.files));

    // Общие подпись и дата для всех выбранных файлов
    cap.addEventListener("input", () => {
      this.files.forEach((f) => (f.caption = cap.value));
    });
    date.addEventListener("change", () => {
      this.files.forEach((f) => (f.date = date.value));
    });

    // Сохранение
    saveBtn.addEventListener("click", async () => {
      if (!this.files.length) return;
      saveBtn.disabled = true;
      status.textContent = "Сохраняю…";
      try {
        for (const f of this.files) {
          const rec = {
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
            blob: f.blob,
            caption: f.caption || "",
            date: f.date || "",
            addedAt: new Date().toISOString(),
          };
          await DB.add(rec);
          Gallery.userPhotos.push(rec);
        }
        Gallery.render();
        showToast("Воспоминание сохранено ♡");
        spawnHeart(innerWidth / 2, innerHeight / 2);
        closeModal();
      } catch (e) {
        console.error(e);
        status.textContent = "Ошибка сохранения. Возможно, фото слишком большое.";
        showToast("Ошибка сохранения 😔");
      } finally {
        saveBtn.disabled = false;
      }
    });

    // Удалить выбранные (до сохранения)
    clearBtn.addEventListener("click", () => {
      this.clearSelection();
      status.textContent = "Выбранные фото удалены";
    });
  },

  addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      showToast("Выберите изображения");
      return;
    }
    files.forEach((file) => {
      this.files.push({
        blob: file,
        caption: $("#captionInput").value || "",
        date: $("#dateInput").value || (file.lastModified
          ? new Date(file.lastModified).toISOString().slice(0, 10)
          : ""),
      });
    });
    this.renderPreviews();
  },

  renderPreviews() {
    const wrap = $("#previews");
    wrap.innerHTML = "";
    $("#metaFields").hidden = this.files.length === 0;
    $("#clearBtn").hidden = this.files.length === 0;
    $("#saveBtn").disabled = this.files.length === 0;

    this.files.forEach((f, i) => {
      const div = document.createElement("div");
      div.className = "preview";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f.blob);
      img.alt = "";
      const btn = document.createElement("button");
      btn.className = "preview__remove";
      btn.textContent = "✕";
      btn.setAttribute("aria-label", "Убрать фото");
      btn.addEventListener("click", () => {
        URL.revokeObjectURL(img.src);
        this.files.splice(i, 1);
        this.renderPreviews();
      });
      div.append(img, btn);
      wrap.appendChild(div);
    });
  },

  clearSelection() {
    this.files = [];
    this.renderPreviews();
    $("#previews").innerHTML = "";
    $("#captionInput").value = "";
    $("#dateInput").value = "";
    $("#modalStatus").textContent = "";
  },
};

/* ============================================================
   6. НАВИГАЦИЯ + REVEAL
   ============================================================ */
const NavFx = {
  init() {
    const nav = $("#nav");
    const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  },
};

const Reveal = {
  init() {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const els = $$(".reveal");
    if (reduced || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      $("#nav").classList.add("is-ready");
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach((el, i) => {
      // каскадная задержка на обложке
      el.style.transitionDelay = `${Math.min(i * 70, 420)}ms`;
      io.observe(el);
    });
    $("#nav").classList.add("is-ready");
  },
};

/* ============================================================
   7. ЗАПУСК
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  Counter.init();
  Gallery.init();
  Lightbox.init();
  Uploader.init();
  NavFx.init();
  Reveal.init();
});
