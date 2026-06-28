const state = {
  mode: "participant",
  participants: [],
  player: null,
  adminPassword: "",
  adminParticipants: [],
  rankings: [],
  adminTab: "roster",
  adminMenuOpen: false,
  slideIndex: 0,
  slideTimer: null
};

const adminTabLabels = {
  roster: "참가자 명단",
  submissions: "서브 미션",
  winners: "우승자 선정",
  slideshow: "Submission 슬라이드 쇼"
};

const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.adminPassword) headers["x-admin-password"] = state.adminPassword;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "요청을 처리할 수 없습니다.");
  return data;
}

function setMode(mode) {
  state.mode = mode;
  $("participantMode").classList.toggle("active", mode === "participant");
  $("adminMode").classList.toggle("active", mode === "admin");
  $("participantView").classList.toggle("active", mode === "participant");
  $("adminView").classList.toggle("active", mode === "admin");
}

function optionList(items, selected = "", placeholder = "선택 안 함") {
  return [
    `<option value="">${placeholder}</option>`,
    ...items.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
  ].join("");
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function nameOf(id, list = state.adminParticipants) {
  return list.find((p) => p.id === id)?.name || "미정";
}

function submittedParticipants() {
  return state.adminParticipants.filter((p) => p.photo);
}

async function loadParticipants() {
  state.participants = await api("/api/participants");
  $("participantSelect").innerHTML = optionList(state.participants, "", "이름을 선택하세요");
  updateLoginHint();
}

function updateLoginHint() {
  const selected = state.participants.find((p) => p.id === $("participantSelect").value);
  if (!selected) {
    $("firstLoginHint").textContent = "관리자가 참가자를 등록하면 이름을 선택할 수 있습니다.";
    $("passwordLabel").querySelector("input").placeholder = "비밀번호 입력";
    return;
  }
  $("firstLoginHint").textContent = selected.hasPassword
    ? "설정한 비밀번호로 입장하세요."
    : "첫 로그인입니다. 사용할 비밀번호를 새로 정해 주세요.";
  $("passwordLabel").querySelector("input").placeholder = selected.hasPassword ? "비밀번호 입력" : "새 비밀번호 설정";
}

async function loginParticipant() {
  const participantId = $("participantSelect").value;
  const selected = state.participants.find((p) => p.id === participantId);
  if (!selected) return toast("참가자를 선택해 주세요.");
  const password = $("passwordInput").value;
  const payload = selected.hasPassword
    ? { participantId, password }
    : { participantId, newPassword: password };
  const data = await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
  state.player = data.participant;
  state.participants = data.participants.map((p) => ({ ...p, hasPassword: true }));
  localStorage.setItem("manitoParticipantId", state.player.id);
  $("passwordInput").value = "";
  renderPlayer();
  toast("입장했습니다.");
}

function renderPlayer() {
  if (!state.player) return;
  $("loginPanel").classList.add("hidden");
  $("playerPanel").classList.remove("hidden");
  $("guessPanel").classList.remove("hidden");
  $("playerName").textContent = state.player.name;
  $("missionText").textContent = state.player.mission;
  const others = state.participants.filter((p) => p.id !== state.player.id);
  $("guessSelect").innerHTML = optionList(others, state.player.guessId, "아직 모르겠어요");
  renderPlayerPhoto();
}

function renderPlayerPhoto() {
  const wrap = $("playerPhotoWrap");
  if (!state.player?.photo) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = `
    <img src="${state.player.photo.url}" alt="제출한 사진" />
    <p class="hint">제출 완료: ${new Date(state.player.photo.uploadedAt).toLocaleString("ko-KR")}</p>
  `;
}

async function uploadPhoto(event) {
  event.preventDefault();
  if (!state.player) return;
  const file = $("photoInput").files[0];
  if (!file) return toast("업로드할 사진을 선택해 주세요.");
  const form = new FormData();
  form.append("participantId", state.player.id);
  form.append("photo", file);
  const data = await api("/api/upload", { method: "POST", body: form });
  state.player = data.participant;
  $("photoInput").value = "";
  renderPlayerPhoto();
  toast("사진을 제출했습니다.");
}

async function saveGuess() {
  if (!state.player) return;
  const data = await api("/api/guess", {
    method: "POST",
    body: JSON.stringify({ participantId: state.player.id, guessId: $("guessSelect").value })
  });
  state.player = data.participant;
  toast("예상을 저장했습니다.");
}

function logoutParticipant() {
  state.player = null;
  localStorage.removeItem("manitoParticipantId");
  $("loginPanel").classList.remove("hidden");
  $("playerPanel").classList.add("hidden");
  $("guessPanel").classList.add("hidden");
}

async function adminLogin() {
  state.adminPassword = $("adminPasswordInput").value;
  await loadAdminState();
  $("adminLoginPanel").classList.add("hidden");
  $("adminDashboard").classList.remove("hidden");
  toast("관리자 화면을 열었습니다.");
}

async function loadAdminState() {
  const data = await api("/api/admin/state");
  state.adminParticipants = data.participants;
  state.rankings = data.rankings || [];
  const submitted = submittedParticipants();
  if (state.slideIndex >= submitted.length) state.slideIndex = Math.max(0, submitted.length - 1);
  renderAdmin();
}

function renderAdmin() {
  const rankOptions = optionList(state.adminParticipants, "", "선정 안 함");
  $("rankFirst").innerHTML = rankOptions;
  $("rankSecond").innerHTML = rankOptions;
  $("rankThird").innerHTML = rankOptions;
  $("rankFirst").value = state.rankings.find((r) => r.rank === 1)?.participantId || "";
  $("rankSecond").value = state.rankings.find((r) => r.rank === 2)?.participantId || "";
  $("rankThird").value = state.rankings.find((r) => r.rank === 3)?.participantId || "";
  renderAdminParticipants();
  renderSubmissions();
  renderSlideshow();
  renderAdminTab();
}

function setAdminTab(tab) {
  state.adminTab = tab;
  state.adminMenuOpen = false;
  if (tab !== "slideshow") stopAutoSlide();
  renderAdminTab();
  if (tab === "slideshow") renderSlideshow();
}

function renderAdminTab() {
  $("adminCurrentMenu").textContent = adminTabLabels[state.adminTab];
  $("adminMenu").classList.toggle("open", state.adminMenuOpen);
  $("adminMenuButton").setAttribute("aria-expanded", String(state.adminMenuOpen));
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.adminTab);
  });
  document.querySelectorAll("[data-admin-section]").forEach((section) => {
    section.classList.toggle("active", section.dataset.adminSection === state.adminTab);
  });
}

function toggleAdminMenu() {
  state.adminMenuOpen = !state.adminMenuOpen;
  renderAdminTab();
}

function renderAdminParticipants() {
  $("adminParticipantList").innerHTML = state.adminParticipants.map((p) => `
    <article class="participant-item">
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <span class="hint">${p.hasPassword ? "비밀번호 설정됨" : "첫 로그인 전"}</span>
      </div>
      <div class="small-actions">
        <button type="button" data-action="edit" data-id="${p.id}">수정</button>
        <button type="button" data-action="reset" data-id="${p.id}">비번 리셋</button>
        <button class="danger" type="button" data-action="delete" data-id="${p.id}">삭제</button>
      </div>
    </article>
  `).join("") || `<p class="hint">아직 등록된 참가자가 없습니다.</p>`;
}

function renderSubmissions() {
  const submitted = state.adminParticipants.filter((p) => p.photo).length;
  $("submitCount").textContent = `${submitted} / ${state.adminParticipants.length}`;
  $("submissionGrid").innerHTML = state.adminParticipants.map((p) => {
    const guess = p.guessId ? nameOf(p.guessId) : "아직 없음";
    return `
      <article class="submission-card">
        ${p.photo ? `<img src="${p.photo.url}" alt="${escapeHtml(p.name)} 제출 사진" />` : `<div class="empty-photo">미제출</div>`}
        <div class="submission-meta">
          <strong>${escapeHtml(p.name)}</strong>
          <span>자신의 예상 마니또: ${escapeHtml(guess)}</span>
          <span>미션: ${escapeHtml(p.mission)}</span>
        </div>
      </article>
    `;
  }).join("") || `<p class="hint">사진을 볼 참가자가 없습니다.</p>`;
}

function renderSlideshow() {
  const slides = submittedParticipants();
  const stage = $("slideshowStage");
  $("slideCount").textContent = slides.length ? `${state.slideIndex + 1} / ${slides.length}` : "0 / 0";
  $("prevSlideButton").disabled = slides.length <= 1;
  $("nextSlideButton").disabled = slides.length <= 1;
  $("autoSlideButton").disabled = slides.length <= 1;
  $("autoSlideButton").textContent = state.slideTimer ? "자동 정지" : "자동 재생";

  if (!slides.length) {
    stage.innerHTML = `<div class="empty-slide">아직 제출된 사진이 없습니다.</div>`;
    stopAutoSlide();
    return;
  }

  const participant = slides[state.slideIndex];
  const guess = participant.guessId ? nameOf(participant.guessId) : "아직 없음";
  stage.innerHTML = `
    <figure class="slide-card">
      <img src="${participant.photo.url}" alt="${escapeHtml(participant.name)} 제출 사진" />
      <figcaption>
        <span class="slide-owner">${escapeHtml(participant.name)}</span>
        <strong>${escapeHtml(participant.mission)}</strong>
        <span>자신의 예상 마니또: ${escapeHtml(guess)}</span>
      </figcaption>
    </figure>
  `;
}

function moveSlide(direction) {
  const slides = submittedParticipants();
  if (!slides.length) return;
  state.slideIndex = (state.slideIndex + direction + slides.length) % slides.length;
  renderSlideshow();
}

function stopAutoSlide() {
  if (!state.slideTimer) return;
  window.clearInterval(state.slideTimer);
  state.slideTimer = null;
  $("autoSlideButton").textContent = "자동 재생";
}

function toggleAutoSlide() {
  if (state.slideTimer) {
    stopAutoSlide();
    return;
  }
  const slides = submittedParticipants();
  if (slides.length <= 1) return;
  state.slideTimer = window.setInterval(() => moveSlide(1), 4500);
  $("autoSlideButton").textContent = "자동 정지";
}

function openParticipantModal(participant = null) {
  $("participantModalTitle").textContent = participant ? "참가자 수정" : "참가자 추가";
  $("editParticipantId").value = participant?.id || "";
  $("nameInput").value = participant?.name || "";
  $("missionInput").value = participant?.mission || "";
  $("participantModal").classList.remove("hidden");
  $("nameInput").focus();
}

function closeParticipantModal() {
  clearParticipantForm();
  $("participantModal").classList.add("hidden");
}

async function saveParticipant(event) {
  event.preventDefault();
  const id = $("editParticipantId").value;
  const body = {
    name: $("nameInput").value,
    mission: $("missionInput").value
  };
  const path = id ? `/api/admin/participants/${id}` : "/api/admin/participants";
  await api(path, { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
  closeParticipantModal();
  await loadAdminState();
  await loadParticipants();
  toast(id ? "참가자를 수정했습니다." : "참가자를 등록했습니다.");
}

function clearParticipantForm() {
  $("editParticipantId").value = "";
  $("nameInput").value = "";
  $("missionInput").value = "";
}

async function handleParticipantAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const participant = state.adminParticipants.find((p) => p.id === id);
  if (!participant) return;
  if (button.dataset.action === "edit") {
    openParticipantModal(participant);
    return;
  }
  if (button.dataset.action === "reset") {
    await api(`/api/admin/reset-password/${id}`, { method: "POST" });
    await loadAdminState();
    await loadParticipants();
    toast("비밀번호를 리셋했습니다.");
    return;
  }
  if (button.dataset.action === "delete") {
    if (!confirm(`${participant.name} 참가자를 삭제할까요?`)) return;
    await api(`/api/admin/participants/${id}`, { method: "DELETE" });
    await loadAdminState();
    await loadParticipants();
    toast("참가자를 삭제했습니다.");
  }
}

async function saveRankings() {
  await api("/api/admin/rankings", {
    method: "POST",
    body: JSON.stringify({
      first: $("rankFirst").value,
      second: $("rankSecond").value,
      third: $("rankThird").value
    })
  });
  await loadAdminState();
  toast("순위를 저장했습니다.");
}

function wireEvents() {
  $("participantMode").addEventListener("click", () => setMode("participant"));
  $("adminMode").addEventListener("click", () => setMode("admin"));
  $("adminMenuButton").addEventListener("click", toggleAdminMenu);
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
  });
  $("participantSelect").addEventListener("change", updateLoginHint);
  $("loginButton").addEventListener("click", () => loginParticipant().catch((err) => toast(err.message)));
  $("uploadForm").addEventListener("submit", (event) => uploadPhoto(event).catch((err) => toast(err.message)));
  $("saveGuessButton").addEventListener("click", () => saveGuess().catch((err) => toast(err.message)));
  $("logoutButton").addEventListener("click", logoutParticipant);
  $("adminLoginButton").addEventListener("click", () => adminLogin().catch((err) => toast(err.message)));
  $("refreshAdminButton").addEventListener("click", () => loadAdminState().catch((err) => toast(err.message)));
  $("addParticipantButton").addEventListener("click", () => openParticipantModal());
  $("participantForm").addEventListener("submit", (event) => saveParticipant(event).catch((err) => toast(err.message)));
  $("clearFormButton").addEventListener("click", closeParticipantModal);
  $("closeParticipantModalButton").addEventListener("click", closeParticipantModal);
  $("participantModal").addEventListener("click", (event) => {
    if (event.target === $("participantModal")) closeParticipantModal();
  });
  $("adminParticipantList").addEventListener("click", (event) => handleParticipantAction(event).catch((err) => toast(err.message)));
  $("saveRankingButton").addEventListener("click", () => saveRankings().catch((err) => toast(err.message)));
  $("prevSlideButton").addEventListener("click", () => moveSlide(-1));
  $("nextSlideButton").addEventListener("click", () => moveSlide(1));
  $("autoSlideButton").addEventListener("click", toggleAutoSlide);
}

async function restorePlayer() {
  const id = localStorage.getItem("manitoParticipantId");
  if (!id) return;
  try {
    const data = await api(`/api/me/${id}`);
    state.player = data.participant;
    renderPlayer();
  } catch {
    localStorage.removeItem("manitoParticipantId");
  }
}

wireEvents();
loadParticipants()
  .then(restorePlayer)
  .catch((err) => toast(err.message));
