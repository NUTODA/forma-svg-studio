// CONTRACT STUB — owned by the semantics agent. Shape is fixed; content to be authored.
import type { MotifId } from './types';

export interface MotifInfo {
  id: MotifId;
  /** Russian display name, nominative singular: «Книга». */
  name: string;
  /** Short Russian description for the catalog: «Раскрытая книга». */
  description: string;
  /** Alternative component names users may type: «книжка», «томик»… */
  aliases: string[];
}

export const MOTIFS: Record<MotifId, MotifInfo> = {} as Record<MotifId, MotifInfo>;
