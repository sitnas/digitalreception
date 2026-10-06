import { createElement, useMemo, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { generatePattern, type PatternId, type SvgEl } from '../lib/patterns';

/**
 * One card per app (Mortise card guidelines): coloured tile, status, title on two lines, a note and
 * a pattern cut out of the bottom-right corner. Every card has the organisation's secondary colour
 * as its surface and the same accent; the pattern tells the apps apart. One link, on the title,
 * stretched over the whole card; the extra links in the note sit above it.
 */
export interface ModuleCardProps {
  id: string;
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  footnote?: ReactNode;
  icon: ReactNode;
  pattern: PatternId;
  to: string;
  loading?: boolean;
  headingLevel?: 2 | 3 | 4;
}

function render(els: SvgEl[], prefix = ''): ReactNode[] {
  return els.map((e, i) => createElement(e.tag, { key: `${prefix}${i}`, ...e.attrs }, e.children ? render(e.children, `${prefix}${i}-`) : undefined));
}

export function ModuleArt({ id, pattern }: { id: string; pattern: PatternId }) {
  const art = useMemo(() => generatePattern(pattern, id), [id, pattern]);
  return (
    <svg className="mc__art" viewBox={art.viewBox} preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
      {render(art.elements)}
    </svg>
  );
}

export function ModuleCard({ id, title, subtitle, eyebrow, footnote, icon, pattern, to, loading, headingLevel = 3 }: ModuleCardProps) {
  const H = `h${headingLevel}` as 'h3';
  return (
    <article className="mc" data-module={id}>
      <div className="mc__top">
        <span className="mc__tile" aria-hidden="true">{icon}</span>
      </div>
      <div className="mc__body">
        {eyebrow && <p className="mc__eyebrow">{eyebrow}</p>}
        <H className="mc__title">
          <NavLink className="mc__link" to={to}>
            {title}
            {loading ? <span className="mc__sub"><span className="sk mc__sk" /></span> : subtitle ? <span className="mc__sub">{subtitle}</span> : null}
          </NavLink>
        </H>
      </div>
      {footnote ? <div className="mc__foot">{footnote}</div> : <span />}
      <ModuleArt id={id} pattern={pattern} />
    </article>
  );
}
