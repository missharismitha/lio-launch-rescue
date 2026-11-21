"use strict";

(function () {
  const form = document.querySelector("form");
  if (!form) return;
  const input = form.querySelector("input");
  let msg = document.getElementById("error") || form.querySelector("[role=alert]");
  if (!msg) {
    msg = document.createElement("p");
    msg.id = "error";
    msg.className = "login-error";
    msg.setAttribute("role", "alert");
    form.append(msg);
  }
  let busy = false;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy || !input) return;
    busy = true;
    msg.textContent = "";
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input.value }),
      });
      if (res.ok) { window.location.href = "/"; return; }
      msg.textContent = res.status === 429 ? "Too many tries. Wait a few minutes." : res.status === 401 ? "That code is wrong." : "Something went wrong. Try again.";
      input.select();
    } catch (e) {
      msg.textContent = "Can't reach the service.";
    }
    busy = false;
  });
})();
