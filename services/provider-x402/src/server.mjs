import { createProviderServer } from "./http.mjs";

const port = Number.parseInt(process.env.PROVIDER_X402_PORT ?? "4010", 10);
const host = process.env.PROVIDER_X402_HOST ?? "127.0.0.1";

const server = createProviderServer();

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`provider-x402 listening on http://${host}:${boundPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
