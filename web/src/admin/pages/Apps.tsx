import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useI18n } from '../i18n';
import { APP_KEYS, type AppKey } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

interface AppsInfo { apps: AppKey[]; employees: number; using: Partial<Record<AppKey, number>> }

/**
 * The apps the organisation has, and how many people use each one. They are turned on by the service
 * provider; who uses them is chosen per person, in Employees.
 */
export function AppsPage() {
  const { t } = useI18n();
  const P = t.apps;
  const state = useAsync(() => api.get<AppsInfo>('/admin/apps'), []);
  const info = state.data;

  return (
    <>
      <PageHead title={P.title} intro={P.intro} />
      <ErrorBox error={state.error} />
      {info && (
        <ul className="app-tiles" role="list">
          {APP_KEYS.map((app) => {
            const on = info.apps.includes(app);
            const n = String(info.using[app] ?? 0), total = String(info.employees);
            return (
              <li key={app} className={`a-card app-tile${on ? ' is-on' : ' is-out'}`}>
                <div className="app-tile-head">
                  <h2>{P.items[app].name}</h2>
                  <span className={`pill${on ? ' pill-on' : ''}`}>{on ? P.on : P.off}</span>
                </div>
                <p>{P.items[app].text}</p>
                {on ? (
                  <div className="app-tile-foot">
                    <span className="muted">{(app === 'parking' ? P.usingParking : P.using).replace('{n}', n).replace('{total}', total)}</span>
                    <Link className="btn-link" to="/admin/employees">{P.choose}</Link>
                  </div>
                ) : <p className="hint">{P.notIncluded}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
