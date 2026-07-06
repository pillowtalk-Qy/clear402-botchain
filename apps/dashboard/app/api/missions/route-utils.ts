const runtimeHealthUrl =
  process.env.RUNTIME_HEALTH_URL ?? "http://127.0.0.1:4000/health";

export function buildRuntimeMissionUrl(pathname: string) {
  return new URL(pathname, runtimeHealthUrl).toString();
}

export async function proxyRuntimeMissionRequest(
  pathname: string,
  request: Request,
  method: "GET" | "POST"
) {
  const runtimeUrl = buildRuntimeMissionUrl(pathname);
  const body = method === "POST" ? await request.text() : undefined;
  const init: RequestInit = {
    method,
    cache: "no-store"
  };
  if (body !== undefined && body.length > 0) {
    init.headers = { "content-type": request.headers.get("content-type") ?? "application/json" };
    init.body = body;
  }

  const response = await fetch(runtimeUrl, init);
  const responseBody = await response.text();

  return new Response(responseBody, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8"
    }
  });
}
