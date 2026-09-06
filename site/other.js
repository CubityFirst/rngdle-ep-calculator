/* --- Other: the legacy tools ------------------------------------------------
   The tools rngdle_solver still renders itself — its EP graph and its /beta lab —
   have no tab here; this gallery lists them, in this site's furniture, and each
   card opens the tool on its own page in the solver's look. The cards are drawn
   from the solver's catalogue (/api/other): the titles, blurbs, marks and
   findings its old /beta index used, copied rather than retyped, so a tool added
   over there shows up here on the next legacy sync.

   The catalogue is fetched once per page load; a failed fetch is reported and
   retried the next time the tab is opened. Everything in it is this site's own
   data (the solver's source, bundled into the same Worker), so the marks go in
   as SVG markup; the text still goes in as textContent, which costs nothing.
   --------------------------------------------------------------------------- */

const otEl = id => document.getElementById(id);
const otNode = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
let otherLoading = null;

function otherStatus(text) {
  otEl("other-status").hidden = !text;
  otEl("other-status-text").textContent = text || "";
}

async function showOther() {
  if (otherLoading) return;
  otherLoading = (async () => {
    otherStatus("Loading the catalogue…");
    try {
      const r = await fetch("/api/other", { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      renderOther(await r.json());
      otherStatus("");
    } catch (e) {
      otherStatus(`The catalogue could not be loaded (${e.message}). The tools are still at /beta/<name> and /chains.`);
      otherLoading = null;     // so the next visit tries again
    }
  })();
}

function renderOther(cat) {
  const cards = otEl("other-cards");
  cards.replaceChildren();
  for (const t of cat.tools) {
    const card = otNode(`
      <a class="ot-card polished-card" href="${t.href}">
        <div class="ot-thumb" aria-hidden="true"><svg viewBox="0 0 64 40" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg></div>
        <div class="ot-body">
          <h3 class="ot-title text-prose"><span></span><em class="ot-kind type-label"></em></h3>
          <p class="ot-blurb type-meta normal-case text-prose-2"></p>
          <div class="ot-note type-meta normal-case text-prose-3"></div>
          <div class="ot-see type-meta normal-case text-prose-3" hidden></div>
        </div>
      </a>`);
    card.querySelector("svg").innerHTML = t.thumb;
    card.querySelector(".ot-title span").textContent = t.title;
    card.querySelector(".ot-kind").textContent = t.kind;
    card.querySelector(".ot-blurb").textContent = t.blurb;
    card.querySelector(".ot-note").textContent = t.note;
    if (t.see && t.see.length) {
      const see = card.querySelector(".ot-see");
      see.hidden = false;
      see.append("See also ");
      t.see.forEach((s, i) => {
        if (i) see.append(", ");
        const b = document.createElement("b");
        b.textContent = s.title;
        see.append(b);
      });
    }
    cards.append(card);
  }
  otEl("other-total").textContent = String(cat.tools.length);

  const finds = otEl("other-findings");
  finds.replaceChildren();
  for (const f of cat.findings) {
    const row = otNode(`
      <div class="ot-find polished-card">
        <b class="text-prose"></b>
        <span class="type-meta normal-case text-prose-2"></span>
        <a class="type-meta normal-case hover:underline" href="${f.href}"></a>
      </div>`);
    row.querySelector("b").textContent = f.head;
    row.querySelector("span").textContent = f.body;
    row.querySelector("a").textContent = `${f.title} →`;
    finds.append(row);
  }
  otEl("other-tools").hidden = false;
  otEl("other-insights").hidden = !cat.findings.length;
}

// showView (ep.js) calls showOther() when the tab is opened; ep.js has already
// routed by the time this file runs, so a cold load of /other starts itself.
if (!document.getElementById("view-other").hidden) showOther();
