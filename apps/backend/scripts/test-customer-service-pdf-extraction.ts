import {
  extractPdfWithMistral,
  validateCustomerServicePdf,
} from "../supabase/functions/_shared/mistralOcr.ts";

const outputDirectory = "supabase/.temp/customer-service-pdf-extraction";

function baseName(path: string) {
  return path.split(/[\\/]/u).at(-1) ?? "document.pdf";
}

function jsonFileName(pdfName: string) {
  const stem = pdfName.replace(/\.pdf$/iu, "");
  return `${stem.replace(/[^a-z0-9._-]+/giu, "-")}.json`;
}

const apiKey = Deno.env.get("API_KEY_MISTRAL_IA")?.trim();
if (!apiKey) {
  throw new Error("Set API_KEY_MISTRAL_IA before running this command.");
}

if (Deno.args.length === 0) {
  throw new Error("Pass at least one PDF path to test.");
}

await Deno.mkdir(outputDirectory, { recursive: true });

for (const pdfPath of Deno.args) {
  const pdfName = baseName(pdfPath);
  const bytes = await Deno.readFile(pdfPath);
  const file = new File([bytes], pdfName, { type: "application/pdf" });
  const validationError = await validateCustomerServicePdf(file);
  if (validationError) throw new Error(`${pdfName}: ${validationError}`);

  console.log(`Extracting ${pdfName}...`);
  const result = await extractPdfWithMistral(file, apiKey);
  const outputPath = `${outputDirectory}/${jsonFileName(pdfName)}`;

  await Deno.writeTextFile(
    outputPath,
    `${
      JSON.stringify(
        {
          fileName: pdfName,
          fileSize: file.size,
          pageCount: result.pages.length,
          model: result.model,
          structuredData: result.structuredData,
          pages: result.pages.map((page) => ({
            page: page.index + 1,
            averageConfidence: page.averageConfidence,
            minimumConfidence: page.minimumConfidence,
          })),
          usageInfo: result.usageInfo,
        },
        null,
        2,
      )
    }\n`,
  );

  console.log(
    `Validated ${pdfName}: ${result.structuredData.contacts.length} contact(s), ${result.structuredData.serviceItems.length} service item(s).`,
  );
  console.log(`Saved ${outputPath}.`);
}
