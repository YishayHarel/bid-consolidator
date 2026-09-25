// Items (the rows of a project's compare sheet). Identity is the surrogate `id`;
// `position` (legacy column item_index) is display order only. Every read of
// "the project's items" goes through activeItems() so soft-deleted items are
// excluded consistently everywhere (the old code forgot this in several places).
import type { PoolClient } from 'pg';
import { query, type Db } from '../../db/pool.js';
import { fileUrl } from '../../lib/fileUrls.js';

export interface ItemRow {
  id: number;
  project_id: number;
  item_index: number;
  style_num: string | null;
  description: string | null;
  moq: number | null;
  last_price: number | null;
  inner_pack: number | null;
  master_pack: number | null;
  cad_id: number | null;
  deleted_at: Date | null;
  images: { position: number; key: string }[];
}

const ITEM_SELECT = `
  SELECT pi.id, pi.project_id, pi.item_index, pi.style_num, pi.description, pi.moq, pi.last_price,
         pi.inner_pack, pi.master_pack, pi.cad_id, pi.deleted_at,
         COALESCE((SELECT json_agg(json_build_object('position', img."position", 'key', img.image_path) ORDER BY img."position")
                     FROM project_item_images img WHERE img.item_id = pi.id AND img.image_path IS NOT NULL), '[]') AS images
    FROM project_items pi`;

export const activeItems = (db: Db, projectId: number) =>
  query<ItemRow>(db, `${ITEM_SELECT} WHERE pi.project_id = $1 AND pi.deleted_at IS NULL ORDER BY pi.item_index`, [projectId]);

export const deletedItems = (db: Db, projectId: number) =>
  query<ItemRow>(db, `${ITEM_SELECT} WHERE pi.project_id = $1 AND pi.deleted_at IS NOT NULL ORDER BY pi.deleted_at DESC`, [projectId]);

export const itemById = async (db: Db, projectId: number, itemId: number) =>
  (await query<ItemRow>(db, `${ITEM_SELECT} WHERE pi.project_id = $1 AND pi.id = $2`, [projectId, itemId]))[0];

export function itemDTO(r: ItemRow) {
  const images = r.images.map((i) => ({ position: i.position, url: fileUrl(i.key) }));
  return {
    id: r.id,
    position: r.item_index,
    styleNum: r.style_num,
    description: r.description,
    moq: r.moq,
    targetPrice: r.last_price,
    innerPack: r.inner_pack,
    masterPack: r.master_pack,
    cadId: r.cad_id,
    imageUrl: images[0]?.url ?? null,
    images,
    deletedAt: r.deleted_at,
  };
}

export interface NewItem {
  styleNum?: string | null;
  description?: string | null;
  moq?: number | null;
  targetPrice?: number | null;
  innerPack?: number | null;
  masterPack?: number | null;
  cadId?: number | null;
  imageKeys?: string[];
}

/**
 * Append items to a project inside a transaction. Positions are allocated under
 * a row lock on the project, so concurrent imports can't collide on position.
 * Returns the new item ids in input order.
 */
export async function createItems(tx: PoolClient, projectId: number, items: NewItem[]): Promise<number[]> {
  if (!items.length) return [];
  await tx.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
  const next = (await query<{ n: number }>(tx, 'SELECT COALESCE(max(item_index), -1) + 1 AS n FROM project_items WHERE project_id = $1', [projectId]))[0]!.n;
  const ids: number[] = [];
  for (const [i, it] of items.entries()) {
    const row = (await query<{ id: number }>(tx,
      `INSERT INTO project_items (project_id, item_index, style_num, description, moq, last_price, inner_pack, master_pack, cad_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [projectId, next + i, it.styleNum ?? null, it.description ?? null, it.moq ?? null, it.targetPrice ?? null,
       it.innerPack ?? null, it.masterPack ?? null, it.cadId ?? null]))[0]!;
    for (const [pos, key] of (it.imageKeys ?? []).entries()) {
      await tx.query(
        `INSERT INTO project_item_images (item_id, project_id, "position", image_path) VALUES ($1, $2, $3, $4)`,
        [row.id, projectId, pos, key],
      );
    }
    ids.push(row.id);
  }
  return ids;
}

/** Replace an item's primary image (position 0) with a CAD's file, or clear it. */
export async function setPrimaryImage(tx: PoolClient, projectId: number, itemId: number, key: string | null) {
  await tx.query('DELETE FROM project_item_images WHERE item_id = $1 AND "position" = 0', [itemId]);
  if (key) {
    await tx.query(`INSERT INTO project_item_images (item_id, project_id, "position", image_path) VALUES ($1, $2, 0, $3)`, [itemId, projectId, key]);
  }
}
