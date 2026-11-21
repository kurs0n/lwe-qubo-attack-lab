import { QUBO } from "./converter";

export type QUBOExportFormat = "json" | "csv" | "mtx";

export function serializeQUBO(
  qubo: QUBO,
  format: QUBOExportFormat,
): string {
  if (format === "json") {
    return `${JSON.stringify(
      {
        matrix: qubo.matrix,
        offset: qubo.offset,
        representation: qubo.representation,
      },
      null,
      2,
    )}\n`;
  }
  if (format === "csv") {
    return `${qubo.matrix.map((row) => row.join(",")).join("\n")}\n`;
  }
  if (format === "mtx") {
    const values: string[] = [];
    for (let column = 0; column < qubo.size; column += 1) {
      for (let row = 0; row < qubo.size; row += 1) {
        values.push(String(qubo.matrix[row]?.[column] ?? 0));
      }
    }
    return [
      "%%MatrixMarket matrix array real general",
      `% offset: ${qubo.offset}`,
      `% representation: ${qubo.representation}`,
      `${qubo.size} ${qubo.size}`,
      ...values,
      "",
    ].join("\n");
  }
  throw new TypeError("format must be 'json', 'csv', or 'mtx'");
}
