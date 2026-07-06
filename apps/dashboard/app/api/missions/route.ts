import { proxyRuntimeMissionRequest } from "./route-utils";

export async function POST(request: Request) {
  return proxyRuntimeMissionRequest("/api/missions", request, "POST");
}
