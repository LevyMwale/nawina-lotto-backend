import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { InvoiceService } from '../services/invoice.service';
import { PdfService } from '../services/pdf.service';
import { User } from '../models/User';
import { TaxService } from '../services/tax.service';

const router = Router();
const invoiceService = new InvoiceService();
const pdfService = new PdfService();
const taxService = new TaxService();

console.log('📦 Invoice routes file loaded');

router.use(authenticate);

// ---------------------------------------------------------------------------
// List the signed-in user's invoices, newest first.
// ---------------------------------------------------------------------------
router.get('/', async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const invoices = await invoiceService.getForUser(req.userId!, limit);
    res.json({
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        amount: Number(i.amount),
        exciseDuty: Number(i.excise_duty),
        netAmount: Number(i.net_amount),
        currency: i.currency,
        issueDate: i.issue_date,
        pdfUrl: `/api/invoices/${i.id}/pdf`,
      })),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Download the PDF for one of the signed-in user's invoices.
// We re-check ownership here: a user can't download someone else's
// invoice even with a guessed id.
// ---------------------------------------------------------------------------
router.get('/:id/pdf', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    const invoice = await invoiceService.getById(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.user_id !== req.userId) {
      return res.status(403).json({ error: 'Not your invoice' });
    }
    const user = await User.query().findById(invoice.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const operator = await taxService.getOperatorProfile();

    const pdf = await pdfService.renderInvoicePdf({ invoice, user, operator });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.invoice_number}.pdf"`,
    );
    res.send(pdf);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
