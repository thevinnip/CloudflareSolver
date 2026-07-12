import {NextFunction, Request, Response} from "express";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
    if (error instanceof TypeError && String(error.message).includes("Invalid URL")) {
        res.status(400).json({ message: "Invalid URL" });
        return;
    }

    if (error instanceof Error) {
        const clientErrors = [
            "Field 'url' is required",
            "Request body must be a JSON object",
            "Unsupported method",
        ];

        if (clientErrors.some(message => error.message.includes(message))) {
            res.status(400).json({ message: error.message });
            return;
        }

        if (error.message === "Browser not connected" || error.message.includes("Browser service")) {
            res.status(503).json({ message: error.message });
            return;
        }

        console.error(error);
        res.status(500).json({ message: error.message });
        return;
    }

    console.error(error);
    res.status(500).json({ message: "Internal server error" });
}
