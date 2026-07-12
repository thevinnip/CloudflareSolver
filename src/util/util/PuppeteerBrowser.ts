import {connect, ConnectResult, Options } from "puppeteer-real-browser";
import {ModuleClient, SessionClient, type Cookie as TlsCookie} from "tlsclientwrapper";

type BrowserPage = Awaited<ReturnType<ConnectResult["browser"]["newPage"]>>;

type DomainState = {
    domain: string,
    initialCookies: string,
    cloudflareCookies: string,
    cookies: TlsCookie[],
    headers?: Record<string, string>,
    tlsSession?: SessionClient
};

export type ConnectOptions = Options;

const SKIP_REQUEST_HEADERS = new Set([
    "host",
    "content-length",
    "connection",
    "accept-encoding",
]);

const CLOUDFLARE_CHALLENGE_MARKERS = [
    "<!DOCTYPE html><html lang=\"en-US\"><head><title>Just a moment...</title>",
    "<title>Just a moment...</title>",
];

export class PuppeteerBrowser {
    private options: ConnectOptions | undefined;
    private puppeteerSession: ConnectResult | undefined;
    private tlsModule: ModuleClient | undefined;
    private connected: boolean = false;
    private shuttingDown: boolean = false;
    private domainStates: Map<string, DomainState> = new Map();
    private resolvingDomains: Map<string, Promise<Record<string, string> | undefined>> = new Map();
    private solveLock: Promise<void> = Promise.resolve();

    constructor(options?: ConnectOptions) {
        if (options) {
            this.options = options;
        }
    }

    public async connect() {
        if (!this.connected && !this.shuttingDown) {
            try {
                this.tlsModule = new ModuleClient();
                this.puppeteerSession = await connect({
                    ...this.options,
                    headless: false,
                    turnstile: true
                });
                this.connected = true;
            } catch (error) {
                console.error(error);
            }
        }
    }

    public async startHealthCheck() {
        while (!this.shuttingDown) {
            if (this.puppeteerSession) {
                const browser = this.puppeteerSession.browser

                let alive = false;
                try {
                    alive = browser.connected || browser.isConnected();
                    if (alive) {
                        await browser.version();
                    }
                } catch {
                    alive = false;
                }

                if (!alive) {
                    console.log("Puppeteer desconectado, reconectando...".yellow);
                    this.connected = false;
                    this.domainStates.clear();
                    this.resolvingDomains.clear();

                    if (!this.shuttingDown) {
                        await this.connect();
                    }
                } else {
                    this.connected = true;
                }
            }

            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    public get isRunning(): boolean {
        return this.connected && !this.shuttingDown;
    }

    public async close() {
        if (this.shuttingDown) {
            return;
        }

        this.shuttingDown = true;
        this.connected = false;

        for (const state of this.domainStates.values()) {
            try {
                await state.tlsSession?.destroySession();
            } catch {}
        }

        this.domainStates.clear();
        this.resolvingDomains.clear();

        try {
            const browser = this.puppeteerSession?.browser;
            if (browser?.isConnected()) {
                await browser.close();
            }
        } catch (error) {
            console.error(error);
        }

        this.puppeteerSession = undefined;

        try {
            await this.tlsModule?.terminate();
        } catch {}

        this.tlsModule = undefined;
    }

    private async withSolveLock<T>(fn: () => Promise<T>): Promise<T> {
        const previousLock = this.solveLock;
        let releaseLock!: () => void;

        this.solveLock = new Promise<void>(resolve => {
            releaseLock = resolve;
        });

        await previousLock;

        try {
            return await fn();
        } finally {
            releaseLock();
        }
    }

    private browserHeadersToRecord(headers: Record<string, string>): Record<string, string> {
        const result: Record<string, string> = {};

        for (const [key, value] of Object.entries(headers)) {
            const normalizedKey = key.toLowerCase();

            if (normalizedKey.startsWith(":")) {
                continue;
            }

            if (SKIP_REQUEST_HEADERS.has(normalizedKey)) {
                continue;
            }

            result[normalizedKey] = value;
        }

        return result;
    }

    private pageCookiesToTlsCookies(cookies: Awaited<ReturnType<BrowserPage["cookies"]>>): TlsCookie[] {
        return cookies.map(cookie => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires > 0 ? Math.floor(cookie.expires) : 0,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
        }));
    }

    private syncTlsSession(state: DomainState) {
        if (!this.tlsModule || !state.headers) {
            return;
        }

        const defaultHeaders = { ...state.headers };
        delete defaultHeaders.cookie;

        if (!state.tlsSession) {
            state.tlsSession = new SessionClient(this.tlsModule, {
                tlsClientIdentifier: "chrome_131",
                followRedirects: true,
                defaultHeaders,
                defaultCookies: state.cookies,
            });
            return;
        }

        state.tlsSession.setDefaultHeaders(defaultHeaders);
        state.tlsSession.setDefaultCookies(state.cookies);
    }

    private async clearDomainSession(domain: string) {
        const state = this.domainStates.get(domain);

        if (state?.tlsSession) {
            try {
                await state.tlsSession.destroySession();
            } catch {}
        }

        this.domainStates.delete(domain);
    }

    private isCloudflareChallenge(status: number, body: string): boolean {
        if (status !== 403) {
            return false;
        }

        return CLOUDFLARE_CHALLENGE_MARKERS.some(marker => body.includes(marker));
    }

    private async ensureDomainSession(url: string, force: boolean, cookies?: string) {
        const domain = new URL(url).hostname;

        if (force) {
            const pending = this.resolvingDomains.get(domain);
            if (pending) {
                await pending.catch(() => {});
            }
            await this.clearDomainSession(domain);
        } else {
            const cached = this.domainStates.get(domain);
            if (cached?.cloudflareCookies) {
                this.syncTlsSession(cached);
                return cached.headers;
            }

            const pending = this.resolvingDomains.get(domain);
            if (pending) {
                return pending;
            }
        }

        const resolvePromise = this.withSolveLock(async () => {
            const latest = this.domainStates.get(domain);
            if (!force && latest?.cloudflareCookies) {
                this.syncTlsSession(latest);
                return latest.headers;
            }

            return this.solveTurnstileInternal(url, cookies);
        });

        this.resolvingDomains.set(domain, resolvePromise);

        try {
            return await resolvePromise;
        } finally {
            this.resolvingDomains.delete(domain);
        }
    }

    public async solveTurnstile(url: string, force: boolean, cookies?: string) {
        if (!this.connected) {
            throw new Error("Browser not connected");
        }

        return this.ensureDomainSession(url, force, cookies);
    }

    private async solveTurnstileInternal(url: string, cookies?: string) {
        const domain = new URL(url).hostname;
        const page = await this.puppeteerSession!.browser.newPage();

        try {
            const pageCookies = await page.cookies();
            await page.deleteCookie(...pageCookies);

            if (cookies) {
                await page.setRequestInterception(true);
                page.on("request", (request) => {
                    const cookie = `${cookies}; ${request.headers()["cookie"] || ""}`.trim();
                    request.continue({
                        headers: {
                            ...request.headers(),
                            cookie,
                        },
                    });
                });
            }

            const response = await page.goto(url, {
                waitUntil: "networkidle0",
                timeout: 60000,
            });

            let defaultHeaders: Record<string, string> = {};

            if (response) {
                defaultHeaders = this.browserHeadersToRecord(response.request().headers());
            }

            const userAgent = await page.browser().userAgent();
            defaultHeaders["user-agent"] = userAgent;

            const finalCookies = await page.cookies();
            const tlsCookies = this.pageCookiesToTlsCookies(finalCookies);
            const cloudflareCookies = finalCookies
                .map(cookie => `${cookie.name}=${cookie.value}`)
                .join("; ");

            defaultHeaders.cookie = cloudflareCookies;

            const state: DomainState = {
                domain,
                initialCookies: cookies || "",
                cloudflareCookies,
                cookies: tlsCookies,
                headers: defaultHeaders,
            };

            this.domainStates.set(domain, state);
            this.syncTlsSession(state);

            return defaultHeaders;
        } catch (error) {
            console.error(error);
            return undefined;
        } finally {
            if (!page.isClosed()) {
                await page.close().catch(() => {});
            }
        }
    }

    private buildRequestHeaders(
        state: DomainState,
        options: RequestInit
    ): Record<string, string> {
        const requestHeaders: Record<string, string> = {
            ...(state.headers ?? {}),
        };

        if (options.headers) {
            const extraHeaders = new Headers(options.headers);
            extraHeaders.forEach((value, key) => {
                requestHeaders[key.toLowerCase()] = value;
            });
        }

        const oldCookie = requestHeaders.cookie ?? "";

        if (state.cloudflareCookies) {
            requestHeaders.cookie = oldCookie
                ? `${oldCookie}; ${state.cloudflareCookies}`
                : state.cloudflareCookies;
        }

        return requestHeaders;
    }

    private async executeTlsRequest(
        url: string,
        options: RequestInit,
        state: DomainState
    ) {
        const requestHeaders = this.buildRequestHeaders(state, options);
        const method = (options.method ?? "GET").toUpperCase();
        const tlsSession = state.tlsSession!;

        switch (method) {
            case "GET":
                return tlsSession.get(url, { headers: requestHeaders });
            case "POST":
                return tlsSession.post(
                    url,
                    typeof options.body === "string" ? options.body : null,
                    { headers: requestHeaders }
                );
            case "PUT":
                return tlsSession.put(
                    url,
                    typeof options.body === "string" ? options.body : null,
                    { headers: requestHeaders }
                );
            case "PATCH":
                return tlsSession.patch(
                    url,
                    typeof options.body === "string" ? options.body : null,
                    { headers: requestHeaders }
                );
            case "DELETE":
                return tlsSession.delete(url, { headers: requestHeaders });
            case "HEAD":
                return tlsSession.head(url, { headers: requestHeaders });
            case "OPTIONS":
                return tlsSession.options(url, { headers: requestHeaders });
            default:
                throw new Error(`Unsupported HTTP method: ${method}`);
        }
    }

    private tlsHeadersToInit(headers?: Record<string, unknown>): [string, string][] {
        const pairs: [string, string][] = [];

        for (const [key, value] of Object.entries(headers ?? {})) {
            if (Array.isArray(value)) {
                for (const item of value) {
                    pairs.push([key, String(item)]);
                }
                continue;
            }

            pairs.push([key, String(value)]);
        }

        return pairs;
    }

    private toResponse(tlsResponse: { status: number; body?: string; headers?: Record<string, unknown> }) {
        if (tlsResponse.status === 0) {
            throw new Error(`TLS request failed: ${tlsResponse.body}`);
        }

        return new Response(tlsResponse.body ?? "", {
            status: tlsResponse.status,
            headers: new Headers(this.tlsHeadersToInit(tlsResponse.headers)),
        });
    }

    public async request(
        url: string,
        options: RequestInit = {},
        retryOnChallenge = true,
        forceRefresh = false
    ): Promise<Response> {
        if (!this.connected) {
            throw new Error("Browser not connected");
        }

        const domain = new URL(url).hostname;
        await this.ensureDomainSession(url, forceRefresh);

        const state = this.domainStates.get(domain);
        if (!state?.tlsSession) {
            throw new Error(`No TLS session available for ${domain}`);
        }

        if (state.cloudflareCookies) {
            console.log(`Cloudflare cookies (${domain}): ${state.cloudflareCookies}`);
        }

        const tlsResponse = await this.executeTlsRequest(url, options, state);

        if (
            retryOnChallenge &&
            this.isCloudflareChallenge(tlsResponse.status, tlsResponse.body ?? "")
        ) {
            console.log(`Cloudflare challenge detectado em ${domain}, refazendo sessão...`.yellow);
            await this.clearDomainSession(domain);
            await this.ensureDomainSession(url, true);
            return this.request(url, options, false);
        }

        return this.toResponse(tlsResponse);
    }
}
