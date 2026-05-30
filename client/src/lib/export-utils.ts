export const downloadTextFile = (content: string, fileName: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const toCsv = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const raw = value == null ? '' : String(value);
    if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };
  const header = columns.join(',');
  const data = rows.map((row) => columns.map((column) => escape(row[column])).join(',')).join('\n');
  return `${header}\n${data}`;
};
