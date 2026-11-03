import type { serviceClient } from "./supabase.ts";
import {
  type GraphImageCredentials,
  graphImageDownloader,
} from "./customerServiceGraphImageSource.ts";
import {
  analyzeCustomerServiceEmail,
  type AnalyzedImportSource,
  type EmailImportAnalysisReport,
  type ImportAnalysisReceipt,
} from "./customerServiceEmailAnalysis.ts";
import {
  buildEmailImportIntake,
  type IntakeCatalog,
} from "./customerServiceEmailIntake.ts";
import {
  type EmailImportExtractor,
  mistralEmailImportExtractor,
} from "./mistralEmailImport.ts";

type ImportServiceClient = ReturnType<typeof serviceClient>;

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Backend analysis adapter. The worker retains source checkpoints and commits
// the resulting intake separately, preserving evidence across human edits.
export async function extractCustomerServiceEmailImport(
  admin: ImportServiceClient,
  importId: string,
  options: {
    apiKey?: string;
    fetcher?: typeof fetch;
    extractor?: EmailImportExtractor;
    today?: string;
    workerToken?: string;
    checkpoint?: AnalyzedImportSource[];
    beforeSource?: () => Promise<void>;
    onSource?: (source: AnalyzedImportSource) => Promise<void>;
    graphCredentials?: GraphImageCredentials;
    graphFetcher?: typeof fetch;
    graphDeadline?: number;
  } = {},
): Promise<
  {
    importId: string;
    requestId: number | null;
    idempotentReplay: boolean;
    report: EmailImportAnalysisReport | null;
  }
> {
  const { data: row, error: readError } = await admin.from(
    "service_request_imports",
  )
    .select(
      "id,request_id,source_status,source_payload,source_manifest,attachment_refs,analysis_payload,source_contract_version,source_connection_id",
    )
    .eq("id", importId).maybeSingle();
  if (readError || !row) {
    throw readError ?? new Error("Email import not found.");
  }
  if (row.request_id !== null) {
    return {
      importId: row.id,
      requestId: row.request_id,
      idempotentReplay: true,
      report: row.analysis_payload,
    };
  }
  if (row.source_status !== "AVAILABLE") {
    throw new Error(
      "The complete email source must be AVAILABLE before analysis.",
    );
  }
  const [builders, jobs] = await Promise.all([
    admin.from("builders").select("id,code,name").eq("is_active", true),
    admin.from("jobs").select(
      "id,builder_id,code,community,community_latitude,community_longitude",
    ).eq("is_active", true).eq("status", "ACTIVE"),
  ]);
  if (builders.error || jobs.error) throw builders.error ?? jobs.error;
  const catalog: IntakeCatalog = {
    builders: (builders.data ?? []).map((builder) => ({
      id: builder.id,
      code: builder.code,
      name: builder.name,
    })),
    jobs: (jobs.data ?? []).filter((job) =>
      builders.data?.some((builder) => builder.id === job.builder_id)
    )
      .map((job) => ({
        id: job.id,
        builderId: job.builder_id,
        code: job.code,
        community: job.community,
        latitude: numeric(job.community_latitude),
        longitude: numeric(job.community_longitude),
      })),
  };
  const receipt: ImportAnalysisReceipt = {
    id: row.id,
    requestId: row.request_id,
    sourceStatus: row.source_status,
    sourcePayload: row.source_payload,
    sourceManifest: row.source_manifest,
    attachmentRefs: row.attachment_refs,
    sourceContractVersion: row.source_contract_version ?? 1,
    sourceConnectionId: row.source_connection_id ?? null,
  };
  let report: EmailImportAnalysisReport;
  if (
    row.analysis_payload?.schemaVersion === "1.0" &&
    row.analysis_payload?.outcome === "READY_FOR_INTAKE"
  ) {
    const cached = row.analysis_payload as EmailImportAnalysisReport;
    // Reuse paid source extraction, but refresh catalog-derived intake. Jobs may
    // have been deactivated or had their verified coordinates corrected since.
    const merged = buildEmailImportIntake(
      cached.sources.filter((source) =>
        source.status === "ANALYZED" && source.structuredData !== null
      )
        .map((source) => ({
          sourceId: source.sourceId,
          kind: source.kind,
          structuredData: source.structuredData!,
        })),
      catalog,
      options.today,
    );
    report = {
      ...cached,
      ...merged,
      outcome: merged.issues.length ? "NEEDS_ATTENTION" : "READY_FOR_INTAKE",
    };
  } else {
    report = await analyzeCustomerServiceEmail({
      receipt,
      catalog,
      today: options.today,
      checkpoint: options.checkpoint,
      refreshIncompleteHomeownerText:
        row.analysis_payload?.schemaVersion === "1.0" &&
        row.analysis_payload?.outcome === "NEEDS_ATTENTION" &&
        Array.isArray(row.analysis_payload?.issues) &&
        row.analysis_payload.issues.includes("MISSING_OR_AMBIGUOUS_HOMEOWNER"),
      beforeSource: options.beforeSource,
      onSource: options.onSource,
      downloadImage: graphImageDownloader(admin, receipt, options.workerToken, {
        credentials: options.graphCredentials,
        fetcher: options.graphFetcher,
        deadline: options.graphDeadline,
      }),
      extractor: options.extractor ??
        mistralEmailImportExtractor(options.apiKey ?? "", options.fetcher),
      download: async (file) => {
        const { data, error } = await admin.storage.from(file.bucketId)
          .download(file.objectPath);
        if (error || !data) {
          throw error ?? new Error("Missing original source file.");
        }
        return data;
      },
    });
  }
  const { data: recorded, error } = await admin.rpc(
    options.workerToken
      ? "record_customer_service_worker_analysis"
      : "record_customer_service_import_analysis",
    {
      p_import_id: receipt.id,
      p_report: report,
      ...(options.workerToken ? { p_worker_token: options.workerToken } : {}),
    },
  );
  if (error || !recorded) {
    throw error ?? new Error("The source analysis could not be retained.");
  }
  return {
    importId: receipt.id,
    requestId: recorded.requestId,
    idempotentReplay: recorded.idempotentReplay,
    report: recorded.analysisPayload,
  };
}
