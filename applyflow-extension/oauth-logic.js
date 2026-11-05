const SAVE_ERRORS = new Set([
    "company is required",
    "title is required",
    "url is required",
    "url must be http or https",
    "invalid status",
    "notes must be a string",
    "body must be an object",
    "already saved",
]);
function base64url(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export function randomUrlSafe(bytes = 32) {
    const array = new Uint8Array(bytes);
    crypto.getRandomValues(array);
    return base64url(array);
}
export async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
}
export function readAuthResponse(redirectUrl, expectedState) {
    let url;
    try {
        url = new URL(redirectUrl);
    }
    catch {
        return { error: "redirect" };
    }
    const state = url.searchParams.get("state") ?? "";
    if (state.length === 0 || state.length !== expectedState.length || state !== expectedState) {
        return { error: "state" };
    }
    const error = url.searchParams.get("error");
    if (error)
        return { error };
    const code = url.searchParams.get("code");
    if (!code)
        return { error: "missing_code" };
    return { code };
}
export function connectionMessage(error) {
    if (error === "access_denied")
        return "You did not approve the connection.";
    if (error === "state")
        return "The connection could not be verified. Try again.";
    if (error === "closed")
        return "The connection window was closed before it finished.";
    if (error === "network")
        return "Could not reach Applyflow. Try again.";
    return "Could not connect your account.";
}
export function publicSaveError(error) {
    if (error === "already saved")
        return "This job is already in Applyflow.";
    return SAVE_ERRORS.has(error) ? error : "Could not save this application.";
}
async function readTokenResponse(response) {
    let body;
    try {
        body = (await response.json());
    }
    catch {
        return { ok: false, error: "network" };
    }
    if (!response.ok ||
        typeof body.access_token !== "string" ||
        typeof body.refresh_token !== "string" ||
        typeof body.expires_in !== "number") {
        return { ok: false, error: typeof body.error === "string" ? body.error : "invalid_grant" };
    }
    return {
        ok: true,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresIn: body.expires_in,
        scope: typeof body.scope === "string" ? body.scope : "",
    };
}
export async function exchangeAuthorizationCode(input) {
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl(`${input.apiUrl}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                grant_type: "authorization_code",
                code: input.code,
                redirect_uri: input.redirectUri,
                client_id: input.clientId,
                code_verifier: input.verifier,
                state: input.state,
            }),
        });
        return await readTokenResponse(response);
    }
    catch {
        return { ok: false, error: "network" };
    }
}
export async function refreshAuthorization(input) {
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl(`${input.apiUrl}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                refresh_token: input.refreshToken,
                client_id: input.clientId,
            }),
        });
        return await readTokenResponse(response);
    }
    catch {
        return { ok: false, error: "network" };
    }
}
export async function revokeAuthorization(input) {
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
        await fetchImpl(`${input.apiUrl}/oauth/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: input.refreshToken, client_id: input.clientId }),
        });
    }
    catch {
        return;
    }
}
