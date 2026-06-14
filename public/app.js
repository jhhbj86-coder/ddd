const $ = (s) => document.querySelector(s);
let token = localStorage.getItem("couple-token") || "";
let authed = false;
let memories = [];
const prompts = ["今晚互相发一张最喜欢的旧照片。", "选一张照片，复刻同款姿势。", "把今天想感谢对方的一件小事写下来。"];
$("#prompt").textContent = prompts[0];

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function fmt(d) {
  return d ? new Date(d.includes("T") ? d : `${d}T00:00`).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: d.includes("T") ? "short" : undefined }) : "";
}

function left(t) {
  const ms = new Date(t) - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 36e5);
  const m = Math.floor((abs % 36e5) / 6e4);
  return ms >= 0 ? `还剩 ${h}小时${m}分` : `已到 ${h}小时${m}分`;
}

function render() {
  $("#mode").textContent = authed ? "专属模式" : "游客模式";
  $("#logout").hidden = !authed;
  $("#login").hidden = authed;
  $("#studio").hidden = !authed;
  $("#listTitle").textContent = authed ? "记忆星图" : "公开窗口";
  const priv = memories.filter((m) => m.visibility === "private").length;
  const pub = memories.filter((m) => m.visibility === "public").length;
  $("#stats").innerHTML = `<span>${memories.length} 张照片</span><span>${priv} 私密</span><span>${pub} 公开</span>`;
  $("#memories").innerHTML = memories.length ? memories.map(card).join("") : `<div class="empty">还没有照片</div>`;
}

function card(m) {
  const reminder = m.reminder?.enabled ? `<div class="timer">${m.reminder.text || "提醒"} · ${m.reminder.doneAt ? "已完成" : left(m.reminder.remindAt)} ${authed && !m.reminder.doneAt ? `<button onclick="done('${m.id}')">完成</button>` : ""}</div>` : "";
  const reactions = authed ? `<div class="reactions">${(m.reactions || []).map((r) => `<p><b>${r.author}</b> ${r.mood} ${r.text}</p>`).join("")}<div class="comment"><input id="c-${m.id}" placeholder="点评一句"><button onclick="comment('${m.id}')">发送</button></div></div>` : "";
  return `<article class="card"><img src="${m.image.url}" alt=""><div class="body"><div class="row"><h3>${m.title || "没有标题的瞬间"}</h3><span>${m.visibility === "public" ? "公开" : "私密"}</span></div><small>${fmt(m.date)}</small><p>${m.note || ""}</p>${reminder}${authed ? `<button onclick="toggle('${m.id}','${m.visibility}')">${m.visibility === "public" ? "设为私密" : "设为公开"}</button>` : ""}${reactions}</div></article>`;
}

async function load() {
  const s = await api("/api/session");
  authed = s.authenticated;
  memories = (await api("/api/memories")).memories;
  render();
}

$("#login").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    token = data.token;
    localStorage.setItem("couple-token", token);
    await load();
  } catch (err) { $("#notice").textContent = err.message; }
});

$("#logout").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem("couple-token");
  token = "";
  await load();
};

$("#upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = new FormData(e.target);
  body.set("reminderEnabled", e.target.reminderEnabled.checked ? "true" : "false");
  await api("/api/memories", { method: "POST", body });
  e.target.reset();
  await load();
});

window.toggle = async (id, v) => { await api(`/api/memories/${id}`, { method: "PATCH", body: JSON.stringify({ visibility: v === "public" ? "private" : "public" }) }); await load(); };
window.comment = async (id) => { const input = $(`#c-${id}`); await api(`/api/memories/${id}/reactions`, { method: "POST", body: JSON.stringify({ author: "TA", text: input.value, mood: "看过" }) }); await load(); };
window.done = async (id) => { await api(`/api/memories/${id}/reminder/done`, { method: "PATCH" }); await load(); };
$("#nextPrompt").onclick = () => $("#prompt").textContent = prompts[Math.floor(Math.random() * prompts.length)];
setInterval(render, 60000);
load().catch((e) => $("#notice").textContent = e.message);
