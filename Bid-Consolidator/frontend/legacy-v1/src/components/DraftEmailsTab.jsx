import { useState, useEffect } from 'react';
import api from '../utils/api';

function generateEmail(factory, styles, isCompetitive) {
  if (isCompetitive) {
    return `Dear ${factory} Team,

Thank you for submitting your quotation for the following styles:

${styles.map(s => `  • ${s.style_num} – ${s.description}: $${Number(s.price).toFixed(2)}`).join('\n')}

We are pleased to confirm that your pricing is competitive and aligns with our target range. We would like to move forward with these styles.

Please confirm your availability and earliest production start date.

Best regards,
Shalom International Sourcing Team`;
  }

  return `Dear ${factory} Team,

Thank you for submitting your quotation. After reviewing all submissions, we have identified target pricing for the following styles:

${styles.map(s => `  • ${s.style_num} – ${s.description}: Target $${(Number(s.lowestBid) * 1.10).toFixed(2)} (submitted: $${Number(s.price).toFixed(2)})`).join('\n')}

To move forward, we need pricing adjusted to the target levels listed above. Please let us know if this is achievable given your current costs.

We look forward to your response.

Best regards,
Shalom International Sourcing Team`;
}

export default function DraftEmailsTab() {
  const [submissions, setSubmissions] = useState([]);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState({});

  useEffect(() => {
    api.get('/submissions').then(r => setSubmissions(r.data)).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!submissions.length) { setLoading(false); return; }
    setLoading(true);
    const subs = submissions.filter(s => s.status !== 'rejected');
    Promise.all(subs.map(s => api.get(`/submissions/${s.id}/products`).then(r => ({ factory: s.factory_name, products: r.data }))))
      .then(results => {
        const styleLowest = {};
        for (const { products } of results) {
          for (const p of products) {
            if (p.price && (!styleLowest[p.style_num] || p.price < styleLowest[p.style_num])) {
              styleLowest[p.style_num] = p.price;
            }
          }
        }

        const drafts = results.map(({ factory, products }) => {
          const annotated = products.map(p => ({
            ...p,
            lowestBid: styleLowest[p.style_num],
            isCompetitive: p.price && p.price <= styleLowest[p.style_num] * 1.10,
          }));
          const competitive = annotated.filter(p => p.isCompetitive);
          const overpriced = annotated.filter(p => !p.isCompetitive && p.price);
          const result = [];
          if (competitive.length) result.push({ factory, type: 'confirmation', styles: competitive, text: generateEmail(factory, competitive, true) });
          if (overpriced.length) result.push({ factory, type: 'counter', styles: overpriced, text: generateEmail(factory, overpriced, false) });
          return result;
        });

        setEmails(drafts.flat());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [submissions]);

  function copyEmail(idx, text) {
    navigator.clipboard.writeText(text);
    setCopied(c => ({ ...c, [idx]: true }));
    setTimeout(() => setCopied(c => ({ ...c, [idx]: false })), 2000);
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Draft Emails</h2>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Generating...</div>
      ) : emails.length === 0 ? (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>No submissions yet. Upload factory quote sheets from the Submissions tab.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {emails.map((email, idx) => (
            <div key={idx} style={s.card}>
              <div style={s.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={s.factory}>{email.factory}</span>
                  <span style={{ ...s.badge, ...(email.type === 'confirmation' ? s.confirm : s.counter) }}>
                    {email.type === 'confirmation' ? 'Confirmation' : 'Counter-Offer'}
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{email.styles.length} style{email.styles.length !== 1 ? 's' : ''}</span>
                </div>
                <button
                  style={{ ...s.copyBtn, ...(copied[idx] ? s.copiedBtn : {}) }}
                  onClick={() => copyEmail(idx, email.text)}
                >
                  {copied[idx] ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre style={s.emailBody}>{email.text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' },
  factory: { fontWeight: 700, color: '#0f172a', fontSize: 14 },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  confirm: { background: '#dcfce7', color: '#166534' },
  counter: { background: '#fef9c3', color: '#854d0e' },
  emailBody: { padding: '16px 18px', fontSize: 13, lineHeight: 1.7, color: '#334155', whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif', margin: 0 },
  copyBtn: { padding: '5px 14px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  copiedBtn: { background: '#166534', color: '#fff' },
};
