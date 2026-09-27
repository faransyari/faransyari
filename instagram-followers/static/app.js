// Loading overlay for forms that wait on Instagram, and confirm prompts.
document.addEventListener("submit", (event) => {
  const form = event.target;
  const question = form.dataset.confirm;
  if (question && !window.confirm(question)) {
    event.preventDefault();
    return;
  }
  if (form.dataset.loading) {
    document.getElementById("loading-text").textContent = form.dataset.loading;
    document.getElementById("loading").hidden = false;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
  }
});

// Coming back with the browser's back button can restore a page with the overlay up.
window.addEventListener("pageshow", () => {
  document.getElementById("loading").hidden = true;
  document.querySelectorAll("form button").forEach((b) => (b.disabled = false));
});

// Filter the follower list by text, and optionally to new followers only.
const list = document.getElementById("followers");
if (list) {
  const filter = document.getElementById("filter");
  const onlyNew = document.getElementById("only-new");
  const noMatch = document.getElementById("no-match");
  const rows = [...list.children];

  const apply = () => {
    const q = filter.value.trim().toLowerCase();
    const newOnly = onlyNew?.checked;
    let shown = 0;
    for (const row of rows) {
      const visible = (!q || row.dataset.search.includes(q)) && (!newOnly || row.dataset.new === "1");
      row.hidden = !visible;
      if (visible) shown++;
    }
    noMatch.hidden = shown > 0;
  };

  filter.addEventListener("input", apply);
  onlyNew?.addEventListener("change", apply);
}
