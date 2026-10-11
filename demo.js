(() => {
  const STORAGE_KEY = "telegram-crew-public-demo-v1";
  const SECRET_FIELDS = new Set([
    "bot_token",
    "cursor_api_key",
    "api_key",
    "token",
    "password",
    "secret",
    "authorization",
    "access_token",
  ]);
  const SECRET_VALUE = /\b(?:\d{8,}:[A-Za-z0-9_-]{20,}|cursor_[A-Za-z0-9_-]{8,}|(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_]{8,})\b/;
  const BLOCKED = "Публичная страница не подключается к Telegram и Cursor. Ключи и токены не принимаются и не отправляются.";

  function tainted(value) {
    const blob = JSON.stringify(value);
    if (SECRET_VALUE.test(blob)) return true;
    return blobIncludesSecretField(value);
  }

  function blobIncludesSecretField(value, depth = 0) {
    if (depth > 8 || value == null) return false;
    if (Array.isArray(value)) return value.some((item) => blobIncludesSecretField(item, depth + 1));
    if (typeof value !== "object") return false;
    return Object.entries(value).some(([key, item]) => {
      if (SECRET_FIELDS.has(key) && String(item ?? "").trim()) return true;
      return blobIncludesSecretField(item, depth + 1);
    });
  }

  function freshState() {
    const seed = window.TELEGRAM_CREW_SEED || { roles: [], skills: [] };
    return {
      settings: {
        model: "composer-2.5",
        group_chat_id: "",
        max_turns: 4,
        human_wake: "lead",
      },
      roles: (seed.roles || []).map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description || "",
        enabled: true,
        skill_ids: Array.isArray(role.skill_ids) ? role.skill_ids.slice() : [],
        allow_tools: false,
        order: role.order || 0,
      })),
      skills: (seed.skills || []).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description || "",
        body: skill.body || "",
      })),
      journal: [],
    };
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw || tainted(JSON.parse(raw))) {
        window.localStorage.removeItem(STORAGE_KEY);
        return freshState();
      }
      const saved = JSON.parse(raw);
      const base = freshState();
      base.settings = { ...base.settings, ...(saved.settings || {}) };
      delete base.settings.cursor_api_key;
      delete base.settings.api_key;
      if (Array.isArray(saved.roles) && saved.roles.length) base.roles = saved.roles;
      if (Array.isArray(saved.skills)) base.skills = saved.skills;
      if (tainted(base)) return freshState();
      return base;
    } catch {
      return freshState();
    }
  }

  let state = loadState();

  function persist() {
    const copy = JSON.parse(JSON.stringify(state));
    if (tainted(copy)) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch {
      /* the demo still works for this visit */
    }
  }

  function publish() {
    return {
      settings: {
        model: state.settings.model || "composer-2.5",
        group_chat_id: state.settings.group_chat_id || "",
        max_turns: state.settings.max_turns || 4,
        human_wake: state.settings.human_wake || "lead",
        has_api_key: false,
        api_key_hint: "",
      },
      roles: state.roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description || "",
        enabled: role.enabled !== false,
        skill_ids: role.skill_ids || [],
        allow_tools: Boolean(role.allow_tools),
        order: role.order || 0,
        bot_username: "",
        bot_user_id: null,
        bot_token: "",
        has_token: false,
        token_hint: "",
      })),
      skills: state.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description || "",
        body: skill.body || "",
      })),
      running: false,
      data_dir: "локальное приложение, не этот сайт",
      workspace_dir: "локальное приложение, не этот сайт",
    };
  }

  function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function uid() {
    return Math.random().toString(16).slice(2, 14);
  }

  function updateSettings(patch) {
    if (patch.model && String(patch.model).trim()) state.settings.model = String(patch.model).trim();
    if ("group_chat_id" in patch) state.settings.group_chat_id = String(patch.group_chat_id || "").trim();
    if ("max_turns" in patch) state.settings.max_turns = Math.max(1, Math.min(12, Number(patch.max_turns) || 1));
    if (["lead", "mentioned", "all"].includes(patch.human_wake)) state.settings.human_wake = patch.human_wake;
  }

  function applyRole(role, payload) {
    if ("name" in payload) {
      const name = String(payload.name || "").trim();
      if (!name) fail("У роли должно быть имя");
      role.name = name;
    }
    if ("description" in payload) role.description = String(payload.description || "").trim();
    if ("enabled" in payload) role.enabled = Boolean(payload.enabled);
    if ("allow_tools" in payload) role.allow_tools = Boolean(payload.allow_tools);
    if ("skill_ids" in payload) {
      const known = new Set(state.skills.map((skill) => skill.id));
      role.skill_ids = (payload.skill_ids || []).filter((id) => known.has(id));
    }
  }

  function upsertRole(payload, roleId) {
    if (!roleId) {
      const role = {
        id: uid(),
        name: "Новая роль",
        description: "",
        enabled: true,
        skill_ids: [],
        allow_tools: false,
        order: state.roles.length,
      };
      applyRole(role, payload);
      state.roles.push(role);
      return;
    }
    const role = state.roles.find((item) => item.id === roleId);
    if (!role) fail("Не найдено", 404);
    applyRole(role, payload);
  }

  function upsertSkill(payload, skillId) {
    if (!skillId) {
      const skill = {
        id: uid(),
        name: String(payload.name || "Новый скилл").trim() || "Новый скилл",
        description: "",
        body: "",
      };
      state.skills.push(skill);
      applySkill(skill, payload);
      return;
    }
    const skill = state.skills.find((item) => item.id === skillId);
    if (!skill) fail("Не найдено", 404);
    applySkill(skill, payload);
  }

  function applySkill(skill, payload) {
    if ("name" in payload) {
      const name = String(payload.name || "").trim();
      if (!name) fail("У скилла должно быть имя");
      skill.name = name;
    }
    if ("description" in payload) skill.description = String(payload.description || "").trim();
    if ("body" in payload) skill.body = String(payload.body || "").trim();
  }

  function handle(method, pathname, params, body) {
    if (body && tainted(body)) fail("Публичная страница не принимает ключи и токены и не отправляет их в интернет.");
    const parts = pathname.split("/").filter(Boolean);
    if (method === "GET" && parts.join("/") === "api/state") return publish();
    if (method === "GET" && parts.join("/") === "api/journal") {
      const after = params.get("after") || "";
      const items = state.journal || [];
      if (!after) return { items: items.slice(-80) };
      const index = items.findIndex((item) => item.id === after);
      return { items: index < 0 ? items.slice(-80) : items.slice(index + 1) };
    }
    if (method === "POST" && (parts.join("/") === "api/crew/start" || parts.join("/") === "api/crew/stop" || parts.join("/") === "api/group/check")) {
      fail(BLOCKED);
    }
    if (method === "POST" && parts[0] === "api" && parts[1] === "roles" && parts[3] === "test") fail(BLOCKED);
    if (method === "PUT" && parts.join("/") === "api/settings") {
      updateSettings(body || {});
      persist();
      return publish();
    }
    if (method === "POST" && parts.join("/") === "api/roles") {
      upsertRole(body || {}, null);
      persist();
      return publish();
    }
    if (method === "PUT" && parts.join("/") === "api/roles/order") {
      const ids = (body && body.ids) || [];
      if (!Array.isArray(ids)) fail("Нужен список id");
      const byId = Object.fromEntries(state.roles.map((role) => [role.id, role]));
      const ordered = [];
      ids.forEach((id) => {
        const role = byId[id];
        if (!role) return;
        delete byId[id];
        role.order = ordered.length;
        ordered.push(role);
      });
      Object.values(byId).forEach((role) => {
        role.order = ordered.length;
        ordered.push(role);
      });
      state.roles = ordered;
      persist();
      return publish();
    }
    if (parts[0] === "api" && parts[1] === "roles" && parts.length === 3) {
      if (method === "PUT") upsertRole(body || {}, parts[2]);
      else if (method === "DELETE") state.roles = state.roles.filter((role) => role.id !== parts[2]);
      else fail("Не найдено", 404);
      persist();
      return publish();
    }
    if (method === "POST" && parts.join("/") === "api/skills") {
      upsertSkill(body || {}, null);
      persist();
      return publish();
    }
    if (parts[0] === "api" && parts[1] === "skills" && parts.length === 3) {
      if (method === "PUT") upsertSkill(body || {}, parts[2]);
      else if (method === "DELETE") {
        state.skills = state.skills.filter((skill) => skill.id !== parts[2]);
        state.roles.forEach((role) => {
          role.skill_ids = (role.skill_ids || []).filter((id) => id !== parts[2]);
        });
      } else fail("Не найдено", 404);
      persist();
      return publish();
    }
    fail("Не найдено", 404);
  }

  function json(status, payload) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" ? input : (input && input.url) || "";
    let url;
    try {
      url = new URL(raw, window.location.origin);
    } catch {
      return json(400, { error: "Запрос отклонён" });
    }
    if (url.origin !== window.location.origin) {
      return json(400, { error: "Внешние запросы с этой страницы отключены" });
    }
    if (!url.pathname.startsWith("/api")) return nativeFetch(input, init);
    let body = null;
    if (init && init.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        return json(400, { error: "Некорректный JSON" });
      }
    }
    try {
      const method = String((init && init.method) || "GET").toUpperCase();
      return json(200, handle(method, url.pathname, url.searchParams, body));
    } catch (error) {
      return json(error.status || 400, { error: error.message || "Запрос не выполнился" });
    }
  };

  window.__TELEGRAM_CREW_OFFLINE__ = true;
})();
