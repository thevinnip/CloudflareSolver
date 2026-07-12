import {Router, Request, Response, NextFunction} from "express";
import {PuppeteerBrowser} from "../util/util/PuppeteerBrowser.js";
import {HTTP_METHODS, HttpMethod, ProxyRequestBody} from "../types/api.js";

function normalizeMethod(method?: string): HttpMethod {
    const normalized = (method ?? "GET").toUpperCase();

    if (!HTTP_METHODS.includes(normalized as HttpMethod)) {
        throw new Error(`Unsupported method: ${method}`);
    }

    return normalized as HttpMethod;
}

function normalizeHeaders(headers?: Record<string, unknown>): Record<string, string> {
    if (!headers) {
        return {};
    }

    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) {
            continue;
        }

        result[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }

    return result;
}

function serializeBody(body: ProxyRequestBody["body"]): string | undefined {
    if (body === undefined || body === null) {
        return undefined;
    }

    if (typeof body === "string") {
        return body;
    }

    return JSON.stringify(body);
}

function responseHeadersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

function parseProxyPayload(body: unknown): ProxyRequestBody {
    if (!body || typeof body !== "object") {
        throw new Error("Request body must be a JSON object");
    }

    const payload = body as ProxyRequestBody;

    if (!payload.url || typeof payload.url !== "string") {
        throw new Error("Field 'url' is required");
    }

    new URL(payload.url);

    return payload;
}

export function createRequestRouter(browserService: PuppeteerBrowser) {
    const router = Router();

    const handleProxyRequest = async (payload: ProxyRequestBody, res: Response) => {
        if (!browserService.isRunning) {
            res.status(503).json({
                message: "Browser service is not ready yet",
            });
            return;
        }

        const start = Date.now();
        const method = normalizeMethod(payload.method);
        const headers = normalizeHeaders(payload.headers);
        const requestBody = serializeBody(payload.body);

        const upstreamResponse = await browserService.request(
            payload.url,
            {
                method,
                headers,
                body: requestBody,
            },
            true,
            payload.forceRefresh ?? false
        );

        const upstreamBody = method === "HEAD" ? "" : await upstreamResponse.text();

        res.status(200).json({
            upstream: {
                status: upstreamResponse.status,
                headers: responseHeadersToRecord(upstreamResponse.headers),
                body: upstreamBody,
            },
            durationMs: Date.now() - start,
        });
    };

    router.post("/request", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const payload = parseProxyPayload(req.body);
            await handleProxyRequest(payload, res);
        } catch (error) {
            next(error);
        }
    });

    router.get("/request", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const url = req.query.url;

            if (!url || typeof url !== "string") {
                res.status(400).json({ message: "Query param 'url' is required" });
                return;
            }

            const headers: Record<string, string> = {};

            for (const [key, value] of Object.entries(req.headers)) {
                if (key.startsWith("x-forward-") && value) {
                    headers[key.slice("x-forward-".length)] = Array.isArray(value)
                        ? value.join(", ")
                        : value;
                }
            }

            await handleProxyRequest({
                url,
                method: "GET",
                headers,
                forceRefresh: req.query.forceRefresh === "true",
            }, res);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
