if (!window.__TELEGRAM_CREW_OFFLINE__) {
  const box = document.querySelector("#view");
  if (box) box.textContent = "Страница остановлена: защита не загрузилась, поэтому запросы в интернет не отправляются.";
  throw new Error("offline guard missing");
}

const view = document.querySelector("#view");
const editor = document.querySelector("#editor");
const editorForm = document.querySelector("#editor-form");
const power = document.querySelector("#power");
const runState = document.querySelector("#run-state");

let state = null;
let tab = "roles";
let journalAfter = "";
let journalItems = [];

const wakeLabel = {
  lead: "Ведущий начинает, дальше роли зовут друг друга",
  mentioned: "Ответ только если роль упомянули",
  all: "На сообщение человека отвечает каждая роль",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(method, url, body) {
  if (!String(url).startsWith("/api/")) {
    throw new Error("Разрешены только запросы интерфейса.");
  }
  const serialized = body ? JSON.stringify(body) : "";
  if (/"bot_token"|"cursor_api_key"|\bcursor_[A-Za-z0-9_-]{8,}|\b\d{8,}:[A-Za-z0-9_-]{20,}/.test(serialized)) {
    throw new Error("Публичная страница не принимает ключи и токены и не отправляет их в интернет.");
  }
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Запрос не выполнился");
  return data;
}

function skillName(id) {
  return state.skills.find((skill) => skill.id === id)?.name || id;
}

function leadId() {
  const ready = state.roles
    .filter((role) => role.enabled && role.has_token)
    .sort((a, b) => a.order - b.order);
  return ready[0]?.id || "";
}

function render() {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  runState.textContent = state.running ? "слушает группу" : "остановлено";
  runState.classList.toggle("on", state.running);
  power.textContent = state.running ? "Остановить" : "Запустить";
  if (tab === "roles") renderRoles();
  if (tab === "skills") renderSkills();
  if (tab === "group") renderGroup();
  if (tab === "journal") renderJournal();
}

function renderRoles() {
  const cards = state.roles
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((role) => {
      const skills = (role.skill_ids || []).map((id) => `<span class="tag">${escapeHtml(skillName(id))}</span>`).join("");
      const bot = role.bot_username ? `@${escapeHtml(role.bot_username)}` : role.has_token ? "токен сохранён" : "бот не задан";
      const lead = role.id === leadId() ? `<span class="tag">ведущий</span>` : "";
      return `
        <article class="card">
          <div class="card-head">
            <h2>${escapeHtml(role.name)}</h2>
            <span>${role.enabled ? "вкл" : "выкл"}</span>
          </div>
          <p>${escapeHtml(role.description || "Опишите, что эта роль делает в группе.")}</p>
          <p class="meta">${bot} ${lead}</p>
          <div>${skills || '<span class="hint">Скиллы не подключены</span>'}</div>
          <div class="row gap-top">
            <button type="button" data-edit-role="${role.id}">Изменить</button>
            <button type="button" data-up="${role.id}">Выше</button>
            <button type="button" data-down="${role.id}">Ниже</button>
          </div>
        </article>`;
    })
    .join("");
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Роли</h2>
        <p class="lede">У каждой роли свой бот. В группе они говорят от его имени.</p>
      </div>
      <button class="primary" type="button" id="add-role">Новая роль</button>
    </div>
    <section class="grid">${cards || '<p class="empty">Ролей пока нет.</p>'}</section>`;
}

function renderSkills() {
  const cards = state.skills
    .map((skill) => {
      const used = state.roles.filter((role) => (role.skill_ids || []).includes(skill.id)).map((role) => role.name);
      return `
        <article class="card">
          <h2>${escapeHtml(skill.name)}</h2>
          <p>${escapeHtml(skill.description || "Когда этот скилл нужен роли.")}</p>
          <p class="meta">${used.length ? `Подключён: ${escapeHtml(used.join(", "))}` : "Пока ни к одной роли"}</p>
          <button type="button" data-edit-skill="${skill.id}">Изменить</button>
        </article>`;
    })
    .join("");
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Скиллы</h2>
        <p class="lede">Инструкция для Cursor. Роль получает только отмеченные скиллы.</p>
      </div>
      <button class="primary" type="button" id="add-skill">Новый скилл</button>
    </div>
    <section class="grid">${cards || '<p class="empty">Скиллов пока нет.</p>'}</section>`;
}

function renderGroup() {
  const settings = state.settings;
  view.innerHTML = `
    <section class="panel">
      <h2>Общая группа</h2>
      <p class="lede">Все боты сидят в одном чате. Человек пишет туда, ведущий отвечает и зовёт коллегу по имени роли.</p>
      <form id="settings-form">
        <p class="hint">Ключ Cursor на публичную страницу не вводится, не сохраняется и не отправляется.</p>
        <label for="model">Модель</label>
        <input id="model" name="model" value="${escapeHtml(settings.model)}">
        <label for="chat">Id группы</label>
        <input id="chat" name="group_chat_id" value="${escapeHtml(settings.group_chat_id)}" placeholder="Появится само, если запустить приём и написать в группу">
        <label for="turns">Сколько реплик подряд могут отправить боты</label>
        <input id="turns" name="max_turns" type="number" min="1" max="12" value="${Number(settings.max_turns)}">
        <label for="wake">Кто отвечает человеку</label>
        <select id="wake" name="human_wake">
          ${Object.entries(wakeLabel)
            .map(([value, label]) => `<option value="${value}" ${settings.human_wake === value ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
        <div class="form-actions">
          <button class="primary" type="submit">Сохранить</button>
          <button type="button" id="check-group">Проверить доступ ботов</button>
        </div>
      </form>
      <div id="check-result"></div>
      <h3 class="section-gap">Перед первым сообщением</h3>
      <ol class="list">
        <li>В локальном приложении у каждой роли свой бот. На этом сайте токен ввести нельзя.</li>
        <li>У каждого бота в BotFather выполните /setprivacy и выберите Disable, иначе бот не видит чужие реплики.</li>
        <li>Добавьте всех ботов в одну группу.</li>
        <li>Ключ Cursor остаётся только в локальном приложении: ${escapeHtml(state.data_dir)}.</li>
        <li>Запуск группы доступен в локальном приложении. Команда /crew показывает состав без вызова модели.</li>
      </ol>
      <p class="hint">Скиллы роли записываются в ${escapeHtml(state.workspace_dir)} и подхватываются локальным агентом Cursor.</p>
    </section>`;
}

function renderJournal() {
  const rows = journalItems.length
    ? journalItems
        .map((item) => {
          const who = item.role ? escapeHtml(item.role) : "система";
          return `
            <article class="${escapeHtml(item.kind)}">
              <header><span>${who} · ${escapeHtml(item.kind)}</span><time>${escapeHtml(item.at)}</time></header>
              <p>${escapeHtml(item.text)}</p>
            </article>`;
        })
        .join("")
    : '<p class="empty">Здесь будут сообщения группы и ответы ролей.</p>';
  view.innerHTML = `<section class="panel"><h2>Журнал</h2><div class="log" id="log">${rows}</div></section>`;
  const log = document.querySelector("#log");
  if (log) log.scrollTop = log.scrollHeight;
}

function openEditor(title, fields, onSubmit, onDelete) {
  editorForm.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    ${fields}
    <div class="form-actions">
      <div>${onDelete ? '<button class="danger" type="button" id="delete-entity">Удалить</button>' : ""}</div>
      <div class="row">
        <button type="button" id="cancel-editor">Закрыть</button>
        <button class="primary" type="submit">Сохранить</button>
      </div>
    </div>`;
  editor.showModal();
  editorForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await onSubmit(new FormData(editorForm));
      editor.close();
      await load();
    } catch (error) {
      alert(error.message);
    }
  };
  editorForm.querySelector("#cancel-editor").onclick = () => editor.close();
  const remove = editorForm.querySelector("#delete-entity");
  if (remove) {
    remove.onclick = async () => {
      try {
        await onDelete();
        editor.close();
        await load();
      } catch (error) {
        alert(error.message);
      }
    };
  }
}

function roleFields(role) {
  const checks = state.skills
    .map((skill) => {
      const checked = (role.skill_ids || []).includes(skill.id) ? "checked" : "";
      return `<label><input type="checkbox" name="skill" value="${skill.id}" ${checked}> ${escapeHtml(skill.name)}</label>`;
    })
    .join("");
  return `
    <label>Название<input name="name" required value="${escapeHtml(role.name || "")}"></label>
    <label>Что делает эта роль<textarea name="description">${escapeHtml(role.description || "")}</textarea></label>
    <p class="hint">Токен бота на публичную страницу не вводится, не сохраняется и не отправляется.</p>
    <label>Скиллы</label>
    <div class="checks">${checks || "<span class=\"hint\">Сначала создайте скилл</span>"}</div>
    <label><input type="checkbox" name="enabled" ${role.enabled === false ? "" : "checked"}> Роль включена</label>
    <label><input type="checkbox" name="allow_tools" ${role.allow_tools ? "checked" : ""}> Разрешить агенту Cursor менять файлы в своей папке</label>
    <p class="hint">Проверка бота доступна только в локальном приложении.</p>`;
}

function editRole(role) {
  openEditor(role.id ? role.name : "Новая роль", roleFields(role), async (form) => {
    const payload = {
      name: form.get("name"),
      description: form.get("description"),
      enabled: form.get("enabled") === "on",
      allow_tools: form.get("allow_tools") === "on",
      skill_ids: form.getAll("skill"),
    };
    if (String(form.get("bot_token") || "").trim()) {
      throw new Error("Публичная страница не принимает токены ботов и не отправляет их в интернет.");
    }
    if (role.id) await api("PUT", `/api/roles/${role.id}`, payload);
    else await api("POST", "/api/roles", payload);
  }, role.id ? () => api("DELETE", `/api/roles/${role.id}`) : null);
}

function editSkill(skill) {
  openEditor(skill.id ? skill.name : "Новый скилл", `
    <label>Название<input name="name" required value="${escapeHtml(skill.name || "")}"></label>
    <label>Когда применять<input name="description" value="${escapeHtml(skill.description || "")}"></label>
    <label>Инструкция для Cursor<textarea name="body">${escapeHtml(skill.body || "")}</textarea></label>
  `, async (form) => {
    const payload = {
      name: form.get("name"),
      description: form.get("description"),
      body: form.get("body"),
    };
    if (skill.id) await api("PUT", `/api/skills/${skill.id}`, payload);
    else await api("POST", "/api/skills", payload);
  }, skill.id ? () => api("DELETE", `/api/skills/${skill.id}`) : null);
}

async function moveRole(id, direction) {
  const ids = state.roles.slice().sort((a, b) => a.order - b.order).map((role) => role.id);
  const index = ids.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= ids.length) return;
  [ids[index], ids[next]] = [ids[next], ids[index]];
  state = await api("PUT", "/api/roles/order", { ids });
  render();
}

async function load() {
  state = await api("GET", "/api/state");
  render();
}

async function pollJournal() {
  if (tab !== "journal") return;
  try {
    const data = await api("GET", `/api/journal?after=${encodeURIComponent(journalAfter)}`);
    if (data.items?.length) {
      journalItems = journalItems.concat(data.items).slice(-80);
      journalAfter = journalItems[journalItems.length - 1].id;
      if (tab === "journal") renderJournal();
    }
    const fresh = await api("GET", "/api/state");
    if (fresh.running !== state.running) {
      state = fresh;
      render();
    }
  } catch {
    /* the next poll retries */
  }
}

document.querySelector(".tabs").onclick = async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  tab = button.dataset.tab;
  if (tab === "journal" && journalItems.length === 0) {
    const data = await api("GET", "/api/journal");
    journalItems = data.items || [];
    journalAfter = journalItems.at(-1)?.id || "";
  }
  render();
};

view.onclick = (event) => {
  const roleId = event.target.dataset.editRole;
  const skillId = event.target.dataset.editSkill;
  if (roleId) editRole(state.roles.find((role) => role.id === roleId));
  if (skillId) editSkill(state.skills.find((skill) => skill.id === skillId));
  if (event.target.dataset.up) moveRole(event.target.dataset.up, -1);
  if (event.target.dataset.down) moveRole(event.target.dataset.down, 1);
  if (event.target.id === "add-role") editRole({ enabled: true, skill_ids: [] });
  if (event.target.id === "add-skill") editSkill({});
};

view.onchange = () => {};

view.addEventListener("submit", async (event) => {
  if (event.target.id !== "settings-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    model: form.get("model"),
    group_chat_id: form.get("group_chat_id"),
    max_turns: Number(form.get("max_turns")),
    human_wake: form.get("human_wake"),
  };
  if (String(form.get("cursor_api_key") || "").trim()) {
    alert("Публичная страница не принимает ключ Cursor и не отправляет его в интернет.");
    return;
  }
  try {
    state = await api("PUT", "/api/settings", payload);
    render();
  } catch (error) {
    alert(error.message);
  }
});

view.addEventListener("click", async (event) => {
  if (event.target.id !== "check-group") return;
  const box = document.querySelector("#check-result");
  box.innerHTML = "<p class=\"hint\">Проверяю…</p>";
  try {
    const data = await api("POST", "/api/group/check");
    box.innerHTML = `<ul class="list">${data.bots
      .map((item) => `<li>${escapeHtml(item.role)}: ${item.ok ? `видит «${escapeHtml(item.title)}»` : escapeHtml(item.error)}</li>`)
      .join("")}</ul>`;
  } catch (error) {
    box.innerHTML = `<p class="hint">${escapeHtml(error.message)}</p>`;
  }
});

power.onclick = async () => {
  power.disabled = true;
  try {
    state = await api("POST", state.running ? "/api/crew/stop" : "/api/crew/start");
    tab = "journal";
    const data = await api("GET", "/api/journal");
    journalItems = data.items || [];
    journalAfter = journalItems.at(-1)?.id || "";
    render();
  } catch (error) {
    alert(error.message);
  } finally {
    power.disabled = false;
  }
};

load().catch((error) => {
  view.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
});
setInterval(pollJournal, 1500);
