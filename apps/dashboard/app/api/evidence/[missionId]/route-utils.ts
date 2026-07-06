export type EvidenceExportFormat = "json" | "md";

const runtimeHealthUrl =
  process.env.RUNTIME_HEALTH_URL ?? "http://127.0.0.1:4000/health";

export function buildRuntimeEvidenceExportUrl(
  missionId: string,
  format: EvidenceExportFormat
) {
  const url = new URL(
    `/api/evidence/${encodeURIComponent(missionId)}/export.${format}`,
    runtimeHealthUrl
  );
  return url.toString();
}

export async function proxyRuntimeEvidenceExport(
  missionId: string,
  format: EvidenceExportFormat
) {
  const runtimeUrl = buildRuntimeEvidenceExportUrl(missionId, format);
  const response = await fetch(runtimeUrl, { cache: "no-store" });
  const body = await response.text();
  const contentType =
    response.headers.get("content-type") ??
    (format === "json"
      ? "application/json; charset=utf-8"
      : "text/markdown; charset=utf-8");

  return new Response(body, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType
    }
  });
}
