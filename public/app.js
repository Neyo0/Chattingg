const authScreen = document.getElementById("authScreen");
const chatScreen = document.getElementById("chatScreen");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showLoginBtn = document.getElementById("showLoginBtn");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const userList = document.getElementById("userList");
const chatHeader = document.getElementById("chatHeader");
const messagesEl = document.getElementById("messages");
const composerForm = document.getElementById("composerForm");
const messageInput = document.getElementById("messageInput");
const mediaInput = document.getElementById("mediaInput");
const meName = document.getElementById("meName");
const meAbout = document.getElementById("meAbout");
const logoutBtn = document.getElementById("logoutBtn");
const toast = document.getElementById("toast");

const state = {
  token: null,
  me: null,
  users: [],
  selectedUser: null,
  messagesByPeer: new Map(),
  socket: null
};

const TOKEN_KEY = "timeless_chat_token";

function setTab(mode) {
  const loginMode = mode === "login";
  showLoginBtn.classList.toggle("active", loginMode);
  showRegisterBtn.classList.toggle("active", !loginMode);
  loginForm.classList.toggle("hidden", !loginMode);
  registerForm.classList.toggle("hidden", loginMode);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden", "error");
  if (isError) toast.classList.add("error");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 2800);
}

function parseError(data, fallback) {
  if (data && data.error) return data.error;
  return fallback;
}

async function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: options.headers || {}
  };

  if (state.token) {
    config.headers.Authorization = `Bearer ${state.token}`;
  }

  if (options.body instanceof FormData) {
    config.body = options.body;
  } else if (options.body) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, config);
  let data = null;

  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }

  if (!response.ok) {
    throw new Error(parseError(data, "Request failed"));
  }

  return data;
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function getPeerId(message) {
  return message.senderId === state.me.id ? message.recipientId : message.senderId;
}

function addMessage(message) {
  if (!message || !message.id || !state.me) return;
  const peerId = getPeerId(message);
  const list = state.messagesByPeer.get(peerId) || [];
  if (list.some((existing) => existing.id === message.id)) {
    return;
  }
  list.push(message);
  state.messagesByPeer.set(peerId, list);
}

function formatTime(ts) {
  const normalized = String(ts || "").replace(" ", "T");
  const date = new Date(`${normalized}Z`);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createMediaNode(message) {
  if (message.type === "image") {
    const img = document.createElement("img");
    img.src = message.content;
    img.alt = "Shared image";
    img.loading = "lazy";
    return img;
  }

  if (message.type === "video") {
    const video = document.createElement("video");
    video.src = message.content;
    video.controls = true;
    video.preload = "metadata";
    return video;
  }

  const paragraph = document.createElement("p");
  paragraph.textContent = message.content;
  return paragraph;
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (!state.selectedUser) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Select a conversation to start chatting.";
    messagesEl.appendChild(p);
    return;
  }

  const list = state.messagesByPeer.get(state.selectedUser.id) || [];

  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No messages yet. Say hello.";
    messagesEl.appendChild(p);
    return;
  }

  list.forEach((message) => {
    const item = document.createElement("article");
    item.className = `message ${
      message.senderId === state.me.id ? "outgoing" : "incoming"
    }`;

    item.appendChild(createMediaNode(message));

    const time = document.createElement("small");
    time.className = "message-time";
    time.textContent = formatTime(message.createdAt);
    item.appendChild(time);

    messagesEl.appendChild(item);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderUsers() {
  userList.innerHTML = "";

  if (state.users.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No other users yet. Invite someone to register.";
    userList.appendChild(empty);
    return;
  }

  state.users.forEach((user) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "user-item";
    if (state.selectedUser && state.selectedUser.id === user.id) {
      btn.classList.add("active");
    }

    const name = document.createElement("strong");
    name.textContent = user.displayName;
    btn.appendChild(name);

    const about = document.createElement("span");
    about.textContent = user.about || `@${user.username}`;
    btn.appendChild(about);

    btn.addEventListener("click", () => {
      selectUser(user.id);
    });

    li.appendChild(btn);
    userList.appendChild(li);
  });
}

function setComposerEnabled(enabled) {
  messageInput.disabled = !enabled;
  mediaInput.disabled = !enabled;
}

async function loadUsers() {
  const { users } = await api("/api/users");
  state.users = users;
  renderUsers();

  if (state.users.length === 0) {
    state.selectedUser = null;
    chatHeader.textContent = "No available contacts";
    setComposerEnabled(false);
    renderMessages();
    return;
  }

  const stillExists =
    state.selectedUser && state.users.some((candidate) => candidate.id === state.selectedUser.id);
  if (!stillExists) {
    state.selectedUser = state.users[0];
  }

  await selectUser(state.selectedUser.id);
}

async function loadMessages(peerId) {
  const { messages } = await api(`/api/messages/${peerId}`);
  state.messagesByPeer.set(peerId, messages);
}

async function selectUser(userId) {
  const user = state.users.find((candidate) => candidate.id === userId);
  if (!user) return;
  state.selectedUser = user;
  chatHeader.textContent = `${user.displayName} (${user.username})`;
  setComposerEnabled(true);
  renderUsers();
  await loadMessages(userId);
  renderMessages();
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  state.socket = io({
    auth: {
      token: state.token
    }
  });

  state.socket.on("message:new", (message) => {
    addMessage(message);
    if (state.selectedUser && getPeerId(message) === state.selectedUser.id) {
      renderMessages();
    }
  });

  state.socket.on("connect_error", () => {
    showToast("Realtime connection failed", true);
  });
}

function enterChat() {
  authScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  meName.textContent = state.me.displayName;
  meAbout.textContent = state.me.about || `@${state.me.username}`;
  setComposerEnabled(false);
  loadUsers().catch((err) => {
    showToast(err.message, true);
  });
  connectSocket();
}

function leaveChat() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  state.token = null;
  state.me = null;
  state.users = [];
  state.selectedUser = null;
  state.messagesByPeer.clear();

  clearToken();
  authScreen.classList.remove("hidden");
  chatScreen.classList.add("hidden");
  renderUsers();
  renderMessages();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  const payload = {
    username: String(form.get("username") || "").trim(),
    password: String(form.get("password") || "")
  };

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: payload
    });

    state.token = data.token;
    state.me = data.user;
    saveToken(state.token);
    enterChat();
    showToast(`Welcome back, ${state.me.displayName}`);
    loginForm.reset();
  } catch (err) {
    showToast(err.message, true);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(registerForm);
  const payload = {
    displayName: String(form.get("displayName") || "").trim(),
    username: String(form.get("username") || "").trim(),
    password: String(form.get("password") || ""),
    about: String(form.get("about") || "").trim()
  };

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: payload
    });
    state.token = data.token;
    state.me = data.user;
    saveToken(state.token);
    enterChat();
    showToast(`Account created. Hi ${state.me.displayName}`);
    registerForm.reset();
  } catch (err) {
    showToast(err.message, true);
  }
});

composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedUser) {
    showToast("Select a user first", true);
    return;
  }

  const text = messageInput.value.trim();
  if (!text) return;

  try {
    const { message } = await api("/api/messages", {
      method: "POST",
      body: {
        recipientId: state.selectedUser.id,
        text
      }
    });
    addMessage(message);
    renderMessages();
    messageInput.value = "";
  } catch (err) {
    showToast(err.message, true);
  }
});

mediaInput.addEventListener("change", async () => {
  if (!state.selectedUser) {
    showToast("Select a user first", true);
    mediaInput.value = "";
    return;
  }

  const file = mediaInput.files[0];
  if (!file) return;

  const body = new FormData();
  body.append("recipientId", String(state.selectedUser.id));
  body.append("media", file);

  try {
    const { message } = await api("/api/messages/media", {
      method: "POST",
      body
    });
    addMessage(message);
    renderMessages();
    showToast("Media sent");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    mediaInput.value = "";
  }
});

showLoginBtn.addEventListener("click", () => setTab("login"));
showRegisterBtn.addEventListener("click", () => setTab("register"));
logoutBtn.addEventListener("click", leaveChat);

async function tryRestoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  state.token = token;
  try {
    const { user } = await api("/api/auth/me");
    state.me = user;
    enterChat();
    showToast(`Welcome back, ${user.displayName}`);
  } catch (err) {
    leaveChat();
  }
}

setTab("login");
tryRestoreSession();
