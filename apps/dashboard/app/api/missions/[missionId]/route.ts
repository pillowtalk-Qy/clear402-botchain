import { proxyRuntimeMissionRequest } from "../route-utils";

interface MissionRouteContext {
  params: Promise<{ missionId: string }> | { missionId: string };
}

export async function GET(request: Request, context: MissionRouteContext) {
  const params = await context.params;
  return proxyRuntimeMissionRequest(
    `/api/missions/${encodeURIComponent(params.missionId)}`,
    request,
    "GET"
  );
}
