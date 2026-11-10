// Shades bands of the disc sheets off the main thread. The tables arrive once per job; bands follow.
import { shadeSheetRows } from './disc-sheet.js';

let tables = null;

self.onmessage = (event) => {
  const message = event.data;
  if (message.tables) tables = message.tables;
  if (message.firstRow === undefined) return;
  const band = shadeSheetRows(tables, message.firstRow, message.lastRow);
  self.postMessage(
    { job: message.job, firstRow: message.firstRow, lastRow: message.lastRow, ...band },
    [band.color.buffer, band.finish.buffer, band.normal.buffer],
  );
};
