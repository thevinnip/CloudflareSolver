import {existsSync, readFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {Router, Request, Response} from "express";

function resolveDocsPath(): string {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(baseDir, "../docs/API.md"),
        join(baseDir, "../../docs/API.md"),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error("API.md not found");
}

export function createDocsRouter() {
    const router = Router();

    router.get("/docs", (_req: Request, res: Response) => {
        const markdown = readFileSync(resolveDocsPath(), "utf-8");
        res.type("text/markdown").send(markdown);
    });

    return router;
}
