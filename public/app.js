const $ = (id) => document.getElementById(id);

const form = $("searchForm");
const statusEl = $("status");
const resultsEl = $("results");

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    resultsEl.innerHTML = `<div class="muted">No matching jobs found from current free sources. Try a broader role title.</div>`;
    return;
  }

  resultsEl.innerHTML = jobs
    .map((j) => {
      const score = Math.round((j.score ?? 0) * 100);
      const loc = j.location ? escapeHtml(j.location) : "Location not specified";
      const mode = j.workMode ? escapeHtml(j.workMode) : "Work mode not specified";
      const desc = j.snippet ? escapeHtml(j.snippet).slice(0, 240) : "";

      return `
        <article class="job">
          <div class="job-top">
            <div>
              <h3>${escapeHtml(j.title || "Untitled")}</h3>
              <div class="meta">${escapeHtml(j.company || "Company not specified")} • ${loc} • ${mode}</div>
            </div>
            <div class="score">${score}% match</div>
          </div>
          ${desc ? `<p class="snippet">${desc}${desc.length >= 240 ? "…" : ""}</p>` : ""}
          <div class="actions">
            <a class="link" href="${escapeHtml(j.link)}" target="_blank" rel="noreferrer">Open job</a>
          </div>
          <div class="meta" style="margin-top:10px">
            Source: ${escapeHtml(j.source || "unknown")} • Matched on: ${escapeHtml((j.matchedOn || []).join(", "))}
          </div>
        </article>
      `;
    })
    .join("");
}

async function searchJobs(payload) {
  const query = "?" + new URLSearchParams(payload).toString();

  // Netlify Functions commonly live under `/.netlify/functions/<name>`.
  // Some setups also expose them under `/api/<name>`, so we try both.
  const urlsToTry = ["/.netlify/functions/search" + query, "/api/search" + query];

  let lastErr = null;
  for (const u of urlsToTry) {
    try {
      const res = await fetch(u, { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Search failed with status ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("Search failed.");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultsEl.innerHTML = "";
  statusEl.textContent = "Searching…";

  const role = $("role").value.trim();
  const workMode = $("workMode").value;
  const market = $("market").value;
  const fresherOnly = $("fresherOnly").checked ? "true" : "false";
  const skills = $("skills").value.trim();

  try {
    form.querySelector("button[type='submit']").disabled = true;
    const data = await searchJobs({ role, workMode, market, fresherOnly, skills });
    statusEl.textContent = data?.meta?.message || `Found ${data?.jobs?.length ?? 0} jobs`;
    renderJobs(data.jobs);
  } catch (err) {
    statusEl.textContent = "Search error. Try again or use a broader role.";
    resultsEl.innerHTML = `<div style="margin-top:10px" class="muted">${escapeHtml(err?.message || String(err))}</div>`;
    console.error(err);
  } finally {
    form.querySelector("button[type='submit']").disabled = false;
  }
});

