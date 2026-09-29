import { approvedMedicinesCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

/** The complete approved-medicine library as CSV. Public research data only. */
export async function GET() {
  try {
    const { csv, rows } = await approvedMedicinesCsv();
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="approved-medicines.csv"',
        "cache-control": "no-store",
        "x-row-count": String(rows),
      },
    });
  } catch (error) {
    console.error("approved-medicines export failed", error);
    return new Response("Export unavailable", { status: 503 });
  }
}
