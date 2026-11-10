import { useId } from 'react';
import type { DragEvent, JSX } from 'react';
import { MOTIF_IDS } from '../domain/types';
import type { MotifId } from '../domain/types';
import { motifAvailability, resolveAsset, variantForLayer } from '../assets/availability';
import {
  AVAILABILITY_CELLS,
  FALLBACK_TITLE,
  availabilityCellTitle,
  availabilityDescription,
  catalogNote,
  motifName,
  motifsCountLabel,
} from './briefFormat';
import { MotifThumb } from './MotifThumb';
import { MOTIF_DRAG_MIME, useEditorApi } from './state/editorContext';
import './Catalog.css';

interface CatalogCardProps {
  motif: MotifId;
}

function CatalogCard({ motif }: CatalogCardProps): JSX.Element {
  const api = useEditorApi();
  const descId = useId();
  const name = motifName(motif);

  const availability = motifAvailability(api.files, motif);
  const resolved = resolveAsset(api.files, motif, api.doc.detail, variantForLayer('object', api.doc.colorMode));
  const approximate = resolved !== null && !resolved.exact;

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(MOTIF_DRAG_MIME, motif);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <li className="catalog__item">
      <button
        type="button"
        className="catalog__card"
        draggable
        aria-label={`Добавить «${name}» на холст`}
        aria-describedby={descId}
        onDragStart={handleDragStart}
        onClick={() => api.addMotif(motif)}
      >
        <span className="catalog__thumb">
          <MotifThumb motif={motif} />
        </span>
        <span className="catalog__name">{name}</span>
        <span className="catalog__meta" aria-hidden="true">
          {(['s', 'l'] as const).map((detail) => (
            <span className="catalog__group" key={detail}>
              <span className="catalog__group-label">{detail.toUpperCase()}</span>
              {AVAILABILITY_CELLS.filter((cell) => cell.detail === detail).map((cell) => (
                <span
                  key={cell.key}
                  className="catalog__dot"
                  data-filled={availability[cell.key]}
                  title={availabilityCellTitle(cell.detail, cell.variant, availability[cell.key])}
                />
              ))}
            </span>
          ))}
          {approximate && (
            <span className="catalog__approx" title={FALLBACK_TITLE}>
              ≈
            </span>
          )}
        </span>
      </button>
      <span id={descId} className="visually-hidden">
        {availabilityDescription(availability, approximate)}
      </span>
    </li>
  );
}

export function Catalog(): JSX.Element {
  const api = useEditorApi();
  const headingId = useId();
  const motifs = MOTIF_IDS.filter((id) => api.available.has(id));
  const note = catalogNote(motifs.length, MOTIF_IDS.length);

  return (
    <section className="catalog panel-section" aria-labelledby={headingId}>
      <div className="panel-section__head">
        <h2 id={headingId} className="label-caps">
          Каталог
        </h2>
        <span className="catalog__count">{motifsCountLabel(motifs.length)}</span>
      </div>
      {motifs.length > 0 ? (
        <ul className="catalog__grid" role="list">
          {motifs.map((motif) => (
            <CatalogCard key={motif} motif={motif} />
          ))}
        </ul>
      ) : (
        <p className="catalog__empty">В библиотеке пока нет мотивов</p>
      )}
      {note && <p className="catalog__note">{note}</p>}
    </section>
  );
}
