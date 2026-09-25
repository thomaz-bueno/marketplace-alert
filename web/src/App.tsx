import { useCallback, useEffect, useState } from "react";
import { alertsApi, ApiError, type Alert, type AlertInput } from "./api/alerts";
import AlertForm from "./components/AlertForm";
import AlertList from "./components/AlertList";
import ProductsFound from "./components/ProductsFound";

type Route = "alerts" | "products";
type FormState = { mode: "create" } | { mode: "edit"; alert: Alert };

function currentRoute(): Route {
  return window.location.hash === "#/products" ? "products" : "alerts";
}

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.details.length > 0
      ? error.details.join(" ")
      : error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error";
}

export default function App() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    function onHashChange(): void {
      setRoute(currentRoute());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setAlerts(await alertsApi.list());
    } catch (error) {
      setListError(messageFrom(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setSaveError(null);
    setForm({ mode: "create" });
  }

  function openEdit(alert: Alert): void {
    setSaveError(null);
    setForm({ mode: "edit", alert });
  }

  function closeForm(): void {
    setSaveError(null);
    setForm(null);
  }

  async function handleCreate(input: AlertInput): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await alertsApi.create(input);
      setAlerts((current) => [...current, created]);
      setForm(null);
    } catch (error) {
      setSaveError(messageFrom(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number, input: AlertInput): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await alertsApi.update(id, input);
      setAlerts((current) =>
        current.map((alert) => (alert.id === id ? updated : alert)),
      );
      setForm(null);
    } catch (error) {
      setSaveError(messageFrom(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(alert: Alert): Promise<void> {
    const confirmed = window.confirm(
      `Delete the alert for "${alert.productName}"?`,
    );
    if (!confirmed) return;

    setDeletingId(alert.id);
    setListError(null);
    try {
      await alertsApi.remove(alert.id);
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
    } catch (error) {
      setListError(messageFrom(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="container">
      <header className="topbar">
        <h1>Marketplace Alert</h1>
        <div className="topbar-actions">
          <nav className="nav" aria-label="Sections">
            <a
              href="#/"
              className={route === "alerts" ? "active" : undefined}
            >
              Alerts
            </a>
            <a
              href="#/products"
              className={route === "products" ? "active" : undefined}
            >
              Products
            </a>
          </nav>
          {route === "alerts" && (
            <button type="button" className="primary" onClick={openCreate}>
              + New alert
            </button>
          )}
        </div>
      </header>

      {route === "products" ? (
        <section>
          <h2>Products Found</h2>
          <ProductsFound />
        </section>
      ) : (
        <>
          {form && (
            <AlertForm
              key={form.mode === "edit" ? `edit-${form.alert.id}` : "create"}
              mode={form.mode}
              initial={form.mode === "edit" ? form.alert : undefined}
              submitting={saving}
              error={saveError}
              onSubmit={(input) =>
                form.mode === "edit"
                  ? void handleUpdate(form.alert.id, input)
                  : void handleCreate(input)
              }
              onCancel={closeForm}
            />
          )}

          <section>
            <h2>Alerts</h2>
            <AlertList
              alerts={alerts}
              loading={loading}
              error={listError}
              deletingId={deletingId}
              onRetry={() => void load()}
              onEdit={openEdit}
              onDelete={(alert) => void handleDelete(alert)}
            />
          </section>
        </>
      )}
    </main>
  );
}
