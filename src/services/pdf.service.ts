import PDFDocument from 'pdfkit';
import { Invoice } from '../models/Invoice';
import { User } from '../models/User';
import { OperatorProfile } from '../models/OperatorProfile';
import { ZraReturn, PlayerTaxLine } from '../models/ZraReturn';

// ============================================================================
// PDF service
//
// Two templates: invoice and ZRA tax return. Both render to a Buffer
// and return it. We don't store the PDF binary — the source rows
// (invoices / zra_returns + operator_profile) are enough to regenerate
// it deterministically. If a tax return is filed, the snapshot is
// frozen and the PDF stays identical forever after.
//
// Layout is plain A4 with the NaWiNa dark teal palette, header bar,
// and table-style line items. No third-party theming.
// ============================================================================

const COLORS = {
  bg:       '#00131a',
  surface:  '#001a26',
  text:     '#0a0a0a',
  textMute: '#555555',
  rule:     '#cccccc',
  accent:   '#006a78',  // teal
  accent2:  '#ffb800',  // amber
  danger:   '#c0392b',
};

const FONT_REG  = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

export class PdfService {
  // -------------------------------------------------------------------------
  // Invoice PDF — single A4 page
  // -------------------------------------------------------------------------
  async renderInvoicePdf(args: {
    invoice: Invoice;
    user: User;
    operator: OperatorProfile;
  }): Promise<Buffer> {
    const { invoice, user, operator } = args;
    return renderToBuffer(async (doc) => {
      header(doc, operator);
      doc.moveDown(0.5);

      // Two-column "bill to / invoice no" block
      const leftX = doc.page.margins.left;
      const rightX = doc.page.width - doc.page.margins.right;

      doc.font(FONT_BOLD).fontSize(11).fillColor(COLORS.text)
        .text('INVOICE', leftX, doc.y);
      doc.font(FONT_REG).fontSize(9).fillColor(COLORS.textMute)
        .text(`Invoice #: ${invoice.invoice_number}`)
        .text(`Issue date: ${new Date(invoice.issue_date).toLocaleDateString()}`)
        .text(`Currency: ${invoice.currency}`);

      doc.moveDown(1.5);
      const tableTop = doc.y;

      // Table header
      doc.font(FONT_BOLD).fontSize(10).fillColor(COLORS.text)
        .text('Description', leftX, tableTop, { width: 280 });
      doc.text('Amount (K)', rightX - 100, tableTop, { width: 100, align: 'right' });

      doc.moveTo(leftX, tableTop + 16).lineTo(rightX, tableTop + 16)
        .strokeColor(COLORS.rule).lineWidth(0.5).stroke();

      // Line items
      let y = tableTop + 22;
      const lineItems: Array<[string, number]> = [
        ['Deposit', Number(invoice.amount)],
        ['Excise duty (5%)', -Number(invoice.excise_duty)],
      ];
      for (const [label, amount] of lineItems) {
        doc.font(FONT_REG).fontSize(10).fillColor(COLORS.text)
          .text(label, leftX, y, { width: 280 });
        doc.text(formatK(amount), rightX - 100, y, { width: 100, align: 'right' });
        y += 18;
      }

      // Divider
      doc.moveTo(leftX, y).lineTo(rightX, y)
        .strokeColor(COLORS.rule).lineWidth(0.5).stroke();
      y += 6;

      // Total
      doc.font(FONT_BOLD).fontSize(11).fillColor(COLORS.accent)
        .text('Net to wallet', leftX, y, { width: 280 });
      doc.text(formatK(Number(invoice.net_amount)), rightX - 100, y,
        { width: 100, align: 'right' });
      y += 24;

      // Footer block
      doc.font(FONT_REG).fontSize(8).fillColor(COLORS.textMute)
        .text(`Billed to: ${user.full_name || '—'} (${user.phone})`, leftX, y);
      y += 12;
      doc.text(`Transaction: ${invoice.transaction_id}`, leftX, y);

      // Page footer
      doc.font(FONT_REG).fontSize(8).fillColor(COLORS.textMute)
        .text(`${operator.company_name} · TPIN ${operator.tpin}` +
              (operator.phone ? ` · ${operator.phone}` : ''),
              leftX,
              doc.page.height - doc.page.margins.bottom - 20,
              { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
    });
  }

  // -------------------------------------------------------------------------
  // Tax return PDF — cover page + per-player breakdown table
  // -------------------------------------------------------------------------
  async renderTaxReturnPdf(args: {
    ret: ZraReturn;
    operator: OperatorProfile;
  }): Promise<Buffer> {
    const { ret, operator } = args;
    return renderToBuffer(async (doc) => {
      header(doc, operator);

      // Cover block
      const leftX = doc.page.margins.left;
      const rightX = doc.page.width - doc.page.margins.right;
      let y = doc.y + 8;

      doc.font(FONT_BOLD).fontSize(18).fillColor(COLORS.text)
        .text('ZRA Gaming Tax Return', leftX, y);
      y = doc.y + 4;
      doc.font(FONT_REG).fontSize(10).fillColor(COLORS.textMute)
        .text(`Period: ${ret.period_start} to ${ret.period_end} (inclusive)`, leftX, y);
      y = doc.y + 2;
      doc.text(`Status: ${ret.status.toUpperCase()}` +
               (ret.filed_at ? `  ·  Filed ${new Date(ret.filed_at).toLocaleDateString()}` : ''),
               leftX, y);
      y = doc.y + 16;

      // Headline summary table
      const summaryRows: Array<[string, string, string]> = [
        ['Total deposits',          formatK(Number(ret.total_deposits)),  ''],
        ['Total player winnings',   formatK(Number(ret.total_payouts)),   ''],
        ['Net revenue (D − P)',     formatK(Number(ret.net_revenue)),     ''],
        ['Presumptive tax  15%',    formatK(Number(ret.presumptive_tax)), 'on net revenue'],
        ['Withholding tax  15%',    formatK(Number(ret.withholding_tax)), 'on player winnings'],
        ['Excise duty       5%',    formatK(Number(ret.excise_duty)),     'on deposits'],
        ['Total tax payable',       formatK(Number(ret.total_tax)),       'sum of the three'],
      ];
      doc.font(FONT_BOLD).fontSize(10).fillColor(COLORS.text)
        .text('Headline summary', leftX, y);
      y = doc.y + 6;

      doc.font(FONT_BOLD).fontSize(9).fillColor(COLORS.text)
        .text('Line', leftX, y, { width: 220 });
      doc.text('Amount (K)', rightX - 200, y, { width: 100, align: 'right' });
      doc.text('Note', rightX - 90, y, { width: 90, align: 'right' });
      y += 14;
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor(COLORS.rule).lineWidth(0.5).stroke();
      y += 6;

      for (const [label, amount, note] of summaryRows) {
        const isTotal = label === 'Total tax payable';
        doc.font(isTotal ? FONT_BOLD : FONT_REG).fontSize(10)
          .fillColor(isTotal ? COLORS.accent : COLORS.text)
          .text(label, leftX, y, { width: 220 });
        doc.text(amount, rightX - 200, y, { width: 100, align: 'right' });
        doc.font(FONT_REG).fillColor(COLORS.textMute)
          .text(note, rightX - 90, y, { width: 90, align: 'right' });
        y += 16;
      }
      y += 4;
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor(COLORS.rule).lineWidth(0.5).stroke();
      y += 16;

      // Signature line
      doc.font(FONT_REG).fontSize(9).fillColor(COLORS.text)
        .text('Operator signature: ____________________________   Date: __________', leftX, y);
      y = doc.y + 8;
      doc.text(`Name (printed): ${operator.company_name}   TPIN: ${operator.tpin}`, leftX, y);

      // -------------------------------------------------------------------
      // Per-player breakdown — new page
      // -------------------------------------------------------------------
      doc.addPage();
      header(doc, operator);
      y = doc.y + 6;

      doc.font(FONT_BOLD).fontSize(14).fillColor(COLORS.text)
        .text('Per-player breakdown', leftX, y);
      y = doc.y + 4;
      doc.font(FONT_REG).fontSize(9).fillColor(COLORS.textMute)
        .text(`${ret.player_breakdown.length} player(s) active in this period`, leftX, y);
      y = doc.y + 10;

      const breakdown: PlayerTaxLine[] = ret.player_breakdown || [];
      if (breakdown.length === 0) {
        doc.font(FONT_REG).fontSize(10).fillColor(COLORS.textMute)
          .text('No players had deposits or winnings in this period.', leftX, y);
        return;
      }

      // Column widths sum to (rightX - leftX). Allotted:
      //   player 160, deposits 90, payouts 90, presumptive 100,
      //   withholding 100, excise 90
      const cols: Array<[string, number, 'left' | 'right']> = [
        ['Player',                  160, 'left'],
        ['Deposits',                 90, 'right'],
        ['Payouts',                  90, 'right'],
        ['Presumptive 15%',         100, 'right'],
        ['Withholding 15%',         100, 'right'],
        ['Excise 5%',                90, 'right'],
      ];
      const colX: number[] = [];
      {
        let x = leftX;
        for (const [, w] of cols) {
          colX.push(x);
          x += w;
        }
      }

      const drawRow = (row: string[], bold = false) => {
        doc.font(bold ? FONT_BOLD : FONT_REG).fontSize(9)
          .fillColor(COLORS.text);
        row.forEach((cell, i) => {
          const [, w, align] = cols[i];
          doc.text(cell, colX[i], y, { width: w, align });
        });
        y += 14;
      };

      drawRow(cols.map(([h]) => h), true);
      doc.moveTo(leftX, y - 2).lineTo(rightX, y - 2)
        .strokeColor(COLORS.rule).lineWidth(0.5).stroke();

      for (const line of breakdown) {
        if (y > doc.page.height - doc.page.margins.bottom - 60) {
          doc.addPage();
          header(doc, operator);
          y = doc.y + 6;
          drawRow(cols.map(([h]) => h), true);
          doc.moveTo(leftX, y - 2).lineTo(rightX, y - 2)
            .strokeColor(COLORS.rule).lineWidth(0.5).stroke();
        }
        drawRow([
          `${line.full_name || '—'}  ${line.phone ? '· ' + line.phone : ''}`,
          formatK(line.deposits),
          formatK(line.payouts),
          formatK(line.presumptive),
          formatK(line.withholding),
          formatK(line.excise),
        ]);
      }

      // Totals row
      y += 4;
      doc.moveTo(leftX, y).lineTo(rightX, y)
        .strokeColor(COLORS.rule).lineWidth(0.5).stroke();
      y += 6;
      const totals: PlayerTaxLine[] = breakdown;
      drawRow([
        'TOTAL',
        formatK(totals.reduce((s, l) => s + l.deposits, 0)),
        formatK(totals.reduce((s, l) => s + l.payouts, 0)),
        formatK(totals.reduce((s, l) => s + l.presumptive, 0)),
        formatK(totals.reduce((s, l) => s + l.withholding, 0)),
        formatK(totals.reduce((s, l) => s + l.excise, 0)),
      ], true);
    });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function renderToBuffer(draw: (doc: PDFKit.PDFDocument) => Promise<void> | void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: 'NaWiNa Lotto',
        Author: 'NaWiNa Lotto',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const r = draw(doc);
      if (r && typeof (r as any).then === 'function') {
        (r as Promise<void>).then(() => doc.end()).catch(reject);
      } else {
        doc.end();
      }
    } catch (e) {
      reject(e);
    }
  });
}

function header(doc: PDFKit.PDFDocument, operator: OperatorProfile): void {
  const leftX = doc.page.margins.left;
  const rightX = doc.page.width - doc.page.margins.right;

  // Teal bar across the top
  doc.save();
  doc.rect(0, 0, doc.page.width, 8).fill(COLORS.accent);
  doc.restore();

  doc.moveDown(0.8);
  doc.font(FONT_BOLD).fontSize(16).fillColor(COLORS.accent)
    .text(operator.company_name, leftX, 18);
  doc.font(FONT_REG).fontSize(8).fillColor(COLORS.textMute)
    .text(`TPIN ${operator.tpin}` +
          (operator.address ? `  ·  ${operator.address}` : '') +
          (operator.phone ? `  ·  ${operator.phone}` : ''),
          leftX, 36,
          { width: rightX - leftX });

  // Move cursor below the header
  doc.y = 60;
}

function formatK(n: number): string {
  // Two-decimal money format. Negative numbers get a minus sign.
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + 'K' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
