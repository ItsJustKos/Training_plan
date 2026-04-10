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

async function loadNote(area){
  const primaryKey = buildStorageKey(area.dataset.id);
  const primaryDoc = await db.collection("notes").doc(`${userId}_${primaryKey}`).get();

  if(primaryDoc.exists){
    area.value = primaryDoc.data().text || "";
    return;
  }

  const legacyKey = area.dataset.legacyKey;
  if(!legacyKey){
    return;
  }

  const legacyDoc = await db.collection("notes").doc(`${userId}_${legacyKey}`).get();
  if(legacyDoc.exists){
    area.value = legacyDoc.data().text || "";
  }
}

document.querySelectorAll("textarea").forEach((area) => {
  loadNote(area).catch(() => {
    showStatus("Ошибка загрузки", true);
  });

  let timeout;
  area.addEventListener("input", () => {
    clearTimeout(timeout);
    showStatus("Сохраняю...");

    timeout = setTimeout(() => {
      const key = buildStorageKey(area.dataset.id);
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

document.querySelectorAll(".day-header").forEach((header) => {
  header.addEventListener("click", () => {
    const card = header.parentElement;
    card.classList.toggle("active");

    if(card.classList.contains("active")){
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});
