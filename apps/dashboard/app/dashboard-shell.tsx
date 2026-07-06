"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  BadgeAlert,
  Blocks,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  CloudAlert,
  ExternalLink,
  FileSearch,
  Fingerprint,
  Menu,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  Sparkles,
  TerminalSquare,
  TimerReset,
  TriangleAlert,
  Zap
} from "lucide-react";
import { motion } from "framer-motion";

import {
  applyDashboardAction,
  buildEvidenceExport,
  countModes,
  describeWorkspaceModes,
  formatCompactHash,
  formatIsoTimestamp,
  formatJson,
  getAttackById,
  loadPreferredEvidenceExport,
  mergeRuntimeTimelineItem,
  recordEvidenceExport,
  runtimeTimelineEventToDashboardItem,
  runPreferredMissionFlowAction,
  type AttackScenario,
  type DashboardPreset,
  type DashboardRuntimeSnapshot,
  type DashboardWorkspace,
  type EvidenceMode,
  type RuntimeTimelineSsePayload,
  type TimelineEvent,
  toCompactModeLabel
} from "./dashboard-data";

type BadgeTone = "live" | "fallback" | "mock" | "blocked" | "success" | "warning" | "neutral";

interface DashboardShellProps extends DashboardRuntimeSnapshot {
  initialWorkspace: DashboardWorkspace;
}

type PanelCardProps = {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  state: string;
  tone?: BadgeTone;
  rightSlot?: ReactNode;
  children: ReactNode;
  dense?: boolean;
};

const presetLabels: Record<DashboardPreset, string> = {
  demo: "demo",
  investigate: "investigate",
  attack: "attack",
  evidence: "evidence"
};

const badgeStyles: Record<BadgeTone, string> = {
  live: "badge badge-live",
  fallback: "badge badge-fallback",
  mock: "badge badge-mock",
  blocked: "badge badge-blocked",
  success: "badge badge-success",
  warning: "badge badge-warning",
  neutral: "badge badge-neutral"
};

const defaultJsonPreview = "{\n  \"status\": \"empty\"\n}";

function resolveBadgeTone(state: string): BadgeTone {
  const normalizedState = state.toLowerCase();

  if (normalizedState === "live") {
    return "live";
  }

  if (normalizedState === "fallback") {
    return "fallback";
  }

  if (normalizedState === "mock") {
    return "mock";
  }

  if (["blocked", "block", "failed", "paid_but_not_delivered"].includes(normalizedState)) {
    return "blocked";
  }

  if (
    ["warning", "pending_approval", "draft", "needs_manual_step", "fallback_required", "refundable"].includes(
      normalizedState
    )
  ) {
    return "warning";
  }

  if (
    ["success", "allow", "complete", "verified", "delivered", "paid", "finalized", "active", "ok"].includes(
      normalizedState
    )
  ) {
    return "success";
  }

  return "neutral";
}

function timelineSseUrl(runtimeEndpoint: string, missionId: string) {
  const url = new URL(runtimeEndpoint);
  url.pathname = `/api/missions/${encodeURIComponent(missionId)}/timeline.sse`;
  url.search = "";
  return url.toString();
}

function Badge({ state, tone }: { state: string; tone?: BadgeTone | undefined }) {
  const resolvedTone = tone ?? resolveBadgeTone(state);
  const stateClass = state.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return <span className={`${badgeStyles[resolvedTone]} badge-state-${stateClass}`}>{toCompactModeLabel(state)}</span>;
}

function SectionCard({ title, subtitle, icon, state, tone, rightSlot, children, dense }: PanelCardProps) {
  const testId = `panel-${title
    .toLowerCase()
    .replace(/\s*\+\s*/g, "-")
    .replace(/\s*\/\s*/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

  return (
    <section
      className={`panel-card${dense ? " panel-card-dense" : ""} panel-tone-${tone ?? resolveBadgeTone(state)}`}
      data-testid={testId}
    >
      <div className="panel-card-head">
        <div className="panel-card-title-wrap">
          <div className="panel-card-icon">{icon}</div>
          <div className="panel-card-copy">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        <div className="panel-card-actions">
          <Badge state={state} tone={tone} />
          {rightSlot}
        </div>
      </div>
      <div className="panel-card-body">{children}</div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong className="metric-value" title={value}>
        {value}
      </strong>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  );
}

function KV({
  label,
  value,
  className = ""
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`kv-row ${className}`.trim()}>
      <span className="kv-label">{label}</span>
      <div className="kv-value">{value}</div>
    </div>
  );
}

function ExplorerLink({
  href,
  label
}: {
  href?: string | undefined;
  label: string;
}) {
  if (!href) {
    return <code>pending</code>;
  }

  return (
    <a className="inline-link" href={href} target="_blank" rel="noreferrer">
      <span>{label}</span>
      <ExternalLink size={13} />
    </a>
  );
}

function JsonBlock({
  value,
  label,
  compact = false,
  defaultExpanded = false
}: {
  value: unknown;
  label?: string;
  compact?: boolean;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const summaryLabel = label ?? "Raw evidence";

  return (
    <details
      className={`json-block${compact ? " json-block-compact" : ""}`}
      open={isExpanded}
      onToggle={(event) => setIsExpanded(event.currentTarget.open)}
    >
      <summary className="json-summary">
        <span className="json-summary-copy">
          <span className="json-label">{summaryLabel}</span>
          <strong>Raw evidence</strong>
        </span>
        <span className="json-summary-state">
          {isExpanded ? "shown" : "folded"}
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </summary>
      <pre>{value ? formatJson(value) : defaultJsonPreview}</pre>
    </details>
  );
}

function DiffBlock({
  before,
  after
}: {
  before: Record<string, string>;
  after: Record<string, string>;
}) {
  return (
    <div className="diff-grid">
      <div className="diff-col">
        <div className="diff-title">Before</div>
        {Object.entries(before).map(([label, value]) => (
          <KV key={label} label={label} value={<code>{value}</code>} />
        ))}
      </div>
      <div className="diff-col">
        <div className="diff-title">After</div>
        {Object.entries(after).map(([label, value]) => (
          <KV key={label} label={label} value={<code>{value}</code>} />
        ))}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  tone = "neutral",
  disabled,
  testId
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: BadgeTone;
  disabled?: boolean;
  testId?: string;
}) {
  const resolvedTestId = testId ?? `action-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  return (
    <button
      className={`action-button action-button-${tone}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={resolvedTestId}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToggleButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`preset-button${active ? " preset-button-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function EmptyState({
  title,
  detail,
  icon
}: {
  title: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  return <Badge state={state} />;
}

function Timeline({ items }: { items: TimelineEvent[] }) {
  return (
    <div className="timeline">
      {items.map((item, index) => (
        <motion.div
          key={`${item.id}-${index}`}
          className={`timeline-item timeline-item-${item.status}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="timeline-rail" />
          <div className="timeline-copy">
            <div className="timeline-top">
              <strong>{item.title}</strong>
              <span className="timeline-meta">
                <StateChip state={item.status} />
                <Badge state={item.evidenceMode} />
              </span>
            </div>
            <p>{item.detail}</p>
            <small>{formatIsoTimestamp(item.timestamp)}</small>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function AttackCards({
  attacks,
  selectedAttackId,
  onSelect
}: {
  attacks: AttackScenario[];
  selectedAttackId: string;
  onSelect: (attackId: string) => void;
}) {
  return (
    <div className="attack-grid">
      {attacks.map((attack) => {
        const active = attack.id === selectedAttackId;

        return (
          <button
            key={attack.id}
            type="button"
            className={`attack-card${active ? " attack-card-active" : ""}`}
            onClick={() => onSelect(attack.id)}
            data-testid={`attack-card-${attack.id}`}
          >
            <div className="attack-card-top">
              <strong>{attack.title}</strong>
              <Badge state={attack.evidenceMode} />
            </div>
            <p>{attack.summary}</p>
            <div className="attack-card-meta">
              <span>{attack.blockedLayer}</span>
              <span>{attack.paper}</span>
            </div>
            <div className="attack-card-footer">
              <StateChip state={attack.resultState === "idle" ? "empty" : attack.resultState === "blocked" ? "blocked" : attack.resultState} />
              <span>Runs: {attack.runCount}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function mapCountsLabel(counts: Record<EvidenceMode, number>) {
  return `live ${counts.live} · fallback ${counts.fallback} · mock ${counts.mock}`;
}

export function DashboardShell({ initialWorkspace, runtime, provider }: DashboardShellProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReceiptExpanded, setIsReceiptExpanded] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const selectedAttack = useMemo(
    () => getAttackById(workspace, workspace.selectedAttackId),
    [workspace]
  );

  const modes = useMemo(() => describeWorkspaceModes(workspace), [workspace]);
  const attackSummary = useMemo(
    () =>
      workspace.attacks.reduce(
        (accumulator, attack) => {
          accumulator[attack.resultState] += 1;
          return accumulator;
        },
        { blocked: 0, fallback: 0, mock: 0, success: 0, idle: 0 } as Record<"blocked" | "fallback" | "mock" | "success" | "idle", number>
      ),
    [workspace]
  );

  const attackStatePreview = useMemo(
    () =>
      countModes([
        workspace.runtimeHealth,
        workspace.providerHealth,
        workspace.mission,
        workspace.caw,
        workspace.botChain,
        workspace.challenge,
        workspace.providerTrust,
        workspace.firewall,
        workspace.paymentContext,
        workspace.clearSign,
        workspace.receipt
      ]),
    [workspace]
  );

  const selectedAttackCard = selectedAttack ?? workspace.attacks[0];
  const isExportVisible = isExportOpen || Boolean(workspace.evidence);
  const modePreview = mapCountsLabel(modes);
  const runtimeTimelineMissionId = workspace.mission.id;

  useEffect(() => {
    if (!runtimeTimelineMissionId || typeof EventSource === "undefined") {
      return;
    }

    const source = new EventSource(timelineSseUrl(runtime.endpoint, runtimeTimelineMissionId));
    const handleRuntimeTimelineEvent = (event: MessageEvent<string>) => {
      try {
        const item = runtimeTimelineEventToDashboardItem(
          JSON.parse(event.data) as RuntimeTimelineSsePayload
        );
        if (item) {
          setWorkspace((current) => mergeRuntimeTimelineItem(current, item));
        }
      } catch {
        // Keep the dashboard on its local timeline if the runtime stream is unavailable or malformed.
      }
    };

    for (const eventName of ["mission", "guard", "receipt", "attack"]) {
      source.addEventListener(eventName, handleRuntimeTimelineEvent);
    }

    return () => {
      source.close();
    };
  }, [runtime.endpoint, runtimeTimelineMissionId]);

  const run = (action: Parameters<typeof applyDashboardAction>[1]) => {
    setWorkspace((current) => applyDashboardAction(current, action));
  };

  const runMissionFlow = (action: Parameters<typeof runPreferredMissionFlowAction>[1]) => {
    const current = workspace;
    setWorkspace({
      ...current,
      actionSource: "demo_fixture"
    });
    void runPreferredMissionFlowAction(current, action).then((result) => {
      setWorkspace(result.workspace);
    });
  };

  const handleEvidenceExport = async () => {
    setIsExportOpen(true);
    setIsExporting(true);

    try {
      const result = await loadPreferredEvidenceExport(workspace);
      setWorkspace((current) =>
        recordEvidenceExport(
          current,
          result.evidence,
          Date.now(),
          result.usedRuntime
            ? `Server-side evidence export (${result.evidence.runtimeSource ?? "runtime"}) captured the current live / fallback / mock split.`
            : `Runtime evidence export unavailable; frontend fallback export kept the demo available. ${result.fallbackReason ?? ""}`.trim()
        )
      );
    } finally {
      setIsExporting(false);
    }
  };

  const exportEvidence = workspace.evidence ?? buildEvidenceExport(workspace);
  const exportSourceLabel =
    exportEvidence.source === "server_side"
      ? `server-side${exportEvidence.runtimeSource ? ` / ${exportEvidence.runtimeSource}` : ""}`
      : "frontend fallback";
  const exportTone =
    exportEvidence.evidenceMode === "live"
      ? "live"
      : exportEvidence.evidenceMode === "mock"
        ? "mock"
        : "fallback";
  const selectedAttackTitle = selectedAttackCard?.title ?? "attack";
  const selectedAttackResult = selectedAttackCard?.resultState ?? "idle";
  const selectedAttackDescription = selectedAttackCard?.resultDetail ?? selectedAttackCard?.summary ?? "";
  const selectedAttackLayer = selectedAttackCard?.blockedLayer ?? "n/a";
  const selectedAttackEvidenceRef = selectedAttackCard?.evidenceRef ?? "n/a";
  const selectedAttackGuardEventId = selectedAttackCard?.guardEventId ?? "n/a";

  return (
    <main className="dashboard-shell">
      <div className="dashboard-grid">
        <aside className={`sidebar${isMobileNavOpen ? " sidebar-open" : ""}`}>
          <div className="brand-line">
            <div className="brand-logo-card" aria-label="Clear402">
              <img src="/brand/clear402-lockup.png" alt="" />
            </div>
            <div className="brand-copy">
              <strong>BOT Chain Evidence</strong>
              <p>AI-agent payment guard with testnet settlement proof.</p>
            </div>
          </div>

          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setIsMobileNavOpen((value) => !value)}
            aria-expanded={isMobileNavOpen}
          >
            {isMobileNavOpen ? <ChevronUp size={16} /> : <Menu size={16} />}
            <span>{isMobileNavOpen ? "Hide navigation" : "Navigation"}</span>
          </button>

          <div className="preset-switcher">
            {(Object.keys(presetLabels) as DashboardPreset[]).map((preset) => (
              <ToggleButton
                key={preset}
                active={workspace.preset === preset}
                label={presetLabels[preset]}
                onClick={() => run({ type: "set-preset", preset })}
              />
            ))}
          </div>

          <div className="sidebar-stack">
            <SectionCard
              title="Live / Fallback / Mock"
              subtitle="Always visible across the console."
              icon={<Sparkles size={18} />}
              state="fallback"
              tone="warning"
              dense
            >
              <Metric label="Mode split" value={modePreview} />
              <Metric label="Source" value={workspace.actionSource} />
              <Metric label="Runtime health" value={runtime.status} hint={runtime.endpoint} />
              <Metric label="Provider health" value={provider.status} hint={provider.endpoint} />
            </SectionCard>

            <SectionCard
              title="Mission Console"
              subtitle="The operator's working set."
              icon={<ClipboardList size={18} />}
              state={workspace.mission.evidenceMode}
              tone={workspace.mission.evidenceMode === "live" ? "live" : "fallback"}
              dense
            >
              <KV label="Prompt" value={<span className="clamp-lines">{workspace.missionDraft.prompt}</span>} />
              <KV label="Budget" value={<code>{workspace.missionDraft.budgetUsd} BOT wei cap</code>} />
              <KV label="Resource" value={<code>{formatCompactHash(workspace.missionDraft.resourceUrl)}</code>} />
              <KV label="Status" value={<StateChip state={workspace.mission.status} />} />
              <KV label="Settlement" value={<code>{workspace.botChain.contractName}</code>} />
            </SectionCard>
          </div>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="topbar-copy">
              <p className="eyebrow">BOT Chain Builder Challenge</p>
              <h1>Clear402 for BOT Chain</h1>
              <p>
                BOT Chain is the settlement layer for AI-agent x402-style payments; Clear402 binds the paid resource, provider, amount, nonce, and escrow evidence before claiming anything live.
              </p>
            </div>
            <div className="topbar-actions">
              <div className="mini-status">
                <span className="mini-status-label">runtime</span>
                <Badge state={runtime.evidenceMode} />
              </div>
              <div className="mini-status">
                <span className="mini-status-label">provider</span>
                <Badge state={provider.evidenceMode} />
              </div>
            </div>
          </header>

          <section className="action-bar">
            <ActionButton label="Create mission" icon={<ClipboardList size={16} />} onClick={() => runMissionFlow("create-mission")} tone="success" />
            <ActionButton label="Dry run 402" icon={<FileSearch size={16} />} onClick={() => runMissionFlow("dry-run")} />
            <ActionButton label="Prepare guard" icon={<ShieldPlus size={16} />} onClick={() => runMissionFlow("prepare-guard")} tone="warning" />
            <ActionButton label="Record BOT evidence" icon={<ArrowRightLeft size={16} />} onClick={() => runMissionFlow("execute-payment")} tone="warning" testId="action-execute-payment" />
            <ActionButton label="Verify receipt" icon={<ShieldCheck size={16} />} onClick={() => runMissionFlow("verify-receipt")} tone="success" />
            <ActionButton label={isExporting ? "Exporting evidence" : "Export evidence"} icon={<ArrowDownToLine size={16} />} onClick={() => void handleEvidenceExport()} tone="fallback" disabled={isExporting} />
          </section>

          <section className="panels-grid">
            <SectionCard
              title="BOT Chain Settlement"
              subtitle="ServiceEscrow contract, payment context, tx hashes, and explorer proof."
              icon={<ShieldCheck size={18} />}
              state={workspace.botChain.settlementStatus}
              tone={workspace.botChain.evidenceMode === "live" ? "live" : "warning"}
            >
              <div className="two-col">
                <KV label="Network" value={<code>{workspace.botChain.network}</code>} />
                <KV label="Chain ID" value={<code>{workspace.botChain.chainId}</code>} />
                <KV label="Contract" value={<code>{workspace.botChain.contractAddress}</code>} />
                <KV label="Action" value={<StateChip state={workspace.botChain.escrowAction} />} />
                <KV label="Status" value={<StateChip state={workspace.botChain.settlementStatus} />} />
                <KV label="Mode" value={<Badge state={workspace.botChain.evidenceMode} />} />
              </div>
              <div className="subpanel">
                <div className="subpanel-head">
                  <strong>Explorer evidence</strong>
                  <Badge state={workspace.botChain.evidenceMode} />
                </div>
                <div className="capability-list">
                  <div className="capability-row">
                    <span>Contract</span>
                    <ExplorerLink href={workspace.botChain.explorerLinks.contract} label="open address" />
                    <small>{workspace.botChain.contractAddress}</small>
                  </div>
                  <div className="capability-row">
                    <span>Deploy tx</span>
                    <ExplorerLink href={workspace.botChain.explorerLinks.deployTx} label="open tx" />
                    <small>{workspace.botChain.deployTxHash}</small>
                  </div>
                  <div className="capability-row">
                    <span>Interaction tx</span>
                    <ExplorerLink href={workspace.botChain.explorerLinks.interactionTx} label="open tx" />
                    <small>{workspace.botChain.interactionTxHash}</small>
                  </div>
                </div>
              </div>
              <div className="subpanel">
                <div className="subpanel-head">
                  <strong>PaymentContext binding</strong>
                  <StateChip state={workspace.botChain.settlementStatus} />
                </div>
                <KV label="Hash" value={<code>{workspace.botChain.paymentContextHash}</code>} />
                <KV label="RPC" value={<code>{workspace.botChain.rpcUrl}</code>} />
                <p className="subpanel-note">{workspace.botChain.note}</p>
              </div>
            </SectionCard>

            <SectionCard
              title="x402 Challenge Inspector"
              subtitle="Raw 402 response, normalized challenge, registry result, settlement path."
              icon={<BadgeAlert size={18} />}
              state={workspace.challenge.state}
              tone={workspace.challenge.state === "success" ? "success" : "neutral"}
            >
              {workspace.challenge.rawChallenge ? (
                <JsonBlock value={workspace.challenge.rawChallenge} label="Raw challenge" />
              ) : (
                <EmptyState
                  title="No live challenge yet"
                  detail="Use Dry run 402 to populate the inspector. Until then the panel stays empty instead of inventing a challenge."
                  icon={<CloudAlert size={18} />}
                />
              )}
              {workspace.challenge.normalizedChallenge ? (
                <JsonBlock value={workspace.challenge.normalizedChallenge} label="Normalized challenge" />
              ) : null}
              {workspace.challenge.providerRegistryResult ? (
                <JsonBlock value={workspace.challenge.providerRegistryResult} label="Provider registry result" />
              ) : null}
              <KV label="Settlement path" value={<code>{workspace.challenge.settlementPath}</code>} />
            </SectionCard>

            <SectionCard
              title="Provider Registry + ERC-8004 Trust Panel"
              subtitle="Identity, endpoint, payTo, reputation, and trust result."
              icon={<Fingerprint size={18} />}
              state={workspace.providerTrust.evidenceMode}
              tone={workspace.providerTrust.evidenceMode === "live" ? "live" : "fallback"}
            >
              <div className="two-col">
                <KV label="Provider ID" value={<code>{workspace.providerTrust.providerId}</code>} />
                <KV label="Trust decision" value={<StateChip state={workspace.providerTrust.state} />} />
              </div>
              <JsonBlock value={workspace.providerTrust.registryEntry} label="Registry entry" />
              <JsonBlock value={workspace.providerTrust.trustResult} label="ERC-8004 trust result" compact />
            </SectionCard>

            <SectionCard
              title="Metadata Firewall Diff"
              subtitle="Before and after redaction with findings."
              icon={<ShieldAlert size={18} />}
              state={workspace.firewall.evidenceMode}
              tone={workspace.firewall.evidenceMode === "live" ? "live" : "fallback"}
            >
              <KV label="Decision" value={<StateChip state={workspace.firewall.decision} />} />
              <KV label="Reason code" value={<code>{workspace.firewall.reasonCode}</code>} />
              <KV label="PII policy hash" value={<code>{workspace.firewall.piiPolicyHash}</code>} />
              <KV label="Latency" value={<code>{workspace.firewall.latencyMs}ms</code>} />
              <DiffBlock before={workspace.firewall.before} after={workspace.firewall.after} />
              <div className="findings-list">
                {workspace.firewall.findings.map((finding, index) => (
                  <div key={`${finding.field}-${index}`} className="finding-row">
                    <strong>{finding.field}</strong>
                    <span>{finding.entityType}</span>
                    <span>{finding.action}</span>
                    <span>{Math.round(finding.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="PaymentContext Panel"
              subtitle="Canonical hashes, nonce, expiry, and request id."
              icon={<Blocks size={18} />}
              state={workspace.paymentContext.evidenceMode}
              tone={workspace.paymentContext.evidenceMode === "live" ? "live" : "fallback"}
            >
              <div className="two-col">
                <KV label="PaymentContext hash" value={<code>{workspace.paymentContext.paymentContextHash}</code>} />
                <KV label="Agent request id" value={<code>{workspace.paymentContext.requestId}</code>} />
                <KV label="Nonce" value={<code>{workspace.paymentContext.nonce}</code>} />
                <KV label="Expiry" value={<code>{formatIsoTimestamp(workspace.paymentContext.expiresAt)}</code>} />
              </div>
              <JsonBlock value={workspace.paymentContext} label="PaymentContext JSON" compact />
            </SectionCard>

            <SectionCard
              title="Clear Signing Panel"
              subtitle="Decoded intent, risk tags, and semantic gate decision."
              icon={<TerminalSquare size={18} />}
              state={workspace.clearSign.result.decision}
              tone={workspace.clearSign.result.decision === "allow" ? "success" : workspace.clearSign.result.decision === "block" ? "blocked" : "warning"}
            >
              <KV label="Decision" value={<StateChip state={workspace.clearSign.result.decision} />} />
              <KV label="Intent" value={<span className="clamp-lines">{workspace.clearSign.result.intent}</span>} />
              <KV label="Selector" value={<code>{workspace.clearSign.result.selector}</code>} />
              <KV label="Function" value={<code>{workspace.clearSign.result.functionSignature}</code>} />
              <KV label="Calldata digest" value={<code>{workspace.clearSign.result.calldataDigest}</code>} />
              <div className="risk-tags">
                {workspace.clearSign.result.riskTags.map((tag) => (
                  <span key={tag} className="risk-tag">
                    {tag}
                  </span>
                ))}
              </div>
              <JsonBlock value={workspace.clearSign.input} label="ClearSign input" compact />
            </SectionCard>

            <SectionCard
              title="Guard + Settlement Timeline"
              subtitle="Runtime guard events, BOT Chain evidence state, receipt verification, and attack logs."
              icon={<TimerReset size={18} />}
              state={workspace.botChain.evidenceMode}
              tone={workspace.botChain.settlementStatus === "confirmed" ? "success" : "warning"}
            >
              <Timeline items={workspace.timeline} />
            </SectionCard>

            <SectionCard
              title="Service Receipt Panel"
              subtitle="Payment receipt, delivery receipt, and final status."
              icon={<ShieldCheck size={18} />}
              state={workspace.receipt.evidenceMode}
              tone={workspace.receipt.finalStatus === "delivered" ? "success" : "warning"}
              rightSlot={<button className="tiny-toggle" type="button" onClick={() => setIsReceiptExpanded((value) => !value)}>{isReceiptExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} details</button>}
            >
              <div className="two-col">
                <KV label="Final status" value={<StateChip state={workspace.receipt.finalStatus} />} />
                <KV label="Payment status" value={<StateChip state={workspace.receipt.paymentReceipt.status} />} />
                <KV label="Delivery status" value={<StateChip state={workspace.receipt.deliveryReceipt.status} />} />
                <KV label="Tx hash" value={<code>{workspace.receipt.paymentReceipt.txHash ? formatCompactHash(workspace.receipt.paymentReceipt.txHash) : "n/a"}</code>} />
              </div>
              {isReceiptExpanded ? (
                <>
                  <JsonBlock value={workspace.receipt.paymentReceipt} label="Payment receipt" />
                  <JsonBlock value={workspace.receipt.deliveryReceipt} label="Delivery receipt" />
                </>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Attack Lab Panel"
              subtitle="One-click attacks with blocked-layer evidence."
              icon={<TriangleAlert size={18} />}
              state="mock"
              tone="mock"
            >
              <AttackCards
                attacks={workspace.attacks}
                selectedAttackId={workspace.selectedAttackId}
                onSelect={(attackId) => setWorkspace((current) => ({ ...current, selectedAttackId: attackId }))}
              />
              <div className="attack-panel-footer">
                <ActionButton
                  label={`Run ${selectedAttackTitle}`}
                  icon={<Zap size={16} />}
                  onClick={() =>
                    selectedAttackCard ? run({ type: "run-attack", attackId: selectedAttackCard.id }) : undefined
                  }
                  tone="blocked"
                />
                <div className="attack-result">
                  <strong>{selectedAttackResult}</strong>
                  <p>{selectedAttackDescription}</p>
                </div>
              </div>
              <KV label="Blocked layer" value={<code>{selectedAttackLayer}</code>} />
              <KV label="Evidence ref" value={<code>{selectedAttackEvidenceRef}</code>} />
              <KV label="Guard event" value={<code>{selectedAttackGuardEventId}</code>} />
            </SectionCard>

            <SectionCard
              title="Evidence Export Panel"
              subtitle="Markdown and JSON export for the current evidence bundle."
              icon={<ArrowDownToLine size={18} />}
              state={workspace.evidence ? workspace.evidence.evidenceMode : "fallback"}
              tone={workspace.evidence ? exportTone : "neutral"}
              rightSlot={<Badge state={workspace.evidence ? workspace.evidence.evidenceMode : "fallback"} />}
            >
              <div className="export-meta">
                <Metric label="Generated" value={workspace.evidence ? formatIsoTimestamp(workspace.evidence.generatedAt) : "not yet generated"} />
                <Metric label="Status" value={isExporting ? "loading runtime" : workspace.evidence ? `${workspace.evidence.stale ? "stale" : "ready"} / ${exportSourceLabel}` : "idle"} />
                <Metric label="Source" value={workspace.evidence ? exportSourceLabel : "runtime preferred"} />
                <Metric label="Runtime" value={runtime.evidenceMode} />
                <Metric label="Provider" value={provider.evidenceMode} />
              </div>
              <div className="export-buttons">
                <ActionButton
                  label={isExporting ? "Opening" : "Open JSON"}
                  icon={<ArrowDownToLine size={16} />}
                  onClick={() => void handleEvidenceExport()}
                  tone="fallback"
                  disabled={isExporting}
                />
                <ActionButton
                  label={isExporting ? "Refreshing" : "Refresh export"}
                  icon={<TimerReset size={16} />}
                  onClick={() => void handleEvidenceExport()}
                  disabled={isExporting}
                />
              </div>
              {isExportVisible ? (
                <div className="export-body">
                  <JsonBlock value={exportEvidence.json} label="JSON export" compact defaultExpanded />
                  <div className="markdown-block">
                    <div className="json-label">Markdown export</div>
                    <pre>{exportEvidence.markdown}</pre>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Evidence export is hidden"
                  detail="Use Open JSON to reveal the export surface. The dashboard does not default to a giant blob."
                  icon={<ArrowDownToLine size={18} />}
                />
              )}
            </SectionCard>
          </section>
        </div>
      </div>

      <section className="bottom-strip">
        <div className="strip-item">
          <strong>Live inputs</strong>
          <p>{runtime.endpoint}</p>
          <p>{provider.endpoint}</p>
        </div>
        <div className="strip-item">
          <strong>State summary</strong>
          <p>{attackSummary.blocked} blocked attacks staged</p>
          <p>{attackStatePreview.live} live facts in view</p>
        </div>
        <div className="strip-item">
          <strong>Mode guard</strong>
          <p>Fallback and mock are intentionally visible. The dashboard records BOT Chain settlement evidence only when contract and tx hashes exist.</p>
        </div>
      </section>
    </main>
  );
}
