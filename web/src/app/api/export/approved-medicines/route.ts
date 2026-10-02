import { approvedMedicinesCsv, csvHeaders, exportFilename } from "@/lib/export";

export const dynamic = "force-dynamic";

/** The complete approved-medicine library as CSV. Public research data only. */
export async function GET() {
  try {
    const { csv, rows } = await approvedMedicinesCsv();
    return new Response(csv, { headers: csvHeaders(exportFilename("approved-medicines", rows), rows) });
  } catch (error) {
    console.error("approved-medicines export failed", error);
    return new Response("Export unavailable", { status: 503 });
  }
}
