import "colors";
import http, { IncomingMessage, ServerResponse } from "http";
import net, { Socket } from "net";
import { URL } from "url";

export class HttpProxyServer {
    private server: http.Server;
    private port: number;
    private isRunning: boolean = false;

    constructor(port: number = 8080) {
        this.port = port;

        this.server = http.createServer(
            this.handleHttp.bind(this)
        );

        this.server.on(
            "connect",
            this.handleConnect.bind(this)
        );
    }


    public start() {
        console.log("Iniciando HTTP Proxy...".yellow);

        this.server.on("error", (error: NodeJS.ErrnoException) => {
            if (error.code === "EADDRINUSE") {
                console.log(`HTTP Proxy indisponível: porta ${this.port} em uso`.yellow);
                return;
            }

            console.error(error);
        });

        this.server.listen(this.port, () => {
            this.isRunning = true;
            console.log(
                `HTTP Proxy iniciado na porta ${this.port}`.green
            );
        });
    }


    public stop() {
        this.server.close();
    }

    public get status(): boolean {
        return this.isRunning;
    }

    public get runningPort(): number {
        return this.port;
    }


    private handleHttp(
        req: IncomingMessage,
        res: ServerResponse
    ) {
        let target: URL;

        try {
            target = new URL(req.url!);
        } catch {
            res.writeHead(400);
            res.end("Invalid URL");
            return;
        }


        const proxyReq = http.request(
            {
                hostname: target.hostname,
                port: Number(target.port) || 80,
                method: req.method,
                path: target.pathname + target.search,
                headers: req.headers
            },
            proxyRes => {

                res.writeHead(
                    proxyRes.statusCode ?? 500,
                    proxyRes.headers
                );

                proxyRes.pipe(res);
            }
        );


        this.handleError(proxyReq);


        req.pipe(proxyReq);


        req.on("aborted", () => {
            proxyReq.destroy();
        });


        res.on("close", () => {
            proxyReq.destroy();
        });
    }



    private handleConnect(
        req: http.IncomingMessage,
        clientSocket: Socket,
        head: Buffer
    ) {
        const [host, portString] =
            req.url!.split(":");


        const port =
            Number(portString) || 443;


        const serverSocket =
            net.connect(port, host);


        const closeBoth = () => {
            this.destroy(clientSocket);
            this.destroy(serverSocket);
        };


        serverSocket.once("connect", () => {

            clientSocket.write(
                "HTTP/1.1 200 Connection Established\r\n" +
                "Proxy-Agent: NodeProxy\r\n" +
                "\r\n"
            );


            if (head.length) {
                serverSocket.write(head);
            }


            clientSocket.pipe(serverSocket);
            serverSocket.pipe(clientSocket);
        });



        clientSocket.on(
            "error",
            closeBoth
        );

        serverSocket.on(
            "error",
            closeBoth
        );


        clientSocket.on(
            "close",
            closeBoth
        );

        serverSocket.on(
            "close",
            closeBoth
        );


        clientSocket.setTimeout(
            30000,
            closeBoth
        );

        serverSocket.setTimeout(
            30000,
            closeBoth
        );
    }



    private handleError(
        socket: NodeJS.WritableStream
    ) {
        socket.on(
            "error",
            (err: any) => {

                const ignored = [
                    "ECONNRESET",
                    "EPIPE",
                    "ETIMEDOUT"
                ];


                if (
                    !ignored.includes(err.code)
                ) {
                    console.error(err);
                }
            }
        );
    }



    private destroy(socket?: Socket) {
        if (
            socket &&
            !socket.destroyed
        ) {
            socket.destroy();
        }
    }
}