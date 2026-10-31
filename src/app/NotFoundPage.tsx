import { Link } from 'react-router-dom';
import { SiteLayout } from '@/components/layout/SiteLayout';

export function NotFoundPage() {
  return (
    <SiteLayout>
      <div className="shell shell--narrow" style={{ paddingBlock: 'var(--sp-11)', textAlign: 'center' }}>
        <p className="eyebrow eyebrow--signal" style={{ justifyContent: 'center' }}>
          Signal lost
        </p>
        <h1 style={{ fontSize: 'var(--fs-3xl)', marginBlock: 'var(--sp-4)' }}>Page not found</h1>
        <p className="lead" style={{ marginInline: 'auto' }}>
          That route does not exist in this build. The arena, dashboard and leaderboard are all one
          click away.
        </p>
        <div className="cluster gap-3" style={{ justifyContent: 'center', marginTop: 'var(--sp-7)' }}>
          <Link className="btn btn--primary" to="/">
            Back to overview
          </Link>
          <Link className="btn btn--ghost" to="/dashboard">
            Dashboard
          </Link>
        </div>
      </div>
    </SiteLayout>
  );
}
