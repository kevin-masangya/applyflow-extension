import { isJobPage, readJobFromPage } from "./job-page.js";
const rootId = "applyflow-reminder";
let shownFor = "";
function reminder() {
    let card = document.getElementById(rootId);
    if (card)
        return card;
    card = document.createElement("aside");
    card.id = rootId;
    card.innerHTML = `
    <style>
      #applyflow-reminder {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 280px;
        padding: 14px;
        border-radius: 12px;
        background: #1c1915;
        color: #f4f1ea;
        font: 14px/1.4 "Segoe UI", sans-serif;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      }
      #applyflow-reminder p { margin: 6px 0; }
      #applyflow-reminder .label { font-size: 12px; color: #d9d2c5; }
      #applyflow-reminder .actions { display: flex; gap: 8px; margin-top: 10px; }
      #applyflow-reminder button {
        border: 0;
        border-radius: 8px;
        padding: 8px 10px;
        font: inherit;
        cursor: pointer;
      }
      #applyflow-reminder .open { background: #f4f1ea; color: #1c1915; }
      #applyflow-reminder .hide { background: transparent; color: #f4f1ea; }
    </style>
    <strong>Applyflow</strong>
    <p class="label" id="applyflow-reminder-text"></p>
    <div class="actions">
      <button class="open" type="button">Open and review</button>
      <button class="hide" type="button">Not now</button>
    </div>
  `;
    document.documentElement.appendChild(card);
    card.querySelector(".hide")?.addEventListener("click", () => {
        sessionStorage.setItem(`applyflow-hide:${location.href}`, "1");
        card?.remove();
    });
    card.querySelector(".open")?.addEventListener("click", () => {
        const text = card?.querySelector("#applyflow-reminder-text");
        chrome.runtime.sendMessage({ type: "open-panel" }, (response) => {
            if (!response?.ok && text) {
                text.textContent = "Chrome blocked the auto-open. Click the Applyflow icon in the toolbar.";
            }
        });
    });
    return card;
}
function updateReminder() {
    if (!isJobPage()) {
        document.getElementById(rootId)?.remove();
        shownFor = "";
        chrome.runtime.sendMessage({ type: "job-cleared" });
        return;
    }
    if (sessionStorage.getItem(`applyflow-hide:${location.href}`) === "1")
        return;
    const job = readJobFromPage();
    chrome.runtime.sendMessage({
        type: "job-detected",
        title: job.title,
        company: job.company,
        url: location.href,
    });
    if (!job.title && !job.company)
        return;
    const signature = `${location.href}|${job.title}|${job.company}`;
    if (signature === shownFor && document.getElementById(rootId))
        return;
    shownFor = signature;
    const card = reminder();
    const text = card.querySelector("#applyflow-reminder-text");
    if (text) {
        const detail = [job.title, job.company].filter(Boolean).join(" at ");
        text.textContent = `${detail}. Review it in Applyflow before saving.`;
    }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "read-job")
        return;
    const job = readJobFromPage();
    sendResponse({ url: location.href, title: job.title, company: job.company });
});
updateReminder();
let remindTimer = 0;
const observer = new MutationObserver(() => {
    window.clearTimeout(remindTimer);
    remindTimer = window.setTimeout(updateReminder, 800);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", updateReminder);
