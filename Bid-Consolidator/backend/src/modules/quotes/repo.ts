import { query, type Db } from '../../db/pool.js';
import { fileUrl } from '../../lib/fileUrls.js';

export interface QuoteRow {
  id: number;
  project_id: number;
  item_id: number | null;
  project_factory_id: number;
  factory_id: number;
  factory_name: string;
  factory_submitted_at: Date | null;
  style_num: string | null;
  description: string | null;
  moq: number | null;
  price: number | null;
  lead_time: string | null;
  image_path: string | null;
  comparison_notes: string | null;
  is_selected_winner: boolean;
  total_fob: number | null;
  base_duty_pct: number | null;
  addl_duty_pct: number | null;
  units_per_container: number | null;
  sell_price: number | null;
  retail_price: number | null;
  etc_amt: number | null;
  submitted_at: Date | null;
  updated_at: Date;
}

const QUOTE_SELECT = `
  SELECT q.id, q.project_id, q.item_id, q.project_factory_id, f.id AS factory_id, f.name AS factory_name,
         pf.submitted_at AS factory_submitted_at, q.style_num, q.description, q.moq, q.price, q.lead_time,
         q.image_path, q.comparison_notes, q.is_selected_winner, q.total_fob, q.base_duty_pct, q.addl_duty_pct,
         q.units_per_container, q.sell_price, q.retail_price, q.etc_amt, q.submitted_at, q.updated_at
    FROM quotes q
    JOIN project_factories pf ON pf.id = q.project_factory_id
    JOIN factories f ON f.id = pf.factory_id`;

export const projectQuotes = (db: Db, projectId: number) =>
  query<QuoteRow>(db, `${QUOTE_SELECT} WHERE q.project_id = $1 ORDER BY lower(f.name), q.id`, [projectId]);

export const quoteById = async (db: Db, projectId: number, quoteId: number) =>
  (await query<QuoteRow>(db, `${QUOTE_SELECT} WHERE q.project_id = $1 AND q.id = $2`, [projectId, quoteId]))[0];

export const winnerQuotes = (db: Db, projectId: number) =>
  query<QuoteRow & { item_position: number; item_style_num: string | null; item_description: string | null }>(db,
    `SELECT x.*, pi.item_index AS item_position, pi.style_num AS item_style_num, pi.description AS item_description
       FROM (${QUOTE_SELECT} WHERE q.project_id = $1 AND q.is_selected_winner) x
       JOIN project_items pi ON pi.id = x.item_id
      WHERE pi.deleted_at IS NULL
      ORDER BY pi.item_index`, [projectId]);

export function quoteDTO(q: QuoteRow) {
  return {
    id: q.id,
    itemId: q.item_id,
    projectFactoryId: q.project_factory_id,
    factory: { id: q.factory_id, name: q.factory_name, submitted: !!q.factory_submitted_at },
    price: q.price,
    moq: q.moq,
    leadTime: q.lead_time,
    styleNum: q.style_num,
    description: q.description,
    imageUrl: fileUrl(q.image_path),
    notes: q.comparison_notes,
    isWinner: q.is_selected_winner,
    submittedAt: q.submitted_at,
    updatedAt: q.updated_at,
  };
}
