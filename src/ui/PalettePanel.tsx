import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { PAINT_ROLES } from '../domain/types';
import type { PaintRole, Palette } from '../domain/types';
import { ROLE_INFO } from '../palette/roles';
import { useEditorApi } from './state/editorContext';
import { IconCheck, IconChevronDown, IconChevronRight, IconTrash, IconUpload } from './icons';
import { PaletteImport } from './PaletteImport';
import { PREVIEW_ROLES, copyText, orderPalettes, radioKeyTarget, roleGroupLabel } from './PalettePanel.logic';
import './PalettePanel.css';

const GROUP_ORDER = ['artboard', 'background', 'objects'] as const;

export function PalettePanel(): JSX.Element {
  const api = useEditorApi();
  const titleId = useId();
  const rolesId = useId();
  const palettes = useMemo(() => orderPalettes(api.palettes), [api.palettes]);
  const activeId = api.palette.id;
  const tabStopId = palettes.some((p) => p.id === activeId) ? activeId : (palettes[0]?.id ?? null);

  const radioRefs = useRef(new Map<string, HTMLButtonElement>());
  const trashRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const refocusRef = useRef(false);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (confirmId) cancelRef.current?.focus();
  }, [confirmId]);

  // After a removal the focused row disappears; return focus to the active palette.
  useLayoutEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    if (tabStopId) radioRefs.current.get(tabStopId)?.focus();
  });

  const onRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const target = radioKeyTarget(event.key, index, palettes.length);
    if (target === null) return;
    const next = palettes[target];
    if (!next) return;
    event.preventDefault();
    api.setPalette(next.id);
    radioRefs.current.get(next.id)?.focus();
  };

  const cancelConfirm = (paletteId: string): void => {
    setConfirmId(null);
    trashRefs.current.get(paletteId)?.focus();
  };

  const confirmRemove = (palette: Palette): void => {
    setConfirmId(null);
    refocusRef.current = true;
    api.removeCustomPalette(palette.id);
    api.announce(`Палитра «${palette.name}» удалена`, 'info');
  };

  const copyHex = async (hex: string): Promise<void> => {
    const ok = await copyText(hex);
    api.announce(ok ? `Скопировано: ${hex}` : 'Не удалось скопировать цвет', ok ? 'success' : 'warning');
  };

  return (
    <section className="panel-section palette" aria-labelledby={titleId}>
      <div className="panel-section__head">
        <h2 id={titleId} className="label-caps">
          Палитра
        </h2>
      </div>

      <div className="palette__list" role="radiogroup" aria-labelledby={titleId}>
        {palettes.map((palette, index) => {
          const checked = palette.id === activeId;
          return (
            <div key={palette.id} className="palette__item">
              <div className={`palette__row${checked ? ' is-checked' : ''}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  ref={(node) => {
                    if (node) radioRefs.current.set(palette.id, node);
                    else radioRefs.current.delete(palette.id);
                  }}
                  className="palette__option"
                  tabIndex={palette.id === tabStopId ? 0 : -1}
                  onClick={() => api.setPalette(palette.id)}
                  onKeyDown={(event) => onRadioKeyDown(event, index)}
                >
                  <span className="palette__swatches" aria-hidden="true">
                    {PREVIEW_ROLES.map((role) => (
                      <span key={role} className="palette__swatch" style={{ backgroundColor: palette.colors[role] }} />
                    ))}
                  </span>
                  <span className="palette__name">{palette.name}</span>
                  {checked ? <IconCheck className="palette__check" /> : null}
                </button>
                {palette.builtIn ? null : (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm palette__remove"
                    aria-label={`Удалить палитру «${palette.name}»`}
                    title="Удалить палитру"
                    ref={(node) => {
                      if (node) trashRefs.current.set(palette.id, node);
                      else trashRefs.current.delete(palette.id);
                    }}
                    onClick={() => setConfirmId(palette.id)}
                  >
                    <IconTrash />
                  </button>
                )}
              </div>
              {confirmId === palette.id ? (
                <div
                  className="palette__confirm"
                  role="group"
                  aria-label={`Подтверждение удаления палитры «${palette.name}»`}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      cancelConfirm(palette.id);
                    }
                  }}
                >
                  <span className="palette__confirm-text">Удалить без возможности вернуть?</span>
                  <button type="button" className="btn btn--sm palette__confirm-yes" onClick={() => confirmRemove(palette)}>
                    Удалить
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    ref={cancelRef}
                    onClick={() => cancelConfirm(palette.id)}
                  >
                    Отмена
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        ref={importRef}
        className="btn btn--block palette__import"
        onClick={() => setImportOpen(true)}
      >
        <IconUpload />
        Импортировать палитру…
      </button>

      <div className="palette__roles">
        <button
          type="button"
          className="palette__roles-toggle"
          aria-expanded={rolesOpen}
          aria-controls={rolesId}
          onClick={() => setRolesOpen((open) => !open)}
        >
          {rolesOpen ? <IconChevronDown /> : <IconChevronRight />}
          <span>Роли цвета</span>
        </button>
        <div id={rolesId} hidden={!rolesOpen}>
          <RolesTable palette={api.palette} onCopy={copyHex} />
        </div>
      </div>

      {importOpen ? (
        <PaletteImport
          onClose={() => {
            setImportOpen(false);
            importRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}

function RolesTable({ palette, onCopy }: { palette: Palette; onCopy: (hex: string) => Promise<void> }): JSX.Element {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    roles: PAINT_ROLES.filter((role) => (ROLE_INFO[role]?.group ?? 'objects') === group),
  })).filter((entry) => entry.roles.length > 0);

  return (
    <table className="palette__table">
      <caption className="visually-hidden">Роли цвета палитры «{palette.name}»</caption>
      <colgroup>
        <col className="palette__col-swatch" />
        <col />
        <col className="palette__col-hex" />
      </colgroup>
      <thead className="visually-hidden">
        <tr>
          <th scope="col">Цвет</th>
          <th scope="col">Роль</th>
          <th scope="col">HEX</th>
        </tr>
      </thead>
      {groups.map(({ group, roles }) => (
        <tbody key={group}>
          <tr>
            <th scope="rowgroup" colSpan={3} className="palette__group label-caps">
              {roleGroupLabel(group)}
            </th>
          </tr>
          {roles.map((role) => (
            <RoleRow key={role} role={role} hex={palette.colors[role]} onCopy={onCopy} />
          ))}
        </tbody>
      ))}
    </table>
  );
}

function RoleRow({
  role,
  hex,
  onCopy,
}: {
  role: PaintRole;
  hex: string;
  onCopy: (hex: string) => Promise<void>;
}): JSX.Element {
  const info = ROLE_INFO[role];
  const label = info?.label ?? role;
  const shown = hex.toUpperCase();
  return (
    <tr className="palette__role">
      <td className="palette__role-swatch">
        <span className="palette__swatch palette__swatch--lg" style={{ backgroundColor: hex }} aria-hidden="true" />
      </td>
      <td className="palette__role-text">
        <span className="palette__role-label">{label}</span>
        {info ? (
          <span className="palette__role-desc" title={info.description}>
            {info.description}
          </span>
        ) : null}
      </td>
      <td className="palette__role-hex">
        <button
          type="button"
          className="palette__hex"
          aria-label={`Скопировать ${label}: ${shown}`}
          title="Скопировать цвет"
          onClick={() => void onCopy(shown)}
        >
          {shown}
        </button>
      </td>
    </tr>
  );
}
