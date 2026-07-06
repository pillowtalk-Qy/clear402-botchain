import type {
  CapabilityStatus,
  CawCapabilityRecord,
  EvidenceMode
} from "../../../packages/shared/src/index.mjs";

export interface CawCapabilityReport {
  version: string;
  createdAt: number;
  evidenceMode: EvidenceMode;
  liveReady: boolean;
  summary: Record<string, number>;
  records: CawCapabilityRecord[];
}

export declare const CAW_CAPABILITIES: readonly string[];

export declare function probeCawCapabilities(options?: {
  command?: string;
  runner?: (
    command: string,
    args: string[],
    options?: { timeoutMs?: number }
  ) => {
    ok: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    errorCode?: string;
  };
  clock?: () => number;
  env?: Record<string, string | undefined>;
}): CawCapabilityRecord[];

export declare function createManualCapabilityRecords(input: {
  env?: Record<string, string | undefined>;
  evidenceRef: string;
}): CawCapabilityRecord[];

export declare function createCawCapabilityReport(
  records: Array<
    | CawCapabilityRecord
    | {
        capability: string;
        status: CapabilityStatus;
        evidenceMode: EvidenceMode;
        rawEvidenceRef?: string;
        notes?: string;
      }
  >,
  options?: { createdAt?: number }
): CawCapabilityReport;

export declare function renderCawCapabilityReportMarkdown(report: CawCapabilityReport): string;

export declare function createCapabilityRecord(input: {
  capability: string;
  status: CapabilityStatus;
  evidenceMode: EvidenceMode;
  rawEvidenceRef?: string;
  notes?: string;
}): CawCapabilityRecord;
