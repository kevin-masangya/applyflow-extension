export function readJobFromPage() {
    function clean(value) {
        return (value ?? "").replace(/\s+/g, " ").trim();
    }
    function keep(value) {
        const cleaned = clean(value);
        const lower = cleaned.toLowerCase();
        if (!cleaned || lower.startsWith("welcome"))
            return "";
        if (["indeed", "linkedin", "jobstreet", "jobs", "home", "sign in", "sign up", "find jobs", "job search"].includes(lower)) {
            return "";
        }
        return cleaned;
    }
    function first(selectors) {
        for (const selector of selectors) {
            for (const node of document.querySelectorAll(selector)) {
                const value = keep(node.textContent ?? "");
                if (value)
                    return value;
            }
        }
        return "";
    }
    function fromJsonLd() {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            let parsed;
            try {
                parsed = JSON.parse(script.textContent ?? "");
            }
            catch {
                continue;
            }
            const stack = [parsed];
            while (stack.length > 0) {
                const current = stack.pop();
                if (!current || typeof current !== "object")
                    continue;
                if (Array.isArray(current)) {
                    stack.push(...current);
                    continue;
                }
                const record = current;
                if (Array.isArray(record["@graph"]))
                    stack.push(...record["@graph"]);
                const typeValue = record["@type"];
                const types = Array.isArray(typeValue) ? typeValue : [typeValue];
                if (!types.includes("JobPosting"))
                    continue;
                const hiring = record.hiringOrganization;
                let company = "";
                if (typeof hiring === "string")
                    company = hiring;
                else if (hiring && typeof hiring === "object" && "name" in hiring) {
                    const name = hiring.name;
                    if (typeof name === "string")
                        company = name;
                }
                const title = typeof record.title === "string" ? record.title : "";
                if (title || company)
                    return { title: clean(title), company: clean(company) };
            }
        }
        return null;
    }
    function fromPageTitle(host, pageTitle) {
        const cleaned = clean(pageTitle);
        if (host.endsWith("linkedin.com")) {
            const parts = cleaned.split("|").map((part) => part.trim()).filter((part) => part.length > 0 && part.toLowerCase() !== "linkedin");
            return { title: keep((parts[0] ?? "").replace(/^\(\d+\)\s*/, "")), company: keep(parts[1] ?? "") };
        }
        if (host.includes("indeed.")) {
            const pieces = (cleaned.split("|")[0] ?? cleaned).trim().split(" - ").map((part) => part.trim());
            return { title: keep(pieces[0] ?? ""), company: keep(pieces[1] ?? "") };
        }
        if (host.includes("jobstreet.")) {
            const pieces = (cleaned.split("|")[0] ?? cleaned).trim().split(" - ").map((part) => part.trim()).filter(Boolean);
            return {
                title: keep((pieces[0] ?? "").replace(/\s+in\s+.+$/i, "")),
                company: keep(pieces.length > 1 ? pieces[pieces.length - 1] : ""),
            };
        }
        return { title: "", company: "" };
    }
    const host = location.hostname;
    const structured = fromJsonLd();
    const titled = fromPageTitle(host, document.title);
    const domTitle = first([
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title",
        "h1.t-24",
        "[data-testid='jobsearch-JobInfoHeader-title']",
        "h1.jobsearch-JobInfoHeader-title",
        ".jobsearch-JobInfoHeader-title",
        "h2.jobTitle",
        "[data-automation='job-detail-title']",
        "h1",
        "h2",
    ]);
    const domCompany = first([
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name",
        "[data-testid='inlineHeader-companyName']",
        "[data-automation='advertiser-name']",
    ]);
    return {
        title: keep(structured?.title || "") || domTitle || titled.title,
        company: keep(structured?.company || "") || domCompany || titled.company,
    };
}
export function isJobPage() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.endsWith("linkedin.com"))
        return path.includes("/jobs/");
    if (host.includes("indeed."))
        return /viewjob|\/jobs|\/rc\/clk/i.test(path + location.search);
    if (host.includes("jobstreet."))
        return /\/job\/|\/jobs\//i.test(path);
    return false;
}
