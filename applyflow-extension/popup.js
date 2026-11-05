import { readJobFromPage } from "./job-page.js";
function required(selector) {
    const node = document.querySelector(selector);
    if (!node)
        throw new Error(`Popup markup is missing ${selector}`);
    return node;
}
const form = required("#track");
const companyInput = required("#company");
const titleInput = required("#title");
const urlInput = required("#url");
const notesInput = required("#notes");
const message = required("#message");
const readButton = required("#read");
const connectSection = required("#connect");
const connectingSection = required("#connecting");
const failedSection = required("#failed");
const expiredSection = required("#expired");
const sessionSection = required("#session");
const connectButton = required("#connect-button");
const createAccountButton = required("#create-account");
const retryButton = required("#retry");
const reconnectButton = required("#reconnect");
const disconnectButton = required("#disconnect");
const failedMessage = required("#failed-message");
const accountName = required("#account-name");
const accountStatus = required("#account-status");
const submitButton = required("#save");
const companyField = companyInput;
const titleField = titleInput;
const urlField = urlInput;
const messageField = message;
let filledUrl = "";
function applyJob(url, title, company) {
    const urlChanged = url !== filledUrl;
    urlField.value = url;
    if (urlChanged) {
        titleField.value = title;
        companyField.value = company;
    }
    else {
        if (title)
            titleField.value = title;
        if (company)
            companyField.value = company;
    }
    filledUrl = url;
    if (title || company) {
        messageField.textContent = "Check the company and title, then click Track application.";
    }
    else {
        messageField.textContent = "The job URL is filled. This page did not include a title or company yet.";
    }
    void markSaved(url);
}
async function markSaved(url) {
    if (!/^https?:\/\//.test(url)) {
        submitButton.disabled = false;
        return;
    }
    try {
        const result = await send({ type: "lookup-application", url });
        if (result?.found) {
            messageField.textContent = "This job is already in Applyflow.";
            submitButton.disabled = true;
            return;
        }
    }
    catch {
        // The API still rejects a duplicate if this check cannot run.
    }
    submitButton.disabled = false;
}
async function fillFromActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
        messageField.textContent = "Open a job page, then click Read this page.";
        return;
    }
    urlField.value = tab.url;
    const fromPage = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: "read-job" }, (response) => {
            if (chrome.runtime.lastError || !response) {
                resolve(null);
                return;
            }
            resolve(response);
        });
    });
    if (fromPage?.url) {
        applyJob(fromPage.url, fromPage.title ?? "", fromPage.company ?? "");
        return;
    }
    try {
        const [injection] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: readJobFromPage,
        });
        const job = injection?.result;
        applyJob(tab.url, job?.title ?? "", job?.company ?? "");
    }
    catch {
        urlField.value = tab.url;
        messageField.textContent = "The job URL is filled. Refresh the job page, then click Read this page.";
    }
}
function sessionVisible() {
    return !sessionSection.hidden;
}
chrome.tabs.onActivated.addListener(() => {
    if (sessionVisible())
        void fillFromActiveTab();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (!sessionVisible())
        return;
    if (changeInfo.url || changeInfo.status === "complete")
        void fillFromActiveTab();
});
readButton.addEventListener("click", () => {
    void fillFromActiveTab();
});
function send(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            const reason = chrome.runtime.lastError?.message;
            if (reason) {
                reject(new Error(reason));
                return;
            }
            resolve(response);
        });
    });
}
function showState(state) {
    connectSection.hidden = state !== "disconnected";
    connectingSection.hidden = state !== "connecting";
    failedSection.hidden = state !== "failed";
    expiredSection.hidden = state !== "expired";
    sessionSection.hidden = state !== "connected";
    connectButton.disabled = state === "connecting";
    retryButton.disabled = state === "connecting";
    reconnectButton.disabled = state === "connecting";
}
function applyAuth(result) {
    if (result.status === "connected") {
        accountName.textContent = result.email || result.name || "Connected account";
        accountStatus.textContent = "Connected";
        showState("connected");
        void fillFromActiveTab();
        return;
    }
    if (result.status === "expired") {
        showState("expired");
        return;
    }
    if (result.status === "failed") {
        failedMessage.textContent = result.message || "Could not connect your account.";
        showState("failed");
        return;
    }
    showState("disconnected");
}
async function connect() {
    showState("connecting");
    messageField.textContent = "";
    try {
        applyAuth(await send({ type: "auth-connect" }));
    }
    catch {
        failedMessage.textContent = "Could not connect your account.";
        showState("failed");
    }
}
connectButton.addEventListener("click", () => {
    void connect();
});
retryButton.addEventListener("click", () => {
    void connect();
});
reconnectButton.addEventListener("click", () => {
    void connect();
});
createAccountButton.addEventListener("click", () => {
    void send({ type: "open-signup" });
});
disconnectButton.addEventListener("click", () => {
    const confirmed = window.confirm("Disconnect this extension from your Applyflow account? Your Applyflow account stays active.");
    if (!confirmed)
        return;
    void send({ type: "auth-disconnect" })
        .then(() => {
        showState("disconnected");
        messageField.textContent = "Disconnected.";
    })
        .catch(() => {
        messageField.textContent = "Could not disconnect. Try again.";
    });
});
function readDraft() {
    return {
        company: companyField.value,
        title: titleField.value,
        url: urlField.value,
        notes: notesInput.value,
    };
}
function writeDraft(draft) {
    companyField.value = draft.company;
    titleField.value = draft.title;
    urlField.value = draft.url;
    notesInput.value = draft.notes;
}
function clearDraft() {
    writeDraft({ company: "", title: "", url: "", notes: "" });
    filledUrl = "";
    submitButton.disabled = false;
}
function draftProblem(draft) {
    if (draft.company.trim() === "" || draft.company.trim().length > 200)
        return "Enter a company name.";
    if (draft.title.trim() === "" || draft.title.trim().length > 200)
        return "Enter a job title.";
    try {
        const url = new URL(draft.url.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return "Use an http or https job link.";
    }
    catch {
        return "Enter a full job link, starting with https://.";
    }
    if (draft.notes.length > 5000)
        return "Notes are too long.";
    return null;
}
form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = readDraft();
    const problem = draftProblem(draft);
    if (problem) {
        messageField.textContent = problem;
        return;
    }
    messageField.textContent = "Saving...";
    try {
        const result = await send({ type: "save-application", ...draft });
        if (result.ok) {
            clearDraft();
            messageField.textContent = result.message || "Tracked as saved.";
            return;
        }
        writeDraft(draft);
        if (result.status === "expired") {
            showState("expired");
            messageField.textContent = "Sign in again. Your job draft is still here.";
            return;
        }
        if (result.status === "disconnected") {
            showState("disconnected");
            messageField.textContent = "Connect your account first. Your job draft is still here.";
            return;
        }
        messageField.textContent = result.message || "Could not save this application. Your draft is still here.";
    }
    catch {
        writeDraft(draft);
        messageField.textContent = "Could not reach Applyflow. Your draft is still here.";
    }
});
void send({ type: "auth-status" })
    .then((result) => {
    applyAuth(result);
})
    .catch(() => {
    showState("disconnected");
});
