import { proxyRuntimeEvidenceExport } from "../route-utils";

interface EvidenceExportRouteContext {
  params: Promise<{ missionId: string }> | { missionId: string };
}

export async function GET(
  _request: Request,
  context: EvidenceExportRouteContext
) {
  const params = await context.params;
  return proxyRuntimeEvidenceExport(params.missionId, "md");
}
