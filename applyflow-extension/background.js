import { API_URL, OAUTH_CLIENT_ID, OAUTH_SCOPE, WEB_ORIGIN } from "./config.js";
import { connectionMessage, exchangeAuthorizationCode, pkceChallenge, publicSaveError, randomUrlSafe, readAuthResponse, refreshAuthorization, revokeAuthorization, } from "./oauth-logic.js";
const SESSION_KEY = "applyflow_extension_session";
chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    void protectStorage();
});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
void protectStorage();
async function protectStorage() {
    try {
        await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
    catch {
        // Tokens stay out of message responses either way.
    }
    await chrome.storage.local.remove("applyflow_token");
}
async function readSession() {
    const stored = await chrome.storage.local.get(SESSION_KEY);
    const value = stored[SESSION_KEY];
    if (!value || typeof value !== "object")
        return null;
    const session = value;
    if (typeof session.refreshToken !== "string" || typeof session.accessToken !== "string")
        return null;
    if (typeof session.accessExpiresAt !== "number")
        return null;
    return {
        refreshToken: session.refreshToken,
        accessToken: session.accessToken,
        accessExpiresAt: session.accessExpiresAt,
        email: typeof session.email === "string" ? session.email : "",
        name: typeof session.name === "string" ? session.name : "",
    };
}
async function writeSession(session) {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
}
async function clearSession() {
    await chrome.storage.local.remove(SESSION_KEY);
}
function extensionPage(sender) {
    if (sender.id !== chrome.runtime.id || sender.tab)
        return false;
    const own = `chrome-extension://${chrome.runtime.id}`;
    const url = sender.url ?? "";
    if (url.startsWith(`${own}/`))
        return true;
    if (sender.origin === own)
        return true;
    return url === "";
}
let pendingConnect = null;
function connectAccount() {
    if (pendingConnect)
        return pendingConnect;
    pendingConnect = runConnect().finally(() => {
        pendingConnect = null;
    });
    return pendingConnect;
}
async function runConnect() {
    const redirectUri = chrome.identity.getRedirectURL();
    const state = randomUrlSafe();
    const verifier = randomUrlSafe();
    const challenge = await pkceChallenge(verifier);
    let redirectUrl = "";
    try {
        const url = new URL("/oauth/authorize", WEB_ORIGIN);
        url.searchParams.set("client_id", OAUTH_CLIENT_ID);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("state", state);
        url.searchParams.set("scope", OAUTH_SCOPE);
        redirectUrl = (await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true })) ?? "";
    }
    catch {
        return { status: "failed", message: connectionMessage("network") };
    }
    if (!redirectUrl)
        return { status: "failed", message: connectionMessage("closed") };
    const parsed = readAuthResponse(redirectUrl, state);
    if ("error" in parsed)
        return { status: "failed", message: connectionMessage(parsed.error) };
    const tokens = await exchangeAuthorizationCode({
        apiUrl: API_URL,
        clientId: OAUTH_CLIENT_ID,
        redirectUri,
        code: parsed.code,
        verifier,
        state,
    });
    if (!tokens.ok || !tokens.scope.split(" ").includes(OAUTH_SCOPE)) {
        if (tokens.ok) {
            await revokeAuthorization({ apiUrl: API_URL, clientId: OAUTH_CLIENT_ID, refreshToken: tokens.refreshToken });
        }
        return { status: "failed", message: connectionMessage(tokens.ok ? "scope" : tokens.error) };
    }
    let profile;
    try {
        const info = await fetch(`${API_URL}/oauth/userinfo`, {
            headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
        });
        profile = (await info.json());
        if (!info.ok) {
            await revokeAuthorization({ apiUrl: API_URL, clientId: OAUTH_CLIENT_ID, refreshToken: tokens.refreshToken });
            return { status: "failed", message: connectionMessage("userinfo") };
        }
    }
    catch {
        await revokeAuthorization({ apiUrl: API_URL, clientId: OAUTH_CLIENT_ID, refreshToken: tokens.refreshToken });
        return { status: "failed", message: connectionMessage("network") };
    }
    const email = typeof profile.email === "string" ? profile.email : "";
    const name = typeof profile.name === "string" ? profile.name : "";
    await writeSession({
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessExpiresAt: Date.now() + tokens.expiresIn * 1000,
        email,
        name,
    });
    return { status: "connected", email, name };
}
async function getAccessToken(force) {
    const session = await readSession();
    if (!session)
        return { ok: false, status: "disconnected" };
    if (!force && session.accessExpiresAt - 30_000 > Date.now()) {
        return { ok: true, accessToken: session.accessToken };
    }
    const refreshed = await refreshAuthorization({
        apiUrl: API_URL,
        clientId: OAUTH_CLIENT_ID,
        refreshToken: session.refreshToken,
    });
    if (!refreshed.ok) {
        if (refreshed.error === "invalid_grant" || refreshed.error === "invalid_client") {
            await clearSession();
            return { ok: false, status: "expired" };
        }
        return { ok: false, status: "unreachable" };
    }
    const next = {
        ...session,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessExpiresAt: Date.now() + refreshed.expiresIn * 1000,
    };
    await writeSession(next);
    return { ok: true, accessToken: next.accessToken };
}
function jobFromMessage(message) {
    const company = typeof message.company === "string" ? message.company.trim() : "";
    const title = typeof message.title === "string" ? message.title.trim() : "";
    const url = typeof message.url === "string" ? message.url.trim() : "";
    const notes = typeof message.notes === "string" ? message.notes : "";
    if (!company || !title || !url)
        return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return null;
    }
    catch {
        return null;
    }
    return { company, title, url, notes };
}
async function postApplication(accessToken, job) {
    return fetch(`${API_URL}/applications`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            company: job.company,
            title: job.title,
            url: job.url,
            notes: job.notes,
            status: "saved",
        }),
    });
}
async function lookupApplication(url) {
    const access = await getAccessToken(false);
    if (!access.ok)
        return { found: false };
    try {
        const response = await fetch(`${API_URL}/applications/lookup?url=${encodeURIComponent(url)}`, {
            headers: { Authorization: `Bearer ${access.accessToken}`, Accept: "application/json" },
        });
        if (!response.ok)
            return { found: false };
        const body = (await response.json());
        return { found: body.found === true };
    }
    catch {
        return { found: false };
    }
}
async function saveApplication(message) {
    const job = jobFromMessage(message);
    if (!job) {
        return { ok: false, message: "Company, title, and an http(s) job URL are required." };
    }
    const first = await getAccessToken(false);
    if (!first.ok) {
        if (first.status === "unreachable") {
            return { ok: false, status: "unreachable", message: "Could not reach Applyflow. Your draft is still here." };
        }
        return { ok: false, status: first.status, message: "" };
    }
    let response;
    try {
        response = await postApplication(first.accessToken, job);
    }
    catch {
        return { ok: false, status: "unreachable", message: "Could not reach Applyflow. Your draft is still here." };
    }
    if (response.status === 401) {
        const second = await getAccessToken(true);
        if (!second.ok) {
            return {
                ok: false,
                status: second.status === "unreachable" ? "unreachable" : "expired",
                message: second.status === "unreachable" ? "Could not reach Applyflow. Your draft is still here." : "",
            };
        }
        try {
            response = await postApplication(second.accessToken, job);
        }
        catch {
            return { ok: false, status: "unreachable", message: "Could not reach Applyflow. Your draft is still here." };
        }
        if (response.status === 401)
            return { ok: false, status: "expired", message: "" };
    }
    if (response.status === 201)
        return { ok: true, message: "Tracked as saved" };
    let error = "";
    try {
        const body = (await response.json());
        if (typeof body.error === "string")
            error = body.error;
    }
    catch {
        error = "";
    }
    return { ok: false, message: publicSaveError(error) };
}
async function disconnectAccount() {
    const session = await readSession();
    if (session) {
        await revokeAuthorization({
            apiUrl: API_URL,
            clientId: OAUTH_CLIENT_ID,
            refreshToken: session.refreshToken,
        });
    }
    await clearSession();
    return { status: "disconnected" };
}
async function authStatus() {
    const session = await readSession();
    if (!session)
        return { status: "disconnected" };
    const token = await getAccessToken(false);
    if (!token.ok && token.status === "expired")
        return { status: "expired" };
    if (!token.ok && token.status === "disconnected")
        return { status: "disconnected" };
    return { status: "connected", email: session.email, name: session.name };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id)
        return;
    if (!sender.tab) {
        if (!extensionPage(sender))
            return;
        const record = message;
        if (message.type === "auth-status") {
            void authStatus().then(sendResponse);
            return true;
        }
        if (message.type === "auth-connect") {
            void connectAccount().then(sendResponse);
            return true;
        }
        if (message.type === "auth-disconnect") {
            void disconnectAccount().then(sendResponse);
            return true;
        }
        if (message.type === "lookup-application") {
            const url = typeof record.url === "string" ? record.url : "";
            void lookupApplication(url).then(sendResponse).catch(() => sendResponse({ found: false }));
            return true;
        }
        if (message.type === "save-application") {
            void saveApplication(record).then(sendResponse);
            return true;
        }
        if (message.type === "open-signup") {
            void chrome.tabs.create({ url: `${WEB_ORIGIN}/signup` });
            sendResponse({ ok: true });
            return;
        }
        return;
    }
    const tabId = sender.tab.id;
    if (typeof tabId !== "number")
        return;
    if (message.type === "job-cleared") {
        void chrome.action.setBadgeText({ text: "", tabId });
        return;
    }
    if (message.type === "job-detected") {
        const job = message;
        void chrome.storage.session.set({
            [String(tabId)]: {
                title: job.title,
                company: job.company,
                url: job.url,
            },
        });
        void chrome.action.setBadgeText({ text: "Job", tabId });
        void chrome.action.setBadgeBackgroundColor({ color: "#1c1915", tabId });
        return;
    }
    if (message.type === "open-panel") {
        chrome.sidePanel
            .open({ tabId })
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    }
});
