const firebaseConfig = {
  apiKey: "AIzaSyDtxo1jZCGMcJSTbT43cMw3NS0GaiIdfB4",
  authDomain: "projectone-840a9.firebaseapp.com",
  projectId: "projectone-840a9",
  storageBucket: "projectone-840a9.firebasestorage.app",
  messagingSenderId: "4790278545",
  appId: "1:4790278545:web:970d5aa6058d1d524ae230"
};

if(!firebase.apps.length){
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const userId = document.body.dataset.userId || "kostya!23-74che";
const storagePrefix = document.body.dataset.storagePrefix || "";
const currentPage = window.location.pathname.split("/").pop() || "index.html";
const storagePageKey = document.body.dataset.storagePageKey || currentPage;
const layoutStorageKey = `training-plan-layout:${storagePrefix || "base"}:${storagePageKey}`;
const openDaysStorageKey = `training-plan-open-days:${storagePrefix || "base"}:${storagePageKey}`;
const periodDocId = `${userId}__${storagePrefix || "base"}__${storagePageKey}`;
const periodDocRef = db.collection("trainingPeriods").doc(periodDocId);
const noteDrafts = new Map();
const defaultDayLayouts = collectDefaultDayLayouts();
let currentDayLayouts = loadDayLayouts();
let openDayIndexes = loadOpenDayIndexes();
let layoutSaveTimer = null;
let remoteLoadStarted = false;

localStorage.setItem("training-plan-last-page", currentPage);

function showStatus(text, isError = false){
  const el = document.getElementById("saveStatus");
  if(!el){
    return;
  }

  el.textContent = text;
  el.style.background = isError ? "#c0392b" : "#111";
  el.classList.add("show");

  clearTimeout(el.hideTimeout);
  el.hideTimeout = setTimeout(() => {
    el.classList.remove("show");
  }, 1500);
}

function buildStorageKey(localKey){
  return storagePrefix ? `${storagePrefix}_${localKey}` : localKey;
}

function escapeHtml(value){
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trimLine(value){
  return String(value || "").replace(/\u00a0/g, " ").trim();
}

function normalizeLines(value){
  return Array.isArray(value)
    ? value.map(trimLine).filter(Boolean)
    : [];
}

function normalizeExercise(exercise, fallbackId){
  const id = exercise && exercise.id ? exercise.id : fallbackId;
  const noteId = exercise && exercise.noteId ? exercise.noteId : `${id}_note`;
  const title = trimLine(exercise && exercise.title) || "Упражнение";
  const badge = trimLine(exercise && exercise.badge);
  const weight = trimLine(exercise && exercise.weight);
  const pace = trimLine(exercise && exercise.pace);
  const metrics = normalizeMetrics(
    trimLine(exercise && exercise.sets),
    trimLine(exercise && exercise.reps),
    trimLine(exercise && exercise.primaryLine)
  );
  const lines = normalizeLines(exercise && exercise.lines);
  const hasPace = Boolean((exercise && exercise.hasPace) || pace);
  const hasWeight = Boolean((exercise && exercise.hasWeight) || weight);
  const isCardio = Boolean(exercise && exercise.isCardio);

  return { id, noteId, title, badge, weight, hasWeight, pace, hasPace, isCardio, sets: metrics.sets, reps: metrics.reps, lines };
}

function cloneDayLayouts(layouts){
  return layouts.map((day, index) => normalizeDayLayout(day, day, index));
}

function normalizeDayLayout(day, fallbackDay, index){
  const safeFallback = fallbackDay || { id: `day-${index + 1}`, date: "", exercises: [] };
  const exerciseSource = Array.isArray(day?.exercises) ? day.exercises : safeFallback.exercises;

  return {
    id: trimLine(day?.id || safeFallback.id || `day-${index + 1}`),
    date: trimLine(day?.date || safeFallback.date),
    exercises: exerciseSource.map((exercise, exerciseIndex) =>
      normalizeExercise(exercise, `${safeFallback.id || `day-${index + 1}`}-exercise-${exerciseIndex + 1}`)
    )
  };
}

function normalizeDayLayouts(days, fallbackLayouts = defaultDayLayouts){
  if(!Array.isArray(days)){
    return cloneDayLayouts(fallbackLayouts);
  }

  return fallbackLayouts.map((fallbackDay, index) => {
    const rawDay = days.find((day) => day?.id === fallbackDay.id) || days[index];
    return normalizeDayLayout(rawDay, fallbackDay, index);
  });
}

function parseExercise(el, dayId, index, dayTitle = ""){
  const noteId = el.querySelector("textarea")?.dataset.id || `${dayId}-exercise-${index + 1}-note`;
  const clone = el.cloneNode(true);
  clone.querySelectorAll("textarea").forEach((area) => area.remove());

  const badgeEl = clone.querySelector(".badge");
  const badge = trimLine(badgeEl?.textContent);
  if(badgeEl){
    badgeEl.remove();
  }

  const titleEl = clone.querySelector("b");
  let title = trimLine(titleEl?.textContent);
  if(titleEl){
    titleEl.remove();
  }

  const lines = clone.innerText
    .split("\n")
    .map(trimLine)
    .filter(Boolean);

  if(!title){
    title = lines.shift() || `Упражнение ${index + 1}`;
  }

  const extracted = extractWeightFromLines(lines);
  const paceField = extractTaggedField(extracted.lines, /^Темп\s*:/i);
  return normalizeExercise({
    id: `${dayId}-exercise-${index + 1}`,
    noteId,
    title,
    badge,
    primaryLine: extracted.primaryLine,
    weight: extracted.weight,
    hasWeight: Boolean(extracted.weight),
    pace: paceField.value,
    hasPace: paceField.found,
    isCardio: isCardioText(`${dayTitle} ${title} ${extracted.primaryLine} ${paceField.lines.join(" ")}`),
    lines: paceField.lines
  }, `${dayId}-exercise-${index + 1}`);
}

function normalizeMetrics(setsValue, repsValue, primaryLine){
  let sets = trimLine(setsValue);
  let reps = trimLine(repsValue);
  const primary = trimLine(primaryLine);

  if(!sets && !reps && primary){
    const parsed = parsePrimaryLine(primary);
    sets = parsed.sets;
    reps = parsed.reps;
  }

  return { sets, reps };
}

function parsePrimaryLine(value){
  const line = trimLine(value);
  if(!line){
    return { sets: "", reps: "" };
  }

  const classicMatch = line.match(/^(\d+)\s*[×xх]\s*(.+)$/i);
  if(classicMatch){
    return { sets: trimLine(classicMatch[1]), reps: trimLine(classicMatch[2]) };
  }

  return { sets: "", reps: line };
}

function extractWeightFromLines(lines){
  const nextLines = [...lines];
  let primaryLine = "";
  let weight = "";

  for(let i = 0; i < nextLines.length; i += 1){
    const line = nextLines[i];
    const match = line.match(/^(.*?)(?:\s*[→—-]\s*|\s+)([\d.,]+(?:\s*[–-]\s*[\d.,]+)?)\s*кг$/i);
    if(!match){
      continue;
    }

    primaryLine = trimLine(match[1]);
    weight = trimLine(match[2]);
    nextLines.splice(i, 1);
    break;
  }

  if(!primaryLine && nextLines.length){
    primaryLine = nextLines.shift();
  }

  return { primaryLine, weight, lines: nextLines };
}

function extractTaggedField(lines, pattern){
  const nextLines = [];
  let value = "";
  let found = false;

  lines.forEach((line) => {
    if(!found && pattern.test(line)){
      value = trimLine(line.replace(pattern, ""));
      found = true;
      return;
    }

    nextLines.push(line);
  });

  return { value, found, lines: nextLines };
}

function collectDefaultDayLayouts(){
  return Array.from(document.querySelectorAll(".day-card")).map((card, index) => {
    const dayId = `day-${index + 1}`;
    const dayTitle = trimLine(card.querySelector(".day-title-main")?.textContent || card.querySelector(".day-header")?.textContent.replace("▼", ""));
    const exercises = Array.from(card.querySelectorAll(".day-content > .exercise")).map((exerciseEl, exerciseIndex) =>
      parseExercise(exerciseEl, dayId, exerciseIndex, dayTitle)
    );

    return { id: dayId, date: "", exercises };
  });
}

function loadDayLayouts(){
  try{
    const saved = JSON.parse(localStorage.getItem(layoutStorageKey) || "null");
    return normalizeDayLayouts(saved, defaultDayLayouts);
  }catch(error){
    return cloneDayLayouts(defaultDayLayouts);
  }
}

function saveDayLayouts(){
  localStorage.setItem(layoutStorageKey, JSON.stringify(currentDayLayouts));
}

function hasLocalPeriodState(){
  return Boolean(localStorage.getItem(layoutStorageKey) || localStorage.getItem(openDaysStorageKey));
}

function loadOpenDayIndexes(){
  try{
    const saved = JSON.parse(localStorage.getItem(openDaysStorageKey) || "null");
    if(Array.isArray(saved)){
      return new Set(saved.filter((value) => Number.isInteger(value)));
    }
  }catch(error){
  }

  const defaultOpen = Array.from(document.querySelectorAll(".day-card"))
    .map((card, index) => card.classList.contains("active") ? index : null)
    .filter((value) => value !== null);

  return new Set(defaultOpen);
}

function saveOpenDayIndexes(){
  localStorage.setItem(openDaysStorageKey, JSON.stringify([...openDayIndexes]));
}

function persistLocalPeriodState(){
  saveDayLayouts();
  saveOpenDayIndexes();
}

function serializePeriodState(){
  return {
    userId,
    storagePrefix: storagePrefix || "base",
    pageKey: storagePageKey,
    page: currentPage,
    updatedAt: Date.now(),
    openDays: [...openDayIndexes],
    days: currentDayLayouts
  };
}

async function saveRemotePeriodState(){
  await periodDocRef.set(serializePeriodState(), { merge: true });
}

async function loadRemotePeriodState(){
  if(remoteLoadStarted){
    return;
  }

  remoteLoadStarted = true;

  try{
    const snapshot = await periodDocRef.get();
    if(snapshot.exists){
      const data = snapshot.data() || {};
      currentDayLayouts = normalizeDayLayouts(data.days, defaultDayLayouts);
      openDayIndexes = Array.isArray(data.openDays)
        ? new Set(data.openDays.filter((value) => Number.isInteger(value)))
        : loadOpenDayIndexes();
      persistLocalPeriodState();
      renderAllDayCards();
      return;
    }

    if(hasLocalPeriodState()){
      await saveRemotePeriodState();
    }
  }catch(error){
    showStatus("Ошибка облака", true);
  }
}

function scheduleLayoutSave(showFeedback = true){
  clearTimeout(layoutSaveTimer);
  persistLocalPeriodState();

  if(showFeedback){
    showStatus("Сохраняю...");
  }

  layoutSaveTimer = setTimeout(async () => {
    try{
      await saveRemotePeriodState();
      if(showFeedback){
        showStatus("Сохранено");
      }
    }catch(error){
      if(showFeedback){
        showStatus("Ошибка", true);
      }
    }
  }, 250);
}

function buildExerciseCard(exercise){
  const metaItems = [];
  if(shouldShowSets(exercise)){
    metaItems.push(`<label class="exercise-weight exercise-metric"><span>Подх</span><input class="weight-input" data-action="sets" value="${escapeHtml(exercise.sets)}" placeholder="3" /></label>`);
  }
  if(shouldShowVolume(exercise)){
    metaItems.push(`<label class="exercise-weight exercise-metric"><span>${escapeHtml(getVolumeLabel(exercise))}</span><input class="weight-input" data-action="reps" value="${escapeHtml(exercise.reps)}" placeholder="${escapeHtml(getVolumePlaceholder(exercise))}" /></label>`);
  }
  if(exercise.hasPace || exercise.pace || isCardioExercise(exercise)){
    metaItems.push(`<label class="exercise-weight exercise-metric exercise-metric-wide"><span>Темп</span><input class="weight-input" data-action="pace" value="${escapeHtml(exercise.pace)}" placeholder="6:30" /></label>`);
  }
  if(shouldShowWeight(exercise)){
    metaItems.push(`<label class="exercise-weight"><span>Вес</span><input class="weight-input" data-action="weight" value="${escapeHtml(exercise.weight)}" placeholder="кг" /></label>`);
  }

  const details = exercise.lines.length
    ? `<div class="exercise-lines">${exercise.lines.map((line) => `<div class="exercise-line">${escapeHtml(line)}</div>`).join("")}</div>`
    : "";

  return `
    <div class="exercise exercise-compact" data-exercise-id="${escapeHtml(exercise.id)}">
      <div class="exercise-top">
        <div class="exercise-heading">
          ${exercise.badge ? `<span class="badge">${escapeHtml(exercise.badge)}</span>` : ""}
          <b>${escapeHtml(exercise.title)}</b>
        </div>
        <button type="button" class="exercise-icon-btn" data-action="delete-exercise" aria-label="Удалить упражнение">×</button>
      </div>
      <div class="exercise-meta">${metaItems}</div>
      ${details}
      <textarea data-id="${escapeHtml(exercise.noteId)}"></textarea>
    </div>
  `;
}

function buildAddExercisePanel(){
  return `
    <div class="exercise-add-panel">
      <button type="button" class="exercise-add-toggle" data-action="toggle-add-form">+ Упражнение</button>
      <form class="exercise-add-form" hidden>
        <input class="compact-input" name="title" placeholder="Название" required />
        <div class="exercise-add-grid">
          <input class="compact-input" name="sets" placeholder="Подходы" />
          <input class="compact-input" name="reps" placeholder="Повторы" />
          <input class="compact-input" name="weight" placeholder="Вес" />
          <input class="compact-input" name="pace" placeholder="Темп" />
        </div>
        <input class="compact-input" name="badge" placeholder="Категория" />
        <textarea class="compact-textarea" name="details" rows="2" placeholder="Детали: комментарий, отдых, RPE и другое"></textarea>
        <div class="exercise-form-actions">
          <button type="submit" class="exercise-submit-btn">Добавить</button>
          <button type="button" class="exercise-cancel-btn" data-action="cancel-add-form">Отмена</button>
        </div>
      </form>
    </div>
  `;
}

function buildDayDateField(day){
  return `
    <div class="day-date-row">
      <label class="day-date-field">
        <span>Дата тренировки</span>
        <input type="date" class="day-date-input" data-action="day-date" value="${escapeHtml(day.date)}" />
      </label>
    </div>
  `;
}

function renderDayCard(card, index){
  const day = currentDayLayouts[index];
  const content = card.querySelector(".day-content");
  content.innerHTML = `${buildDayDateField(day)}${day.exercises.map(buildExerciseCard).join("")}${buildAddExercisePanel()}`;
  hydrateTextareas(content);
  updateWeekDashboard();
}

function renderAllDayCards(){
  document.querySelectorAll(".day-card").forEach((card, index) => {
    card.classList.toggle("active", openDayIndexes.has(index));
    renderDayCard(card, index);
  });
  updateWeekDashboard();
}

function getDayIndexFromCard(card){
  return Number(card.dataset.dayIndex);
}

function createExerciseId(dayId){
  return `${dayId}-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getExerciseSearchText(exercise){
  return [exercise.title, exercise.badge, exercise.reps, exercise.pace, ...exercise.lines].join(" ").toLowerCase();
}

function isCardioText(text){
  return /(бег|интервал|длинн|кардио|эллипс|заминка|разминка|шаг|прогулк)/i.test(String(text || ""));
}

function isCardioExercise(exercise){
  return Boolean(exercise.isCardio) || isCardioText(getExerciseSearchText(exercise));
}

function shouldShowSets(exercise){
  return Boolean(exercise.sets) || !isCardioExercise(exercise);
}

function shouldShowVolume(exercise){
  return Boolean(exercise.reps) || !isCardioExercise(exercise);
}

function shouldShowWeight(exercise){
  return exercise.hasWeight || Boolean(exercise.weight) || !isCardioExercise(exercise);
}

function getVolumeLabel(exercise){
  return isCardioExercise(exercise) ? "Объём" : "Повт";
}

function getVolumePlaceholder(exercise){
  return isCardioExercise(exercise) ? "5 км" : "10";
}

function getDayHeading(card){
  const explicitTitle = trimLine(card.querySelector(".day-title-main")?.textContent);
  if(explicitTitle){
    return explicitTitle;
  }

  return trimLine(card.dataset.dayBaseTitle || card.querySelector(".day-header")?.textContent.replace("▼", ""));
}

function getDayLabel(card, index){
  const explicitLabel = trimLine(card.querySelector(".day-index-badge")?.textContent);
  return explicitLabel || `День ${index + 1}`;
}

function formatBlocks(count){
  if(count % 10 === 1 && count % 100 !== 11){
    return `${count} блок`;
  }
  if([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)){
    return `${count} блока`;
  }
  return `${count} блоков`;
}

function formatDayDate(value){
  const raw = trimLine(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match){
    return raw;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

function ensureDayHeaderDate(card){
  const header = card.querySelector(".day-header");
  const arrow = header?.querySelector(".day-arrow");
  if(!header || !arrow){
    return null;
  }

  let dateEl = header.querySelector(".day-header-date");
  if(!dateEl){
    dateEl = document.createElement("span");
    dateEl.className = "day-header-date";
    header.insertBefore(dateEl, arrow);
  }

  return dateEl;
}

function updateWeekDashboard(){
  const cards = Array.from(document.querySelectorAll(".day-card"));
  const totalDays = cards.length;
  const totalExercises = currentDayLayouts.reduce((sum, day) => sum + day.exercises.length, 0);
  const cardioDays = cards.filter((card) => /бег|интервал|длинн|кардио/i.test(getDayHeading(card))).length;
  const strengthDays = cards.filter((card) => /силов/i.test(getDayHeading(card))).length;

  cards.forEach((card, index) => {
    const meta = card.querySelector("[data-day-meta]");
    if(meta){
      meta.textContent = formatBlocks(currentDayLayouts[index]?.exercises.length || 0);
    }

    const titleEl = card.querySelector(".day-header > span:first-child");
    if(titleEl){
      const baseTitle = trimLine(card.dataset.dayBaseTitle || titleEl.textContent);
      card.dataset.dayBaseTitle = baseTitle;
      titleEl.textContent = baseTitle;
    }

    const dateEl = ensureDayHeaderDate(card);
    if(dateEl){
      const dayDate = formatDayDate(currentDayLayouts[index]?.date || "");
      dateEl.textContent = dayDate;
      dateEl.style.display = dayDate ? "inline-block" : "none";
    }
  });

  const dayCountEl = document.getElementById("summary-day-count");
  const exerciseCountEl = document.getElementById("summary-exercise-count");
  const cardioCountEl = document.getElementById("summary-cardio-count");
  const strengthCountEl = document.getElementById("summary-strength-count");
  const focusEl = document.getElementById("summary-focus");
  const noteEl = document.getElementById("summary-note");

  if(dayCountEl){
    dayCountEl.textContent = String(totalDays);
  }
  if(exerciseCountEl){
    exerciseCountEl.textContent = String(totalExercises);
  }
  if(cardioCountEl){
    cardioCountEl.textContent = String(cardioDays);
  }
  if(strengthCountEl){
    strengthCountEl.textContent = String(strengthDays);
  }

  if(focusEl || noteEl){
    const focusIndex = [...openDayIndexes].sort((a, b) => a - b)[0] ?? 0;
    const focusCard = cards[focusIndex];
    const focusDay = currentDayLayouts[focusIndex];
    if(focusEl && focusCard){
      focusEl.textContent = `${getDayLabel(focusCard, focusIndex)} • ${getDayHeading(focusCard)}`;
    }
    if(noteEl && focusDay){
      noteEl.textContent = `${formatBlocks(focusDay.exercises.length)} в текущем блоке`;
    }
  }
}

function bindTextareas(root = document){
  root.querySelectorAll("textarea[data-id]").forEach((area) => {
    if(area.dataset.bound === "true"){
      return;
    }

    area.dataset.bound = "true";
    const draftKey = buildStorageKey(area.dataset.id);
    if(noteDrafts.has(draftKey)){
      area.value = noteDrafts.get(draftKey);
    }else{
      loadNote(area).catch(() => {
        showStatus("Ошибка загрузки", true);
      });
    }

    let timeout;
    area.addEventListener("input", () => {
      const key = buildStorageKey(area.dataset.id);
      noteDrafts.set(key, area.value);
      clearTimeout(timeout);
      showStatus("Сохраняю...");

      timeout = setTimeout(() => {
        db.collection("notes").doc(`${userId}_${key}`).set({
          text: area.value,
          updated: Date.now()
        })
        .then(() => {
          showStatus("Сохранено");
        })
        .catch(() => {
          showStatus("Ошибка", true);
        });
      }, 500);
    });
  });
}

function hydrateTextareas(root = document){
  bindTextareas(root);
}

async function loadNote(area){
  const primaryKey = buildStorageKey(area.dataset.id);
  if(noteDrafts.has(primaryKey)){
    area.value = noteDrafts.get(primaryKey);
    return;
  }

  const primaryDoc = await db.collection("notes").doc(`${userId}_${primaryKey}`).get();

  if(primaryDoc.exists){
    area.value = primaryDoc.data().text || "";
    noteDrafts.set(primaryKey, area.value);
    return;
  }

  const legacyKey = area.dataset.legacyKey;
  if(!legacyKey){
    return;
  }

  const legacyDoc = await db.collection("notes").doc(`${userId}_${legacyKey}`).get();
  if(legacyDoc.exists){
    area.value = legacyDoc.data().text || "";
    noteDrafts.set(primaryKey, area.value);
  }
}

document.querySelectorAll(".day-header").forEach((header) => {
  header.addEventListener("click", () => {
    const card = header.parentElement;
    const cardIndex = Number(card.dataset.dayIndex);
    card.classList.toggle("active");

    if(card.classList.contains("active")){
      openDayIndexes.add(cardIndex);
    }else{
      openDayIndexes.delete(cardIndex);
    }
    saveOpenDayIndexes();
    scheduleLayoutSave(false);

    if(card.classList.contains("active")){
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    updateWeekDashboard();
  });
});

document.querySelectorAll(".day-card").forEach((card, index) => {
  card.dataset.dayIndex = String(index);
  const titleEl = card.querySelector(".day-header > span:first-child");
  if(titleEl){
    card.dataset.dayBaseTitle = trimLine(titleEl.textContent);
  }
  ensureDayHeaderDate(card);
  const content = card.querySelector(".day-content");

  content.addEventListener("click", (event) => {
    const deleteButton = event.target.closest('[data-action="delete-exercise"]');
    if(deleteButton){
      const exerciseEl = deleteButton.closest("[data-exercise-id]");
      const dayIndex = getDayIndexFromCard(card);
      const day = currentDayLayouts[dayIndex];
      if(!day){
        return;
      }

      const exercise = day.exercises.find((item) => item.id === exerciseEl.dataset.exerciseId);
      const exerciseName = exercise?.title || "это упражнение";
      if(!window.confirm(`Удалить блок "${exerciseName}"?`)){
        return;
      }

      day.exercises = day.exercises.filter((exercise) => exercise.id !== exerciseEl.dataset.exerciseId);
      renderDayCard(card, dayIndex);
      scheduleLayoutSave();
      return;
    }

    const toggleButton = event.target.closest('[data-action="toggle-add-form"]');
    if(toggleButton){
      const form = content.querySelector(".exercise-add-form");
      form.hidden = !form.hidden;
      if(!form.hidden){
        form.querySelector('input[name="title"]').focus();
      }
      return;
    }

    const cancelButton = event.target.closest('[data-action="cancel-add-form"]');
    if(cancelButton){
      const form = cancelButton.closest(".exercise-add-form");
      form.reset();
      form.hidden = true;
    }
  });

  content.addEventListener("input", (event) => {
    if(event.target.matches('[data-action="day-date"]')){
      const dayIndex = getDayIndexFromCard(card);
      const day = currentDayLayouts[dayIndex];
      if(!day){
        return;
      }

      day.date = trimLine(event.target.value);
      updateWeekDashboard();
      scheduleLayoutSave();
      return;
    }

    if(event.target.matches('[data-action="weight"], [data-action="sets"], [data-action="reps"], [data-action="pace"]')){
      const exerciseEl = event.target.closest("[data-exercise-id]");
      const dayIndex = getDayIndexFromCard(card);
      const day = currentDayLayouts[dayIndex];
      const exercise = day?.exercises.find((item) => item.id === exerciseEl.dataset.exerciseId);
      if(!exercise){
        return;
      }

      const action = event.target.dataset.action;
      exercise[action] = trimLine(event.target.value);
      if(action === "pace"){
        exercise.hasPace = true;
      }
      if(action === "weight"){
        exercise.hasWeight = true;
      }
      scheduleLayoutSave();
    }
  });

  content.addEventListener("submit", (event) => {
    const form = event.target.closest(".exercise-add-form");
    if(!form){
      return;
    }

    event.preventDefault();
    const dayIndex = getDayIndexFromCard(card);
    const day = currentDayLayouts[dayIndex];
    const formData = new FormData(form);
    const title = trimLine(formData.get("title"));
    if(!title){
      form.querySelector('input[name="title"]').focus();
      return;
    }

    const dayId = day.id;
    const exerciseId = createExerciseId(dayId);
    const detailLines = String(formData.get("details") || "")
      .split("\n")
      .map(trimLine)
      .filter(Boolean);

    day.exercises.push(normalizeExercise({
      id: exerciseId,
      noteId: `${exerciseId}_note`,
      title,
      badge: trimLine(formData.get("badge")),
      sets: trimLine(formData.get("sets")),
      reps: trimLine(formData.get("reps")),
      weight: trimLine(formData.get("weight")),
      hasWeight: Boolean(trimLine(formData.get("weight"))),
      pace: trimLine(formData.get("pace")),
      hasPace: Boolean(trimLine(formData.get("pace"))),
      isCardio: isCardioText(getDayHeading(card)),
      lines: detailLines
    }, exerciseId));

    renderDayCard(card, dayIndex);
    scheduleLayoutSave();
  });
});

renderAllDayCards();
loadRemotePeriodState();
