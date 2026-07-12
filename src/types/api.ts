export const HTTP_METHODS = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
] as const;

export type HttpMethod = typeof HTTP_METHODS[number];

export type ProxyRequestBody = {
    url: string;
    method?: HttpMethod;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown> | unknown[] | number | boolean | null;
    forceRefresh?: boolean;
};

export type ProxyResponseBody = {
    upstream: {
        status: number;
        headers: Record<string, string>;
        body: string;
    };
    durationMs: number;
};
