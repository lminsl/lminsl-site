// Date tabs without a page reload. Every tab is a real link, so this is optional:
// without JavaScript (or on any error) the browser simply follows the link.
(() => {
  const nav = () => document.querySelector(".archive-nav");
  const cache = new Map();

  function setActive(href) {
    for (const a of nav().querySelectorAll("a")) {
      const on = a.getAttribute("href") === href;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
  }

  function revealActive() {
    const a = nav()?.querySelector("a.active");
    if (a) a.scrollIntoView({ block: "nearest", inline: "center" });
  }

  async function load(href, push) {
    const current = document.getElementById("edition");
    current.classList.add("loading");
    try {
      let html = cache.get(href);
      if (!html) {
        const res = await fetch(href, { credentials: "same-origin" });
        if (!res.ok) throw new Error(res.status);
        html = await res.text();
        cache.set(href, html);
      }
      const doc = new DOMParser().parseFromString(html, "text/html");
      const next = doc.getElementById("edition");
      if (!next) throw new Error("no edition");
      current.replaceWith(next);
      document.title = doc.title;
      const notice = document.querySelector(".run-notice");
      if (notice) notice.hidden = href !== "./";
      setActive(href);
      if (push) history.pushState({ href }, "", href);
      window.scrollTo({ top: 0 });
    } catch {
      location.href = href;
    }
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest(".archive-nav a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    load(a.getAttribute("href"), true);
  });

  window.addEventListener("popstate", () => {
    const file = location.pathname.split("/").pop();
    load(/^\d{4}-\d{2}-\d{2}\.html$/.test(file) ? file : "./", false);
  });

  history.replaceState({ href: location.href }, "");
  revealActive();
})();
