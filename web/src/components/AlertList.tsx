import type { Alert } from "../api/alerts";

interface Props {
  alerts: Alert[];
  loading: boolean;
  error: string | null;
  deletingId: number | null;
  onRetry: () => void;
  onEdit: (alert: Alert) => void;
  onDelete: (alert: Alert) => void;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function AlertList({
  alerts,
  loading,
  error,
  deletingId,
  onRetry,
  onEdit,
  onDelete,
}: Props) {
  if (loading) {
    return <p className="muted">Loading alerts…</p>;
  }

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {alerts.length === 0 ? (
        <p className="muted">No alerts yet. Create your first alert.</p>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => (
            <li key={alert.id} className="card alert-item">
              <div>
                <h3>{alert.productName}</h3>
                <p className="meta">{alert.city}</p>
                <p className="meta price">Up to {brl.format(alert.maxPrice)}</p>
              </div>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => onEdit(alert)}
                  disabled={deletingId !== null}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(alert)}
                  disabled={deletingId !== null}
                >
                  {deletingId === alert.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
