import "colors";
import "dotenv/config";
import cors from "cors";
import express, {NextFunction, Request, Response} from "express";
import {errorHandler} from "./middleware/errorHandler.js";
import {createDocsRouter} from "./routes/docsRoute.js";
import {createRequestRouter} from "./routes/requestRoute.js";
import {HttpProxyServer} from "./util/ProxyServer.js";
import {PuppeteerBrowser} from "./util/util/PuppeteerBrowser.js";

const app = express();
const port = process.env.PORT || 3000;

const proxyService = new HttpProxyServer();
const browserService = new PuppeteerBrowser();

let isShuttingDown = false;

async function shutdown(signal?: string) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;

    if (signal) {
        console.log(`Encerrando (${signal})...`.yellow);
    }

    proxyService.stop();
    await browserService.close();
    process.exit(0);
}

process.once("SIGINT", () => {
    shutdown("SIGINT").catch(console.error);
});

process.once("SIGTERM", () => {
    shutdown("SIGTERM").catch(console.error);
});

process.once("beforeExit", () => {
    if (!isShuttingDown) {
        browserService.close().catch(console.error);
    }
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = (body: unknown) => {
        return originalJson({
            path: req.originalUrl.split("?")[0] || req.path,
            status: res.statusCode,
            ...(typeof body === "object" && body !== null ? body : { data: body }),
        });
    };

    next();
});

app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
        proxyService: {
            isRunning: proxyService.status,
            port: proxyService.status ? proxyService.runningPort : undefined,
        },
        browserService: {
            isRunning: browserService.isRunning,
        },
        api: {
            docs: "/api/docs",
            request: "/api/request",
        },
    });
});

app.use("/api", createDocsRouter());
app.use("/api", createRequestRouter(browserService));

app.use((_req: Request, res: Response) => {
    res.status(404).json({ message: "Not Found" });
});

app.use(errorHandler);

app.listen(port, async () => {
    console.log(`
                █████████  ████                          █████  █████████           ████                                
              ███░░░░░███░░███                         ░░███  ███░░░░░███         ░░███                                
             ███     ░░░  ░███   ██████  █████ ████  ███████ ░███    ░░░   ██████  ░███  █████ █████  ██████  ████████ 
            ░███          ░███  ███░░███░░███ ░███  ███░░███ ░░█████████  ███░░███ ░███ ░░███ ░░███  ███░░███░░███░░███
            ░███          ░███ ░███ ░███ ░███ ░███ ░███ ░███  ░░░░░░░░███░███ ░███ ░███  ░███  ░███ ░███████  ░███ ░░░ 
            ░░███     ███ ░███ ░███ ░███ ░███ ░███ ░███ ░███  ███    ░███░███ ░███ ░███  ░░███ ███  ░███░░░   ░███     
             ░░█████████  █████░░██████  ░░████████░░████████░░█████████ ░░██████  █████  ░░█████   ░░██████  █████    
              ░░░░░░░░░  ░░░░░  ░░░░░░    ░░░░░░░░  ░░░░░░░░  ░░░░░░░░░   ░░░░░░  ░░░░░    ░░░░░     ░░░░░░  ░░░░░
                   
    ${`Developed by Vinícius`.cyan}           
    ${`Running on http://127.0.0.1:${port} (0.0.0.0:${port})`.green}
    ${`Docs: http://127.0.0.1:${port}/api/docs`.yellow}                                                                                                
            
 `.red);

    await browserService.connect().catch(console.error);
    browserService.startHealthCheck().catch(console.error);
    proxyService.start();
});
