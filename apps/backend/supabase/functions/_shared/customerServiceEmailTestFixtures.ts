import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { validateEmailImportAttachments } from "./customerServiceEmailAttachments.ts";
import {
  emptyEmailImportFacts,
  type IntakeCatalog,
} from "./customerServiceEmailIntake.ts";
import type { ImportAnalysisReceipt } from "./customerServiceEmailAnalysis.ts";
import type { EmailImportExtractor } from "./mistralEmailImport.ts";

export const TEST_IMPORT_ID = "00000000-0000-4000-8000-000000000004";
export const emptyCatalog: IntakeCatalog = { builders: [], jobs: [] };
export const testCatalog: IntakeCatalog = {
  builders: [{ id: 1, code: "KBH", name: "KB Home" }],
  jobs: [{
    id: 10,
    builderId: 1,
    code: "KB-AR",
    community: "Arroyo",
    latitude: 34.1,
    longitude: -117.2,
  }],
};
export function importFacts(
  owner: string | null = "Elena Rivera",
  description: string | null = "Adjust entry door",
) {
  const facts = emptyEmailImportFacts();
  if (owner) {
    facts.contacts = [{
      role: "HOMEOWNER",
      name: owner,
      email: null,
      phones: [],
      sourceLabel: "Homeowner",
      sourcePage: 1,
    }];
  }
  if (description) {
    facts.serviceItems = [{
      sourceItemNumber: "1",
      description,
      requestedAction: null,
      location: null,
      assignedVendor: "Valtrim Inc.",
      assignedToValtrim: true,
      sourceCategory: null,
      suggestedServiceKind: "Adjustment",
      suggestedWorkType: "Doors",
      suggestedServiceTask: "GENERAL_FIX",
      sourcePage: 1,
      reviewReasons: [],
    }];
  }
  return facts;
}
export async function importPdf(
  { form = false, pages = 1, xfa = false, encrypted = false } = {},
) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  if (form || xfa) {
    pdf.getForm().createTextField("Homeowner").setText("Elena Rivera");
    pdf.getForm().createTextField("Work").setText("Adjust entry door");
    pdf.getForm().createCheckBox("Material").check();
    pdf.getForm().createDropdown("Language").addOptions(["English", "Spanish"]);
    pdf.getForm().getDropdown("Language").select("Spanish");
    if (xfa) {
      pdf.getForm().acroForm.dict.set(
        PDFName.of("XFA"),
        PDFHexString.fromText("<xfa>Original XFA data</xfa>"),
      );
    }
  }
  if (encrypted) {
    pdf.context.trailerInfo.Encrypt = pdf.context.register(
      pdf.context.obj({ Filter: PDFName.of("Standard") }),
    );
  }
  const bytes = await pdf.save({
    updateFieldAppearances: false,
    addDefaultPage: false,
  });
  return new File([bytes as Uint8Array<ArrayBuffer>], "work-order.pdf", {
    type: "application/pdf",
  });
}
export function importPng() {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1EAAAAASUVORK5CYII=",
    ),
    (char) => char.charCodeAt(0),
  );
  return new File([bytes], "door.png", { type: "image/png" });
}
export async function analysisFixture(files: File[] = []) {
  const originals = files.map((file, index) => ({
    id: `file-${index + 1}`,
    file,
  }));
  const manifest = (await validateEmailImportAttachments(originals)).map((
    file,
    index,
  ) => ({
    ...file,
    objectPath: `imports/${TEST_IMPORT_ID}/${index + 1}-${file.sha256}`,
  }));
  const receipt: ImportAnalysisReceipt = {
    id: TEST_IMPORT_ID,
    requestId: null,
    sourceStatus: "AVAILABLE",
    sourcePayload: { bodyText: "Homeowner Elena Rivera. Adjust entry door." },
    sourceManifest: manifest,
    attachmentRefs: manifest.map((file, index) => ({
      ...file,
      fileId: index + 1,
      bucketId: "customer-service-imports",
    })),
  };
  const calls = { text: [] as string[], image: 0, pdf: 0, download: 0 };
  const extractor: EmailImportExtractor = {
    text: (text) => {
      calls.text.push(text);
      return Promise.resolve({
        model: "text-test",
        structuredData: importFacts(),
        usageInfo: null,
      });
    },
    image: () => {
      calls.image++;
      return Promise.resolve({
        model: "vision-test",
        structuredData: importFacts(),
        usageInfo: null,
      });
    },
    pdf: () => {
      calls.pdf++;
      return Promise.resolve({
        model: "ocr-test",
        structuredData: importFacts(),
        usageInfo: null,
        text: "Original OCR",
        pages: [{
          index: 0,
          markdown: "Original OCR",
          averageConfidence: 1,
          minimumConfidence: 1,
        }],
      });
    },
  };
  const download = (ref: ImportAnalysisReceipt["attachmentRefs"][number]) => {
    calls.download++;
    return Promise.resolve(files[ref.fileId - 1]);
  };
  return {
    receipt,
    extractor,
    download,
    catalog: emptyCatalog,
    today: "2026-10-22",
    calls,
  };
}

export async function graphAnalysisFixture(files: File[] = [importPng()]) {
  const fixture = await analysisFixture(files);
  fixture.receipt.sourceContractVersion = 2;
  fixture.receipt.sourceConnectionId = "00000000-0000-4000-8000-000000000008";
  fixture.receipt.sourceManifest = fixture.receipt.sourceManifest.map((
    { objectPath, ...file },
  ) =>
    file.mimeType === "application/pdf"
      ? { ...file, objectPath, retention: "STORED" }
      : { ...file, retention: "GRAPH_ONLY" }
  );
  fixture.receipt.attachmentRefs = fixture.receipt.attachmentRefs.filter((
    file,
  ) => file.mimeType === "application/pdf")
    .map((file) => ({ ...file, retention: "STORED" }));
  const imageReads: string[] = [];
  return {
    ...fixture,
    imageReads,
    downloadImage: (file: { attachmentId: string }) => {
      imageReads.push(file.attachmentId);
      return Promise.resolve(
        files[Number(file.attachmentId.split("-")[1]) - 1],
      );
    },
  };
}
